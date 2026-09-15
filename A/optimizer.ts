import { runSim, planCost, type SimResult } from "./simulate";
import { contactPoint, norm } from "./geo";
import { mulberry32, PLAYERS } from "./levels";
import type { Checkpoint, PhysicsParams, Shot, TableSpec, Vec } from "./types";

export interface SolveConfig {
	table: TableSpec;
	params: PhysicsParams;
	object: Vec;
	/** стартовая расстановка битков (в locked-режиме — фиксированная) */
	cues: Vec[];
	checkpoints: Checkpoint[];
	maxTime: number;
	maxPower: number;
	placement: "free" | "locked";
	timeMode: boolean;
	fps: number;
	sub: number;
	seed: number;
	/** стартовый план пользователя (если задан — оптимизатор продолжает от него) */
	seedPlan?: Shot[];
	/** какие удары разрешено менять */
	iterations?: number;
}

export interface State {
	shots: Shot[];
	cues: Vec[];
}

export interface Progress {
	phase: string;
	iter: number;
	cost: number;
	best: number;
	solved: boolean;
	time: number;
	evals: number;
	note: string;
}

export interface Solution {
	state: State;
	res: SimResult;
	cost: number;
	evals: number;
	iters: number;
}

type Kind = "angle" | "power" | "t" | "cx" | "cy";
interface PSpec {
	k: Kind;
	i: number;
	min: number;
	max: number;
	step: number;
}

function specs(cfg: SolveConfig, st: State): PSpec[] {
	const out: PSpec[] = [];
	st.shots.forEach((s, i) => {
		if (s.locked) return;
		out.push({ k: "angle", i, min: -Math.PI, max: Math.PI, step: 0.018 });
		out.push({ k: "power", i, min: 0.06, max: cfg.maxPower, step: 0.05 });
		if (cfg.timeMode) out.push({ k: "t", i, min: 0, max: cfg.maxTime * 0.85, step: 0.015 });
	});
	if (cfg.placement === "free") {
		st.cues.forEach((_c, i) => out.push({ k: "cx", i, min: 0.05, max: cfg.table.w - 0.05, step: 0.012 }));
		st.cues.forEach((_c, i) => out.push({ k: "cy", i, min: 0.05, max: cfg.table.h - 0.05, step: 0.012 }));
	}
	return out;
}

function get(st: State, p: PSpec): number {
	switch (p.k) {
		case "angle":
			return st.shots[p.i].angle;
		case "power":
			return st.shots[p.i].power;
		case "t":
			return st.shots[p.i].t;
		case "cx":
			return st.cues[p.i].x;
		case "cy":
			return st.cues[p.i].y;
	}
}

function set(st: State, p: PSpec, val: number) {
	const clamp = Math.max(p.min, Math.min(p.max, val));
	switch (p.k) {
		case "angle":
			st.shots[p.i].angle = clamp;
			break;
		case "power":
			st.shots[p.i].power = clamp;
			break;
		case "t":
			st.shots[p.i].t = Math.max(0, clamp);
			break;
		case "cx":
			st.cues[p.i].x = clamp;
			break;
		case "cy":
			st.cues[p.i].y = clamp;
			break;
	}
}

const clone = (s: State): State => ({ shots: s.shots.map((x) => ({ ...x })), cues: s.cues.map((c) => ({ ...c })) });

function overlapPenalty(st: State, params: PhysicsParams) {
	const all = st.cues;
	let pen = 0;
	const min = params.ballRadius * 2 + 0.004;
	for (let i = 0; i < all.length; i++)
		for (let j = i + 1; j < all.length; j++) {
			const d = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y);
			if (d < min) pen += (min - d) ** 2 * 400;
		}
	return pen;
}

export function evaluate(cfg: SolveConfig, st: State): SimResult {
	return runSim({
		table: cfg.table,
		params: cfg.params,
		object: cfg.object,
		cues: st.cues,
		checkpoints: cfg.checkpoints,
		shots: st.shots,
		maxTime: cfg.maxTime,
		fps: cfg.fps,
		sub: cfg.sub,
		holdAfterFinish: 0.2,
		trackNearest: true,
		objectColor: "#fdf3d3",
		cueColors: PLAYERS.map((p) => p.color),
	});
}

export function costOf(cfg: SolveConfig, st: State): { cost: number; res: SimResult } {
	const res = evaluate(cfg, st);
	return { cost: planCost(res, { guide: 26, miss: 1500 }) + overlapPenalty(st, cfg.params), res };
}

