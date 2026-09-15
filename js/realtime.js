/* Живой движок реалтайма: 240 Гц физика, NPC со стратегиями, запись кадров 60 Гц. */
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
		require("./simulate.js");
		require("./bots.js");
		require("./levels.js");
	}

	const REC_FPS = 60;
	const H = 1 / 240;

	class LiveEngine {
		constructor(cfg) {
			this.cfg = cfg;
			this.balls = this.spawn(cfg);
			this.traj = new K.Traj(REC_FPS, this.balls.length, 512);
			this.events = [];
			this.t = 0;
			this.acc = 0;
			this.lastRec = -1;
			this.lastBot = -1;
			this.nextCp = 0;
			this.passed = new Array(cfg.checkpoints.length).fill(NaN);
			this.finishAt = Infinity;
			this.running = false;
			this.speed = cfg.speed ?? 1;
			this.cooldown = cfg.cues.map((_c, i) => (cfg.human === i ? 0 : 0.7 + i * 0.4));
			this.shotCount = cfg.cues.map(() => 0);
			this.notes = cfg.cues.map(() => "готов");
			this.aim = { angle: 0, power: 1.2 };
			this.view = {
				balls: this.balls,
				table: cfg.table,
				params: cfg.params,
				checkpoints: cfg.checkpoints,
				nextCp: 0,
				t: 0,
				maxPower: cfg.maxPower,
				rollout: (p, a, pw) => K.rolloutCost(this.view, this.balls, p, a, pw),
			};
			this.reset(cfg);
		}

		spawn(cfg) {
			return K.makeBodies({
				params: cfg.params,
				object: cfg.object,
				cues: cfg.cues,
				objectColor: K.OBJECT_COLOR,
				cueColors: K.PLAYERS.map((p) => p.color),
			});
		}

		reset(cfg) {
			this.cfg = cfg;
			this.balls = this.spawn(cfg);
			this.balls.forEach((b, i) => (b.idx = i));
			this.view.balls = this.balls;
			this.traj.reset();
			this.events = [];
			this.t = 0;
			this.acc = 0;
			this.lastRec = -1;
			this.lastBot = -1;
			this.nextCp = 0;
			this.view.nextCp = 0;
			this.passed = new Array(cfg.checkpoints.length).fill(NaN);
			this.finishAt = Infinity;
			this.running = false;
			this.speed = cfg.speed ?? 1;
			this.cooldown = cfg.cues.map((_c, i) => (cfg.human === i ? 0 : 0.7 + i * 0.4));
			this.shotCount = cfg.cues.map(() => 0);
			this.notes = cfg.cues.map(() => "готов");
			this.traj.push(0, this.balls);
		}

		get cueOf() {
			return this.cfg.human ?? 0;
		}

		get humanBall() {
			return this.balls.find((b) => b.kind === "cue" && b.owner === this.cueOf);
		}

		aimAt(p) {
			const b = this.humanBall;
			if (!b) return;
			this.aim.angle = Math.atan2(p.y - b.y, p.x - b.x);
			const d = Math.hypot(p.x - b.x, p.y - b.y);
			this.aim.power = Math.max(0.1, Math.min(this.cfg.maxPower, 0.2 + d * 2.6));
		}

		shoot(player, angle, power, byBot = false) {
			const b = this.balls.find((x) => x.kind === "cue" && x.owner === player);
			if (!b) return false;
			if (this.t < this.cooldown[player]) return false;
			K.applyImpulse(b, angle, power);
			this.cooldown[player] = this.t + (byBot ? K.PLAYERS[player].cool : 0.28);
			this.shotCount[player]++;
			this.events.push({ t: this.t, type: "shot", a: b.idx, b: -1, imp: power, player, label: byBot ? K.PLAYERS[player].nick : "выстрел" });
			this.notes[player] = byBot ? "бьёт" : "ваш удар";
			return true;
		}

		update(dtWall) {
			if (!this.running) return;
			this.acc += Math.min(0.06, dtWall) * this.speed;
			while (this.acc >= H) {
				this.acc -= H;
				this.step(H);
				if (!this.running) break;
			}
		}

		step(h) {
			const cfg = this.cfg;
			if (this.t - this.lastBot > 0.06) {
				this.lastBot = this.t;
				this.view.t = this.t;
				this.view.nextCp = this.nextCp;
				for (let p = 0; p < cfg.cues.length; p++) {
					if (!(cfg.botEnabled?.[p] ?? true)) continue;
					if (this.t < this.cooldown[p]) continue;
					if (this.nextCp >= cfg.checkpoints.length) break;
					const d = K.botDecide(K.PLAYERS[p], this.view);
					if (!d) {
						this.cooldown[p] = this.t + 0.22;
						this.notes[p] = "ждёт";
						continue;
					}
					this.notes[p] = d.note;
					this.shoot(p, d.angle, d.power, true);
				}
			}

			K.stepBodies(this.balls, h, cfg.params, cfg.table, this.events, this.t);

			const cps = cfg.checkpoints;
			if (this.nextCp < cps.length) {
				const c = cps[this.nextCp];
				const o = this.balls[0];
				const dx = o.x - c.x;
				const dy = o.y - c.y;
				if (dx * dx + dy * dy <= c.r * c.r) {
					this.passed[this.nextCp] = this.t;
					this.events.push({ t: this.t, type: "checkpoint", a: 0, b: this.nextCp, label: `К-${this.nextCp + 1}` });
					this.nextCp++;
					this.view.nextCp = this.nextCp;
					if (this.nextCp >= cps.length) {
						this.finishAt = this.t;
						this.running = false;
						this.events.push({ t: this.t, type: "finish", a: 0, b: -1, label: "финиш" });
					}
				}
			}

			this.t += h;
			if (this.t - this.lastRec >= 1 / REC_FPS - 1e-9) {
				this.traj.push(this.t, this.balls);
				this.lastRec = this.t;
			}
			if (this.events.length > K.MAX_EVENTS) this.events.length = K.MAX_EVENTS;
		}

		get solved() {
			return this.nextCp >= this.cfg.checkpoints.length;
		}
	}

	K.LiveEngine = LiveEngine;
});
