/* Авторасчёт маршрута.
	 Этап 1 — конструктив: для каждого leg'а строится точка контакта (призрачный шар),
	 назначается ближайший биток, веером уточняются угол → сила → время → позиция.
	 Этап 2 — полировка: градиент на конечных разностях, координатный спуск, отжиг.
	 Поиск — генератор с бюджетом времени, UI не блокируется. */
"use strict";
(function (global, factory) {
	const K = global.Kribil ?? (global.Kribil = {});
	factory(K);
	if (typeof module !== "undefined" && module.exports) module.exports = K;
})(typeof globalThis !== "undefined" ? globalThis : this, function (K) {
	if (typeof require === "function") {
		require("./core.js");
		require("./simulate.js");
		require("./geo.js");
		require("./levels.js");
	}

	const OPT_POWER_MAX = 4;

	function specs(cfg, st) {
		const out = [];
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

	function get(st, p) {
		switch (p.k) {
			case "angle": return st.shots[p.i].angle;
			case "power": return st.shots[p.i].power;
			case "t": return st.shots[p.i].t;
			case "cx": return st.cues[p.i].x;
			case "cy": return st.cues[p.i].y;
		}
	}

	function set(st, p, val) {
		const clamp = Math.max(p.min, Math.min(p.max, val));
		switch (p.k) {
			case "angle": st.shots[p.i].angle = clamp; break;
			case "power": st.shots[p.i].power = clamp; break;
			case "t": st.shots[p.i].t = Math.max(0, clamp); break;
			case "cx": st.cues[p.i].x = clamp; break;
			case "cy": st.cues[p.i].y = clamp; break;
		}
	}

	const clone = (s) => ({ shots: s.shots.map((x) => ({ ...x })), cues: s.cues.map((c) => ({ ...c })) });

	function overlapPenalty(st, params) {
		let pen = 0;
		const min = params.ballRadius * 2 + 0.004;
		for (let i = 0; i < st.cues.length; i++) {
			for (let j = i + 1; j < st.cues.length; j++) {
				const d = Math.hypot(st.cues[i].x - st.cues[j].x, st.cues[i].y - st.cues[j].y);
				if (d < min) pen += (min - d) ** 2 * 400;
			}
		}
		return pen;
	}

	function evaluate(cfg, st) {
		return K.runSim({
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
			record: false,
			cueColors: K.PLAYERS.map((p) => p.color),
		});
	}

	function costOf(cfg, st) {
		const res = evaluate(cfg, st);
		return { cost: K.planCost(res, { guide: 26, miss: 1500 }) + overlapPenalty(st, cfg.params), res };
	}

	function powerFor(cfg, distance) {
		const f = Math.max(0.02, cfg.params.friction);
		// экспоненциальное трение: путь до остановки ≈ v0/f → v0 ≈ f·s, запас 1.45
		const v0 = f * distance * 1.45 + 0.12;
		return Math.max(0.1, Math.min(cfg.maxPower, v0 * cfg.params.cueMass));
	}

	/**
	 * Импульс, при котором биток из покоя за время τ проедет ровно d под трением.
	 * v(τ)=v0·e^{−fτ}, путь d=v0(1−e^{−fτ})/f → v0=f·d/(1−e^{−fτ}); f=0 → d/τ.
	 * Позволяет назначить удар точно к моменту прихода шара 1 в точку.
	 */
	function timedPower(cfg, d, tau) {
		const f = Math.max(0, cfg.params.friction);
		const v0 = f > 0.02 ? (f * d) / Math.max(1e-3, 1 - Math.exp(-f * tau)) : d / Math.max(1e-3, tau);
		return Math.max(0.06, Math.min(cfg.maxPower, v0 * cfg.params.cueMass));
	}

	/** Позиция шара 1 в момент прохождения точки k (по кадрам прогона). */
	function objectAt(res, t) {
		if (res.frames.count > 0) return res.frames.at(t, 0);
		return null;
	}

	/** Свободно ли место для стартовой позиции битка (без наложений и в столе). */
	function positionClear(cfg, st, self, p, ignorePlayers) {
		const R = cfg.params.ballRadius;
		if (p.x < R * 1.4 || p.x > cfg.table.w - R * 1.4 || p.y < R * 1.4 || p.y > cfg.table.h - R * 1.4) return false;
		const minD = R * 2 + 0.012;
		for (let i = 0; i < st.cues.length; i++) {
			if (i === self || (ignorePlayers && ignorePlayers.has(i))) continue;
			if (K.dist(st.cues[i], p) < minD) return false;
		}
		if (K.dist(cfg.object, p) < minD) return false;
		return true;
	}

	function legCost(cfg, st, k) {
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

	/** Прогон текущего черновика с записью кадров (для тайминга конструктора). */
	function legSim(cfg, st) {
		return K.runSim({
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
			record: true,
			cueColors: K.PLAYERS.map((p) => p.color),
		});
	}

	/**
	 * Локальный поиск одного ребра.
	 * Конструктив по «человеческой стратегии»: в момент прихода шара 1 в точку
	 * неигравший биток ждёт в позиции призрачного шара позади и бьёт вдоль
	 * следующего leg'а; сила считается так, чтобы биток пришёл точно вовремя.
	 * Дальше — веерные переборы угла, силы, времени и (free) позиции.
	 */
	function* legSearch(cfg, st, k, rnd, used) {
		const cp = cfg.checkpoints[k];
		const sumR = cfg.params.ballRadius * 2;
		const players = cfg.cues.length;

		const prev = legSim(cfg, st);
		const tArrive = k > 0 && !Number.isNaN(prev.passed[k - 1]) ? prev.passed[k - 1] : NaN;
		const timed = k > 0 && Number.isFinite(tArrive);
		const src = timed ? objectAt(prev, tArrive) ?? cfg.checkpoints[k - 1] : k === 0 ? cfg.object : cfg.checkpoints[k - 1];
		const dir = K.norm({ x: cp.x - src.x, y: cp.y - src.y });
		const C = K.contactPoint(src, dir, sumR);

		// Положение всех тел к моменту прихода шара 1 (для оценки маршрутов).
		const fi = timed ? prev.frames.frameAt(tArrive).i0 : -1;
		const bodiesNow = timed
			? Array.from({ length: st.cues.length + 1 }, (_u, i) => ({
				...prev.frames.at(tArrive, i),
				vx: prev.frames.vel[(fi * prev.frames.nb + i) * 2],
				vy: prev.frames.vel[(fi * prev.frames.nb + i) * 2 + 1],
				r: sumR / 2,
			}))
			: [{ x: cfg.object.x, y: cfg.object.y, vx: 0, vy: 0, r: sumR / 2 }, ...st.cues.map((c) => ({ x: c.x, y: c.y, vx: 0, vy: 0, r: sumR / 2 }))];

		// Оценка маршрута битка p в точку контакта C: прямое касание с сонаправленной
		// нормалью (forwardness), иначе рикошет от борта. Чем выше балл — тем чище.
		const routeOf = (p) => {
			const Qp = bodiesNow[p + 1];
			const aim = Math.atan2(C.y - Qp.y, C.x - Qp.x);
			const dd = K.dist(Qp, C);
			const ray = K.castRay(Qp, { x: Math.cos(aim), y: Math.sin(aim) }, bodiesNow, p + 1, sumR, cfg.table);
			let direct = false;
			let score = -1e9;
			if (ray.hit === 0 && Math.abs(ray.dist - dd) < 0.12) {
				const fwd = -(ray.nx * dir.x + ray.ny * dir.y);
				if (fwd > 0.45) {
					direct = true;
					score = 1000 + fwd * 200 - dd * 10;
				}
			}
			const bank = K.bankShot(Qp, C, bodiesNow, p + 1, sumR, cfg.table);
			if (!direct && bank) score = Math.max(score, 500 - bank.len * 30);
			return { score, aim, bank, dd, Qp, direct };
		};

		let bestPlayer = -1;
		let pick = null;
		if (cfg.placement === "free") {
			// позицию битка мы выбираем сами — берём ближайшего неигравшего
			const free = [...Array(players).keys()].filter((p) => !used.has(p));
			bestPlayer = free.sort((a, b) => K.dist(st.cues[a], C) - K.dist(st.cues[b], C))[0] ?? 0;
			used.add(bestPlayer);
		} else {
			// locked: среди неигравших выбираем биток с лучшим маршрутом в точку C
			const routes = [...Array(players).keys()].map((p) => ({ p, r: routeOf(p) }));
			const fresh = routes.filter((x) => !used.has(x.p)).sort((a, b) => b.r.score - a.r.score);
			const bestFresh = fresh[0];
			if (bestFresh && bestFresh.r.score > -1e8) {
				bestPlayer = bestFresh.p;
				pick = bestFresh.r;
				used.add(bestPlayer);
			} else {
				// ни один свободный биток не достаёт — повторный удар битком,
				// который к tArrive уже лежит в покое у нужной точки
				const rest = routes
					.filter((x) => used.has(x.p))
					.filter((x) => {
						const b = bodiesNow[x.p + 1];
						return Math.hypot(b.vx ?? 0, b.vy ?? 0) < cfg.params.stopEps * 2 && tArrive > 0.3;
					})
					.sort((a, b) => b.r.score - a.r.score)[0];
				bestPlayer = rest ? rest.p : bestFresh?.p ?? 0;
				pick = rest ? rest.r : bestFresh?.r ?? null;
			}
		}
		const reuse = used.has(bestPlayer);

		const shot = { id: `auto-${k}-${bestPlayer}`, player: bestPlayer, t: 0, angle: 0, power: 1 };
		const Q = st.cues[bestPlayer];

		if (cfg.placement === "free") {
			// позиции позади точки контакта, затем почти касательные (резка у борта)
			const cands = [];
			for (const d0 of [0.3, 0.38, 0.24, 0.44, 0.18]) {
				for (const perp of [0, 0.06, -0.06, 0.12, -0.12])
					cands.push({ back: d0, perp });
			}
			for (const perp of [0.16, -0.16, 0.22, -0.22, 0.28, -0.28, 0.34, -0.34]) {
				cands.push({ back: 0.08, perp });
			}
			let placed = false;
			for (const { back, perp } of cands) {
				const cand = {
					x: C.x - dir.x * back - dir.y * perp,
					y: C.y - dir.y * back + dir.x * perp,
				};
				if (positionClear(cfg, st, bestPlayer, cand, used)) {
					Q.x = cand.x;
					Q.y = cand.y;
					placed = true;
					break;
				}
			}
			// последний шанс: любая свободная точка спирали вокруг C
			if (!placed) {
				for (let rr = 0.12; rr < 0.5 && !placed; rr += 0.05) {
					for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
						const cand = { x: C.x + Math.cos(a) * rr, y: C.y + Math.sin(a) * rr };
						if (positionClear(cfg, st, bestPlayer, cand, used)) {
							Q.x = cand.x;
							Q.y = cand.y;
							placed = true;
							break;
						}
					}
				}
			}
		}

		// для locked маршрут строится от положения битка в момент tArrive
		// (повторно используемый биток к этому времени уже лежит в точке покоя)
		if (cfg.placement !== "free") pick = pick ?? routeOf(bestPlayer);
		const origin = cfg.placement === "free" ? Q : pick.Qp;
		const d = K.dist(origin, C);
		const legLen = K.dist(src, cp);
		const aimC = cfg.placement === "free" ? Math.atan2(C.y - Q.y, C.x - Q.x) : pick.aim;
		const directOk = cfg.placement === "free" ? true : pick.direct;
		const bank = cfg.placement === "free" ? null : pick.bank;

		shot.angle = !directOk && bank ? bank.angle : aimC;
		// free: биток уже стоит у точки контакта, бьём после прихода шара 1;
		// locked: биток едет с фиксированной позиции и должен прибыть синхронно
		const freeTimed = timed && cfg.placement === "free";
		const lockTimed = timed && cfg.placement !== "free";
		// путь битка: прямой d или длина рикошета
		const cuePath = !directOk && bank ? bank.len : d;
		// стартовое τ: короткий переезд — контакт на скорости; для locked ограничено tArrive
		const vMax = cfg.maxPower / cfg.params.cueMass;
		const tauMin = Math.max(0.12, (cuePath / vMax) * 1.15);
		if (!directOk && bank) shot.angle = bank.angle;
		if (!timed) {
			shot.t = 0;
			shot.power = powerFor(cfg, cuePath * 1.05 + legLen * 0.55);
		} else if (freeTimed) {
			shot.t = tArrive + 0.08;
			shot.power = powerFor(cfg, cuePath * 1.05 + legLen * 0.85);
		} else {
			const tau = Math.max(tauMin, 0.3);
			shot.t = Math.max(0, tArrive - tau);
			// борту нужен запас на потерю скорости при отскоке
			shot.power = Math.min(cfg.maxPower, timedPower(cfg, cuePath, tau) * (!directOk && bank ? 1.25 : 1));
		}
		st.shots.push(shot);
		let bestCost = legCost(cfg, st, k);

		const sweep = (apply, back, cands) => {
			for (const cand of cands) {
				const keep = back();
				apply(cand);
				const c = legCost(cfg, st, k);
				if (c < bestCost - 1e-9) bestCost = c;
				else apply(keep);
			}
		};
		/** Синхронная пара «время переезда + сила»: контакт всегда в tArrive. */
		const setTau = (tau) => {
			const tt = Math.max(tauMin, Math.min(tArrive - 0.02, tau));
			shot.t = Math.max(0, tArrive - tt);
			shot.power = Math.min(cfg.maxPower, timedPower(cfg, cuePath, tt) * (!directOk && bank ? 1.25 : 1));
		};
		const powerGrid = [0.5, 0.7, 0.85, 1.0, 1.15, 1.35, 1.6, 1.9, 2.3, 2.8].map((m) =>
			Math.max(0.06, Math.min(cfg.maxPower, shot.power * m)),
		);

		if (lockTimed) {
			// сетка времён переезда: от быстрого и сильного контакта до медленного
			sweep(setTau, () => tArrive - shot.t, [0.14, 0.2, 0.28, 0.38, 0.5, 0.65, 0.85, 1.1, 1.4, 1.8, 2.4, Math.min(tArrive * 0.96, 3)]);
			sweep(
				(v) => (shot.angle = v),
				() => shot.angle,
				Array.from({ length: 27 }, (_u, i) => shot.angle + (i - 13) * 0.026),
			);
			sweep(
				(v) => (shot.t = Math.max(0, v)),
				() => shot.t,
				Array.from({ length: 17 }, (_u, i) => shot.t + (i - 8) * 0.04),
			);
			sweep(
				(v) => (shot.angle = v),
				() => shot.angle,
				Array.from({ length: 13 }, (_u, i) => shot.angle + (i - 6) * 0.014),
			);
		} else {
			sweep(
				(v) => (shot.angle = v),
				() => shot.angle,
				Array.from({ length: 21 }, (_u, i) => shot.angle + (i - 10) * 0.026),
			);
			sweep((v) => (shot.power = v), () => shot.power, powerGrid);
			if (freeTimed) {
				// момент удара вокруг прихода шара 1 (чуть раньше — на ходу, позже — по покою)
				sweep(
					(v) => (shot.t = Math.max(0, v)),
					() => shot.t,
					Array.from({ length: 21 }, (_u, i) => tArrive + (i - 6) * 0.08),
				);
				sweep(
					(v) => (shot.angle = v),
					() => shot.angle,
					Array.from({ length: 13 }, (_u, i) => shot.angle + (i - 6) * 0.014),
				);
			}
		}

		// грубый запас, если точка не взята: полный круг углов + случайные рестарты
		if (Number.isNaN(K.evaluate(cfg, st).passed[k])) {
			const a0 = shot.angle;
			const pw0 = shot.power;
			sweep(
				(v) => {
					shot.angle = v;
					shot.power = Math.min(cfg.maxPower, Math.max(pw0, cfg.maxPower * 0.5));
				},
				() => a0,
				Array.from({ length: 40 }, (_u, i) => a0 + (i / 40) * Math.PI * 2),
			);
			sweep(
				(v) => (shot.angle = v),
				() => shot.angle,
				Array.from({ length: 15 }, (_u, i) => shot.angle + (i - 7) * 0.02),
			);
			// случайные рестарты по всем трём параметрам
			const baseT = shot.t;
			for (let i = 0; i < 60; i++) {
				const snapT = { a: shot.angle, p: shot.power, t: shot.t };
				shot.angle = rnd() * Math.PI * 2;
				shot.power = Math.max(0.2, cfg.maxPower * (0.25 + rnd() * 0.75));
				if (timed) shot.t = Math.max(0, tArrive - 0.15 - rnd() * Math.max(0.2, tArrive - 0.15));
				const c = legCost(cfg, st, k);
				if (c < bestCost - 1e-9) bestCost = c;
				else Object.assign(shot, { angle: snapT.a, power: snapT.p, t: snapT.t });
			}
			// локальная доводка лучшего рестарта
			sweep(
				(v) => (shot.angle = v),
				() => shot.angle,
				Array.from({ length: 21 }, (_u, i) => shot.angle + (i - 10) * 0.02),
			);
			sweep((v) => (shot.power = v), () => shot.power, [0.6, 0.8, 0.95, 1.1, 1.3, 1.6].map((m) => Math.max(0.06, Math.min(cfg.maxPower, shot.power * m))));
			if (timed) sweep((v) => (shot.t = v), () => shot.t, Array.from({ length: 15 }, (_u, i) => shot.t + (i - 7) * 0.06));
			if (lockTimed) sweep(setTau, () => tArrive - shot.t, [0.18, 0.3, 0.5, 0.8, 1.2, 1.8]);
			void baseT;
		}
		yield { phase: "маршрут", iter: k, cost: bestCost, best: bestCost, solved: false, time: 0, evals: 40, note: `К-${k + 1}: черновик принят` };

		if (cfg.placement === "free") {
			for (let i = 0; i < 16; i++) {
				const snap = { qx: Q.x, qy: Q.y, a: shot.angle, p: shot.power, t: shot.t };
				Q.x = Math.max(0.06, Math.min(cfg.table.w - 0.06, Q.x + (rnd() - 0.5) * 0.3));
				Q.y = Math.max(0.06, Math.min(cfg.table.h - 0.06, Q.y + (rnd() - 0.5) * 0.3));
				shot.angle = Math.atan2(C.y - Q.y, C.x - Q.x);
				const dd = K.dist(Q, C);
				if (lockTimed) shot.power = timedPower(cfg, dd, Math.max(tauMin, tArrive - snap.t));
				else shot.power = powerFor(cfg, dd + K.dist(src, cp) * (timed ? 0.85 : 0.55));
				const c = legCost(cfg, st, k);
				if (c < bestCost - 1e-9) bestCost = c;
				else {
					Q.x = snap.qx;
					Q.y = snap.qy;
					shot.angle = snap.a;
					shot.power = snap.p;
					shot.t = snap.t;
				}
				if (i % 4 === 3)
					yield { phase: "маршрут", iter: k, cost: bestCost, best: bestCost, solved: false, time: 0, evals: 10, note: `К-${k + 1}: позиция битка` };
			}
			// финальные веерные подгонки после сдвига позиции
			sweep(
				(v) => (shot.angle = v),
				() => shot.angle,
				Array.from({ length: 13 }, (_u, i) => shot.angle + (i - 6) * 0.018),
			);
			sweep(
				(v) => (shot.power = v),
				() => shot.power,
				[0.8, 0.92, 1.05, 1.2, 1.45, 1.8].map((m) => Math.max(0.06, Math.min(cfg.maxPower, shot.power * m))),
			);
		}
	}

	/**
	 * Спасение непройденных leg'ов на готовом совместном плане: по записанному прогону
	 * строим призрачные точки к моменту прихода шара 1, выбираем лучший биток
	 * (прямой/рикошет, можно повторный — если он уже в покое) и веером доводим.
	 * Возвращает новое состояние и его стоимость.
	 */
	function rescueLegs(cfg, stIn, score) {
		const st = clone(stIn);
		const record = () =>
			K.runSim({
				table: cfg.table, params: cfg.params, object: cfg.object, cues: st.cues,
				checkpoints: cfg.checkpoints, shots: st.shots, maxTime: cfg.maxTime,
				fps: cfg.fps, sub: cfg.sub, holdAfterFinish: 0.2, record: true, trackNearest: true,
				cueColors: K.PLAYERS.map((p) => p.color),
			});
		const sumR = cfg.params.ballRadius * 2;
		for (let k = 0; k < cfg.checkpoints.length; k++) {
			let res = record();
			if (!Number.isNaN(res.passed[k])) continue;
			const tPrev = k === 0 ? 0 : res.passed[k - 1];
			if (k > 0 && Number.isNaN(tPrev)) break;
			const tArrive = k === 0 ? 0 : tPrev;
			const fi = k === 0 ? 0 : res.frames.frameAt(tArrive).i0;
			const bodies = st.cues.map((_c, i) => {
				const pos = k === 0 ? { ...st.cues[i] } : res.frames.at(tArrive, i + 1);
				const o = (fi * res.frames.nb + i + 1) * 2;
				return { x: pos.x, y: pos.y, vx: k === 0 ? 0 : res.frames.vel[o], vy: k === 0 ? 0 : res.frames.vel[o + 1], r: sumR / 2 };
			});
			const src = k === 0 ? { ...cfg.object } : res.frames.at(tArrive, 0);
			const cp = cfg.checkpoints[k];
			const dir = K.norm({ x: cp.x - src.x, y: cp.y - src.y });
			const C = K.contactPoint(src, dir, sumR);
			let best = null;
			for (let p = 0; p < st.cues.length; p++) {
				const Qp = bodies[p];
				if (Math.hypot(Qp.vx, Qp.vy) > cfg.params.stopEps * 2) continue;
				const aim = Math.atan2(C.y - Qp.y, C.x - Qp.x);
				const dd = K.dist(Qp, C);
				const all = [{ x: src.x, y: src.y, r: sumR / 2 }, ...bodies];
				const ray = K.castRay(Qp, { x: Math.cos(aim), y: Math.sin(aim) }, all, p + 1, sumR, cfg.table);
				let direct = false;
				let sc = -1e9;
				if (ray.hit === 0 && Math.abs(ray.dist - dd) < 0.12) {
					const fwd = -(ray.nx * dir.x + ray.ny * dir.y);
					if (fwd > 0.4) {
						direct = true;
						sc = 1000 + fwd * 200 - dd * 8;
					}
				}
				const bank = K.bankShot(Qp, C, all, p + 1, sumR, cfg.table);
				if (!direct && bank) sc = Math.max(sc, 500 - bank.len * 25);
				if (sc > -1e8 && (!best || sc > best.sc)) best = { p, sc, aim, bank, dd, direct, Qp };
			}
			if (!best) continue;
			const path = !best.direct && best.bank ? best.bank.len : best.dd;
			const vMax = cfg.maxPower / cfg.params.cueMass;
			const tau = Math.max(0.12, Math.min(Math.max(0.15, (tArrive - 0.02) || 0.2), (path / vMax) * 1.15 * 1.4));
			let si = st.shots.findIndex((s) => s.id?.startsWith(`auto-${k}-`));
			const make = () => ({
				id: `auto-${k}-${best.p}`,
				player: best.p,
				t: k === 0 ? 0 : Math.max(0, tArrive - tau),
				angle: !best.direct && best.bank ? best.bank.angle : best.aim,
				power: k === 0
					? powerFor(cfg, path + K.dist(src, cp) * 0.6)
					: Math.min(cfg.maxPower, K.timedPower ? K.timedPower(cfg, path, tau) * (!best.direct ? 1.25 : 1) : 1),
			});
			const sh = make();
			if (si < 0) {
				st.shots.push(sh);
				si = st.shots.length - 1;
			} else st.shots[si] = sh;
			res = record();
			let bestCost = K.planCost(res, { guide: 26, miss: 1500 }) + overlapPenalty(st, cfg.params);
			const fan = (key, cands) => {
				const keep = st.shots[si][key];
				for (const cand of cands) {
					st.shots[si][key] = cand;
					const r = record();
					const c = K.planCost(r, { guide: 26, miss: 1500 }) + overlapPenalty(st, cfg.params);
					if (c < bestCost - 1e-9) bestCost = c;
					else st.shots[si][key] = keep;
				}
			};
			fan("angle", Array.from({ length: 41 }, (_u, i) => sh.angle + (i - 20) * 0.025));
			fan("power", [0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.4, 1.7, 2.1, 2.6].map((m) => Math.max(0.06, Math.min(cfg.maxPower, sh.power * m))));
			if (k > 0) fan("t", Array.from({ length: 25 }, (_u, i) => Math.max(0, sh.t + (i - 12) * 0.08)));
			fan("angle", Array.from({ length: 21 }, (_u, i) => st.shots[si].angle + (i - 10) * 0.01));
		}
		const final = score(st);
		return { state: st, cost: final.cost, res: final.res };
	}

	/** Один запуск поиска от сида. Кладёт улучшения в общий out. */
	function* runAttempt(cfg, budget, out, seed, useUserPlan, evalsRef, attemptNo, attempts) {
		const rnd = K.mulberry32(seed);
		const evals = () => evalsRef.n;
		const cost = (s) => {
			evalsRef.n++;
			return costOf(cfg, s);
		};
		const tag = () => (attempts > 1 ? ` · попытка ${attemptNo}/${attempts}` : "");

		const st = {
			shots: useUserPlan ? (cfg.seedPlan ?? []).map((s, i) => ({ ...s, id: s.id || `s${i}` })) : [],
			cues: cfg.cues.map((c) => ({ ...c })),
		};

		let cur = cost(st);
		let best = { state: clone(st), cost: cur.cost, res: cur.res };
		let stall = 0;
		const publish = () => {
			if (!out.best || best.cost < out.best.cost - 1e-9)
				out.best = { state: clone(best.state), res: best.res, cost: best.cost, evals: evalsRef.n, iters: 0 };
		};
		publish();
		yield { phase: "старт", iter: 0, cost: cur.cost, best: out.best.cost, solved: cur.res.solved, time: cur.res.finishAt, evals: evals(), note: (st.shots.length ? "текущий план" : "пустой план") + tag() };

		if (!useUserPlan || st.shots.length < cfg.checkpoints.length) {
			// плана пользователя нет или он неполный — строим черновик с нуля
			st.shots = [];
			st.cues = cfg.cues.map((c) => ({ ...c }));
			const used = new Set();
			for (let k = 0; k < cfg.checkpoints.length; k++) {
				const g = legSearch(cfg, st, k, rnd, used);
				for (;;) {
					const r = g.next();
					if (r.done) break;
					yield { ...r.value, evals: evals(), note: r.value.note + tag() };
				}
			}
			cur = cost(st);
			if (cur.cost < best.cost) best = { state: clone(st), cost: cur.cost, res: cur.res };
			publish();
			yield { phase: "геометрия", iter: 0, cost: cur.cost, best: out.best.cost, solved: cur.res.solved, time: cur.res.finishAt, evals: evals(), note: "черновик маршрута готов" + tag() };
		}

		let state = clone(st);
		const ps = specs(cfg, state);
		let iter = 0;
		let temp = 0.6;

		while (iter < budget.iters) {
			iter++;
			// градиент (конечные разности) + линейный поиск
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
				const base = best.cost;
				const x0 = ps.map((p) => get(state, p));
				let accepted = false;
				for (let ls = 0; ls < 4; ls++) {
					ps.forEach((p, i) => set(state, p, x0[i] - ((lr * g[i]) / gn) * p.step * 8));
					const c = cost(state).cost;
					if (c < base - 1e-9) {
						accepted = true;
						break;
					}
					lr *= 0.45;
				}
				if (!accepted) ps.forEach((p, i) => set(state, p, x0[i]));
				else {
					const r = cost(state);
					if (r.cost < best.cost) {
						best = { state: clone(state), cost: r.cost, res: r.res };
						stall = 0;
						publish();
					}
				}
				yield { phase: "градиент", iter, cost: cost(state).cost, best: best.cost, solved: best.res.solved, time: best.res.finishAt, evals: evals(), note: "∇ по конечным разностям" };
			}

			// координатный спуск с множащимся шагом (устойчив к шуму дискретной симуляции)
			let improved = false;
			for (const p of ps) {
				let cur0 = get(state, p);
				let bestLocal = cost(state).cost;
				for (const mult of [1, 2.5, 6]) {
					for (const dir of [1, -1]) {
						set(state, p, cur0 + dir * p.step * mult);
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
			let rc = cost(state);
			if (rc.cost < best.cost) {
				best = { state: clone(state), cost: rc.cost, res: rc.res };
				stall = 0;
				publish();
			} else stall++;

			// прицельная локальная доводка первого непройденного leg'а (веер угол/сила/время)
			if (iter % 2 === 0) {
				const missLeg = best.res.passed.findIndex((p) => Number.isNaN(p));
				const si = missLeg >= 0 ? state.shots.findIndex((s) => s.id?.startsWith(`auto-${missLeg}-`)) : -1;
				if (si >= 0) {
					const sh = state.shots[si];
					const fan = (key, cands) => {
						const keep = sh[key];
						for (const cand of cands) {
							sh[key] = cand;
							const r2 = cost(state);
							if (r2.cost < best.cost - 1e-9) {
								best = { state: clone(state), cost: r2.cost, res: r2.res };
								publish();
								rc = r2;
							} else sh[key] = keep;
						}
					};
					fan("angle", Array.from({ length: 33 }, (_u, i) => sh.angle + (i - 16) * 0.03));
					fan(
						"power",
						[0.55, 0.7, 0.85, 1, 1.15, 1.35, 1.6, 2, 2.5].map((m) =>
							Math.max(0.06, Math.min(cfg.maxPower, sh.power * m)),
						),
					);
					if (missLeg > 0) fan("t", Array.from({ length: 21 }, (_u, i) => Math.max(0, sh.t + (i - 10) * 0.08)));
					fan("angle", Array.from({ length: 21 }, (_u, i) => sh.angle + (i - 10) * 0.012));
				}
			}
			yield { phase: "координаты", iter, cost: rc.cost, best: best.cost, solved: best.res.solved, time: best.res.finishAt, evals: evals(), note: improved ? "улучшение" : "плато" };

			// спасательная перестройка непройденных leg'ов на совместном плане
			if (iter % 6 === 0 && !best.res.solved) {
				const rsc = rescueLegs(cfg, best.state, (s) => {
					evalsRef.n++;
					return costOf(cfg, s);
				});
				if (rsc.cost < best.cost - 1e-9) {
					best = { state: clone(rsc.state), cost: rsc.cost, res: rsc.res };
					state = clone(rsc.state);
					stall = 0;
					publish();
				}
				yield { phase: "спасение", iter, cost: best.cost, best: best.cost, solved: best.res.solved, time: best.res.finishAt, evals: evals(), note: "перестройка leg'ов" };
			}

			// отжиг Метрополиса — выброс из плато
			if (stall > 2 || !best.res.solved) {
				// первый непройденный leg — кандидат на прицельный рестарт
				const missLeg = best.res.passed.findIndex((p) => Number.isNaN(p));
				const missShot = missLeg >= 0 ? state.shots.findIndex((s) => s.id?.startsWith(`auto-${missLeg}-`)) : -1;
				for (let a = 0; a < 16; a++) {
					const trial = clone(state);
					if (missShot >= 0 && a < 6) {
						const sh = trial.shots[missShot];
						sh.angle = rnd() * Math.PI * 2 - Math.PI;
						sh.power = Math.max(0.1, cfg.maxPower * (0.2 + rnd() * 0.8));
						if (cfg.timeMode) sh.t = rnd() * cfg.maxTime * 0.8;
						// лёгкое касание остальных параметров
						ps.forEach((p) => {
							if (p.k === "angle" && p.i === missShot && cfg.timeMode === false) return;
							const span = p.max - p.min;
							set(trial, p, get(trial, p) + (rnd() - 0.5) * span * 0.03 * temp);
						});
					} else {
						ps.forEach((p) => {
							const span = p.max - p.min;
							set(trial, p, get(trial, p) + (rnd() - 0.5) * span * 0.05 * temp);
						});
					}
					const tr = cost(trial);
					const d = tr.cost - rc.cost;
					const accept = d < 0 || rnd() < Math.exp(-d / (temp * 0.5 + 1e-6));
					if (accept) state = trial;
					if (tr.cost < best.cost) {
						best = { state: clone(trial), cost: tr.cost, res: tr.res };
						stall = 0;
						if (out.best === null || tr.cost < out.best.cost) out.best = { state: clone(trial), res: tr.res, cost: tr.cost, evals: evalsRef.n, iters: iter };
					}
				}
				temp *= 0.9;
				yield { phase: "отжиг", iter, cost: cost(state).cost, best: best.cost, solved: best.res.solved, time: best.res.finishAt, evals: evals(), note: `T=${temp.toFixed(2)}` };
			}
			if (temp < 0.02) temp = 0.35;
			if (best.res.solved && stall > 9) {
				yield { phase: "готово", iter, cost: best.cost, best: best.cost, solved: true, time: best.res.finishAt, evals: evals(), note: "сошлось" };
				break;
			}
		}

		if (!best.res.solved) {
			const rsc = rescueLegs(cfg, best.state, (s) => {
				evalsRef.n++;
				return costOf(cfg, s);
			});
			if (rsc.cost < best.cost - 1e-9) best = { state: clone(rsc.state), cost: rsc.cost, res: rsc.res };
			publish();
			yield { phase: "спасение", iter, cost: best.cost, best: best.cost, solved: best.res.solved, time: best.res.finishAt, evals: evals(), note: "финальная перестройка" };
		}

		return { state: best.state, res: best.res, cost: best.cost, evals: evalsRef.n, iters: iter };
	}

	/**
	 * Ансамбль из нескольких сидов: фиксированные расстановки не всегда имеют
	 * решение от конкретного старта конструктора, поэтому перезапускаем поиск
	 * и оставляем лучший. Первый старт — от плана пользователя (если задан).
	 */
	function* solveGenerator(cfg, budget, out) {
		const attempts = Math.max(1, cfg.attempts ?? 3);
		const base = cfg.seed || 1;
		const seeds = [base];
		for (let a = 1; a < attempts; a++) {
			const x = Math.imul((base + a * 2654435761) | 0, 2246822519);
			seeds.push((x ^ (x >>> 13)) >>> 0 || base + a * 97);
		}
		const evalsRef = { n: 0 };
		let last = null;
		for (let a = 0; a < attempts; a++) {
			const useUserPlan = a === 0 && !!cfg.seedPlan && cfg.useSeed !== false;
			const gen = runAttempt(cfg, budget, out, seeds[a], useUserPlan, evalsRef, a + 1, attempts);
			for (;;) {
				const r = gen.next();
				if (r.done) {
					last = r.value;
					break;
				}
				yield r.value;
			}
			if (out.best?.res.solved) break;
		}
		return last ?? out.best;
	}

	class Solver {
		constructor(cfg, iters = 40) {
			this.out = { best: null };
			this.gen = solveGenerator(cfg, { iters }, this.out);
			this.progress = { phase: "ожидание", iter: 0, cost: Infinity, best: Infinity, solved: false, time: Infinity, evals: 0, note: "" };
			this.solution = null;
			this.done = false;
		}

		get current() {
			return this.solution ?? this.out.best;
		}

		/** Выкачивает итерации в пределах бюджета времени (мс). */
		run(budgetMs) {
			const now = typeof performance !== "undefined" ? performance.now() : Date.now();
			while (!this.done) {
				const r = this.gen.next();
				if (r.done) {
					this.done = true;
					this.solution = this.out.best ?? r.value;
					this.progress = {
						...this.progress,
						phase: "готово",
						solved: !!this.solution?.res.solved,
						best: this.solution?.cost ?? this.progress.best,
						time: this.solution?.res.finishAt ?? this.progress.time,
					};
					break;
				}
				this.progress = r.value;
				if (this.out.best && (!this.solution || this.out.best.cost < this.solution.cost)) this.solution = this.out.best;
				const t = typeof performance !== "undefined" ? performance.now() : Date.now();
				if (t - now > budgetMs) break;
			}
			return this.progress;
		}
	}

	Object.assign(K, {
		Solver,
		evaluate: (cfg, st) => evaluate(cfg, st),
		costOf: (cfg, st) => costOf(cfg, st),
		legSearch,
		rescueLegs: (cfg, st) => rescueLegs(cfg, st, (s) => costOf(cfg, s)),
		timedPower,
		powerFor,
		OPT_POWER_MAX,
	});
});
