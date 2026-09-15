import { describe, expect, it } from "vitest";
import { Solver, type SolveConfig } from "../optimizer";
import { botDecide } from "../bots";
import { PLAYERS, TABLE } from "../levels";
import { makeBodies, runSim } from "../simulate";
import { DEFAULT_PHYSICS, type Checkpoint, type PhysicsParams } from "../types";
import type { BotView } from "../bots";

const P: PhysicsParams = { ...DEFAULT_PHYSICS, friction: 0.55, ballRadius: 0.03 };

/** Двухточечный стол: решатель обязан собрать полный маршрут. */
function cfg(over: Partial<SolveConfig> = {}): SolveConfig {
	return {
		table: TABLE,
		params: P,
		object: { x: 0.6, y: 0.6 },
		cues: [
			{ x: 0.4, y: 1.0 },
			{ x: 1.2, y: 1.05 },
			{ x: 2.0, y: 1.0 },
			{ x: 2.1, y: 0.3 },
		],
		checkpoints: [
			{ id: 0, x: 0.62, y: 0.28, r: 0.16 },
			{ id: 1, x: 1.28, y: 0.9, r: 0.16 },
		],
		maxTime: 6,
		maxPower: 4,
		placement: "free",
		timeMode: false,
		fps: 60,
		sub: 3,
		seed: 7,
		...over,
	};
}

describe("автоматический расчёт маршрута", () => {
	it("решатель проводит шар 1 через все контрольные точки", () => {
		const c = cfg();
		const solver = new Solver(c, 12);
		while (!solver.done) solver.run(100000);
		const sol = solver.current;
		expect(sol).not.toBeNull();
		const res = sol!.res;
		// 1) каждый биток попал по шару 1
		expect(Number.isFinite(res.firstContact)).toBe(true);
		// 2) шар проходит все точки маршрута
		expect(res.solved).toBe(true);
		expect(res.passed.every((p) => !Number.isNaN(p))).toBe(true);
		// 3) общее время до финиша конечно и укладывается в лимит
		expect(Number.isFinite(res.finishAt)).toBe(true);
		expect(res.finishAt).toBeGreaterThan(0);
		expect(res.finishAt).toBeLessThan(c.maxTime);
		expect(res.events.some((e) => e.type === "shot")).toBe(true);
	});

	it("полировка улучшает геометрический черновик", () => {
		const draft = (() => {
			const s = new Solver(cfg(), 0);
			while (!s.done) s.run(100000);
			return s.current!.cost;
		})();
		const polished = (() => {
			const s = new Solver(cfg(), 14);
			while (!s.done) s.run(100000);
			return s.current!.cost;
		})();
		expect(polished).toBeLessThanOrEqual(draft + 1e-6);
	});

	it("фиксированная расстановка (режим Б) не двигает битки, свободная — двигает", () => {
		const locked = new Solver(cfg({ placement: "locked" }), 6);
		while (!locked.done) locked.run(100000);
		const c0 = cfg().cues;
		locked.current!.state.cues.forEach((q, i) => {
			expect(q.x).toBeCloseTo(c0[i].x, 6);
			expect(q.y).toBeCloseTo(c0[i].y, 6);
		});

		const free = new Solver(cfg({ placement: "free", timeMode: true }), 10);
		while (!free.done) free.run(100000);
		const moved = free.current!.state.cues.some((q, i) => Math.hypot(q.x - c0[i].x, q.y - c0[i].y) > 1e-4);
		expect(moved).toBe(true);
		expect(free.current!.res.solved || free.current!.cost < locked.current!.cost + 1e6).toBe(true);
	});
});

describe("стратегии NPC", () => {
	it("тактик резаным ударом отправляет шар 1 в сторону ближайшей точки", () => {
		const cp: Checkpoint = { id: 0, x: 0.6, y: 0.42, r: 0.1 };
		const balls = makeBodies({
			params: P,
			object: { x: 0.6, y: 0.6 },
			cues: [
				{ x: 1.9, y: 0.2 },
				{ x: 2.0, y: 1.05 },
				{ x: 0.6, y: 1.0 },
				{ x: 0.3, y: 0.3 },
			],
		});
		const view: BotView = { balls, table: TABLE, params: P, checkpoints: [cp], nextCp: 0, t: 0, maxPower: 4 };
		const d = botDecide(PLAYERS[2], view);
		expect(d).not.toBeNull();
		const res = runSim({
			table: TABLE,
			params: P,
			object: { x: 0.6, y: 0.6 },
			cues: view.balls.filter((b) => b.kind === "cue").map((b) => ({ x: b.x, y: b.y })),
			checkpoints: [cp],
			shots: [{ id: "b", player: 2, t: 0, angle: d!.angle, power: d!.power }],
			maxTime: 5,
			fps: 90,
			sub: 4,
		});
		expect(res.contacts).toBeGreaterThan(0);
		expect(res.solved).toBe(true);
		expect(res.passed[0]).toBeGreaterThan(0);
	});

	it("тактик отказывается бить, пока шар 1 катится", () => {
		const cp: Checkpoint = { id: 0, x: 0.6, y: 0.3, r: 0.1 };
		const balls = makeBodies({ params: P, object: { x: 0.6, y: 0.6 }, cues: [{ x: 0.6, y: 1.0 }] });
		balls[0].vx = 0.9;
		const view: BotView = { balls, table: TABLE, params: P, checkpoints: [cp], nextCp: 0, t: 0, maxPower: 4 };
		expect(botDecide(PLAYERS[2], view)).toBeNull();
	});

	it("циркуль уходит в отскок от борта, если прямая перекрыта", () => {
		const cp: Checkpoint = { id: 0, x: 1.2, y: 0.6, r: 0.1 };
		const balls = makeBodies({
			params: P,
			object: { x: 1.2, y: 0.6 },
			cues: [
				{ x: 0.3, y: 0.6 },
				{ x: 0.75, y: 0.6 },
				{ x: 2.2, y: 0.2 },
				{ x: 2.2, y: 1.0 },
			],
		});
		const view: BotView = { balls, table: TABLE, params: P, checkpoints: [cp], nextCp: 0, t: 0, maxPower: 4 };
		const direct = Math.atan2(cp.y - balls[1].y, cp.x - balls[1].x);
		const d = botDecide(PLAYERS[1], view)!;
		expect(d).toBeTruthy();
		expect(Math.hypot(d.power, 1)).toBeGreaterThan(0);
		expect(Math.abs(d.angle - direct)).toBeGreaterThan(0.03);
	});

	it("комета бьёт сразу и сильно по шару 1", () => {
		const cp: Checkpoint = { id: 0, x: 0.9, y: 0.6, r: 0.12 };
		const balls = makeBodies({ params: P, object: { x: 0.6, y: 0.6 }, cues: [{ x: 0.3, y: 0.6 }] });
		const view: BotView = { balls, table: TABLE, params: P, checkpoints: [cp], nextCp: 0, t: 0, maxPower: 4 };
		const d = botDecide({ ...PLAYERS[0], jitter: 0 }, view)!;
		expect(d.power).toBeGreaterThan(2.5);
		expect(Math.abs(d.angle)).toBeLessThan(0.05);
	});
});
