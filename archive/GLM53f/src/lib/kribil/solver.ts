import type { Checkpoint, KribilSetup, ShotSpec, SimResult } from './types';
import { simulate } from './simulate';
import { clamp, TAU } from './vec';

/** Детерминированный ГПСЧ (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

export type OptDim = 't' | 'angle' | 'power';

export interface SolveOptions {
  iterations?: number; // итераций CEM
  population?: number; // кандидатов на итерацию
  elites?: number;
  seed?: number;
  dt?: number; // шаг физики при поиске (должен совпадать с финальным для согласованности)
  maxShotTime?: number;
  maxPower?: number;
  minPower?: number;
  optimize?: OptDim[]; // какие параметры искать (остальные берутся из baseShots)
  marginWeight?: number; // вес штрафа за проход КТ по краю (в поиске)
  onProgress?: (info: {
    evaluations: number;
    totalEvals: number;
    iteration: number;
    iterations: number;
    bestLoss: number | null;
    bestFinish: number | null;
  }) => void;
}

/**
 * Функция потерь плана: финиш → время финиша (чем меньше, тем лучше);
 * иначе штраф 10000 за каждую непройденную КТ + время последнего прогресса.
 * Дополнительно штрафуется проход КТ «по краю» (большой cpMiss): это вынуждает
 * оптимизатор искать планы с запасом через центр КТ — они устойчивы к округлению
 * параметров и вариациям шага интегрирования.
 */
export function planLoss(r: SimResult, checkpoints: Checkpoint[], marginWeight = 6): number {
  const totalCp = checkpoints.length;
  let marginPenalty = 0;
  for (let i = 0; i < totalCp; i++) {
    const radius = checkpoints[i].radius;
    const miss = Math.min(r.cpMiss[i] ?? radius, radius);
    marginPenalty += (miss / radius) * marginWeight;
  }
  if (r.success && r.finishTime != null) return r.finishTime + marginPenalty;
  let last: number | null = null;
  for (const e of r.events) if (e.kind === 'checkpoint') last = e.t;
  return 10000 * (totalCp - r.passedCount) + (last ?? r.endTime) + marginPenalty;
}

export interface CemSession {
  readonly done: boolean;
  readonly evaluations: number;
  readonly totalEvals: number;
  readonly bestLoss: number | null;
  runChunk(n: number): void;
  finish(): { plan: ShotSpec[]; loss: number; result: SimResult | null; evaluations: number };
}

const ALL_DIMS: OptDim[] = ['t', 'angle', 'power'];
const STD_INIT: Record<OptDim, number> = { t: 4, angle: 1.1, power: 320 };
const STD_FLOOR: Record<OptDim, number> = { t: 0.12, angle: 0.02, power: 22 };
const REFINE_STEP: Record<OptDim, number> = { t: 0.35, angle: 0.035, power: 70 };

/**
 * CEM-сессия: стохастическая оптимизация плана ударов.
 * Градиентный спуск здесь плохо работает: столкновения делают ландшафт потерь
 * кусочно-разрывным (момент контакта «щелкает» дискретно), поэтому используем
 * кросс-энтропийный метод (population-based search) + локальную доводку.
 */
