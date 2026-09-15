/* Кольцевой кадровый буфер позиций/скоростей всех тел.
	 Один и тот же формат у планировщика (полный прогон) и реалтайма (живая запись). */
"use strict";
(function (global, factory) {
	const K = global.Kribil ?? (global.Kribil = {});
	factory(K);
	if (typeof module !== "undefined" && module.exports) module.exports = K;
})(typeof globalThis !== "undefined" ? globalThis : this, function (K) {
	if (typeof require === "function") require("./core.js");

	class Traj {
		constructor(fps, ballCount, cap = 1024) {
			this.fps = fps;
			this.nb = ballCount;
			this.cap = cap;
			this.count = 0;
			this.time = new Float64Array(cap);
			this.pos = new Float64Array(cap * ballCount * 2);
			this.vel = new Float64Array(cap * ballCount * 2);
		}

		ensure(need) {
			if (need <= this.cap) return;
			let cap = this.cap;
			while (cap < need) cap *= 2;
			const grow = (Arr, old) => {
				const n = new Arr(cap * (old.length / this.cap));
				n.set(old);
				return n;
			};
			this.time = grow(Float64Array, this.time);
			this.pos = grow(Float64Array, this.pos);
			this.vel = grow(Float64Array, this.vel);
			this.cap = cap;
		}

		reset() {
			this.count = 0;
		}

		push(t, balls) {
			this.ensure(this.count + 1);
			const i = this.count;
			this.time[i] = t;
			for (let b = 0; b < this.nb; b++) {
				const o = (i * this.nb + b) * 2;
				this.pos[o] = balls[b].x;
				this.pos[o + 1] = balls[b].y;
				this.vel[o] = balls[b].vx;
				this.vel[o + 1] = balls[b].vy;
			}
			this.count++;
		}

		x(i, b) {
			return this.pos[(i * this.nb + b) * 2];
		}
		y(i, b) {
			return this.pos[(i * this.nb + b) * 2 + 1];
		}
		speed(i, b) {
			const o = (i * this.nb + b) * 2;
			return Math.hypot(this.vel[o], this.vel[o + 1]);
		}

		/** Индекс кадра и доля интерполяции для времени t. */
		frameAt(t) {
			if (this.count === 0) return { i0: 0, f: 0 };
			const raw = Math.max(0, Math.min(this.count - 1, t * this.fps));
			const i0 = Math.min(this.count - 1, Math.floor(raw));
			const i1 = Math.min(this.count - 1, i0 + 1);
			return { i0, f: i1 === i0 ? 0 : raw - i0 };
		}

		at(t, b) {
			if (this.count === 0) return { x: 0, y: 0 };
			const { i0, f } = this.frameAt(t);
			const i1 = Math.min(this.count - 1, i0 + 1);
			return {
				x: this.x(i0, b) + (this.x(i1, b) - this.x(i0, b)) * f,
				y: this.y(i0, b) + (this.y(i1, b) - this.y(i0, b)) * f,
			};
		}

		get duration() {
			return this.count / this.fps;
		}
	}

	K.Traj = Traj;
});
