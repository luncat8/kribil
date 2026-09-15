/* Геометрия: лучи, касания, точка контакта. */
"use strict";
(function (global, factory) {
	const K = global.Kribil ?? (global.Kribil = {});
	factory(K);
	if (typeof module !== "undefined" && module.exports) module.exports = K;
})(typeof globalThis !== "undefined" ? globalThis : this, function (K) {
	if (typeof require === "function") require("./core.js");

	/** Пересечение луча (o, единичный d) с окружностью радиуса r вокруг c: расстояние или null. */
	function rayCircle(o, d, c, r) {
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

	/**
	 * Пускает луч из o по направлению d (не обязательно единичному).
	 * Возвращает первый пересечённый шар (hit=индекс) или борт (hit=-1),
	 * расстояние до контакта центров и нормаль контакта.
	 */
	function castRay(o, d, bodies, excludeIdx, sumR, table) {
		const dl = Math.hypot(d.x, d.y);
		if (dl < 1e-12) return { dist: Infinity, hit: -1, nx: 0, ny: 0 };
		d = { x: d.x / dl, y: d.y / dl };
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
		const R = bodies[excludeIdx]?.r ?? bodies[0]?.r ?? 0.03;
		const wallHit = (t, ax, ay) => {
			if (t > 0 && t < best) {
				best = t;
				hit = -1;
				nx = ax;
				ny = ay;
			}
		};
		if (d.x < -1e-9) wallHit((R - o.x) / d.x, 1, 0);
		else if (d.x > 1e-9) wallHit((table.w - R - o.x) / d.x, -1, 0);
		if (d.y < -1e-9) wallHit((R - o.y) / d.y, 0, 1);
		else if (d.y > 1e-9) wallHit((table.h - R - o.y) / d.y, 0, -1);
		return { dist: best, hit, nx, ny };
	}

	const norm = (v) => {
		const l = Math.hypot(v.x, v.y);
		return l < 1e-12 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
	};

	const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

	/** Центр битка в момент контакта, после которого цель пойдёт в направлении want. */
	function contactPoint(target, want, sumR) {
		const d = norm(want);
		return { x: target.x - d.x * sumR, y: target.y - d.y * sumR };
	}

	/**
	 * Удар «от борта» в цель C: зеркалим C относительно каждой стенки для центра
	 * шара (отступ R) и проверяем, что оба плеча маршрута свободны.
	 * Возвращает угол прицела и суммарную длину пути центра битка.
	 */
	function bankShot(o, C, bodies, selfIdx, sumR, table) {
		const R = bodies[selfIdx]?.r ?? 0.03;
		const rails = [
			{ axis: "x", at: R },
			{ axis: "x", at: table.w - R },
			{ axis: "y", at: R },
			{ axis: "y", at: table.h - R },
		];
		let best = null;
		for (const rail of rails) {
			const M = rail.axis === "x" ? { x: 2 * rail.at - C.x, y: C.y } : { x: C.x, y: 2 * rail.at - C.y };
			const dm = norm({ x: M.x - o.x, y: M.y - o.y });
			if (dm.x === 0 && dm.y === 0) continue;
			// точка отскока на стенке
			const sNum = rail.at - (rail.axis === "x" ? o.x : o.y);
			const sDen = rail.axis === "x" ? dm.x : dm.y;
			if (Math.abs(sDen) < 1e-9) continue;
			const s = sNum / sDen;
			if (s <= 0) continue;
			const B = { x: o.x + dm.x * s, y: o.y + dm.y * s };
			const along = rail.axis === "x" ? B.y : B.x;
			const span = rail.axis === "x" ? table.h : table.w;
			if (along < R || along > span - R) continue;
			// плечо 1: до стенки не должно задеть шар раньше
			const h1 = castRay(o, dm, bodies, selfIdx, sumR, table);
			if (h1.hit !== -1) continue;
			if (Math.abs(h1.dist - s) > Math.max(0.05, s * 0.2)) continue;
			// плечо 2: от стенки до цели — первым должен быть объект (индекс 0)
			const d2 = norm({ x: C.x - B.x, y: C.y - B.y });
			const fromB = bodies.map((b, i) => (i === selfIdx ? { ...b, x: B.x, y: B.y } : b));
			const h2 = castRay(B, d2, fromB, selfIdx, sumR, table);
			if (h2.hit !== 0) continue;
			const len = s + K.dist(B, C);
			if (!best || len < best.len) best = { angle: Math.atan2(dm.y, dm.x), len };
		}
		return best;
	}

	Object.assign(K, { rayCircle, castRay, norm, dist, contactPoint, bankShot });
});
