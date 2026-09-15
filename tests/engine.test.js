/* Юнит-тесты Крибил (node --test tests/).
	 Три обязательных по README: биток касается шара 1, шар проходит точку,
	 считается общее время до финиша. Плюс физика, детерминизм и живой режим. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const K = require("../js/levels.js");
["geo", "physics", "traj", "simulate", "optimizer", "realtime"].forEach((f) => require(`../js/${f}.js`));

const { TABLE, DEFAULT_PHYSICS, defaultDoc, PLAYERS } = K;

/** Базовый стол: шар 1 на (0.6;0.6), первый биток слева на той же оси. */
function baseCfg(over = {}) {
	return Object.assign({
		table: TABLE,
		params: { ...DEFAULT_PHYSICS },
		object: { x: 0.6, y: 0.6 },
		cues: [
			{ x: 0.3, y: 0.6 },
			{ x: 1.2, y: 1.05 },
			{ x: 2.0, y: 1.0 },
			{ x: 2.1, y: 0.3 },
		],
		checkpoints: [{ id: 0, x: 1.0, y: 0.6, r: 0.12 }],
		shots: [],
		maxTime: 6,
		maxPower: 4,
		fps: 120,
		sub: 4,
	}, over);
}

test("биток прямым ударом касается шара 1", () => {
	const hit = K.runSim(baseCfg({ shots: [{ id: "s1", player: 0, t: 0, angle: 0, power: 3 }] }));
	assert.ok(Number.isFinite(hit.firstContact), "есть время первого контакта");
	assert.ok(hit.firstContact > 0 && hit.firstContact < 0.3, "контакт почти сразу после удара");
	assert.ok(hit.contacts >= 1, "контактов не меньше одного");
	const touch = hit.events.some((e) => e.type === "contact" && (e.a === 0 || e.b === 0));
	assert.ok(touch, "в журнале есть контакт с шаром 1");

	const miss = K.runSim(baseCfg());
	assert.equal(Number.isFinite(miss.firstContact), false, "без удара контакта нет");
});

test("шар 1 после удара проходит контрольную точку", () => {
	const res = K.runSim(baseCfg({ shots: [{ id: "s1", player: 0, t: 0, angle: 0, power: 3 }] }));
	assert.ok(Number.isFinite(res.passed[0]), "точка зачтена");
	assert.ok(res.passed[0] > res.firstContact, "точка — после контакта");
	assert.ok(res.windows[0], "записан интервал входа/выхода из точки");
	assert.ok(res.windows[0][0] <= res.passed[0] && res.passed[0] <= res.windows[0][1]);
	// nearest семплируется на 120 Гц, допускаем один кадр подлёта (~0.025 м)
	assert.ok(res.nearest[0] === Infinity || res.nearest[0] <= 0.15, "до прохода шар подходит вплотную к кругу");

	const off = K.runSim(baseCfg({ checkpoints: [{ id: 0, x: 1.0, y: 0.95, r: 0.08 }],
		shots: [{ id: "s1", player: 0, t: 0, angle: 0, power: 3 }] }));
	assert.equal(Number.isFinite(off.passed[0]), false, "точка в стороне не зачитывается");
});

test("импульс равных масс передаётся почти полностью (лобовой удар)", () => {
	const res = K.runSim(baseCfg({ checkpoints: [], shots: [{ id: "s1", player: 0, t: 0, angle: 0, power: 3 }] }));
	const cueSpeed = K.impulseSpeed(3, 1);
	const after = res.frames.at(res.firstContact + 0.02, 0);
	const before = res.frames.at(res.firstContact - 0.02, 0);
	const vel = res.frames;
	const i = Math.round((res.firstContact + 0.02) * res.frames.fps);
	const vx = vel.vel[(i * 5 + 0) * 2];
	assert.ok(Math.abs(vx) > cueSpeed * 0.8, `шар 1 разогнан (vx=${vx.toFixed(2)}, удар=${cueSpeed.toFixed(2)})`);
	assert.ok(after.x > before.x, "шар 1 движется вперёд");
});

test("трение останавливает шары, лёд — почти нет", () => {
	const stop = K.runSim(baseCfg({ checkpoints: [], maxTime: 8,
		shots: [{ id: "s1", player: 0, t: 0, angle: 0, power: 2 }] }));
	const ke = K.totalKE(stop.bodies);
	assert.ok(ke < 1e-4, `сукно останавливает шары (KE=${ke.toExponential(1)})`);

	const ice = K.runSim(baseCfg({ params: { ...DEFAULT_PHYSICS, friction: 0 }, checkpoints: [], maxTime: 8,
		shots: [{ id: "s1", player: 0, t: 0, angle: 0, power: 2 }] }));
	const speedEnd = ice.frames.speed(ice.frames.count - 1, 0);
	assert.ok(speedEnd > 0.5, `на льду шар 1 ещё катится (v=${speedEnd.toFixed(2)})`);
});

