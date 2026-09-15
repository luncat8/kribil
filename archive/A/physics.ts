import type { PhysicsParams, TableSpec } from "./types";

export interface Body {
	id: string;
	kind: "object" | "cue";
	owner: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	mass: number;
	r: number;
	color: string;
	label: string;
	/** номер в массиве тел (для событий) */
	idx: number;
}

export interface SimEvent {
	t: number;
	type: "shot" | "contact" | "cushion" | "checkpoint" | "finish" | "rest" | "foul";
	a: number;
	b: number;
	imp?: number;
	label?: string;
}

export const MAX_EVENTS = 600;

export function totalMomentum(balls: Body[]): [number, number] {
	let px = 0;
	let py = 0;
	for (const b of balls) {
	px += b.mass * b.vx;
	py += b.mass * b.vy;
	}
	return [px, py];
}

export function totalKE(balls: Body[]): number {
	let e = 0;
	for (const b of balls) e += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy);
	return e;
}

/**
	* Один подшаг физики: трение → перенос → борта → парные столкновения.
	* События (контакты) пишутся в переданный массив, если он задан.
	*/
export function stepBodies(
	balls: Body[],
	h: number,
	p: PhysicsParams,
	table: TableSpec,
	events?: SimEvent[],
	t = 0,
) {
	const damp = p.friction > 0 ? Math.exp(-p.friction * h) : 1;
	const R = p.ballRadius;

	for (const b of balls) {
	b.r = R;
	b.vx *= damp;
	b.vy *= damp;
	if (Math.hypot(b.vx, b.vy) < p.stopEps) {
		b.vx = 0;
		b.vy = 0;
	}
	b.x += b.vx * h;
	b.y += b.vy * h;

	const e = p.cushion;
	if (b.x < R) {
		b.x = R;
		if (b.vx < 0) {
		if (events && events.length < MAX_EVENTS) events.push({ t, type: "cushion", a: b.idx, b: -1, imp: Math.abs(b.vx) * b.mass });
		b.vx = -b.vx * e;
		}
	} else if (b.x > table.w - R) {
		b.x = table.w - R;
		if (b.vx > 0) {
		if (events && events.length < MAX_EVENTS) events.push({ t, type: "cushion", a: b.idx, b: -1, imp: Math.abs(b.vx) * b.mass });
		b.vx = -b.vx * e;
		}
	}
	if (b.y < R) {
		b.y = R;
		if (b.vy < 0) {
		if (events && events.length < MAX_EVENTS) events.push({ t, type: "cushion", a: b.idx, b: -1, imp: Math.abs(b.vy) * b.mass });
		b.vy = -b.vy * e;
		}
	} else if (b.y > table.h - R) {
		b.y = table.h - R;
		if (b.vy > 0) {
		if (events && events.length < MAX_EVENTS) events.push({ t, type: "cushion", a: b.idx, b: -1, imp: Math.abs(b.vy) * b.mass });
		b.vy = -b.vy * e;
		}
	}
	}

	const n = balls.length;
	for (let it = 0; it < 2; it++) {
	for (let i = 0; i < n; i++) {
		const A = balls[i];
		for (let j = i + 1; j < n; j++) {
		const B = balls[j];
		const dx = B.x - A.x;
		const dy = B.y - A.y;
		const rs = A.r + B.r;
		const d2 = dx * dx + dy * dy;
		if (d2 > rs * rs || d2 < 1e-14) continue;
		const d = Math.sqrt(d2);
		const nx = dx / d;
		const ny = dy / d;
		const imA = 1 / A.mass;
		const imB = 1 / B.mass;
		const imSum = imA + imB;
		// расталкиваем без наложения
		const overlap = rs - d;
		A.x -= nx * overlap * (imA / imSum);
		A.y -= ny * overlap * (imA / imSum);
		B.x += nx * overlap * (imB / imSum);
		B.y += ny * overlap * (imB / imSum);
		// импульс
		const vn = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
		if (vn < 0) {
		const jImp = (-(1 + p.restitution) * vn) / imSum;
		A.vx -= (jImp * nx) * imA;
		A.vy -= (jImp * ny) * imA;
		B.vx += (jImp * nx) * imB;
		B.vy += (jImp * ny) * imB;
		if (it === 0 && events && events.length < MAX_EVENTS) {
			events.push({ t, type: "contact", a: A.idx, b: B.idx, imp: jImp });
		}
		}
		}
	}
	}
}

/** Скорость, которую получит тело при импульсе power. */
export function impulseSpeed(power: number, mass: number): number {
	return power / Math.max(1e-6, mass);
}

/** Приложить удар к телу. */
export function applyImpulse(b: Body, angle: number, power: number) {
	const s = impulseSpeed(power, b.mass);
	b.vx += Math.cos(angle) * s;
	b.vy += Math.sin(angle) * s;
}
