import type { Vec } from "./types";

/** Пересечение луча (origin, dir) с окружностью радиуса r вокруг target. */
export function rayCircle(o: Vec, d: Vec, c: Vec, r: number): number | null {
	const fx = o.x - c.x;
	const fy = o.y - c.y;
	const b = fx * d.x + fy * d.y;
	const cc = fx * fx + fy * fy - r * r;
	const disc = b * b - cc;
	if (disc < 0) return null;
	const sq = Math.sqrt(disc);
	const t1 = -b - sq;
	if (t1 > 0) return t1;
	const t2 = -b + sq;
	if (t2 > 0) return t2;
	return null;
}

export interface RayHit {
	/** дистанция до точки контакта центра битка */
	dist: number;
	/** индекс тела, в которое попали (или -1) */
	hit: number;
	/** нормаль контакта */
	nx: number;
	ny: number;
}

/** Пускает биток из o по направлению d, возвращает первый шар или борт. */
export function castRay(
	o: Vec,
	d: Vec,
	bodies: { x: number; y: number; r: number }[],
	excludeIdx: number,
	sumR: number,
	table: { w: number; h: number },
): RayHit {
	let best = Infinity;
	let hit = -1;
	let nx = 0;
	let ny = 0;
	for (let i = 0; i < bodies.length; i++) {
		if (i === excludeIdx) continue;
		const t = rayCircle(o, d, bodies[i], sumR);
		if (t !== null && t < best) {
			best = t;
			hit = i;
			const cx = o.x + d.x * best - bodies[i].x;
			const cy = o.y + d.y * best - bodies[i].y;
			const l = Math.hypot(cx, cy) || 1;
			nx = cx / l;
			ny = cy / l;
		}
	}
	// борта
	const R = bodies[0]?.r ?? 0.03;
	if (d.x < -1e-9) {
		const t = (R - o.x) / d.x;
		if (t > 0 && t < best) {
			best = t;
			hit = -1;
			nx = 1;
			ny = 0;
		}
	} else if (d.x > 1e-9) {
		const t = (table.w - R - o.x) / d.x;
		if (t > 0 && t < best) {
			best = t;
			hit = -1;
			nx = -1;
			ny = 0;
		}
	}
	if (d.y < -1e-9) {
		const t = (R - o.y) / d.y;
		if (t > 0 && t < best) {
			best = t;
			hit = -1;
			nx = 0;
			ny = 1;
		}
	} else if (d.y > 1e-9) {
		const t = (table.h - R - o.y) / d.y;
		if (t > 0 && t < best) {
			best = t;
			hit = -1;
			nx = 0;
			ny = -1;
		}
	}
	return { dist: best, hit, nx, ny };
}

export const norm = (v: Vec): Vec => {
	const l = Math.hypot(v.x, v.y) || 1;
	return { x: v.x / l, y: v.y / l };
};

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Точка касания битка, после которой шар-цель летит по направлению want. */
export function contactPoint(target: Vec, want: Vec, sumR: number): Vec {
	const d = norm(want);
	return { x: target.x - d.x * sumR, y: target.y - d.y * sumR };
}
