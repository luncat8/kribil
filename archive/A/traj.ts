import type { Body } from "./physics";

/**
	* Кольцевой (растущий) буфер кадров симуляции: позиции и скорости всех тел.
	* Используется и планировщиком (полный прогон), и реалтаймом (живая запись),
	* чтобы отрисовка траекторий и слайдер времени были одинаковыми.
	*/
export class Traj {
	readonly fps: number;
	readonly nb: number;
	count = 0;
	private cap: number;
	time: Float64Array;
	pos: Float64Array;
	vel: Float64Array;

	constructor(fps: number, ballCount: number, cap = 1024) {
	this.fps = fps;
	this.nb = ballCount;
	this.cap = cap;
	this.time = new Float64Array(cap);
	this.pos = new Float64Array(cap * ballCount * 2);
	this.vel = new Float64Array(cap * ballCount * 2);
	}

	private ensure(need: number) {
	if (need <= this.cap) return;
	let cap = this.cap;
	while (cap < need) cap *= 2;
	const time = new Float64Array(cap);
	time.set(this.time);
	const pos = new Float64Array(cap * this.nb * 2);
	pos.set(this.pos);
	const vel = new Float64Array(cap * this.nb * 2);
	vel.set(this.vel);
	this.cap = cap;
	this.time = time;
	this.pos = pos;
	this.vel = vel;
	}

	reset() {
	this.count = 0;
	}

	push(t: number, balls: Body[]) {
	this.ensure(this.count + 1);
	const i = this.count;
	this.time[i] = t;
	for (let b = 0; b < this.nb; b++) {
		const o = (i * this.nb + b) * 2;
		const src = balls[b];
		this.pos[o] = src.x;
		this.pos[o + 1] = src.y;
		this.vel[o] = src.vx;
		this.vel[o + 1] = src.vy;
	}
	this.count++;
	}

	x(i: number, b: number) {
	return this.pos[(i * this.nb + b) * 2];
	}
	y(i: number, b: number) {
	return this.pos[(i * this.nb + b) * 2 + 1];
	}
	speed(i: number, b: number) {
	return Math.hypot(this.vel[(i * this.nb + b) * 2], this.vel[(i * this.nb + b) * 2 + 1]);
	}

	/** Кадр (с интерполяцией) для произвольного времени. */
	frameAt(t: number): { i0: number; f: number } {
	const raw = Math.max(0, Math.min((this.count - 1) * 1, t * this.fps));
	const i0 = Math.floor(raw);
	const i1 = Math.min(this.count - 1, i0 + 1);
	let f = raw - i0;
	if (i1 === i0) f = 0;
	return { i0: i1 === i0 ? i0 : i0, f: this.count ? f : 0 };
	}

	at(t: number, b: number): { x: number; y: number } {
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
