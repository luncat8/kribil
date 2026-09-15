/* Полный детерминированный прогон плана: кадры, события, проходы КТ, финиш. */
"use strict";
(function (global, factory) {
	const K = global.Kribil ?? (global.Kribil = {});
	factory(K);
	if (typeof module !== "undefined" && module.exports) module.exports = K;
})(typeof globalThis !== "undefined" ? globalThis : this, function (K) {
	if (typeof require === "function") {
		require("./core.js");
		require("./physics.js");
		require("./traj.js");
		require("./levels.js");
	}

	function makeBodies(cfg) {
		const p = cfg.params;
		const list = [
			K.makeBody({
				id: "obj",
				kind: "object",
				owner: -1,
				x: cfg.object.x,
				y: cfg.object.y,
				mass: p.objectMass,
				r: p.ballRadius,
				color: cfg.objectColor ?? K.OBJECT_COLOR,
				label: "1",
				idx: 0,
			}),
		];
		cfg.cues.forEach((c, i) => {
			list.push(
				K.makeBody({
					id: `cue${i}`,
					kind: "cue",
					owner: i,
					x: c.x,
					y: c.y,
					mass: p.cueMass,
					r: p.ballRadius,
					color: cfg.cueColors?.[i] ?? K.PLAYERS[i]?.color ?? "#9ae6b4",
					label: `${i + 1}`,
					idx: list.length,
				}),
			);
		});
		return list;
	}

	/**
	 * Полный прогон. record=false — без записи кадров (для оптимизатора, горячий путь).
	 * windows[k] = [tВхода, tВыхода] — интервал, когда центр шара 1 был внутри круга КТ.
	 */
	function runSim(cfg) {
		const fps = cfg.fps ?? 120;
		const dt = 1 / fps;
		const sub = cfg.sub ?? 4;
		const h = dt / sub;
		const params = cfg.params;
		const maxTime = cfg.maxTime ?? 12;
		const trackNearest = cfg.trackNearest ?? true;
		const record = cfg.record !== false;
		const balls = makeBodies(cfg);
		const cp = cfg.checkpoints;
		const nCp = cp.length;
		const passed = new Array(nCp).fill(NaN);
		const nearest = new Array(nCp).fill(Infinity);
		const winEnter = new Array(nCp).fill(NaN);
		const windows = new Array(nCp).fill(null);
		const touches = new Array(balls.length).fill(0);
		const events = [];
		const shots = [...cfg.shots].sort((a, b) => a.t - b.t);
		let si = 0;
		let nextCp = 0;
		let finishAt = Infinity;
		let firstContact = Infinity;
		let contacts = 0;
		let restSince = -1;
		const hold = cfg.holdAfterFinish ?? 0.4;
		const hardLimit = Math.max(2, Math.ceil((maxTime + hold + 0.6) * fps));
		const frames = new K.Traj(fps, balls.length, Math.min(hardLimit, 4096));
		let t = 0;
		let count = 0;

		const trackWindow = (tt) => {
			if (nextCp >= nCp) return;
			const k = nextCp;
			const c = cp[k];
			const inside = Math.hypot(balls[0].x - c.x, balls[0].y - c.y) <= c.r;
			if (inside && Number.isNaN(winEnter[k])) winEnter[k] = tt;
			if (!inside && !Number.isNaN(winEnter[k]) && Number.isNaN(passed[k])) {
				// вошли и вышли, не зачтя точку (не тот порядок/касание края) — следим заново
				winEnter[k] = NaN;
			}
			if (!inside && !Number.isNaN(passed[k]) && windows[k] === null) {
				windows[k] = [winEnter[k], tt];
			}
		};

		for (let f = 0; f < hardLimit; f++) {
			if (record) frames.push(t, balls);
			count = f + 1;

			for (let k = 0; k < sub; k++) {
				const tt = t + k * h;
				while (si < shots.length && shots[si].t <= tt + 1e-9) {
					const s = shots[si++];
					const body = balls.find((b) => b.kind === "cue" && b.owner === s.player);
					if (body) {
						K.applyImpulse(body, s.angle, s.power);
						events.push({ t: tt, type: "shot", a: body.idx, b: -1, imp: s.power, player: s.player, label: `удар P${s.player + 1}` });
					}
				}
				const before = events.length;
				K.stepBodies(balls, h, params, cfg.table, events, tt);
				for (let e = before; e < events.length; e++) {
					const ev = events[e];
					if (ev.type !== "contact") continue;
					contacts++;
					if (ev.a === 0 || ev.b === 0) {
						touches[ev.a]++;
						touches[ev.b]++;
						if (firstContact === Infinity) firstContact = ev.t;
					}
				}
				trackWindow(tt);
				if (nextCp < nCp) {
					const c = cp[nextCp];
					const dx = balls[0].x - c.x;
					const dy = balls[0].y - c.y;
					if (dx * dx + dy * dy <= c.r * c.r) {
						passed[nextCp] = tt;
						events.push({ t: tt, type: "checkpoint", a: 0, b: nextCp, label: `К-${nextCp + 1}` });
						nextCp++;
						if (nextCp === nCp) {
							finishAt = tt;
							events.push({ t: tt, type: "finish", a: 0, b: -1, label: "финиш" });
						}
					}
				}
				trackWindow(tt);
			}

			if (trackNearest) {
				for (let kk = 0; kk < nCp; kk++) {
					if (kk > 0 && Number.isNaN(passed[kk - 1])) continue;
					if (!Number.isNaN(passed[kk])) continue;
					const d = Math.hypot(balls[0].x - cp[kk].x, balls[0].y - cp[kk].y);
					if (d < nearest[kk]) nearest[kk] = d;
				}
			}

			t += dt;
			const allShot = si >= shots.length;
			if (K.totalKE(balls) < 1e-6 && allShot) {
				if (restSince < 0) restSince = t;
				else if (t - restSince > 0.25) {
					events.push({ t, type: "rest", a: -1, b: -1, label: "стоп" });
					count = frames.count;
					break;
				}
			} else restSince = -1;

			if (Number.isFinite(finishAt) && t > finishAt + hold) break;
		}

		// замкнуть незакрытые окна (финиш внутри круга или стоп в круге)
		for (let k = 0; k < nCp; k++) {
			if (windows[k] === null && !Number.isNaN(winEnter[k])) windows[k] = [winEnter[k], passed[k] ?? t];
		}

		return {
			frames,
			bodies: balls,
			passed,
			nearest,
			windows,
			firstContact,
			contacts,
			touches,
			finishAt,
			duration: count / fps,
			events: events.sort((a, b) => a.t - b.t),
			maxTime,
			solved: passed.every((p) => !Number.isNaN(p)),
		};
	}

	/**
	 * Стоимость плана: время leg'ов + направляющий член по дистанции ближайшего
	 * подхода + крупный штраф за каждую непройденную точку. Разрывность смягчена
	 * направляющим членом — у поиска всегда есть градиент «куда улучшать».
	 */
	function planCost(res, weights) {
		const guide = weights?.guide ?? 26;
		const missPen = weights?.miss ?? 1500;
		let sumLeg = 0;
		let miss = 0;
		let guideSum = 0;
		let prev = 0;
		for (let k = 0; k < res.passed.length; k++) {
			const p = res.passed[k];
			if (Number.isNaN(p)) {
				miss++;
				const near = res.nearest[k];
				guideSum += Number.isFinite(near) ? near : 2;
			} else {
				sumLeg += Math.max(0, p - prev);
				prev = p;
			}
		}
		return sumLeg + guide * guideSum + missPen * miss;
	}

	function splits(res) {
		const out = [];
		let prev = 0;
		for (let i = 0; i < res.passed.length; i++) {
			const at = res.passed[i];
			if (Number.isNaN(at)) {
				out.push({ i, at: NaN, leg: NaN });
				continue;
			}
			out.push({ i, at, leg: at - prev });
			prev = at;
		}
		return out;
	}

	Object.assign(K, { makeBodies, runSim, planCost, splits });
});
