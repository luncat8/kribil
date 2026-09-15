/* Стратегии NPC для реалтайма: rusher / geometer / tactician / master. */
"use strict";
(function (global, factory) {
	const K = global.Kribil ?? (global.Kribil = {});
	factory(K);
	if (typeof module !== "undefined" && module.exports) module.exports = K;
})(typeof globalThis !== "undefined" ? globalThis : this, function (K) {
	if (typeof require === "function") {
		require("./core.js");
		require("./geo.js");
	}

	const cueBall = (view, p) => view.balls.find((b) => b.kind === "cue" && b.owner === p);

	/** Оценка силы импульса под трение и дистанцию (с запасом на резку). */
	function need(view, distance) {
		const f = Math.max(0.04, view.params.friction);
		return Math.max(0.12, Math.min(view.maxPower, (f * distance * 1.5 + 0.14) * view.params.cueMass));
	}

	function botDecide(def, view) {
		const obj = view.balls[0];
		const cue = cueBall(view, def.id);
		if (!obj || !cue) return null;
		const cp = view.checkpoints[Math.min(view.nextCp, view.checkpoints.length - 1)];
		if (!cp) return null;
		const sumR = view.params.ballRadius * 2;
		const toCp = K.norm({ x: cp.x - obj.x, y: cp.y - obj.y });
		const C = K.contactPoint({ x: obj.x, y: obj.y }, toCp, sumR);
		const jitter = (a) => a + (Math.random() - 0.5) * def.jitter;

		switch (def.bot) {
			case "rusher": {
				const a = Math.atan2(obj.y - cue.y, obj.x - cue.x);
				return { angle: jitter(a), power: view.maxPower * 0.82, note: "в лоб, на всю" };
			}
			case "tactician": {
				if (Math.hypot(obj.vx, obj.vy) > 0.16) return null;
				const a = Math.atan2(C.y - cue.y, C.x - cue.x);
				const d = Math.hypot(C.x - cue.x, C.y - cue.y);
				return { angle: jitter(a), power: need(view, d), note: "резка, покоем" };
			}
			case "geometer": {
				const direct = Math.atan2(C.y - cue.y, C.x - cue.x);
				const dir = { x: Math.cos(direct), y: Math.sin(direct) };
				const hit = K.castRay({ x: cue.x, y: cue.y }, dir, view.balls, cue.idx, sumR, view.table);
				if (hit.hit === 0) {
					const d = Math.hypot(C.x - cue.x, C.y - cue.y);
					return { angle: jitter(direct), power: need(view, d), note: "прямая видимость" };
				}
				const bank = K.bankShot({ x: cue.x, y: cue.y }, C, view.balls, cue.idx, sumR, view.table);
				if (!bank) return { angle: jitter(direct), power: need(view, 0.8), note: "нет маршрута, пробую прямо" };
				return { angle: jitter(bank.angle), power: need(view, bank.len * 1.15), note: "от борта" };
			}
			case "master": {
				const base = Math.atan2(C.y - cue.y, C.x - cue.x);
				const d = Math.hypot(C.x - cue.x, C.y - cue.y);
				const p0 = need(view, d);
				let best = null;
				let bestCost = Infinity;
				for (let i = -5; i <= 5; i++) {
					for (const m of [0.75, 1, 1.35, 1.8]) {
						const angle = base + i * 0.024;
						const power = Math.max(0.1, Math.min(view.maxPower, p0 * m));
						const cost = view.rollout ? view.rollout(def.id, angle, power) : Math.abs(angle - base) + Math.abs(power - p0);
						if (cost < bestCost) {
							bestCost = cost;
							best = { angle, power, note: `перебор ${i + 6}/11 · ×${m}` };
						}
					}
				}
				return best;
			}
		}
		return null;
	}

	/** Мини-прогон без записи кадров: стоимость варианта для «МАСТЕРА». */
	function rolloutCost(view, balls, player, angle, power, horizon = 2.4) {
		const copy = balls.map((b) => ({ ...b }));
		const cue = copy.find((b) => b.kind === "cue" && b.owner === player);
		if (!cue) return 999;
		K.applyImpulse(cue, angle, power);
		const cp = view.checkpoints[Math.min(view.nextCp, view.checkpoints.length - 1)];
		const sub = 3;
		const h = 1 / 60 / sub;
		const steps = Math.round(horizon * 60);
		let t = 0;
		let best = Infinity;
		let passed = NaN;
		for (let i = 0; i < steps; i++) {
			for (let k = 0; k < sub; k++) {
				K.stepBodies(copy, h, view.params, view.table);
				const o = copy[0];
				const d = Math.hypot(o.x - cp.x, o.y - cp.y);
				if (d < best) best = d;
				if (Number.isNaN(passed) && d <= cp.r) passed = t + k * h;
			}
			t += 1 / 60;
			if (!Number.isNaN(passed) && t > passed + 0.05) break;
		}
		return Number.isNaN(passed) ? 20 + best * 30 : passed + 0.4 * (power / view.maxPower);
	}

	Object.assign(K, { botDecide, need, rolloutCost });
});
