import { castRay, contactPoint, norm } from "./geo";
import type { Body } from "./physics";
import type { Checkpoint, PhysicsParams, TableSpec } from "./types";
import type { PlayerDef } from "./levels";

export interface BotView {
	balls: Body[];
	table: TableSpec;
	params: PhysicsParams;
	checkpoints: Checkpoint[];
	nextCp: number;
	t: number;
	maxPower: number;
	/** мини-прогон варианта (для «МАСТЕРА») → меньше лучше */
	rollout?: (player: number, angle: number, power: number) => number;
}

export interface BotDecision {
	angle: number;
	power: number;
	note: string;
}

const need = (view: BotView, distance: number) => {
	const f = Math.max(0.04, view.params.friction);
	return Math.max(0.12, Math.min(view.maxPower, (f * distance * 1.5 + 0.14) * view.params.cueMass));
};

function objBall(view: BotView) {
	return view.balls[0];
}

function cueBall(view: BotView, p: number) {
	return view.balls.find((b) => b.kind === "cue" && b.owner === p)!;
}

/** Маршрут «от борта»: отражаем точку касания о ближайшую грань. */
function kickAngle(view: BotView, from: { x: number; y: number }, to: { x: number; y: number }) {
	const w = view.table.w;
	const h = view.table.h;
	const rails = [
		{ axis: "x" as const, at: 0 },
		{ axis: "x" as const, at: w },
		{ axis: "y" as const, at: 0 },
		{ axis: "y" as const, at: h },
	];
	let best: { angle: number; len: number } | null = null;
	for (const r of rails) {
		const mir = r.axis === "x" ? { x: 2 * r.at - to.x, y: to.y } : { x: to.x, y: 2 * r.at - to.y };
		const dx = mir.x - from.x;
		const dy = mir.y - from.y;
		const len = Math.hypot(dx, dy);
		if (len < 0.15) continue;
		const touch = r.axis === "x" ? { x: r.at, y: from.y + (dy ? (r.at - from.x) * (mir.y - from.y) / dx : 0) } : { x: from.x + (dx ? (r.at - from.y) * (mir.x - from.x) / dy : 0), y: r.at };
		const inRange = r.axis === "x" ? touch.y > 0.04 && touch.y < h - 0.04 : touch.x > 0.04 && touch.x < w - 0.04;
		if (!inRange) continue;
		if (!best || len < best.len) best = { angle: Math.atan2(dy, dx), len };
	}
	return best;
}

export function botDecide(def: PlayerDef, view: BotView): BotDecision | null {
	const obj = objBall(view);
	const cue = cueBall(view, def.id);
	if (!obj || !cue) return null;
	const cp = view.checkpoints[Math.min(view.nextCp, view.checkpoints.length - 1)];
	const sumR = view.params.ballRadius * 2;
	const toCp = norm({ x: cp.x - obj.x, y: cp.y - obj.y });
	const C = contactPoint({ x: obj.x, y: obj.y }, toCp, sumR);
	const jitter = (a: number) => a + (Math.random() - 0.5) * def.jitter;

	switch (def.bot) {
		case "rusher": {
			// просто бьёт по шару 1, максимально сильно — без геометрии
			const a = Math.atan2(obj.y - cue.y, obj.x - cue.x);
			return { angle: jitter(a), power: view.maxPower * 0.82, note: "в лоб, на всю" };
		}
		case "tactician": {
			// ждёт покоя шара 1, потом точно в точку касания
			if (Math.hypot(obj.vx, obj.vy) > 0.16) return null;
			const a = Math.atan2(C.y - cue.y, C.x - cue.x);
			const d = Math.hypot(C.x - cue.x, C.y - cue.y);
			return { angle: jitter(a), power: need(view, d), note: "резка, покоем" };
		}
		case "geometer": {
			const direct = Math.atan2(C.y - cue.y, C.x - cue.x);
			const hit = castRay({ x: cue.x, y: cue.y }, { x: Math.cos(direct), y: Math.sin(direct) }, view.balls, cue.idx, sumR, view.table);
			const clear = hit.hit === 0;
			if (clear) {
				const d = Math.hypot(C.x - cue.x, C.y - cue.y);
				return { angle: jitter(direct), power: need(view, d), note: "прямая видимость" };
			}
			const k = kickAngle(view, { x: cue.x, y: cue.y }, C);
			if (!k) return { angle: jitter(direct), power: need(view, 0.8), note: "нет маршрута, пробую прямо" };
			return { angle: jitter(k.angle), power: need(view, k.len * 1.15), note: "от борта" };
		}
		case "master": {
			// локальный перебор вариантов вокруг геометрического решения
			const base = Math.atan2(C.y - cue.y, C.x - cue.x);
			const d = Math.hypot(C.x - cue.x, C.y - cue.y);
			const p0 = need(view, d);
			let best: BotDecision | null = null;
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
}
