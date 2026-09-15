/* Крибил — UI: планировщик, таймлайн, ручные удары, решатель, живой режим.
	 Classic script, работает по file://; точка входа — DOMContentLoaded. */
"use strict";
(function () {
	const K = window.Kribil;
	const $ = (id) => document.getElementById(id);
	const TAU = Math.PI * 2;
	const NBALLS = 5;

	// относительный «толчковый» слайдер: +10% хода ≈ +0.01·scale, +100% ≈ +2·scale
	const NUDGE_B = 4.8;
	const NUDGE_C = 0.0168;

	const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
	const fmtT = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}с` : "—");

	function h(tag, attrs, kids) {
		const e = document.createElement(tag);
		if (attrs) {
			for (const k in attrs) {
				if (k === "class") e.className = attrs[k];
				else if (k === "text") e.textContent = attrs[k];
				else if (k === "html") e.innerHTML = attrs[k];
				else if (k === "on") {
					for (const ev in attrs.on) e.addEventListener(ev, attrs.on[ev]);
				} else if (k === "dataset") Object.assign(e.dataset, attrs[k]);
				else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
			}
		}
		if (kids != null) {
			if (!Array.isArray(kids)) kids = [kids];
			for (const k of kids) e.append(k?.nodeType ? k : document.createTextNode(k));
		}
		return e;
	}

	const app = {
		doc: K.defaultDoc(),
		mode: "planner", // planner | live
		placement: "locked", // locked | free
		cursor: "drag", // drag | aim
		tab: "setup",
		t: 0,
		playing: false,
		speed: 1,
		res: null,
		dirty: true,
		solver: null,
		solving: false,
		useSeed: false,
		timeMode: false,
		live: null,
		human: 0,
		bots: [false, true, true, true],
		sel: null, // {kind:'shot'|'cp'|'object'|'cue', ...}
		drag: null,
		charge: null,
		undo: null,
		shotSeq: 1,
		lastHud: 0,
	};
	const ui = { shotOuts: new Map() };
	let view = null;
	let trailCache = null;

	// ── конфигурация для движка ──────────────────────────────────────────────
	function simCfg(extra) {
		const d = app.doc;
		return Object.assign({
			table: K.TABLE,
			params: d.physics,
			object: d.object,
			cues: d.cues,
			checkpoints: d.checkpoints,
			shots: d.shots,
			maxTime: d.maxTime,
			maxPower: d.maxPower,
			placement: app.placement,
			timeMode: false,
			fps: 60,
			sub: 4,
		}, extra);
	}

	function recompute() {
		try {
			app.res = K.runSim(simCfg());
		} catch (err) {
			console.error(err);
		}
		app.t = clamp(app.t, 0, app.res.duration);
		trailCache = null;
		refreshMarks();
	}

	function activeRes() {
		if (app.mode === "live") return null;
		if (app.solving && app.solver?.current) return app.solver.current.res;
		return app.res;
	}

	// ── мелкие UI ────────────────────────────────────────────────────────────
	function toast(msg, kind) {
		const box = $("toast");
		const t = h("div", { class: `t ${kind || ""}`, text: msg });
		box.append(t);
		setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .4s"; setTimeout(() => t.remove(), 450); }, 3200);
	}

	/** Абсолютный слайдер. */
	function slider(label, min, max, step, get, set, fmtv, color) {
		const out = h("output", { text: fmtv(get()) });
		const inp = h("input", {
			type: "range", min, max, step, value: get(),
			style: color ? `--knob:${color}` : "",
			on: { input: () => { set(parseFloat(inp.value)); out.textContent = fmtv(get()); edit(); } },
		});
		return h("label", { class: "sl" }, [h("div", { class: "lab" }, [h("span", { text: label }), out]), inp]);
	}

	/**
	 * Относительный лог-слайдер точной настройки: всегда возвращается в 0,
	 * величина изменения зависит от расстояния хода (мелко у центра).
	 */
	function nudge(label, scale, get, set, fmtv, lo, hi) {
		const out = h("output", { text: fmtv(get()), title: "двойной клик — ввести точное значение" });
		const inp = h("input", { class: "nudge", type: "range", min: -1, max: 1, step: 0.001, value: 0 });
		const apply = () => {
			const f = parseFloat(inp.value);
			if (f === 0) return;
			const delta = Math.sign(f) * scale * NUDGE_C * (Math.exp(NUDGE_B * Math.abs(f)) - 1);
			let v = get() + delta;
			if (lo !== undefined) v = clamp(v, lo, hi);
			set(v);
			out.textContent = fmtv(get());
			edit();
		};
		inp.addEventListener("input", apply);
		const snap = () => { inp.value = 0; };
		inp.addEventListener("pointerup", snap);
		inp.addEventListener("pointercancel", snap);
		out.addEventListener("dblclick", () => {
			const raw = prompt(`${label}:`, fmtv(get()));
			if (raw == null) return;
			const v = parseFloat(raw.replace(",", "."));
			if (Number.isFinite(v)) {
				set(hi !== undefined ? clamp(v, lo, hi) : v);
				out.textContent = fmtv(get());
				edit();
			}
		});
		const wrap = h("label", { class: "sl" }, [h("div", { class: "lab" }, [h("span", { text: label }), out]), inp]);
		wrap._out = out;
		return wrap;
	}

	function tag(text, on, toggle) {
		return h("button", { class: `tagbtn ${on ? "on" : ""}`, on: { click: toggle }, text });
	}

	// ── панель «Расстановка» ─────────────────────────────────────────────────
	function buildSetup() {
		const d = app.doc;
		const p = d.physics;
		const root = $("tab-setup");
		root.replaceChildren();

		const route = h("div", { class: "panel" }, [
			h("h3", { text: "Маршрут" }),
			h("div", { class: "row wrap", style: "gap:6px" }, [
				["zigzag", "зигзаг"], ["arc", "дуга"], ["rail", "борта"], ["random", "случайно"],
			].map(([kind, name]) => h("button", {
				class: "chip", on: {
					click: () => {
						d.checkpoints = K.presetRoute(kind);
						d.shots = [];
						app.sel = null;
						app.undo = null;
						edit();
						buildCrew();
						toast(`маршрут «${name}» задан`);
					},
				}, text: name,
			}))),
			h("div", { class: "rule" }),
			h("div", { class: "row" }, [
				h("button", { class: "btn tiny", text: "сбросить удары", on: { click: () => { d.shots = []; app.sel = null; app.undo = null; edit(); buildCrew(); } } }),
				h("button", { class: "btn tiny", text: "📋 копия", on: { click: openCopy } }),
				h("button", { class: "btn tiny", text: "📥 вставить", on: { click: openPaste } }),
			]),
		]);

		const phys = h("div", { class: "panel" }, [h("h3", { text: "Стол и физика" })]);
		const grid = h("div", { class: "grid2" });
		grid.append(
			slider("трение", 0, 1.2, 0.01, () => p.friction, (v) => (p.friction = v), (v) => v.toFixed(2), "#ffb703"),
			slider("упругость шаров", 0.5, 1.05, 0.01, () => p.restitution, (v) => (p.restitution = v), (v) => v.toFixed(2), "#48cae4"),
			slider("упругость бортов", 0.5, 1, 0.01, () => p.cushion, (v) => (p.cushion = v), (v) => v.toFixed(2), "#48cae4"),
			slider("радиус шаров", 0.018, 0.05, 0.001, () => p.ballRadius, (v) => (p.ballRadius = v), (v) => `${(v * 100).toFixed(1)}см`, "#fdf3d3"),
			slider("масса шара 1", 0.5, 3, 0.05, () => p.objectMass, (v) => (p.objectMass = v), (v) => v.toFixed(2), "#fdf3d3"),
			slider("масса битков", 0.5, 3, 0.05, () => p.cueMass, (v) => (p.cueMass = v), (v) => v.toFixed(2), "#c77dff"),
			slider("горизонт, с", 2, 24, 0.5, () => d.maxTime, (v) => (d.maxTime = v), (v) => v.toFixed(1), "#ff6b8b"),
			slider("макс. сила", 1, 8, 0.1, () => d.maxPower, (v) => (d.maxPower = v), (v) => v.toFixed(1), "#f4623a"),
		);
		phys.append(grid);
		phys.append(h("div", { class: "rule" }));
		const iceBtn = tag("лёд (трение 0)", p.friction === 0, () => {
			p.friction = p.friction === 0 ? K.DEFAULT_PHYSICS.friction : 0;
			buildSetup(); edit();
		});
		phys.append(h("div", { class: "row" }, [
			iceBtn,
			h("button", { class: "btn tiny", text: "сброс физики", on: { click: () => { Object.assign(p, K.DEFAULT_PHYSICS); buildSetup(); edit(); } } }),
		]));

		const hints = h("div", { class: "panel" }, [
			h("h3", { text: "Как работать" }),
			h("div", {
				class: "muted", html:
					"Тащите шар 1, битки (в свободной расстановке) и точки режимом «тащить». "
					+ "Режим «целиться» правит стрелки ударов: голова стрелки — угол и сила, колесо мыши — время. "
					+ "Удары добавляются в панели «Команда», точная доводка — толчковыми слайдерами (двойной клик по значению — ввод числа).",
			}),
		]);

		root.append(route, phys, hints);
	}

	// ── панель «Команда» ─────────────────────────────────────────────────────
	function shotOrigin(s) {
		const res = activeRes();
		if (!res) return { x: app.doc.cues[s.player].x, y: app.doc.cues[s.player].y };
		return res.frames.at(s.t, s.player + 1);
	}

	function buildCrew() {
		const root = $("tab-crew");
		root.replaceChildren();
		ui.shotOuts.clear();
		const d = app.doc;

		if (app.mode === "live") {
			const rolePanel = h("div", { class: "panel" }, [
				h("h3", { text: "Ваша позиция" }),
				h("div", { class: "row wrap", style: "gap:6px" }, K.PLAYERS.map((pl) => h("button", {
					class: `chip ${app.human === pl.id ? "on" : ""}`,
					on: {
						click: () => {
							app.human = pl.id;
							app.bots = K.PLAYERS.map((x) => x.id !== pl.id);
							enterLive(true);
							buildCrew();
						},
					},
					text: `${pl.id + 1} · ${pl.nick}`,
				}))),
			]);

			const cards = h("div", { class: "panel" }, [h("h3", { text: "Команда" })]);
			K.PLAYERS.forEach((pl) => {
				const isHuman = app.human === pl.id;
				const botBtn = tag(isHuman ? "это вы" : (app.bots[pl.id] ? "бот вкл" : "бот выкл"), !isHuman && app.bots[pl.id], () => {
					app.bots[pl.id] = !app.bots[pl.id];
					if (app.live) app.live.cfg.botEnabled = app.bots.slice();
					buildCrew();
				});
				if (isHuman) botBtn.disabled = true;
				const note = h("div", { class: "role", id: `note-${pl.id}`, text: "…" });
				const card = h("div", { class: "player" }, [
					h("div", { class: "head" }, [
						h("div", { class: "dotc", style: `background:${pl.color}` }),
						h("div", { style: "flex:1;min-width:0" }, [
							h("div", { class: "nick", text: `${pl.id + 1} · ${pl.nick}` }),
							note,
						]),
						botBtn,
					]),
				]);
				cards.append(card);
			});

			const ctrl = h("div", { class: "panel" }, [
				h("h3", { text: "Партия" }),
				h("div", { class: "row" }, [
					h("button", {
						class: "btn solid", id: "liveStart", text: "старт",
						on: { click: togglePlay },
					}),
					h("button", { class: "btn", text: "заново", on: { click: () => { enterLive(true); setBanner("", ""); } } }),
				]),
				h("div", { class: "rule" }),
				h("div", {
					class: "muted", html:
						"Ведите мышь — прицел (призрак показывает точку касания). Зажмите кнопку — набирается сила, "
						+ "отпустите — удар. Пробел — старт/пауза. Остальные трое играют сами по своим стратегиям.",
				}),
			]);
			root.append(rolePanel, cards, ctrl);
			return;
		}

		const panel = h("div", { class: "panel" }, [h("h3", { text: "Удары по времени" })]);
		K.PLAYERS.forEach((pl) => {
			const mine = d.shots.filter((s) => s.player === pl.id).sort((a, b) => a.t - b.t);
			const addBtn = h("button", {
				class: "mini", title: "добавить удар", html: "&#65291;",
				on: {
					click: () => {
						const res = app.res;
						const t = clamp(app.t, 0, d.maxTime - 0.1);
						const from = res.frames.at(t, pl.id + 1);
						const ang = Math.atan2(d.object.y - from.y, d.object.x - from.x);
						const s = { id: `m${app.shotSeq++}`, player: pl.id, t, angle: ang, power: 1.2 };
						d.shots.push(s);
						app.sel = { kind: "shot", shot: s };
						edit();
						buildCrew();
					},
				},
			});
			const card = h("div", { class: "player" }, [
				h("div", { class: "head" }, [
					h("div", { class: "dotc", style: `background:${pl.color}` }),
					h("div", { style: "flex:1" }, [h("div", { class: "nick", text: pl.nick }), h("div", { class: "role", text: pl.role })]),
					addBtn,
				]),
			]);
			mine.forEach((s) => {
				const sel = () => app.sel?.kind === "shot" && app.sel.shot === s;
				const row = h("div", { class: `shot ${sel() ? "sel" : ""}`, on: { click: (e) => { if (e.target.tagName !== "INPUT") { app.sel = { kind: "shot", shot: s }; buildCrew(); } } } });
				const st = h("div", { class: "st" }, [h("span", { text: `удар #${mine.indexOf(s) + 1}` }), h("span", {})]);
				const tN = nudge("t, с", 2.5, () => s.t, (v) => (s.t = v), (v) => v.toFixed(2), 0, d.maxTime);
				const aN = nudge("∠ град", 90, () => (s.angle * 180) / Math.PI, (v) => (s.angle = (v * Math.PI) / 180), (v) => `${Math.round(((v % 360) + 360) % 360)}°`);
				const pN = nudge("сила", 1, () => s.power, (v) => (s.power = v), (v) => v.toFixed(2), 0.05, d.maxPower);
				const del = h("button", {
					class: "mini", title: "удалить", html: "&#10005;",
					on: { click: (e) => { e.stopPropagation(); d.shots.splice(d.shots.indexOf(s), 1); if (sel()) app.sel = null; edit(); buildCrew(); } },
				});
				st.lastChild.append(del);
				row.append(st, tN, aN, pN);
				card.append(row);
				ui.shotOuts.set(s, { t: tN._out, a: aN._out, p: pN._out, row, refresh: () => {
					row.classList.toggle("sel", sel());
					tN._out.textContent = s.t.toFixed(2);
					aN._out.textContent = `${Math.round(((s.angle * 180 / Math.PI % 360) + 360) % 360)}°`;
					pN._out.textContent = s.power.toFixed(2);
				} });
			});
			if (!mine.length) card.append(h("div", { class: "muted", style: "margin-top:6px", text: "ударов нет" }));
			panel.append(card);
		});
		panel.append(h("div", { class: "rule" }));
		panel.append(h("div", {
			class: "muted", html:
				"Слайдеры относительные: чем дальше от центра, тем крупнее шаг; отпускаются в ноль. "
				+ "На таймлайне удары отмечены чёрточками цвета игрока.",
		}));
		root.append(panel);
	}

	// ── панель «Решатель» ────────────────────────────────────────────────────
	function buildSolve() {
		const root = $("tab-solve");
		root.replaceChildren();

		const runBtn = h("button", {
			class: "btn solid", text: "▶ решить",
			on: { click: startSolver,
			},
		});
		const stopBtn = h("button", { class: "btn danger", text: "стоп", disabled: true, on: { click: stopSolver } });
		const undoBtn = h("button", {
			class: "btn", text: "↩ вернуть мои удары", style: app.undo ? "" : "display:none",
			on: { click: () => { if (!app.undo) return; app.doc.shots = app.undo.shots; app.doc.cues = app.undo.cues; app.undo = null; app.sel = null; edit(); buildSolve(); buildCrew(); toast("возвращён ручной план", "ok"); } },
		});

		const seedTag = tag("сид из моих ударов", app.useSeed, () => { app.useSeed = !app.useSeed; seedTag.classList.toggle("on", app.useSeed); });
		const timeTag = tag("время — параметр", app.timeMode, () => { app.timeMode = !app.timeMode; timeTag.classList.toggle("on", app.timeMode); });

		const bar = h("div", { class: "progress" }, [h("div", { style: "width:0%" })]);
		const phase = h("div", { class: "muted", style: "margin-top:5px", text: "ожидание" });

		const ctrl = h("div", { class: "panel" }, [
			h("h3", { text: "Авторешатель" }),
			h("div", { class: "row" }, [runBtn, stopBtn]),
			h("div", { class: "rule" }),
			h("div", { class: "row wrap", style: "gap:6px" }, [seedTag, timeTag]),
			h("div", { class: "muted", style: "margin:6px 0" },
				`расстановка: ${app.placement === "locked" ? "замок (битки не двигаются)" : "свободная (битки ставит решатель)"}`),
			h("div", { class: "rule" }),
			bar, phase,
			undoBtn,
		]);

		const stats = h("div", { class: "grid2", style: "margin-top:10px" });
		const statEls = {};
		const stat = (k, id) => {
			const v = h("div", { class: "v", id: `st-${id}`, text: "—" });
			statEls[id] = v;
			return h("div", { class: "stat" }, [h("div", { class: "k", text: k }), v]);
		};
		stats.append(stat("стоимость", "cost"), stat("финиш", "finish"), stat("контактов", "contacts"), stat("не пройдено", "miss"));

		const checks = h("div", { id: "st-checks", style: "margin-top:10px;display:flex;flex-direction:column;gap:3px" });
		const log = h("div", { class: "log", id: "st-log", style: "margin-top:10px" });

		root.append(
			ctrl,
			h("div", { class: "panel" }, [h("h3", { text: "Диагностика плана" }), stats, h("div", { class: "rule" }), checks, h("div", { class: "rule" }), h("h3", { text: "Журнал" }), log]),
		);
		ui.solve = { runBtn, stopBtn, bar, barFill: bar.firstChild, phase, statEls, checks, log };
		refreshSolve();
	}

	function refreshSolve() {
		if (!ui.solve) return;
		const s = ui.solve;
		const cur = app.solver?.current;
		const res = cur ? cur.res : app.res;
		if (!res) return;
		const missN = res.passed.filter((x) => Number.isNaN(x)).length;
		s.statEls.cost.textContent = cur ? cur.cost.toFixed(2) : K.planCost(res).toFixed(2);
		s.statEls.finish.textContent = fmtT(res.finishAt);
		s.statEls.contacts.textContent = String(res.contacts);
		s.statEls.miss.textContent = String(missN);
		s.statEls.miss.style.color = missN ? "#ff9b9b" : "";

		const rows = [];
		rows.push({
			ok: Number.isFinite(res.firstContact),
			label: "биток касается шара 1",
			note: Number.isFinite(res.firstContact) ? `t=${res.firstContact.toFixed(2)}` : "нет контакта",
		});
		res.passed.forEach((p, k) => rows.push({
			ok: !Number.isNaN(p),
			label: `К-${k + 1} пройдена`,
			note: !Number.isNaN(p) ? `t=${p.toFixed(2)}` : `ближайшая ${res.nearest[k] === Infinity ? "—" : res.nearest[k].toFixed(2)} м`,
		}));
		rows.push({ ok: res.solved, label: "финиш", note: fmtT(res.finishAt) });
		s.checks.replaceChildren(...rows.map((r) => h("div", { class: "check" }, [
			h("div", { class: `ic ${r.ok ? "yes" : "no"}`, text: r.ok ? "✓" : "✗" }),
			h("div", {}, [r.label, h("span", { class: "note", text: r.note })]),
		])));

		const wanted = new Set(["shot", "checkpoint", "finish", "rest"]);
		const evs = res.events.filter((e) => wanted.has(e.type) || (e.type === "cushion" && e.a === 0) || (e.type === "contact" && (e.a === 0 || e.b === 0)));
		s.log.replaceChildren(...evs.slice(-40).map((e) => h("div", { class: "e" }, [
			h("span", { class: "tt", text: e.t.toFixed(2) }),
			h("span", {
				text: e.type === "shot" ? `${K.PLAYERS[e.player]?.nick ?? "P"} · сила ${e.imp?.toFixed(1) ?? ""}`
					: e.type === "checkpoint" ? `прошёл К-${e.b + 1}`
						: e.type === "finish" ? "ФИНИШ"
							: e.type === "rest" ? "все шары встали"
								: e.type === "cushion" ? "шар 1 · борт"
									: "контакт с шаром 1",
			}),
			h("span", { class: "j", text: e.type }),
		])));
		s.log.scrollTop = s.log.scrollHeight;

		if (app.solving) {
			const pr = app.solver.progress;
			s.runBtn.disabled = true;
			s.stopBtn.disabled = false;
			s.bar.classList.add("run");
			s.phase.textContent = `${pr.phase} · ${pr.note} · оценок ${pr.evals}`;
			const frac = clamp((pr.iter + 1) / 30, 0.04, 0.97);
			s.barFill.style.width = `${frac * 100}%`;
		} else {
			s.runBtn.disabled = false;
			s.stopBtn.disabled = true;
			s.bar.classList.remove("run");
			s.barFill.style.width = cur?.res.solved ? "100%" : "0%";
		}
	}

	// ── решатель ─────────────────────────────────────────────────────────────
	function startSolver() {
		if (app.solving) return;
		if (app.mode === "live") switchMode("planner");
		const seed = ((Date.now() ^ (Math.random() * 1e9)) >>> 0) || 7;
		const cfg = simCfg({
			timeMode: app.timeMode,
			fps: 60,
			sub: 3,
			seed,
			attempts: 3,
			iters: 26,
			seedPlan: app.useSeed ? app.doc.shots.map((s) => ({ ...s })) : undefined,
		});
		app.solver = new K.Solver(cfg, cfg.iters);
		app.solving = true;
		app.playing = false;
		toast("решатель считает…");
		const pump = () => {
			if (!app.solving) return;
			app.solver.run(20);
			const cur = app.solver.current;
			if (cur) {
				app.t = clamp(app.t, 0, cur.res.duration);
				trailCache = null;
				refreshMarks();
			}
			if (app.solver.done) return finishSolver();
			requestAnimationFrame(pump);
		};
		requestAnimationFrame(pump);
	}

	function stopSolver() {
		app.solving = false;
		app.solver = null;
		trailCache = null;
		app.dirty = true;
		refreshSolve();
		toast("остановлено");
	}

	function finishSolver() {
		const sol = app.solver.current;
		app.solving = false;
		if (sol?.res.solved) {
			app.undo = { shots: app.doc.shots.map((s) => ({ ...s })), cues: app.doc.cues.map((c) => ({ ...c })) };
			app.doc.shots = sol.state.shots.map((s) => ({ ...s }));
			if (app.placement === "free") app.doc.cues = sol.state.cues.map((c) => ({ ...c }));
			app.sel = null;
			app.dirty = true;
			app.t = Math.min(app.t, sol.res.finishAt + 1);
			updateBest(sol.res.finishAt);
			toast(`решено за ${sol.res.finishAt.toFixed(2)}с — план в столе`, "ok");
			setBanner(`РЕШЕНО ЗА ${sol.res.finishAt.toFixed(2)}с`, "ok");
			buildCrew();
			buildSolve();
			app.solver = null;
			app.dirty = true;
		} else {
			toast("не сошлось: добавьте попытки или поправьте расстановку", "bad");
			setBanner("НЕ СОШЛОСЬ", "bad");
			app.solver = null;
			app.dirty = true;
			buildSolve();
		}
		trailCache = null;
	}

	// ── копирование / вставка ────────────────────────────────────────────────
	function ioModal(title, value, actions) {
		$("ioTitle").textContent = title;
		const ta = $("ioText");
		ta.value = value;
		const bar = $("ioActions");
		bar.replaceChildren(...actions, h("button", { class: "btn tiny", text: "закрыть", on: { click: () => $("ioModal").close() } }));
		$("ioModal").showModal();
		return ta;
	}

	function openCopy() {
		const data = JSON.stringify({ v: 1, placement: app.placement, doc: app.doc }, null, 1);
		const ta = ioModal("Копия установки (JSON)", data, [
			h("button", {
				class: "btn tiny solid", text: "в буфер", on: {
					click: async () => {
						try { await navigator.clipboard.writeText(ta.value); toast("скопировано", "ok"); }
						catch { ta.select(); document.execCommand("copy"); toast("скопировано (выделено)", "ok"); }
					},
				},
			}),
		]);
		ta.readOnly = true;
		ta.select();
	}

	function openPaste() {
		const ta = ioModal("Вставить установку (JSON)", "", [
			h("button", {
				class: "btn tiny solid", text: "из буфера", on: {
					click: async () => { try { ta.value = await navigator.clipboard.readText(); } catch { toast("браузер не дал буфер — вставьте в поле вручную", "bad"); } },
				},
			}),
			h("button", {
				class: "btn tiny", text: "применить", on: {
					click: () => {
						try {
							const parsed = JSON.parse(ta.value);
							const incoming = parsed.doc ? parsed.doc : parsed;
							if (!Array.isArray(incoming.checkpoints) || !Array.isArray(incoming.cues) || !incoming.physics)
								throw new Error("не та структура");
							app.doc = {
								object: { ...incoming.object },
								cues: incoming.cues.map((c) => ({ ...c })),
								checkpoints: incoming.checkpoints.map((c, i) => ({ id: i, ...c })),
								shots: (incoming.shots || []).map((s, i) => ({ id: `m${app.shotSeq++}`, ...s })),
								physics: { ...K.DEFAULT_PHYSICS, ...incoming.physics },
								maxTime: incoming.maxTime ?? 12,
								maxPower: incoming.maxPower ?? 4,
							};
							if (parsed.placement === "free" || parsed.placement === "locked") {
								app.placement = parsed.placement;
								syncSeg("placeSeg", "placement", app.placement);
							}
							app.sel = null;
							app.undo = null;
							$("ioModal").close();
							edit();
							buildSetup();
							buildCrew();
							toast("установка принята", "ok");
						} catch (err) {
							toast(`не разобрать JSON: ${err.message}`, "bad");
						}
					},
				},
			}),
		]);
		ta.readOnly = false;
	}

	// ── рекорды ──────────────────────────────────────────────────────────────
	const BEST_KEY = "kribil-best-v1";
	function bestStore() {
		try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; }
		catch { return {}; }
	}
	function routeKey() {
		return app.doc.checkpoints.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join("|");
	}
	function updateBest(t) {
		if (!Number.isFinite(t)) return;
		const store = bestStore();
		const k = routeKey();
		if (store[k] != null && store[k] <= t) return;
		store[k] = +t.toFixed(3);
		try { localStorage.setItem(BEST_KEY, JSON.stringify(store)); } catch { /* file:// без хранилища */ }
		refreshBest();
	}
	function refreshBest() {
		const v = bestStore()[routeKey()];
		$("bestBox").textContent = v != null ? `${v.toFixed(2)}с` : "—";
	}

	function edit() {
		app.dirty = true;
		app.playing = false;
		refreshBest();
		refreshSolveThrottled.dirty = true;
	}

	// ── живой режим ──────────────────────────────────────────────────────────
	function liveCfg() {
		return {
			table: K.TABLE,
			params: app.doc.physics,
			object: app.doc.object,
			cues: app.doc.cues,
			checkpoints: app.doc.checkpoints,
			maxTime: app.doc.maxTime,
			maxPower: app.doc.maxPower,
			human: app.human,
			botEnabled: app.bots.slice(),
			speed: app.speed,
		};
	}

	function enterLive(reset) {
		if (app.solving) stopSolver();
		if (!app.live || reset) app.live = new K.LiveEngine(liveCfg());
		app.t = 0;
		app.playing = false;
		app._announced = false;
		trailCache = null;
	}

	function pointerWorld(ev) {
		const r = $("table").getBoundingClientRect();
		return K.unproject(view, ev.clientX - r.left, ev.clientY - r.top);
	}

	function liveDown(ev) {
		const eng = app.live;
		if (!eng || !eng.running) return;
		const w = pointerWorld(ev);
		eng.aimAt(w);
		app.charge = { t0: performance.now(), x: w.x, y: w.y };
	}

	function liveMove(ev) {
		const eng = app.live;
		if (!eng) return;
		const w = pointerWorld(ev);
		eng.aimAt(w);
		if (app.charge) { app.charge.x = w.x; app.charge.y = w.y; }
	}

	function liveUp() {
		const eng = app.live;
		if (!eng || !app.charge) return;
		const held = (performance.now() - app.charge.t0) / 1000;
		const power = clamp(app.doc.maxPower * Math.min(1, held / 0.85), 0.12, app.doc.maxPower);
		const ok = eng.shoot(eng.cueOf, eng.aim.angle, power, false);
		if (!ok) toast("рано: биток ещё не готов", "bad");
		app.charge = null;
	}

	// ── правка на холсте (планировщик) ───────────────────────────────────────
	function shotGeom(s) {
		const o = shotOrigin(s);
		const len = 0.1 + 0.62 * Math.min(1, s.power / app.doc.maxPower);
		return { o, hx: o.x + Math.cos(s.angle) * len, hy: o.y + Math.sin(s.angle) * len };
	}

	function hitTest(w) {
		const res = app.res;
		const r = app.doc.physics.ballRadius;
		const px = K.X(view, w.x), py = K.Y(view, w.y);
		const hitPx = (x, y, radPx) => Math.hypot(K.X(view, x) - px, K.Y(view, y) - py) <= radPx;

		if (app.cursor === "aim") {
			const shots = [...app.doc.shots].sort((a, b) => b.t - a.t);
			for (const s of shots) {
				const g = shotGeom(s);
				if (hitPx(g.hx, g.hy, 11)) return { kind: "shot", shot: s, part: "head" };
				if (hitPx(g.o.x, g.o.y, 9)) return { kind: "shot", shot: s, part: "tail" };
			}
		}
		for (let k = app.doc.checkpoints.length - 1; k >= 0; k--) {
			const c = app.doc.checkpoints[k];
			const d = Math.hypot(w.x - c.x, w.y - c.y);
			if (Math.abs(d - c.r) <= 0.012 && d > c.r - 0.012) return { kind: "cp", id: k, part: "edge" };
			if (d <= c.r) return { kind: "cp", id: k, part: "move" };
		}
		if (hitPx(app.doc.object.x, app.doc.object.y, K.L(view, r) + 5)) return { kind: "object" };
		if (app.placement === "free") {
			for (let i = app.doc.cues.length - 1; i >= 0; i--) {
				const c = app.doc.cues[i];
				if (hitPx(c.x, c.y, K.L(view, r) + 5)) return { kind: "cue", id: i };
			}
		}
		return null;
	}

	function clampFelt(pos, rad) {
		pos.x = clamp(pos.x, rad + 0.02, K.TABLE.w - rad - 0.02);
		pos.y = clamp(pos.y, rad + 0.02, K.TABLE.h - rad - 0.02);
	}

	function planDown(ev) {
		if (app.solving) return;
		const w = pointerWorld(ev);
		const hit = hitTest(w);
		app.sel = hit;
		if (hit) {
			app.drag = { ...hit, x: w.x, y: w.y };
			if (hit.kind === "cp" && hit.part === "move") {
				app.drag.dx = w.x - app.doc.checkpoints[hit.id].x;
				app.drag.dy = w.y - app.doc.checkpoints[hit.id].y;
			}
		} else if (app.cursor === "aim") {
			// клик мимо — поставить новый удар выбранного игрока в точку t
			app.sel = null;
		}
		buildCrew();
	}

	function planMove(ev) {
		const d = app.drag;
		if (!d) return;
		const w = pointerWorld(ev);
		const rad = app.doc.physics.ballRadius;
		if (d.kind === "shot") {
			const s = d.shot;
			const g = shotGeom(s);
			if (d.part === "head") {
				s.angle = Math.atan2(w.y - g.o.y, w.x - g.o.x);
				const len = Math.hypot(w.x - g.o.x, w.y - g.o.y);
				s.power = clamp(((len - 0.1) / 0.62) * app.doc.maxPower, 0.1, app.doc.maxPower);
			}
		} else if (d.kind === "cp") {
			const c = app.doc.checkpoints[d.id];
			if (d.part === "edge") c.r = clamp(Math.hypot(w.x - c.x, w.y - c.y), 0.06, 0.3);
			else {
				c.x = clamp(w.x - d.dx, c.r + 0.03, K.TABLE.w - c.r - 0.03);
				c.y = clamp(w.y - d.dy, c.r + 0.03, K.TABLE.h - c.r - 0.03);
			}
		} else if (d.kind === "object") {
			app.doc.object.x = w.x;
			app.doc.object.y = w.y;
			clampFelt(app.doc.object, rad);
		} else if (d.kind === "cue") {
			const c = app.doc.cues[d.id];
			c.x = w.x; c.y = w.y;
			clampFelt(c, rad);
		}
		edit();
	}

	function planUp() {
		if (app.drag) {
			app.drag = null;
			buildCrew();
		}
	}

	function planWheel(ev) {
		if (!app.sel) return;
		ev.preventDefault();
		const step = ev.deltaY < 0 ? 1 : -1;
		if (app.sel.kind === "shot") {
			app.sel.shot.t = clamp(app.sel.shot.t + step * 0.02, 0, app.doc.maxTime);
		} else if (app.sel.kind === "cp") {
			app.doc.checkpoints[app.sel.id].r = clamp(app.doc.checkpoints[app.sel.id].r + step * 0.005, 0.06, 0.3);
		}
		edit();
	}

	// ── отрисовка ────────────────────────────────────────────────────────────
	const TRAIL_STYLES = [
		{ width: 2.8, alpha: 0.95 },
		{ width: 1.5, alpha: 0.6 },
		{ width: 1.5, alpha: 0.6 },
		{ width: 1.5, alpha: 0.6 },
		{ width: 1.5, alpha: 0.6 },
	];

	/** Кэш корзин тайм-цвета строится один раз на результат симуляции. */
	function ensureTrail(frames, duration) {
		if (trailCache && trailCache.count === frames.count) return;
		trailCache = K.buildTrail(view, frames, duration, { styles: TRAIL_STYLES });
	}

	function renderPlanner(ctx) {
		const res = activeRes();
		if (!res) return;
		const d = app.doc;
		const draft = app.solving && app.solver?.current ? app.solver.current.state : null;
		const shots = draft ? draft.shots : d.shots;
		K.drawTable(ctx, view);
		K.drawRoute(ctx, view, d.checkpoints);

		ensureTrail(res.frames, res.duration);
		K.drawTrail(ctx, trailCache);

		d.checkpoints.forEach((c, i) => {
			const p = res.passed[i];
			K.drawCheckpoint(ctx, view, c, i, {
				passed: !Number.isNaN(p) && p <= app.t,
				next: i === res.passed.findIndex((x) => Number.isNaN(x) || x > app.t),
				selected: app.sel?.kind === "cp" && app.sel.id === i,
				color: K.CP_COLORS[i],
				t: p,
			});
		});

		shots.forEach((s) => {
			const from = res.frames.at(s.t, s.player + 1);
			K.drawShot(ctx, view, s, from, d.maxPower, { selected: app.sel?.kind === "shot" && app.sel.shot === s });
		});

		for (let b = 0; b < NBALLS; b++) {
			const pos = res.frames.at(app.t, b);
			if (b === 0) K.drawBall(ctx, view, pos, d.physics.ballRadius, K.OBJECT_COLOR, "1", {});
			else {
				const pl = K.PLAYERS[b - 1];
				K.drawBall(ctx, view, pos, d.physics.ballRadius, pl.color, String(pl.id + 1), {});
			}
		}
	}

	function renderLive(ctx) {
		const eng = app.live;
		if (!eng) return;
		const d = app.doc;
		K.drawTable(ctx, view);
		K.drawRoute(ctx, view, d.checkpoints);

		if (!trailCache || eng.traj.count - trailCache.count >= 6)
			trailCache = K.buildTrail(view, eng.traj, Math.max(eng.traj.duration, eng.t + 0.5), { styles: TRAIL_STYLES });
		K.drawTrail(ctx, trailCache);

		d.checkpoints.forEach((c, i) => {
			K.drawCheckpoint(ctx, view, c, i, {
				passed: i < eng.nextCp,
				next: i === eng.nextCp,
				selected: false,
				color: K.CP_COLORS[i],
				t: eng.passed[i],
			});
		});

		for (let b = 0; b < eng.balls.length; b++) {
			// на паузе/при перемотке показываем записанную позицию, на бегу — живую
			const pos = eng.running ? eng.balls[b] : eng.traj.at(clamp(app.t, 0, eng.traj.duration), b);
			if (b === 0) K.drawBall(ctx, view, pos, d.physics.ballRadius, K.OBJECT_COLOR, "1", {});
			else {
				const pl = K.PLAYERS[b - 1];
				K.drawBall(ctx, view, pos, d.physics.ballRadius, pl.color, String(pl.id + 1), {});
			}
		}

		// прицел человека: призрак в точке касания и линия
		const hb = eng.humanBall;
		if (hb && eng.running) {
			const ang = eng.aim.angle;
			const dir = { x: Math.cos(ang), y: Math.sin(ang) };
			const R = d.physics.ballRadius;
			const ray = K.castRay({ x: hb.x, y: hb.y }, dir, eng.balls, hb.idx, 2 * R, K.TABLE);
			let gx = hb.x + dir.x * Math.min(ray.dist, 2.6);
			let gy = hb.y + dir.y * Math.min(ray.dist, 2.6);
			if (ray.hit === 0) {
				gx = hb.x + dir.x * (ray.dist - 2 * R);
				gy = hb.y + dir.y * (ray.dist - 2 * R);
				K.drawBall(ctx, view, { x: gx, y: gy }, R, K.OBJECT_COLOR, null, { ghost: true });
			}
			ctx.save();
			ctx.strokeStyle = K.PLAYERS[eng.cueOf].color;
			ctx.globalAlpha = 0.7;
			ctx.setLineDash([6, 5]);
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(K.X(view, hb.x), K.Y(view, hb.y));
			ctx.lineTo(K.X(view, gx), K.Y(view, gy));
			ctx.stroke();
			ctx.restore();

			let power = eng.aim.power;
			if (app.charge) power = clamp(d.maxPower * Math.min(1, (performance.now() - app.charge.t0) / 850), 0.12, d.maxPower);
			K.drawPowerArc(ctx, view, hb, ang, power, d.maxPower);
		}
	}

	// ── таймлайн ─────────────────────────────────────────────────────────────
	function refreshMarks() {
		const marks = $("marks");
		marks.replaceChildren();
		let res, frames;
		if (app.mode === "live") {
			if (!app.live) return;
			res = { duration: app.live.traj.duration, windows: [], events: app.live.events };
		} else res = activeRes();
		if (!res) return;
		const dur = Math.max(0.25, res.duration);

		(res.windows || []).forEach((win, k) => {
			if (!win) return;
			const mk = h("div", { class: "win", style: `left:${(win[0] / dur) * 100}%;width:${Math.max(1, ((win[1] - win[0]) / dur) * 100)}%;background:${K.CP_COLORS[k]}` });
			marks.append(mk);
		});
		const draftShots = app.solving && app.solver?.current ? app.solver.current.state.shots : null;
		const shots = app.mode === "live" ? res.events.filter((e) => e.type === "shot") : (draftShots || app.doc.shots);
		shots.forEach((s) => {
			const pl = K.PLAYERS[s.player];
			const mk = h("div", { class: "mk", style: `left:${(s.t / dur) * 100}%;background:${pl?.color ?? "#fff"};height:10px;top:3px` });
			marks.append(mk);
		});
		(app.mode === "live" ? app.live.passed : res.passed)?.forEach((p, k) => {
			if (Number.isNaN(p)) return;
			const mk = h("div", { class: "mk", style: `left:${(p / dur) * 100}%;background:${K.CP_COLORS[k]};height:16px;top:8px;width:3px` });
			marks.append(mk);
		});
	}

	function refreshHud() {
		const dots = $("cpDots");
		if (dots.childElementCount !== app.doc.checkpoints.length) {
			dots.replaceChildren(...app.doc.checkpoints.map((_c, i) => h("div", { class: "dot", text: String(i + 1) })));
		}
		const res = app.mode === "live" ? null : activeRes();
		const passed = app.mode === "live" ? app.live?.nextCp ?? 0 : res ? res.passed.filter((p) => !Number.isNaN(p)).length : 0;
		[...dots.children].forEach((d, i) => d.classList.toggle("ok", i < passed));
	}

	function setBanner(text, kind) {
		const b = $("banner");
		if (!text) { b.style.display = "none"; return; }
		b.style.display = "";
		b.className = `banner ${kind || ""}`;
		b.textContent = text;
	}

	// ── воспроизведение ──────────────────────────────────────────────────────
	function togglePlay() {
		if (app.mode === "live") {
			if (!app.live) enterLive(true);
			const e = app.live;
			if (e.solved) {
				enterLive(true);
				app.live.running = true;
				return;
			}
			e.running = !e.running;
			app.playing = e.running;
			if (e.running) setBanner("", "");
			return;
		}
		if (app.t >= (activeRes()?.duration ?? 0) - 0.02) app.t = 0;
		app.playing = !app.playing;
	}

	function stepFrame() {
		if (app.mode === "live") {
			if (app.live && !app.live.running) app.live.step(1 / 60);
		} else {
			app.playing = false;
			app.t = Math.min((activeRes()?.duration ?? 0), app.t + 1 / 60);
		}
	}

	// ── главный цикл ─────────────────────────────────────────────────────────
	let last = performance.now();
	function frame(now) {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;

		if (app.mode === "planner") {
			if (app.dirty) { recompute(); app.dirty = false; refreshSolveThrottled.dirty = true; }
			if (app.playing) {
				app.t += dt * app.speed;
				if (app.t >= app.res.duration) { app.t = app.res.duration; app.playing = false; }
			}
		} else if (app.live) {
			if (app.live.running) app.live.update(dt);
			app.t = app.live.t;
			if (app.live.solved && app.live.running === false && !app._announced) {
				app._announced = true;
				setBanner(`ФИНИШ ЗА ${app.live.finishAt.toFixed(2)}с`, "ok");
				updateBest(app.live.finishAt);
				toast(`партия пройдена за ${app.live.finishAt.toFixed(2)}с`, "ok");
			}
		}

		const canvas = $("table");
		const ctx = canvas.getContext("2d");
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (app.mode === "planner") renderPlanner(ctx);
		else renderLive(ctx);

		// таймлайн
		const res = app.mode === "live" ? null : activeRes();
		const dur = app.mode === "live" ? Math.max(app.live?.traj.duration ?? 1, app.t + 0.2) : (res?.duration ?? 1);
		$("tVal").textContent = `${app.t.toFixed(2)} с`;
		const scrub = $("scrub");
		scrub.disabled = app.mode === "live" && app.live?.running;
		if (document.activeElement !== scrub) scrub.value = Math.round(clamp(app.t / dur, 0, 1) * 1000);
		$("playBtn").textContent = app.mode === "live" ? (app.live?.running ? "⏸" : "▶") : (app.playing ? "⏸" : "▶");

		// живые подписи во время правок/решателя
		if (app.sel?.kind === "shot") ui.shotOuts.get(app.sel.shot)?.refresh();
		if (app.solving || app.mode === "planner") refreshSolveThrottled(now);
		refreshHud();
		if (app.mode === "live" && now - app.lastHud > 250) {
			app.lastHud = now;
			refreshLiveNotes();
			refreshMarks();
		}
		requestAnimationFrame(frame);
	}
	let solveRefreshAt = 0;
	function refreshSolveThrottled(now) {
		if (!ui.solve) return;
		if (app.solving) {
			if (now - solveRefreshAt > 120) { solveRefreshAt = now; refreshSolve(); }
		} else if (refreshSolveThrottled.dirty) {
			refreshSolveThrottled.dirty = false;
			refreshSolve();
		}
	}
	refreshSolveThrottled.dirty = false;

	function refreshLiveNotes() {
		const eng = app.live;
		if (!eng) return;
		K.PLAYERS.forEach((pl) => {
			const e = $(`note-${pl.id}`);
			if (!e) return;
			if (pl.id === app.human) {
				e.textContent = `${eng.running ? "целитесь вы" : "пауза"} · ударов ${eng.shotCount[pl.id]}`;
				return;
			}
			const cool = eng.t < eng.cooldown[pl.id];
			e.textContent = `${eng.notes[pl.id]}${cool ? " · перезарядка" : ""} · ударов ${eng.shotCount[pl.id]}`;
		});
		const b = $("liveStart");
		if (b) b.textContent = eng.running ? "пауза" : (eng.solved ? "ещё раз" : "старт");
	}

	// ── размеры ──────────────────────────────────────────────────────────────
	function resize() {
		const canvas = $("table");
		const wrap = canvas.parentElement.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.max(50, wrap.width * dpr);
		canvas.height = Math.max(50, wrap.height * dpr);
		canvas.style.width = `${wrap.width}px`;
		canvas.style.height = `${wrap.height}px`;
		canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
		view = K.makeView(K.TABLE, wrap.width, wrap.height, 12);
		trailCache = null;
	}

	// ── сегменты и проводка ──────────────────────────────────────────────────
	function syncSeg(id, key, val) {
		$(id).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset[key] === String(val)));
	}
	function wireSeg(id, key, apply) {
		$(id).querySelectorAll("button").forEach((b) => b.addEventListener("click", () => apply(b.dataset[key])));
	}

	function switchMode(mode) {
		app.mode = mode;
		document.body.dataset.mode = mode;
		syncSeg("modeSeg", "mode", mode);
		$("placeSeg").style.visibility = mode === "live" ? "hidden" : "";
		$("cursorSeg").style.visibility = mode === "live" ? "hidden" : "";
		app.sel = null;
		app._announced = false;
		setBanner("", "");
		if (mode === "live") {
			enterLive(true);
			app.tab = "crew";
		} else {
			if (app.live) app.live.running = false;
			app.live = null;
			app.dirty = true;
		}
		switchTab(app.tab);
		buildCrew();
		app.t = 0;
		trailCache = null;
		refreshMarks();
	}

	function switchTab(tab) {
		app.tab = tab;
		syncSeg2(tab);
		["setup", "crew", "solve"].forEach((t) => ($(`tab-${t}`).style.display = t === tab ? "" : "none"));
		if (tab === "crew") buildCrew();
		if (tab === "solve") buildSolve();
		if (tab === "setup") buildSetup();
	}
	function syncSeg2(tab) {
		document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
	}

	function init() {
		// временной градиент трека из тех же стопов, что и траектории
		$("timeGrad").style.background =
			"linear-gradient(90deg,#fff4a3 0%,#ffb703 20%,#f4623a 42%,#e0356f 60%,#8e5bd6 78%,#2f9bd6 100%)";

		buildSetup();
		buildCrew();
		buildSolve();

		wireSeg("modeSeg", "mode", switchMode);
		wireSeg("placeSeg", "placement", (v) => {
			app.placement = v;
			syncSeg("placeSeg", "placement", v);
			if (v === "locked") { /* позиции битков — стартовые, не трогаем план */ }
			edit();
			if (app.tab === "solve") buildSolve();
			toast(v === "locked" ? "замок: битки стоят как расставлены" : "свободно: решатель сам поставит битки");
		});
		wireSeg("cursorSeg", "cursor", (v) => {
			app.cursor = v;
			syncSeg("cursorSeg", "cursor", v);
			$("hint").textContent = v === "aim"
				? "тащите голову стрелки — угол/сила; колесо на стрелке — время"
				: "тащите шар 1, битки (свободная расстановка) и контрольные точки";
		});
		document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
		wireSeg("speedSeg", "speed", (v) => {
			app.speed = parseFloat(v);
			syncSeg("speedSeg", "speed", v);
			if (app.live) app.live.speed = app.speed;
		});

		$("playBtn").addEventListener("click", togglePlay);
		$("stepBtn").addEventListener("click", stepFrame);
		$("scrub").addEventListener("input", (e) => {
			const dur = app.mode === "live" ? app.live?.traj.duration ?? 1 : activeRes()?.duration ?? 1;
			app.t = (parseInt(e.target.value, 10) / 1000) * dur;
			app.playing = false;
			if (app.mode === "live" && app.live) app.live.running = false;
		});

		const canvas = $("table");
		canvas.addEventListener("pointerdown", (ev) => { canvas.setPointerCapture(ev.pointerId); app.mode === "live" ? liveDown(ev) : planDown(ev); });
		canvas.addEventListener("pointermove", (ev) => (app.mode === "live" ? liveMove(ev) : planMove(ev)));
		canvas.addEventListener("pointerup", () => (app.mode === "live" ? liveUp() : planUp()));
		canvas.addEventListener("pointercancel", () => { app.charge = null; app.drag = null; });
		canvas.addEventListener("wheel", planWheel, { passive: false });
		canvas.addEventListener("contextmenu", (e) => e.preventDefault());

		window.addEventListener("keydown", (ev) => {
			if (["INPUT", "TEXTAREA", "BUTTON"].includes(ev.target.tagName)) return;
			if (ev.code === "Space") { ev.preventDefault(); togglePlay(); }
			else if (ev.key === ".") stepFrame();
			else if (ev.key >= "1" && ev.key <= "4" && app.mode === "live") {
				app.human = +ev.key - 1;
				app.bots = K.PLAYERS.map((x) => x.id !== app.human);
				enterLive(true);
				buildCrew();
			} else if ((ev.key === "Delete" || ev.key === "Backspace") && app.sel?.kind === "shot") {
				ev.preventDefault();
				const s = app.sel.shot;
				app.doc.shots.splice(app.doc.shots.indexOf(s), 1);
				app.sel = null;
				edit(); buildCrew();
			}
		});

		let rzT = null;
		new ResizeObserver(() => { clearTimeout(rzT); rzT = setTimeout(resize, 40); }).observe(canvas.parentElement);
		resize();
		$("hint").textContent = "тащите шар 1, битки (свободная расстановка) и контрольные точки";
		refreshBest();
		document.body.dataset.mode = "planner";
		recompute();
		app.dirty = false;
		requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
	else init();
})();
