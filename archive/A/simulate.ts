import { applyImpulse, stepBodies, totalKE, type Body, type SimEvent } from "./physics";
import { Traj } from "./traj";
import type { Checkpoint, PhysicsParams, Shot, TableSpec, Vec } from "./types";

export interface SimConfig {
	table: TableSpec;
	params: PhysicsParams;
	object: Vec;
	cues: Vec[];
	checkpoints: Checkpoint[];
	shots: Shot[];
	/** секунд симуляции */
	maxTime?: number;
	fps?: number;
	sub?: number;
	/** сколько ещё писать после последнего КТ */
	holdAfterFinish?: number;
	trackNearest?: boolean;
	objectColor?: string;
	cueColors?: string[];
}

export interface SimResult {
	frames: Traj;
	bodies: Body[];
	/** время прохода k-й контрольной точки (в порядке маршрута), NaN если не пройдена */
	passed: number[];
	/** минимальное расстояние шара 1 до точки (после прохода предыдущей) */
	nearest: number[];
	/** момент, когда любой биток впервые коснулся шара 1 */
	firstContact: number;
	contacts: number;
	touches: number[];
	finishAt: number;
	duration: number;
	events: SimEvent[];
	maxTime: number;
	solved: boolean;
}

export function makeBodies(
	cfg: { params: PhysicsParams; object: Vec; cues: Vec[]; objectColor?: string; cueColors?: string[] },
): Body[] {
	const list: Body[] = [
	{
		id: "obj",
		kind: "object",
		owner: -1,
		x: cfg.object.x,
		y: cfg.object.y,
		vx: 0,
		vy: 0,
		mass: cfg.params.objectMass,
		r: cfg.params.ballRadius,
		color: cfg.objectColor ?? "#fdf6e0",
		label: "ШАР 1",
		idx: 0,
	},
	];
	cfg.cues.forEach((c, i) => {
	list.push({
		id: `cue${i}`,
		kind: "cue",
		owner: i,
		x: c.x,
		y: c.y,
		vx: 0,
		vy: 0,
		mass: cfg.params.cueMass,
		r: cfg.params.ballRadius,
		color: cfg.cueColors?.[i] ?? "#9ae6b4",
		label: `БИТОК ${i + 1}`,
		idx: list.length,
	});
	});
	return list;
}

/** Полный прогон плана: пишет траектории, ловит контакты, КТ и финиш. */
export function runSim(cfg: SimConfig): SimResult {
	const fps = cfg.fps ?? 120;
	const dt = 1 / fps;
	const sub = cfg.sub ?? 4;
	const h = dt / sub;
	const params = cfg.params;
	const maxTime = cfg.maxTime ?? 12;
	const trackNearest = cfg.trackNearest ?? true;
	const balls = makeBodies(cfg);
	const cp = cfg.checkpoints;
	const nCp = cp.length;
	const passed = new Array<number>(nCp).fill(NaN);
	const nearest = new Array<number>(nCp).fill(Infinity);
	const touches = new Array<number>(balls.length).fill(0);
	const events: SimEvent[] = [];
	const shots = [...cfg.shots].sort((a, b) => a.t - b.t);
	let si = 0;
	let nextCp = 0;
	let finishAt = Infinity;
	let firstContact = Infinity;
	let contacts = 0;
	let restSince = -1;
	const hardLimit = Math.max(2, Math.ceil((maxTime + (cfg.holdAfterFinish ?? 0.4) + 0.6) * fps));

	const frames = new Traj(fps, balls.length, Math.min(hardLimit, 2048));
	let t = 0;
	let count = 0;

	for (let f = 0; f < hardLimit; f++) {
	frames.push(t, balls);
	count = f + 1;

	for (let k = 0; k < sub; k++) {
		const tt = t + k * h;
		while (si < shots.length && shots[si].t <= tt + 1e-9) {
		const s = shots[si++];
		const body = balls.find((b) => b.kind === "cue" && b.owner === s.player);
		if (body) {
		applyImpulse(body, s.angle, s.power);
		events.push({ t: tt, type: "shot", a: body.idx, b: -1, imp: s.power, label: `удар P${s.player + 1}` });
		}
		}
		const before = events.length;
		stepBodies(balls, h, params, cfg.table, events, tt);
		for (let e = before; e < events.length; e++) {
		const ev = events[e];
		if (ev.type !== "contact") continue;
		contacts++;
		const obj = ev.a === 0 ? ev.b : ev.b === 0 ? ev.a : -1;
		if (obj >= 0) {
		touches[ev.a]++;
		touches[ev.b]++;
		if (firstContact === Infinity) firstContact = ev.t;
		}
		}
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
	}

	if (trackNearest) {
		for (let kk = 0; kk < nCp; kk++) {
		if (kk > 0 && Number.isNaN(passed[kk - 1])) continue;
		if (!Number.isNaN(passed[kk])) continue;
		const c = cp[kk];
		const d = Math.hypot(balls[0].x - c.x, balls[0].y - c.y);
		if (d < nearest[kk]) nearest[kk] = d;
		}
	}

	t += dt;

	const allShot = si >= shots.length;
	const ke = totalKE(balls);
	if (ke < 1e-6 && allShot) {
		if (restSince < 0) restSince = t;
		else if (t - restSince > 0.25) {
		events.push({ t, type: "rest", a: -1, b: -1, label: "стоп" });
		count = frames.count;
		break;
		}
	} else restSince = -1;

	if (Number.isFinite(finishAt) && t > finishAt + (cfg.holdAfterFinish ?? 0.4)) break;
	}

	return {
	frames,
	bodies: balls,
	passed,
	nearest,
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
	* Стоимость плана для оптимизатора:
	* сумма времени по отрезкам маршрута + штраф за недойденные точки + направляющий член
	* (расстояние до ближайшего подхода к следующей точке), чтобы был градиент.
	*/
export function planCost(res: SimResult, weights?: { guide?: number; miss?: number }) {
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
		sumLeg += 0;
	} else {
		sumLeg += Math.max(0, p - prev);
		prev = p;
	}
	}
	return sumLeg + guide * guideSum + missPen * miss + (miss > 0 ? 0 : 0);
}

/** Моменты проходов + сплиты между ними. */
export function splits(res: SimResult) {
	const out: { i: number; at: number; leg: number }[] = [];
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

export function timeAt(res: SimResult, i: number) {
	return res.frames.time[Math.min(i, res.frames.count - 1)];
}
