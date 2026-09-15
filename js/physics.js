/* Тела и один подшаг физики: трение → перенос → борта → парные соударения. */
"use strict";
(function (global, factory) {
	const K = global.Kribil ?? (global.Kribil = {});
	factory(K);
	if (typeof module !== "undefined" && module.exports) module.exports = K;
})(typeof globalThis !== "undefined" ? globalThis : this, function (K) {
	if (typeof require === "function") require("./core.js");

	const MAX_EVENTS = 600;

	function makeBody(o) {
		return {
			id: o.id,
			kind: o.kind,
			owner: o.owner ?? -1,
			x: o.x,
			y: o.y,
			vx: o.vx ?? 0,
			vy: o.vy ?? 0,
			mass: o.mass ?? 1,
			r: o.r ?? 0.03,
			color: o.color ?? "#fff",
			label: o.label ?? "",
			idx: o.idx ?? 0,
		};
	}

	function totalMomentum(balls) {
		let px = 0;
		let py = 0;
		for (const b of balls) {
			px += b.mass * b.vx;
			py += b.mass * b.vy;
		}
		return [px, py];
	}

	function totalKE(balls) {
		let e = 0;
		for (const b of balls) e += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy);
		return e;
	}

	/** Один подшаг. События пишутся в events, если он передан. */
	function stepBodies(balls, h, p, table, events, t = 0) {
		const damp = p.friction > 0 ? Math.exp(-p.friction * h) : 1;
		const R = p.ballRadius;

		for (const b of balls) {
			b.r = R;
			b.vx *= damp;
			b.vy *= damp;
			const sp = Math.hypot(b.vx, b.vy);
			if (sp < p.stopEps) {
				b.vx = 0;
				b.vy = 0;
			}
			b.x += b.vx * h;
			b.y += b.vy * h;

			const hitWall = (nxImp) => {
				if (events && events.length < MAX_EVENTS)
					events.push({ t, type: "cushion", a: b.idx, b: -1, imp: Math.abs(nxImp) * b.mass });
			};
			const e = p.cushion;
			if (b.x < R) {
				b.x = R;
				if (b.vx < 0) {
					hitWall(b.vx);
					b.vx = -b.vx * e;
				}
			} else if (b.x > table.w - R) {
				b.x = table.w - R;
				if (b.vx > 0) {
					hitWall(b.vx);
					b.vx = -b.vx * e;
				}
			}
			if (b.y < R) {
				b.y = R;
				if (b.vy < 0) {
					hitWall(b.vy);
					b.vy = -b.vy * e;
				}
			} else if (b.y > table.h - R) {
				b.y = table.h - R;
				if (b.vy > 0) {
					hitWall(b.vy);
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
					const overlap = rs - d;
					A.x -= nx * overlap * (imA / imSum);
					A.y -= ny * overlap * (imA / imSum);
					B.x += nx * overlap * (imB / imSum);
					B.y += ny * overlap * (imB / imSum);
					const vn = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
					if (vn < 0) {
						const jImp = (-(1 + p.restitution) * vn) / imSum;
						A.vx -= jImp * nx * imA;
						A.vy -= jImp * ny * imA;
						B.vx += jImp * nx * imB;
						B.vy += jImp * ny * imB;
						if (it === 0 && events && events.length < MAX_EVENTS)
							events.push({ t, type: "contact", a: A.idx, b: B.idx, imp: jImp });
					}
				}
			}
		}
	}

	const impulseSpeed = (power, mass) => power / Math.max(1e-6, mass);

	function applyImpulse(b, angle, power) {
		const s = impulseSpeed(power, b.mass);
		b.vx += Math.cos(angle) * s;
		b.vy += Math.sin(angle) * s;
	}

	Object.assign(K, { MAX_EVENTS, makeBody, totalMomentum, totalKE, stepBodies, impulseSpeed, applyImpulse });
});
