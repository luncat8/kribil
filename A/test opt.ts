import { describe, expect, it } from "vitest";
import { stepBodies, totalMomentum, applyImpulse, type Body } from "../physics";
import { TABLE } from "../levels";
import { DEFAULT_PHYSICS, type PhysicsParams } from "../types";

const noFriction: PhysicsParams = {
	...DEFAULT_PHYSICS,
	friction: 0,
	restitution: 1,
	cushion: 1,
	stopEps: 0,
	ballRadius: 0.03,
};

function body(o: Partial<Body>): Body {
	return {
		id: o.id ?? "b",
		kind: o.kind ?? "cue",
		owner: o.owner ?? 0,
		x: o.x ?? 0,
		y: o.y ?? 0,
		vx: o.vx ?? 0,
		vy: o.vy ?? 0,
		mass: o.mass ?? 1,
		r: o.r ?? 0.03,
		color: "#fff",
		label: "",
		idx: o.idx ?? 0,
		...o,
	};
}

describe("физика столкновений", () => {
	it("без трения сохраняет суммарный импульс системы", () => {
		const balls = [body({ idx: 0, kind: "object", x: 0.6, y: 0.6 }), body({ idx: 1, x: 0.5, y: 0.6, vx: 1 })];
		const before = totalMomentum(balls);
		for (let i = 0; i < 400; i++) stepBodies(balls, 1 / 480, noFriction, TABLE);
		const after = totalMomentum(balls);
		expect(after[0]).toBeCloseTo(before[0], 8);
		expect(after[1]).toBeCloseTo(before[1], 8);
	});

	it("биток попадает по шару 1: при лобовом ударе равных масс биток останавливается, шар улетает со скоростью битка", () => {
		const balls = [body({ idx: 0, kind: "object", x: 0.6, y: 0.6 }), body({ idx: 1, x: 0.5, y: 0.6, vx: 1 })];
		const events: { t: number; type: string; a: number; b: number }[] = [];
		let contactAt = -1;
		for (let i = 0; i < 240 && contactAt < 0; i++) {
			stepBodies(balls, 1 / 480, noFriction, TABLE, events as never, i / 480);
			const c = events.find((e) => e.type === "contact");
			if (c) contactAt = c.t;
		}
		expect(contactAt).toBeGreaterThan(0); // был контакт шар-шар
		expect(balls[0].vx).toBeGreaterThan(0.95); // шар 1 поехал
		expect(Math.abs(balls[1].vx)).toBeLessThan(0.05); // биток встал
		expect(balls[0].x).toBeGreaterThan(0.62);
	});

	it("шары не слипаются: расталкиваются при наложении", () => {
		const balls = [body({ idx: 0, x: 0.6, y: 0.6 }), body({ idx: 1, x: 0.62, y: 0.6 })];
		stepBodies(balls, 1 / 480, noFriction, TABLE);
		const d = Math.hypot(balls[1].x - balls[0].x, balls[1].y - balls[0].y);
		expect(d).toBeGreaterThanOrEqual(balls[0].r + balls[1].r - 1e-6);
	});

	it("упругий отскок от борта меняет знак скорости с учётом restitution", () => {
		const p = { ...noFriction, cushion: 1 };
		const balls = [body({ idx: 0, x: TABLE.w - 0.05, y: 0.6, vx: 1 })];
		for (let i = 0; i < 60; i++) stepBodies(balls, 1 / 480, p, TABLE);
		expect(balls[0].vx).toBeLessThan(0);
		expect(Math.abs(balls[0].vx)).toBeCloseTo(1, 3);
		expect(balls[0].x).toBeLessThanOrEqual(TABLE.w - 0.03 + 1e-9);
	});

	it("трение экспоненциально гасит скорость и приводит шар в покой", () => {
		const p = { ...noFriction, friction: 1.2, stopEps: 0.02 };
		const balls = [body({ idx: 0, x: 0.5, y: 0.5, vx: 2 })];
		for (let i = 0; i < 600; i++) stepBodies(balls, 1 / 240, p, TABLE);
		expect(balls[0].vx).toBe(0);
	});

	it("импульс кия: скорость = power / mass", () => {
		const b = body({ idx: 1, mass: 2 });
		applyImpulse(b, 0, 4);
		expect(b.vx).toBeCloseTo(2, 10);
		expect(b.vy).toBeCloseTo(0, 10);
	});
});