export function createCemSession(
  setup: KribilSetup,
  baseShots: ShotSpec[],
  opts: SolveOptions = {}
): CemSession {
  const iterations = opts.iterations ?? 9;
  const population = opts.population ?? 56;
  const elites = Math.max(4, opts.elites ?? Math.floor(population * 0.25));
  const rng = mulberry32(opts.seed ?? 42);
  const maxShotTime = opts.maxShotTime ?? 30;
  const maxPower = opts.maxPower ?? 1400;
  const minPower = opts.minPower ?? 60;
  const mask = opts.optimize ?? ALL_DIMS;
  const dt = opts.dt ?? 1 / 240;
  const marginW = opts.marginWeight ?? 6;
  const cps = setup.checkpoints;

  function evalParams(params: number[]): number {
    const r = simulate(setup, paramsToShots(params), { dt, recordFrames: false });
    return planLoss(r, cps, marginW);
  }

  /** Полировка: усиленный штраф за край КТ — план «продавливается» к центрам колец. */
  function evalRefine(params: number[]): number {
    const r = simulate(setup, paramsToShots(params), { dt, recordFrames: false });
    return planLoss(r, cps, 18);
  }

  const dims: Array<{ shot: number; dim: OptDim }> = [];
  baseShots.forEach((s, i) => {
    if (!s.enabled) return;
    for (const d of ALL_DIMS) if (mask.includes(d)) dims.push({ shot: i, dim: d });
  });

  const lo: number[] = [];
  const hi: number[] = [];
  for (const d of dims) {
    if (d.dim === 't') {
      lo.push(0);
      hi.push(maxShotTime);
    } else if (d.dim === 'angle') {
      lo.push(0);
      hi.push(TAU);
    } else {
      lo.push(minPower);
      hi.push(maxPower);
    }
  }

  const startParams = dims.map((d, k) => {
    let v = baseShots[d.shot][d.dim];
    if (d.dim === 'angle') v = ((v % TAU) + TAU) % TAU; // wrap перед clamp!
    return clamp(v, lo[k], hi[k]);
  });

  function paramsToShots(params: number[]): ShotSpec[] {
    const out = baseShots.map((s) => ({ ...s }));
    dims.forEach((d, k) => {
      let v = params[k];
      if (d.dim === 'angle') v = ((v % TAU) + TAU) % TAU;
      out[d.shot] = { ...out[d.shot], [d.dim]: clamp(v, lo[k], hi[k]) } as ShotSpec;
    });
    return out;
  }

  let iter = 0;
  let evalInIter = 0;
  let evaluations = 0;
  let mean = [...startParams];
  let std = dims.map((d) => STD_INIT[d.dim]);
  let batch: number[][] = [];
  const iterLosses: Array<{ params: number[]; loss: number }> = [];

  const baseRes = simulate(setup, baseShots, { dt, recordFrames: false });
  let best: { params: number[]; loss: number } = {
    params: [...startParams],
    loss: planLoss(baseRes, cps),
  };

  function nextBatch(): void {
    batch = [];
    for (let p = 0; p < population; p++) {
      // элитизм: глобальный лучший кандидат переносится в новую популяцию
      if (p === 0) {
        batch.push([...best.params]);
        continue;
      }
      const v: number[] = [];
      for (let k = 0; k < dims.length; k++) {
        v.push(clamp(mean[k] + std[k] * randn(rng), lo[k], hi[k]));
      }
      batch.push(v);
    }
  }

  const totalEvals = iterations * population;

  const session: CemSession = {
    get done() {
      return iter >= iterations;
    },
    get evaluations() {
      return evaluations;
    },
    get totalEvals() {
      return totalEvals;
    },
    get bestLoss() {
      return best.loss;
    },
    runChunk(n: number) {
      if (this.done) return;
      if (batch.length === 0 && evalInIter === 0) nextBatch();
      let budget = n;
      while (budget > 0 && evalInIter < population) {
        const params = batch[evalInIter++];
        const loss = evalParams(params);
        iterLosses.push({ params, loss });
        if (loss < best.loss) best = { params: [...params], loss };
        evaluations++;
        budget--;
      }
      if (evalInIter >= population) {
        iterLosses.sort((a, b) => a.loss - b.loss);
        const elite = iterLosses.slice(0, Math.min(elites, iterLosses.length));
        const eliteMean = dims.map((_, k) => elite.reduce((s, e) => s + e.params[k], 0) / elite.length);
        // сглаженный сдвиг среднего: 0.7 к элите + 0.3 к прошлому среднему
        const newMean = dims.map((_, k) => 0.7 * eliteMean[k] + 0.3 * mean[k]);
        std = dims.map((_, k) => {
          const m = newMean[k];
          const variance =
            elite.reduce((s, e) => s + (e.params[k] - m) ** 2, 0) / Math.max(1, elite.length);
          return Math.max(STD_FLOOR[dims[k].dim], Math.sqrt(variance) * 0.85);
        });
        mean = newMean;
        iter++;
        evalInIter = 0;
        iterLosses.length = 0;
        batch = [];
        const bl = best.loss;
        opts.onProgress?.({
          evaluations,
          totalEvals,
          iteration: iter,
          iterations,
          bestLoss: bl,
          bestFinish: bl < 10000 ? bl : null,
        });
      }
    },
    finish() {
      // финальная оценка должна считаться от лучшего найденного (потенциально улучшенного полировкой)
      let params = [...best.params];
      let curLoss = evalRefine(params); // приводим оценку к строгой шкале
      for (const factor of [1, 0.4]) {
        for (let k = 0; k < dims.length; k++) {
          const step = REFINE_STEP[dims[k].dim] * factor;
          const tryV = (v: number) => {
            const cand = [...params];
            cand[k] = v;
            const l = evalRefine(cand);
            if (l < curLoss) {
              params = cand;
              curLoss = l;
            }
          };
          tryV(clamp(params[k] + step, lo[k], hi[k]));
          tryV(clamp(params[k] - step, lo[k], hi[k]));
        }
      }
      const plan = paramsToShots(params);
      const result = simulate(setup, plan, { dt: 1 / 240, recordFrames: true });
      return { plan, loss: curLoss, result, evaluations };
    },
  };

  return session;
}

/** Однократный полный запуск оптимизации (используется в тестах и ботах). */
export function solvePlan(
  setup: KribilSetup,
  baseShots: ShotSpec[],
  opts: SolveOptions = {}
): { plan: ShotSpec[]; loss: number; result: SimResult | null; evaluations: number } {
  const session = createCemSession(setup, baseShots, opts);
  while (!session.done) session.runChunk(opts.population ?? 56);
  return session.finish();
}
