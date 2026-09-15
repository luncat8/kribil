import type { Checkpoint, TableSpec } from "./types";

export const TABLE: TableSpec = { w: 2.4, h: 1.2, rail: 0.11 };

export interface PlayerDef {
	id: number;
	nick: string;
	role: string;
	color: string;
	bot: "rusher" | "geometer" | "tactician" | "master";
	/** секунды между решениями */
	cool: number;
	/** разброс прицела, радиан */
	jitter: number;
}

export const PLAYERS: PlayerDef[] = [
	{ id: 0, nick: "КОМЕТА", role: "штурм · бьёт сразу", color: "#ffb703", bot: "rusher", cool: 0.55, jitter: 0.05 },
	{ id: 1, nick: "ЦИРКУЛЬ", role: "геометрия · от борта", color: "#48cae4", bot: "geometer", cool: 1.35, jitter: 0.02 },
	{ id: 2, nick: "ТИХОХОД", role: "тактик · ждёт покоя", color: "#ff6b8b", bot: "tactician", cool: 2.1, jitter: 0.012 },
	{ id: 3, nick: "МАСТЕР", role: "перебор вариантов", color: "#c77dff", bot: "master", cool: 1.7, jitter: 0 },
];

export const OBJECT_COLOR = "#fdf3d3";

export const DEFAULT_OBJECT = { x: 0.52, y: 0.66 };

/** Расстановка битков «до игры» (режим LOCKED). */
export const DEFAULT_CUES = [
	{ x: 0.32, y: 0.98 },
	{ x: 0.92, y: 1.02 },
	{ x: 1.62, y: 0.98 },
	{ x: 2.12, y: 0.72 },
];

/** Маршрут: 4 контрольные точки, последняя — финиш. */
export const DEFAULT_CHECKPOINTS: Checkpoint[] = [
	{ id: 0, x: 0.58, y: 0.3, r: 0.15 },
	{ id: 1, x: 1.18, y: 0.86, r: 0.15 },
	{ id: 2, x: 1.74, y: 0.28, r: 0.15 },
	{ id: 3, x: 2.06, y: 0.94, r: 0.15 },
];

export const CP_COLORS = ["#ffd166", "#8ecf6f", "#48cae4", "#ff5d73"];

export function presetRoute(kind: "zigzag" | "arc" | "rail" | "random"): Checkpoint[] {
	const base = DEFAULT_CHECKPOINTS.map((c) => ({ ...c }));
	if (kind === "arc") {
		return [
			{ id: 0, x: 0.42, y: 0.94, r: 0.14 },
			{ id: 1, x: 1.0, y: 0.4, r: 0.14 },
			{ id: 2, x: 1.6, y: 0.95, r: 0.14 },
			{ id: 3, x: 2.18, y: 0.36, r: 0.14 },
		];
	}
	if (kind === "rail") {
		return [
			{ id: 0, x: 0.3, y: 0.24, r: 0.13 },
			{ id: 1, x: 2.1, y: 0.24, r: 0.13 },
			{ id: 2, x: 2.1, y: 0.96, r: 0.13 },
			{ id: 3, x: 0.3, y: 0.96, r: 0.13 },
		];
	}
	if (kind === "random") {
		const rnd = mulberry32(Date.now() % 9973);
		return base.map((_c, i) => ({
			id: i,
			x: 0.25 + rnd() * (TABLE.w - 0.5),
			y: 0.22 + rnd() * (TABLE.h - 0.44),
			r: 0.12 + rnd() * 0.08,
		}));
	}
	return base;
}

export function mulberry32(a: number) {
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
