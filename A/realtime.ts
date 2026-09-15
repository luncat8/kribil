import { applyImpulse, stepBodies, type Body, type SimEvent, MAX_EVENTS } from "./physics";
import { Traj } from "./traj";
import { makeBodies } from "./simulate";
import { botDecide, type BotView } from "./bots";
import { PLAYERS } from "./levels";
import type { Checkpoint, PhysicsParams, TableSpec, Vec } from "./types";

export interface LiveConfig {
	table: TableSpec;
	params: PhysicsParams;
	checkpoints: Checkpoint[];
	object: Vec;
	cues: Vec[];
	maxPower: number;
	/** индекс игрока за человека (null → все четверо боты) */
	human: number | null;
	/** включить/выключить ИИ у игроков */
	botEnabled?: boolean[];
	/** скорость реалтайма */
	speed?: number;
}

const REC_FPS = 60;
const H = 1 / 240;

/** Мини-прогон варианта без записи кадров — используется «МАСТЕРОМ» в реалтайме. */
function rolloutCost(balls: Body[], view: BotView, player: number, angle: number, power: number, horizon = 2.4) {
	const copy: Body[] = balls.map((b) => ({ ...b }));
	const cue = copy.find((b) => b.kind === "cue" && b.owner === player);
	if (!cue) return 999;
	applyImpulse(cue, angle, power);
	const cp = view.checkpoints[Math.min(view.nextCp, view.checkpoints.length - 1)];
	const sub = 3;
	const h = (1 / 60) / sub;
	const steps = Math.round(horizon * 60);
	let t = 0;
	let best = Infinity;
	let passed = NaN;
	for (let i = 0; i < steps; i++) {
		for (let k = 0; k < sub; k++) {
			stepBodies(copy, h, view.params, view.table);
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

/** Живой движок: 240 Гц физика, три четверти команды — боты со своими стратегиями. */
export class LiveEngine {
	cfg: LiveConfig;
	balls: Body[] = [];
	traj: Traj;
	events: SimEvent[] = [];
	t = 0;
	acc = 0;
	lastRec = -1;
	nextCp = 0;
	passed: number[] = [];
	finishAt = Infinity;
	running = false;
	speed = 1;
	cooldown: number[] = [];
	shotCount: number[] = [];
	notes: string[] = [];
	aim = { angle: 0, power: 1.2 };
	view: BotView;

	constructor(cfg: LiveConfig) {
		this.cfg = cfg;
		this.balls = this.spawn(cfg);
		this.traj = new Traj(REC_FPS, this.balls.length, 512);
		this.view = {
			balls: this.balls,
			table: cfg.table,
			params: cfg.params,
			checkpoints: cfg.checkpoints,
			nextCp: 0,
			t: 0,
			maxPower: cfg.maxPower,
			rollout: (p, a, pw) => rolloutCost(this.balls, this.view, p, a, pw),
		};
		this.reset(cfg);
	}

	private spawn(cfg: LiveConfig): Body[] {
		return makeBodies({
			params: cfg.params,
			object: cfg.object,
			cues: cfg.cues,
			objectColor: "#fdf3d3",
			cueColors: PLAYERS.map((p) => p.color),
		});
	}

	reset(cfg: LiveConfig) {
		this.cfg = cfg;
		this.balls = this.spawn(cfg);
		this.balls.forEach((b, i) => (b.idx = i));
		this.view.balls = this.balls;
		this.traj.reset();
		this.events = [];
		this.t = 0;
		this.acc = 0;
		this.lastRec = -1;
		this.nextCp = 0;
		this.view.nextCp = 0;
		this.passed = new Array(cfg.checkpoints.length).fill(NaN);
		this.finishAt = Infinity;
		this.running = false;
		this.speed = cfg.speed ?? 1;
		this.cooldown = cfg.cues.map((_, i) => (cfg.human === i ? 0 : 0.7 + i * 0.4));
		this.shotCount = cfg.cues.map(() => 0);
		this.notes = cfg.cues.map(() => "готов");
		this.traj.push(0, this.balls);
	}

	get cueOf(): number {
		return this.cfg.human ?? 0;
	}

	get humanBall(): Body | undefined {
		return this.balls.find((b) => b.kind === "cue" && b.owner === this.cueOf);
	}

	aimAt(p: Vec) {
		const b = this.humanBall;
		if (!b) return;
		this.aim.angle = Math.atan2(p.y - b.y, p.x - b.x);
		const d = Math.hypot(p.x - b.x, p.y - b.y);
		this.aim.power = Math.max(0.1, Math.min(this.cfg.maxPower, 0.2 + d * 2.6));
	}

	shoot(player: number, angle: number, power: number, byBot = false) {
		const b = this.balls.find((x) => x.kind === "cue" && x.owner === player);
		if (!b) return false;
		if (this.t < this.cooldown[player]) return false;
		applyImpulse(b, angle, power);
		this.cooldown[player] = this.t + (byBot ? PLAYERS[player].cool : 0.28);
		this.shotCount[player]++;
		this.events.push({ t: this.t, type: "shot", a: b.idx, b: -1, imp: power, label: byBot ? `${PLAYERS[player].nick}` : "выстрел" });
		this.notes[player] = byBot ? "бьёт" : "ваш удар";
		return true;
	}

	update(dtWall: number) {
		if (!this.running) return;
		this.acc += Math.min(0.06, dtWall) * this.speed;
		while (this.acc >= H) {
			this.acc -= H;
			this.step(H);
			if (!this.running) break;
		}
	}

	private step(h: number) {
		const cfg = this.cfg;
		// боты принимают решения не каждый шаг
		if (this.t - (this.lastBot ?? -1) > 0.06) {
			this.lastBot = this.t;
			this.view.t = this.t;
			this.view.nextCp = this.nextCp;
			for (let p = 0; p < cfg.cues.length; p++) {
				if (!(cfg.botEnabled?.[p] ?? true)) continue;
				if (this.t < this.cooldown[p]) continue;
				if (this.nextCp >= cfg.checkpoints.length) break;
				const def = PLAYERS[p];
				const d = botDecide(def, this.view);
				if (!d) {
					this.cooldown[p] = this.t + 0.22;
					this.notes[p] = "ждёт";
					continue;
				}
				this.notes[p] = d.note;
				this.shoot(p, d.angle, d.power, true);
			}
		}

		stepBodies(this.balls, h, cfg.params, cfg.table, this.events, this.t);

		// контрольные точки
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
		if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
	}
	private lastBot = -1;

	get solved() {
		return this.nextCp >= this.cfg.checkpoints.length;
	}
}
