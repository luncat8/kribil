/* Константы стола/физики, игроки, раскладка по умолчанию, пресеты маршрутов. */
"use strict";
(function (global, factory) {
	const K = global.Kribil ?? (global.Kribil = {});
	factory(K);
	if (typeof module !== "undefined" && module.exports) module.exports = K;
})(typeof globalThis !== "undefined" ? globalThis : this, function (K) {
	if (typeof require === "function") require("./core.js");

	const TABLE = { w: 2.4, h: 1.2, rail: 0.11 };

	const DEFAULT_PHYSICS = {
		friction: 0.55,
		restitution: 1,
		cushion: 0.92,
		stopEps: 0.02,
		ballRadius: 0.03,
		objectMass: 1,
		cueMass: 1,
	};

	const PLAYERS = [
		{ id: 0, nick: "КОМЕТА", role: "штурм · бьёт сразу", color: "#ffb703", bot: "rusher", cool: 0.55, jitter: 0.05 },
		{ id: 1, nick: "ЦИРКУЛЬ", role: "геометрия · от борта", color: "#48cae4", bot: "geometer", cool: 1.35, jitter: 0.02 },
		{ id: 2, nick: "ТИХОХОД", role: "тактик · ждёт покоя", color: "#ff6b8b", bot: "tactician", cool: 2.1, jitter: 0.012 },
		{ id: 3, nick: "МАСТЕР", role: "перебор вариантов", color: "#c77dff", bot: "master", cool: 1.7, jitter: 0 },
	];

	const OBJECT_COLOR = "#fdf3d3";
	const CP_COLORS = ["#ffd166", "#8ecf6f", "#48cae4", "#ff5d73"];

	const DEFAULT_OBJECT = { x: 0.52, y: 0.66 };

	/** LOCKED-расстановка битков «до игры». */
	const DEFAULT_CUES = [
		{ x: 0.32, y: 0.98 },
		{ x: 0.92, y: 1.02 },
		{ x: 1.62, y: 0.98 },
		{ x: 2.12, y: 0.72 },
	];

	const DEFAULT_CHECKPOINTS = [
		{ id: 0, x: 0.58, y: 0.3, r: 0.15 },
		{ id: 1, x: 1.18, y: 0.86, r: 0.15 },
		{ id: 2, x: 1.74, y: 0.28, r: 0.15 },
		{ id: 3, x: 2.06, y: 0.94, r: 0.15 },
	];

	function mulberry32(a) {
		return function () {
			a |= 0;
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function presetRoute(kind) {
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
			const rnd = mulberry32((Date.now() % 9973) | 1);
			return DEFAULT_CHECKPOINTS.map((_c, i) => ({
				id: i,
				x: 0.25 + rnd() * (TABLE.w - 0.5),
				y: 0.22 + rnd() * (TABLE.h - 0.44),
				r: 0.12 + rnd() * 0.08,
			}));
		}
		return DEFAULT_CHECKPOINTS.map((c) => ({ ...c }));
	}

	/** Стартовый документ планировщика. */
	function defaultDoc() {
		return {
			object: { ...DEFAULT_OBJECT },
			cues: DEFAULT_CUES.map((c) => ({ ...c })),
			checkpoints: DEFAULT_CHECKPOINTS.map((c) => ({ ...c })),
			shots: [],
			physics: { ...DEFAULT_PHYSICS },
			maxTime: 12,
			maxPower: 4,
		};
	}

	Object.assign(K, {
		TABLE,
		DEFAULT_PHYSICS,
		PLAYERS,
		OBJECT_COLOR,
		CP_COLORS,
		DEFAULT_OBJECT,
		DEFAULT_CUES,
		DEFAULT_CHECKPOINTS,
		mulberry32,
		presetRoute,
		defaultDoc,
	});
});