/* ────────────────────────── constructive init ────────────────────────── */

function powerFor(cfg: SolveConfig, distance: number) {
	const f = Math.max(0.02, cfg.params.friction);
	// путь при экспоненциальном трении: s = v0/f * (1 - e^{-fT}) → v0 ≈ f*s*1.35
	const v0 = f * distance * 1.45 + 0.12;
	return Math.max(0.1, Math.min(cfg.maxPower, v0 * cfg.params.cueMass));
}

function legCost(cfg: SolveConfig, st: State, k: number): number {
	const res = evaluate(cfg, st);
	let c = 0;
	for (let i = 0; i <= k; i++) {
		const p = res.passed[i];
		if (Number.isNaN(p)) {
			const near = res.nearest[i];
			c += 400 + 30 * (Number.isFinite(near) ? near : 2);
		} else c += p;
	}
	return c + overlapPenalty(st, cfg.params);
}

/** Локальный поиск для одного ребра: угол → сила → время. */
function* legSearch(cfg: SolveConfig, st: State, k: number, rnd: () => number): Generator<Progress, void, void> {
	const cp = cfg.checkpoints[k];
	const src = k === 0 ? cfg.object : cfg.checkpoints[k - 1];
	const dir = norm({ x: cp.x - src.x, y: cp.y - src.y });
	const sumR = cfg.params.ballRadius * 2;
	const C = contactPoint(src, dir, sumR);
	const tBase = st.shots.length ? Math.max(0, ...st.shots.map((s) => s.t)) : 0;
	const players = cfg.cues.length;

	// кого назначить: ближайший биток к точке контакта
	let bestPlayer = 0;
	let bestD = Infinity;
	for (let p = 0; p < players; p++) {
		const d = Math.hypot(C.x - st.cues[p].x, C.y - st.cues[p].y);
		if (d < bestD) {
			bestD = d;
			bestPlayer = p;
		}
	}
	const baseAngle = Math.atan2(C.y - st.cues[bestPlayer].y, C.x - st.cues[bestPlayer].x);
	const basePower = powerFor(cfg, bestD);
	const shot: Shot = {
		id: `auto-${k}`,
		player: bestPlayer,
		t: k === 0 ? 0 : Math.max(0, tBase + 0.55),
		angle: baseAngle,
		power: basePower,
	};
	st.shots.push(shot);

	let bestCost = legCost(cfg, st, k);

	const sweep = (name: string, apply: (v: number) => void, back: () => number, cands: number[], per: number) => {
		let improved = false;
		for (let i = 0; i < cands.length; i++) {
			const keep = back();
			apply(cands[i]);
			const c = legCost(cfg, st, k);
			if (c < bestCost - 1e-9) {
				bestCost = c;
				improved = true;
			} else apply(keep);
			void name;
			void per;
		}
		return improved;
	};

	// 1) прицел — веером вокруг геометрического решения
	sweep(
		"angle",
		(v) => (shot.angle = v),
		() => shot.angle,
		Array.from({ length: 13 }, (_u, i) => baseAngle + (i - 6) * 0.032),
		13,
	);
	// 2) сила
	sweep(
		"power",
		(v) => (shot.power = v),
		() => shot.power,
		[0.5, 0.7, 0.85, 1.15, 1.45, 1.9, 2.4, 3.0].map((m) => Math.max(0.06, Math.min(cfg.maxPower, basePower * m))),
		8,
	);
	// 3) тайминг удара (важен, когда шар 1 уже в движении)
	if (cfg.timeMode && k > 0) {
		const t0 = shot.t;
		sweep(
			"t",
			(v) => (shot.t = Math.max(0, v)),
			() => shot.t,
			Array.from({ length: 18 }, (_u, i) => t0 + (i - 8) * 0.1),
			18,
		);
		if (Math.abs(shot.t - t0) > 1e-9) {
			// сдвиг удара меняет и точку касания — пересчитаем прицел
			sweep(
				"angle2",
				(v) => (shot.angle = v),
				() => shot.angle,
				Array.from({ length: 9 }, (_u, i) => shot.angle + (i - 4) * 0.02),
				9,
			);
		}
	}
	yield { phase: "маршрут", iter: k, cost: bestCost, best: bestCost, solved: false, time: 0, evals: 40, note: `К-${k + 1}: черновик принят` };
	// подгонка позиции битка (free)
	if (cfg.placement === "free") {
		const Q = st.cues[bestPlayer];
		for (let i = 0; i < 10; i++) {
			const dx = (rnd() - 0.5) * 0.36;
			const dy = (rnd() - 0.5) * 0.36;
			const px = Q.x;
			const py = Q.y;
			Q.x = Math.max(0.06, Math.min(cfg.table.w - 0.06, Q.x + dx));
			Q.y = Math.max(0.06, Math.min(cfg.table.h - 0.06, Q.y + dy));
			const c = legCost(cfg, st, k);
			if (c < bestCost - 1e-9) bestCost = c;
			else {
				Q.x = px;
				Q.y = py;
			}
			yield { phase: "маршрут", iter: k, cost: bestCost, best: bestCost, solved: false, time: 0, evals: 10, note: `К-${k + 1}: позиция битка` };
		}
		// пересчитать угол после сдвига
		shot.angle = Math.atan2(C.y - Q.y, C.x - Q.x);
		shot.power = powerFor(cfg, Math.hypot(C.x - Q.x, C.y - Q.y));
	}
}

