import type { KribilSetup, ShotSpec, SimFrame, SimResult } from './types';
import { createWorld, snapshot, stepWorld } from './world';

export const DEFAULT_DT = 1 / 240;

export interface SimOptions {
  dt?: number;
  recordFrames?: boolean;
  frameInterval?: number;
}

/**
 * Полная симуляция заезда по плану ударов. Детерминирована.
 * Завершается по финишу шар1, остановке всех шаров или лимиту времени.
 */
export function simulate(
  setup: KribilSetup,
  shots: ShotSpec[],
  opts: SimOptions = {}
): SimResult {
  const dt = opts.dt ?? DEFAULT_DT;
  const record = opts.recordFrames ?? true;
  const interval = opts.frameInterval ?? 1 / 30;

  const w = createWorld(setup, shots);
  const frames: SimFrame[] = record ? [snapshot(w)] : [];
  let nextT = interval;
  while (!w.done) {
    stepWorld(w, dt);
    if (record && w.time >= nextT) {
      frames.push(snapshot(w));
      nextT += interval;
    }
  }
  if (record) {
    const last = frames[frames.length - 1];
    if (!last || last.t < w.time) frames.push(snapshot(w));
  }

  const cpTimes = setup.checkpoints.map(() => null as number | null);
  for (const e of w.events) {
    if (e.kind === 'checkpoint' && e.cp != null && cpTimes[e.cp] == null) cpTimes[e.cp] = e.t;
  }

  return {
    success: w.finished,
    finishTime: w.finishTime,
    cpTimes,
    cpMiss: w.cpMinDist.map((d) => (d === Infinity ? w.table.width : d)),
    passedCount: w.passedCount,
    events: [...w.events],
    frames,
    endTime: w.time,
    ball1HitCount: w.ball1HitCount,
  };
}

/** Позиции шаров в момент t (линейная интерполяция между кадрами). */
export function frameAt(frames: SimFrame[], t: number): Record<string, { x: number; y: number }> {
  if (frames.length === 0) return {};
  if (t <= frames[0].t) return frames[0].pos;
  const last = frames[frames.length - 1];
  if (t >= last.t) return last.pos;
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const k = (t - a.t) / Math.max(1e-9, b.t - a.t);
  const out: Record<string, { x: number; y: number }> = {};
  for (const id of Object.keys(a.pos) as (keyof typeof a.pos)[]) {
    out[id] = {
      x: a.pos[id].x + (b.pos[id].x - a.pos[id].x) * k,
      y: a.pos[id].y + (b.pos[id].y - a.pos[id].y) * k,
    };
  }
  return out;
}

/** Хвост траектории шар1 для отрисовки. */
export function trailFromFrames(frames: SimFrame[], t: number, maxPoints = 260) {
  const pts: { x: number; y: number }[] = [];
  for (const f of frames) {
    if (f.t > t) break;
    const p = f.pos['ball1'];
    if (p) pts.push(p);
  }
  return pts.slice(-maxPoints);
}
