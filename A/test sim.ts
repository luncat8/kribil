import { describe, expect, it } from "vitest";
import { runSim, planCost, splits } from "../simulate";
import { TABLE } from "../levels";
import { DEFAULT_PHYSICS, type Checkpoint, type PhysicsParams, type Shot } from "../types";

const P: PhysicsParams = { ...DEFAULT_PHYSICS, friction: 0.55, ballRadius: 0.03 };

const shot = (o: Partial<Shot>): Shot => ({ id: Math.random().toString(36).slice(2), player: 0, t: 0, angle: 0, power: 1, ...o });

function sim(o: { object: { x: number; y: number }; cues: { x: number; y: number }[]; checkpoints: Checkpoint[]; shots: Shot[]; params?: PhysicsParams; maxTime?: number }) {
	return runSim({
		table: TABLE,
		params: o.params ?? P,
		object: o.object,
		cues: o.cues,
		checkpoints: o.checkpoints,
		shots: o.shots,
		maxTime: o.maxTime ?? 4,
		fps: 120,
		sub: 4,
	});
}

describe("прогон плана: контакт, проходы КТ, время финиша", () => {
	it("биток догоняет шар 1 — фиксируется firstContact и событие контакта", () => {
		const res = sim({
			object: { x: 0.6, y: 0.6 },
			cues: [{ x: 0.5, y: 0.6 }],
			checkpoints: [],
			shots: [shot({ angle: 0, power: 1 })],
		});
		expect(Number.isFinite(res.firstContact)).toBe(true);
		expect(res.firstContact).toBeGreaterThan(0.01);
		expect(res.firstContact).toBeLessThan(0.2);
		expect(res.events.some((e) => e.type === "contact" && (e.a === 0 || e.b === 0))).toBe(true);
		expect(res.touches[1]).toBeGreaterThan(0);
	});

	it("шар 1 проходит контрольную точку: passed — момент, когда центр шара внутри круга", () => {
		const cp: Checkpoint = { id: 0, x: 0.9, y: 0.6, r: 0.09 };
		const res = sim({
			object: { x: 0.6, y: 0.6 },
			cues: [{ x: 0.5, y: 0.6 }],
			checkpoints: [cp],
			shots: [shot({ power: 1.4 })],
		});
		expect(Number.isNaN(res.passed[0])).toBe(false);
		const p = res.frames.at(res.passed[0], 0);
		expect(Math.hypot(p.x - cp.x, p.y - cp.y)).toBeLessThanOrEqual(cp.r + 1e-6);
		expect(res.passed[0]).toBeGreaterThan(res.firstContact);
		expect(res.solved).toBe(true);
		expect(res.finishAt).toBeCloseTo(res.passed[0], 6);
	});

	it("порядок точек обязателен: точка, пересечённая раньше времени, не засчитывается", () => {
		const late: Checkpoint = { id: 0, x: 1.4, y: 0.6, r: 0.09 };
		const early: Checkpoint = { id: 1, x: 0.8, y: 0.6, r: 0.09 };
		const res = sim({
			object: { x: 0.6, y: 0.6 },
			cues: [{ x: 0.5, y: 0.6 }],
			checkpoints: [late, early],
			shots: [shot({ power: 1 })],
		});
		// шар проехал через early, но она вторая по счёту → не засчитана
		expect(Number.isNaN(res.passed[1])).toBe(true);
		expect(Number.isNaN(res.passed[0])).toBe(true);
		expect(res.solved).toBe(false);
		expect(res.nearest[0]).toBeLessThan(1);
		expect(res.finishAt).toBe(Infinity);
	});

	it("общее время до финиша = момент прохода последней точки и сплиты растут по маршруту", () => {
		const cps: Checkpoint[] = [
			{ id: 0, x: 0.72, y: 0.6, r: 0.08 },
			{ id: 1, x: 0.86, y: 0.6, r: 0.08 },
		];
		const res = sim({
			object: { x: 0.6, y: 0.6 },
			cues: [{ x: 0.5, y: 0.6 }],
			checkpoints: cps,
			shots: [shot({ power: 1.8 })],
		});
		expect(res.solved).toBe(true);
		expect(res.finishAt).toBeCloseTo(res.passed[1], 6);
		const sp = splits(res);
		expect(sp[0].leg).toBeGreaterThan(0);
		expect(sp[1].leg).toBeGreaterThan(0);
		expect(sp[1].at).toBeGreaterThan(sp[0].at);
	});

	it("более сильный удар приводит к меньшему времени финиша", () => {
		const cps: Checkpoint[] = [
			{ id: 0, x: 0.78, y: 0.6, r: 0.07 },
			{ id: 1, x: 1.05, y: 0.6, r: 0.07 },
		];
		const run = (power: number) =>
			sim({
				object: { x: 0.6, y: 0.6 },
				cues: [{ x: 0.48, y: 0.6 }],
				checkpoints: cps,
				shots: [shot({ power })],
			});
		const slow = run(1);
		const fast = run(2.2);
		expect(slow.solved).toBe(true);
		expect(fast.solved).toBe(true);
		expect(fast.finishAt).toBeLessThan(slow.finishAt);
	});

	it("траектория записана целиком: время монотонно, длина ограничена лимитом", () => {
		const res = sim({
			object: { x: 0.6, y: 0.6 },
			cues: [{ x: 0.5, y: 0.6 }],
			checkpoints: [{ id: 0, x: 0.9, y: 0.6, r: 0.09 }],
			shots: [shot({ t: 0.5, power: 1.4 })],
			maxTime: 6,
			params: { ...P, friction: 0.05 },
		});
		const fr = res.frames;
		expect(fr.count).toBeGreaterThan(10);
		for (let i = 1; i < fr.count; i++) expect(fr.time[i]).toBeGreaterThan(fr.time[i - 1]);
		expect(res.duration).toBeLessThanOrEqual(6 + 1 / 120);
		// шар 1 стартует там, где его поставили
		expect(fr.x(0, 0)).toBeCloseTo(0.6, 6);
		expect(fr.y(0, 0)).toBeCloseTo(0.6, 6);
	});

	it("стоимость плана: пройденный маршрут дешевле непройденного", () => {
		const cp: Checkpoint = { id: 0, x: 1.9, y: 0.6, r: 0.08 };
		const miss = sim({ object: { x: 0.6, y: 0.6 }, cues: [{ x: 0.5, y: 0.6 }], checkpoints: [cp], shots: [shot({ power: 0.4 })] });
		const hit = sim({ object: { x: 0.6, y: 0.6 }, cues: [{ x: 0.5, y: 0.6 }], checkpoints: [cp], shots: [shot({ power: 2.6 })] });
		expect(hit.solved).toBe(true);
		expect(planCost(hit)).toBeLessThan(planCost(miss));
	});
});