/* ────────────────────────── polish: GD + coordinate descent + anneal ────────────────────────── */

function* solveGenerator(
	cfg: SolveConfig,
	budget: { iters: number },
	out: { best: Solution | null },
): Generator<Progress, Solution, void> {
	const rnd = mulberry32(cfg.seed || 1);
	const st: State = {
		shots: (cfg.seedPlan ?? []).map((s, i) => ({ ...s, id: s.id || `s${i}` })),
		cues: cfg.cues.map((c) => ({ ...c })),
	};
	let evals = 0;
	const cost = (s: State) => {
		evals++;
		return costOf(cfg, s);
	};

	let cur = cost(st);
	let best = { state: clone(st), cost: cur.cost, res: cur.res };
	let stall = 0;
	const publish = () => {
		if (!out.best || best.cost < out.best.cost - 1e-9) {
			out.best = { state: clone(best.state), res: best.res, cost: best.cost, evals, iters: 0 };
		}
	};
	publish();
	yield { phase: "старт", iter: 0, cost: cur.cost, best: best.cost, solved: cur.res.solved, time: cur.res.finishAt, evals, note: st.shots.length ? "текущий план" : "пустой план" };

	if (!cfg.seedPlan || st.shots.length < cfg.checkpoints.length) {
		st.shots = [];
		for (let k = 0; k < cfg.checkpoints.length; k++) {
			const g = legSearch(cfg, st, k, rnd);
			for (;;) {
				const r = g.next();
				if (r.done) break;
				yield { ...r.value, evals };
			}
		}
		cur = cost(st);
		if (cur.cost < best.cost) best = { state: clone(st), cost: cur.cost, res: cur.res };
		publish();
		yield { phase: "геометрия", iter: 0, cost: cur.cost, best: best.cost, solved: cur.res.solved, time: cur.res.finishAt, evals, note: "черновик маршрута готов" };
	}

	let state = clone(st);
	const ps = specs(cfg, state);
	let iter = 0;
	let temp = 0.6;

	while (iter < budget.iters) {
		iter++;
		// ── градиентный спуск (конечные разности) + линейный поиск ──
		if (iter % 3 !== 0) {
			const g = ps.map((p) => {
				const a = get(state, p);
				const e = p.step;
				set(state, p, a + e);
				const cp1 = cost(state).cost;
				set(state, p, a - e);
				const cm1 = cost(state).cost;
				set(state, p, a);
				return (cp1 - cm1) / (2 * e);
			});
			const gn = Math.hypot(...g) || 1;
			let lr = 0.9;
			let base = best.cost;
			const x0 = ps.map((p) => get(state, p));
			let accepted = false;
			for (let ls = 0; ls < 4; ls++) {
				ps.forEach((p, i) => set(state, p, x0[i] - (lr * g[i]) / gn * p.step * 8));
				const c = cost(state).cost;
				if (c < base - 1e-9) {
					accepted = true;
					base = c;
					break;
				}
				lr *= 0.45;
			}
			if (!accepted) {
				ps.forEach((p, i) => set(state, p, x0[i]));
			} else {
				const r = cost(state);
				if (r.cost < best.cost) {
					best = { state: clone(state), cost: r.cost, res: r.res };
					stall = 0;
					publish();
				}
			}
			yield { phase: "градиент", iter, cost: cost(state).cost, best: best.cost, solved: best.res.solved, time: best.res.finishAt, evals, note: "∇ по конечным разностям" };
		}

		// ── координатный спуск с множащимся шагом (устойчив к шуму дискретной симуляции) ──
		let improved = false;
		for (let pi = 0; pi < ps.length; pi++) {
			const p = ps[pi];
			let cur0 = get(state, p);
			let bestLocal = cost(state).cost;
			for (const mult of [1, 2.5, 6]) {
				for (const dir of [1, -1]) {
					const cand = cur0 + dir * p.step * mult;
					set(state, p, cand);
					const c = cost(state).cost;
					if (c < bestLocal - 1e-9) {
						bestLocal = c;
						cur0 = get(state, p);
						improved = true;
					}
				}
			}
			set(state, p, cur0);
		}
		const rc = cost(state);
		if (rc.cost < best.cost) {
			best = { state: clone(state), cost: rc.cost, res: rc.res };
			stall = 0;
			publish();
		} else stall++;
		yield { phase: "координаты", iter, cost: rc.cost, best: best.cost, solved: best.res.solved, time: best.res.finishAt, evals, note: improved ? "улучшение" : "плато" };

		// ── отжиг: выброс из плато (Метрополис по возмущению всех параметров) ──
		if (stall > 2 || !best.res.solved) {
			for (let a = 0; a < 16; a++) {
				const trial = clone(state);
				ps.forEach((p) => {
					const span = p.max - p.min;
					const jitter = (rnd() - 0.5) * span * 0.05 * temp;
					set(trial, p, get(trial, p) + jitter);
				});
				const t = cost(trial);
				const d = t.cost - rc.cost;
				const accept = d < 0 || rnd() < Math.exp(-d / (temp * 0.5 + 1e-6));
				if (accept) state = trial;
				if (t.cost < best.cost) {
					best = { state: clone(trial), cost: t.cost, res: t.res };
					stall = 0;
					if (out.best === null || t.cost < out.best.cost) out.best = { state: clone(trial), res: t.res, cost: t.cost, evals, iters: iter };
				}
			}
			temp *= 0.9;
			yield { phase: "отжиг", iter, cost: cost(state).cost, best: best.cost, solved: best.res.solved, time: best.res.finishAt, evals, note: `T=${temp.toFixed(2)}` };
		}
		if (temp < 0.02) temp = 0.35;
		if (best.res.solved && stall > 9) {
			yield { phase: "готово", iter, cost: best.cost, best: best.cost, solved: true, time: best.res.finishAt, evals, note: "сошлось" };
			break;
		}
	}

	return { state: best.state, res: best.res, cost: best.cost, evals, iters: iter };
}