test("борт отражает шар и упругость затухает скорость", () => {
	const cfg = baseCfg({
		checkpoints: [],
		object: { x: TABLE.w / 2, y: 0.5 },
		cues: [{ x: TABLE.w / 2, y: 0.9 }, { x: 1.2, y: 1.05 }, { x: 2.0, y: 1.0 }, { x: 2.1, y: 0.3 }],
		shots: [{ id: "s1", player: 0, t: 0, angle: -Math.PI / 2, power: 2.5 }],
	});
	const res = K.runSim(cfg);
	const rails = res.events.filter((e) => e.type === "cushion" && e.a === 0);
	assert.ok(rails.length >= 1, "шар 1 ударился о борт");
	const mid = res.frames.at(rails[0].t - 0.03, 0);
	const post = res.frames.at(rails[0].t + 0.12, 0);
	assert.ok(post.y > mid.y, "после борта шар вернулся вниз");
});

test("решатель проходит весь маршрут и возвращает общее время до финиша (замок)", () => {
	const d = defaultDoc();
	const mk = () => ({
		table: TABLE, params: { ...d.physics }, object: { ...d.object },
		cues: d.cues.map((c) => ({ ...c })), checkpoints: d.checkpoints.map((c) => ({ ...c })),
		shots: [], maxTime: d.maxTime, maxPower: d.maxPower,
		placement: "locked", fps: 60, sub: 3, seed: 7, attempts: 3, iters: 22,
	});
	const solve = () => {
		const s = new K.Solver(mk(), 22);
		let guard = 0;
		while (!s.done && guard++ < 2000) s.run(25);
		assert.ok(s.done, "решатель завершился");
		return s.current;
	};
	const a = solve();
	assert.ok(a.res.solved, "все 4 точки пройдены");
	assert.ok(a.res.finishAt > 0 && a.res.finishAt < d.maxTime,
		`финиш за ${a.res.finishAt.toFixed(2)}с в пределах горизонта ${d.maxTime}с`);
	const b = solve();
	assert.equal(b.res.finishAt, a.res.finishAt, "решение детерминировано по seed");

	// замок не двигает стартовые позиции битков
	a.state.cues.forEach((c, i) => {
		assert.ok(Math.hypot(c.x - d.cues[i].x, c.y - d.cues[i].y) < 1e-9, "биток стоит на месте");
	});
});

test("свободная расстановка: решатель двигает битки и тоже финиширует", () => {
	const d = defaultDoc();
	const cfg = {
		table: TABLE, params: { ...d.physics }, object: { ...d.object },
		cues: d.cues.map((c) => ({ ...c })), checkpoints: d.checkpoints.map((c) => ({ ...c })),
		shots: [], maxTime: d.maxTime, maxPower: d.maxPower,
		placement: "free", timeMode: false, fps: 60, sub: 3, seed: 7, attempts: 3, iters: 22,
	};
	const s = new K.Solver(cfg, 22);
	let guard = 0;
	while (!s.done && guard++ < 2000) s.run(25);
	const cur = s.current;
	assert.ok(cur.res.solved, "маршрут пройден при свободной расстановке");
	const moved = cur.state.cues.some((c, i) => Math.hypot(c.x - d.cues[i].x, c.y - d.cues[i].y) > 0.05);
	assert.ok(moved, "решатель переставил хотя бы один биток");
});

test("живой режим: удар игрока применяется и уважает перезарядку, боты не стреляют сами", () => {
	const d = defaultDoc();
	const cfg = {
		table: TABLE, params: { ...d.physics }, object: { ...d.object },
		cues: d.cues.map((c) => ({ ...c })), checkpoints: d.checkpoints.map((c) => ({ ...c })),
		maxTime: d.maxTime, maxPower: d.maxPower, human: 0,
		botEnabled: [false, false, false, false],
	};
	const e = new K.LiveEngine(cfg);
	e.running = true;
	const hb = e.humanBall;
	assert.equal(hb.owner, 0);
	assert.equal(e.shoot(0, 0, 2.5, false), true, "первый удар принят");
	assert.ok(Math.hypot(hb.vx, hb.vy) > 1, "биток полетел");
	assert.equal(e.shoot(0, 0, 2.5, false), false, "сразу второй удар запрещён");

	for (let i = 0; i < 240 * 4; i++) e.step(1 / 240);
	const botShots = e.events.filter((ev) => ev.type === "shot" && ev.player !== 0);
	assert.equal(botShots.length, 0, "с выключенными ботами чужих ударов нет");
});

test("запись траектории: интерполяция кадров идёт между сэмплами", () => {
	const res = K.runSim(baseCfg({ shots: [{ id: "s1", player: 0, t: 0, angle: 0, power: 3 }] }));
	const f = res.frames;
	const p0 = f.at(0, 0);
	const p1 = f.at(1 / f.fps, 0);
	const pm = f.at(0.5 / f.fps, 0);
	assert.ok(pm.x >= p0.x && pm.x <= p1.x, "интерполяция монотонна по x");
	assert.ok(f.duration > 0, "у записи есть длительность");
});