/* ────────────────────────── driver ────────────────────────── */

export class Solver {
	private gen: Generator<Progress, Solution, void>;
	private out: { best: Solution | null } = { best: null };
	progress: Progress = { phase: "ожидание", iter: 0, cost: Infinity, best: Infinity, solved: false, time: Infinity, evals: 0, note: "" };
	solution: Solution | null = null;
	done = false;

	constructor(cfg: SolveConfig, iters = 40) {
		this.gen = solveGenerator(cfg, { iters }, this.out);
	}

	/** Лучшее найденное решение на текущий момент (можно забирать досрочно). */
	get current(): Solution | null {
		return this.solution ?? this.out.best;
	}

	/** Выкачивает итерации в пределах бюджета времени, возвращает прогресс. */
	run(budgetMs: number): Progress {
		const t0 = performance.now();
		while (!this.done) {
			const r = this.gen.next();
			if (r.done) {
				this.done = true;
				this.solution = r.value ?? this.out.best;
				this.progress = {
					...this.progress,
					phase: "готово",
					solved: !!this.solution?.res.solved,
					best: this.solution?.cost ?? this.progress.best,
					time: this.solution?.res.finishAt ?? this.progress.time,
					evals: this.progress.evals,
				};
				break;
			}
			this.progress = r.value;
			if (this.out.best && (!this.solution || this.out.best.cost < this.solution.cost)) this.solution = this.out.best;
			if (performance.now() - t0 > budgetMs) break;
		}
		return this.progress;
	}
}

export const OPT_POWER_MAX = 4;
