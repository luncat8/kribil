import { useEffect, useRef } from "react";
import {
	L,
	X,
	Y,
	drawBall,
	drawCheckpoint,
	drawPowerArc,
	drawRoute,
	drawShot,
	drawTable,
	drawTrajectories,
	makeView,
	timeColor,
	unproject,
	type View,
} from "@/game/render";
import type { SimResult } from "@/game/simulate";
import type { Traj } from "@/game/traj";
import { castRay, norm } from "@/game/geo";
import { PLAYERS } from "@/game/levels";
import type { Checkpoint, PhysicsParams, Shot, TableSpec, Vec } from "@/game/types";
import type { LiveEngine } from "@/game/realtime";

export type Sel = { kind: "object" | "cue" | "cp" | "shot"; idx: number } | null;

export interface CanvasProps {
	mode: "planner" | "live";
	pointerMode: "drag" | "aim";
	table: TableSpec;
	params: PhysicsParams;
	checkpoints: Checkpoint[];
	object: Vec;
	cues: Vec[];
	shots: Shot[];
	res: SimResult | null;
	t: number;
	selection: Sel;
	maxPower: number;
	showObj: boolean;
	showCues: boolean;
	live: LiveEngine | null;
	onMoveObject: (v: Vec) => void;
	onMoveCue: (i: number, v: Vec) => void;
	onMoveCp: (i: number, v: Vec) => void;
	onResizeCp: (i: number, r: number) => void;
	onPatchShot: (i: number, patch: Partial<Shot>) => void;
	onSelect: (s: Sel) => void;
	onHint: (h: string) => void;
}

interface Drag {
	kind: "object" | "cue" | "cp" | "cpR" | "shotAngle" | "shotTime";
	idx: number;
	grab?: Vec;
	base?: number;
}

export default function TableCanvas(props: CanvasProps) {
	const wrapRef = useRef<HTMLDivElement | null>(null);
	const cvsRef = useRef<HTMLCanvasElement | null>(null);
	const stateRef = useRef(props);
	stateRef.current = props;
	const dragRef = useRef<Drag | null>(null);
	const viewRef = useRef<View | null>(null);
	const chargeRef = useRef<{ on: boolean; t0: number }>({ on: false, t0: 0 });
	const hoverRef = useRef<Vec | null>(null);
	const rafRef = useRef(0);

	useEffect(() => {
		const cvs = cvsRef.current!;
		const wrap = wrapRef.current!;
		const ctx = cvs.getContext("2d")!;
		let cssW = 0;
		let cssH = 0;

		const resize = () => {
			const r = wrap.getBoundingClientRect();
			const dpr = Math.min(2, window.devicePixelRatio || 1);
			cssW = Math.max(320, r.width);
			cssH = Math.max(220, r.height);
			cvs.width = Math.round(cssW * dpr);
			cvs.height = Math.round(cssH * dpr);
			cvs.style.width = `${cssW}px`;
			cvs.style.height = `${cssH}px`;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		};
		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(wrap);

		const draw = () => {
			const s = stateRef.current;
			const v = makeView(s.table, cssW, cssH, 12);
			viewRef.current = v;
			ctx.clearRect(0, 0, cssW, cssH);
			drawTable(ctx, v);

			const live = s.live;
			const frames: Traj | null = live ? live.traj : (s.res?.frames ?? null);
			const duration = live ? live.t : (s.res?.duration ?? 0);
			const passed: number[] = live ? live.passed : (s.res?.passed ?? []);
			const nextIdx = live ? live.nextCp : passed.filter((p) => !Number.isNaN(p) && p <= s.t).length;

			drawRoute(ctx, v, s.checkpoints, nextIdx);
			s.checkpoints.forEach((c, i) => {
				const p = passed[i];
				drawCheckpoint(ctx, v, c, i, {
					passed: !Number.isNaN(p),
					next: i === nextIdx,
					selected: s.selection?.kind === "cp" && s.selection.idx === i,
					color: i === 3 ? "#ff5d73" : ["#ffd166", "#8ecf6f", "#48cae4", "#ff5d73"][i],
					t: Number.isNaN(p) ? undefined : p,
				});
			});

			// траектории
			if (frames && frames.count > 2) {
				const nb = frames.nb;
				const styles = Array.from({ length: nb }, (_u, i) =>
					i === 0
						? s.showObj
							? { width: 3.2, alpha: 0.95 }
							: null
						: s.showCues
							? { width: 1.7, alpha: 0.62, dash: [5, 4] }
							: null,
				);
				const synth = { frames, duration } as unknown as SimResult;
				drawTrajectories(ctx, v, synth, { styles, stride: live ? 2 : 3, buckets: 34 });
			}

			// векторы ударов
			if (!live) {
				s.shots.forEach((sh, i) => {
					const cueIdx = 1 + sh.player;
					const from = s.res && s.res.frames.count > 2 ? s.res.frames.at(sh.t, cueIdx) : s.cues[sh.player];
					drawShot(ctx, v, sh, from ?? s.cues[sh.player], s.maxPower, {
						selected: s.selection?.kind === "shot" && s.selection.idx === i,
						live: sh.t <= s.t,
					});
				});
				// предсказание выбранного удара: куда придёт биток и поедет шар 1
				const sel = s.selection;
				if (sel?.kind === "shot") {
					const sh = s.shots[sel.idx];
					if (sh) {
						const cueIdx = 1 + sh.player;
						const from = s.res ? s.res.frames.at(sh.t, cueIdx) : s.cues[sh.player];
						if (from) {
							const dir = { x: Math.cos(sh.angle), y: Math.sin(sh.angle) };
							const bodies = s.res ? s.res.bodies.map((b) => ({ x: b.x, y: b.y, r: b.r, idx: b.idx })) : [];
							void bodies;
							const sim = simPositions(s, sh.t);
							const hit = castRay(from, dir, sim, cueIdx, s.params.ballRadius * 2, s.table);
							const cx = from.x + dir.x * hit.dist;
							const cy = from.y + dir.y * hit.dist;
							ctx.save();
							ctx.setLineDash([3, 4]);
							ctx.strokeStyle = "rgba(255,244,163,.55)";
							ctx.lineWidth = 1;
							ctx.beginPath();
							ctx.arc(X(v, cx), Y(v, cy), L(v, s.params.ballRadius), 0, Math.PI * 2);
							ctx.stroke();
							if (hit.hit === 0) {
								const o = sim[0];
								const nd = norm({ x: o.x - cx, y: o.y - cy });
								ctx.setLineDash([]);
								ctx.strokeStyle = timeColor(0, 0.9);
								ctx.lineWidth = 2;
								ctx.beginPath();
								ctx.moveTo(X(v, o.x), Y(v, o.y));
								ctx.lineTo(X(v, o.x + nd.x * 0.5), Y(v, o.y + nd.y * 0.5));
								ctx.stroke();
								ctx.fillStyle = timeColor(0, 0.9);
								ctx.beginPath();
								ctx.arc(X(v, o.x + nd.x * 0.5), Y(v, o.y + nd.y * 0.5), 3, 0, Math.PI * 2);
								ctx.fill();
							}
							ctx.restore();
						}
					}
				}
			}

			// вспышки контактов вокруг текущего момента
			const evs = live ? live.events : (s.res?.events ?? []);
			for (const ev of evs) {
				if (ev.type !== "contact" && ev.type !== "checkpoint") continue;
				const d = Math.abs(ev.t - s.t);
				if (d > 0.12) continue;
				const k = 1 - d / 0.12;
				const pos =
					ev.a >= 0 && frames ? { x: frames.at(ev.t, ev.a).x, y: frames.at(ev.t, ev.a).y } : null;
				if (!pos) continue;
				ctx.save();
				ctx.strokeStyle = ev.type === "checkpoint" ? `rgba(255,255,255,${0.85 * k})` : `rgba(255,244,163,${0.7 * k})`;
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.arc(X(v, pos.x), Y(v, pos.y), L(v, s.params.ballRadius) + 4 + 14 * (1 - k), 0, Math.PI * 2);
				ctx.stroke();
				ctx.restore();
			}

			// шары
			const r = s.params.ballRadius;
			for (let i = 0; i < (live ? live.balls.length : 1 + s.cues.length); i++) {
				let pos: Vec;
				let color: string;
				let label: string;
				if (live) {
					const b = live.balls[i];
					pos = { x: b.x, y: b.y };
					color = b.color;
					label = b.kind === "object" ? "1" : `${b.owner + 1}`;
				} else {
					const tNow = Math.min(s.t, s.res?.duration ?? 0);
					pos = s.res ? s.res.frames.at(tNow, i) : (i === 0 ? s.object : s.cues[i - 1]);
					color = i === 0 ? "#fdf3d3" : PLAYERS[i - 1]?.color ?? "#fff";
					label = i === 0 ? "1" : `${i}`;
				}
				const selected =
					(i === 0 && s.selection?.kind === "object") ||
					(i > 0 && s.selection?.kind === "cue" && s.selection.idx === i - 1);
				drawBall(ctx, v, pos, r, color, label, { selected });
			}

			// реалтайм: прицел человека
			if (live) {
				const hb = live.humanBall;
				if (hb) {
					const hp = hoverRef.current ?? { x: hb.x + Math.cos(live.aim.angle) * 0.4, y: hb.y + Math.sin(live.aim.angle) * 0.4 };
					live.aimAt(hp);
					const dir = { x: Math.cos(live.aim.angle), y: Math.sin(live.aim.angle) };
					const sim = live.balls.map((b) => ({ x: b.x, y: b.y, r: b.r }));
					const hit = castRay({ x: hb.x, y: hb.y }, dir, sim, hb.idx, r * 2, s.table);
					const cx = hb.x + dir.x * hit.dist;
					const cy = hb.y + dir.y * hit.dist;
					ctx.save();
					ctx.setLineDash([7, 6]);
					ctx.strokeStyle = "rgba(255,244,163,.6)";
					ctx.lineWidth = 1.4;
					ctx.beginPath();
					ctx.moveTo(X(v, hb.x), Y(v, hb.y));
					ctx.lineTo(X(v, cx), Y(v, cy));
					ctx.stroke();
					ctx.setLineDash([]);
					ctx.strokeStyle = hit.hit === 0 ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.25)";
					ctx.beginPath();
					ctx.arc(X(v, cx), Y(v, cy), L(v, r), 0, Math.PI * 2);
					ctx.stroke();
					if (hit.hit === 0) {
						const o = live.balls[0];
						const nd = norm({ x: o.x - cx, y: o.y - cy });
						const want = { x: o.x + nd.x * 0.55, y: o.y + nd.y * 0.55 };
						ctx.strokeStyle = "rgba(126,222,170,.9)";
						ctx.lineWidth = 2;
						ctx.setLineDash([10, 5]);
						ctx.beginPath();
						ctx.moveTo(X(v, o.x), Y(v, o.y));
						ctx.lineTo(X(v, want.x), Y(v, want.y));
						ctx.stroke();
						ctx.setLineDash([]);
						const cp = s.checkpoints[Math.min(live.nextCp, s.checkpoints.length - 1)];
						if (cp) {
							const a1 = Math.atan2(cp.y - o.y, cp.x - o.x);
							const a2 = Math.atan2(nd.y, nd.x);
							let da = Math.abs(((a1 - a2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
							da = Math.abs(da);
							ctx.fillStyle = da < 0.25 ? "rgba(126,222,170,.95)" : "rgba(255,140,140,.9)";
							ctx.font = '600 10px "JetBrains Mono", monospace';
							ctx.textAlign = "center";
							ctx.fillText(`${((da * 180) / Math.PI).toFixed(0)}°`, X(v, o.x), Y(v, o.y) - L(v, r) - 7);
						}
					}
					ctx.restore();
					const charge = chargeRef.current.on ? Math.min(1, (performance.now() - chargeRef.current.t0) / 1100) : 0;
					drawPowerArc(ctx, v, { x: hb.x, y: hb.y }, live.aim.angle, charge * s.maxPower, s.maxPower);
				}
			}

			rafRef.current = requestAnimationFrame(draw);
		};
		rafRef.current = requestAnimationFrame(draw);

		/* ─── указатель ─── */
		const toWorld = (e: PointerEvent) => {
			const rect = cvs.getBoundingClientRect();
			const v = viewRef.current!;
			return unproject(v, e.clientX - rect.left, e.clientY - rect.top);
		};
		const px = (p: Vec, q: Vec) => Math.hypot(p.x - q.x, p.y - q.y) * viewRef.current!.scale;

		const pick = (p: Vec): Drag | null => {
			const s = stateRef.current;
			const editable = s.mode === "planner" || (s.live ? !s.live.running && s.live.t === 0 : true);
			const shotAt = (i: number) => {
				const sh = s.shots[i];
				const from = s.res ? s.res.frames.at(sh.t, 1 + sh.player) : s.cues[sh.player];
				const len = 0.1 + 0.62 * Math.min(1, sh.power / s.maxPower);
				return { head: { x: from.x + Math.cos(sh.angle) * len, y: from.y + Math.sin(sh.angle) * len }, from };
			};
			if (s.pointerMode === "aim" && editable && s.mode === "planner") {
				// ручка радиуса выбранной точки
				const selCp = s.selection?.kind === "cp" ? s.checkpoints[s.selection.idx] : null;
				if (selCp && px(p, { x: selCp.x + selCp.r, y: selCp.y }) < 11) {
					const i = s.selection!.idx;
					return { kind: "cpR", idx: i, grab: p, base: selCp.r };
				}
				for (let i = 0; i < s.shots.length; i++) {
					const { head } = shotAt(i);
					if (px(p, head) < 13) {
						return {
							kind: "shotAngle",
							idx: i,
							grab: p,
						};
					}
				}
			}
			if (editable) {
				for (let i = 0; i < s.cues.length; i++) {
					if (px(p, s.cues[i]) < Math.max(12, L(viewRef.current!, s.params.ballRadius) + 5))
						return { kind: "cue", idx: i, grab: p };
				}
				if (px(p, s.object) < Math.max(12, L(viewRef.current!, s.params.ballRadius) + 5)) return { kind: "object", idx: 0, grab: p };
				for (let i = 0; i < s.checkpoints.length; i++) {
					const c = s.checkpoints[i];
					if (px(p, c) < Math.max(10, L(viewRef.current!, c.r))) return { kind: "cp", idx: i, grab: p };
				}
			}
			if (s.mode === "planner") {
				for (let i = 0; i < s.shots.length; i++) {
					const { head } = shotAt(i);
					if (px(p, head) < 13) return { kind: "shotAngle", idx: i, grab: p };
				}
			}
			return null;
		};

		const onDown = (e: PointerEvent) => {
			const s = stateRef.current;
			const p = toWorld(e);
			if (s.mode === "live" && s.live?.running) {
				chargeRef.current = { on: true, t0: performance.now() };
				cvs.setPointerCapture(e.pointerId);
				return;
			}
			const d = pick(p);
			if (!d) {
				s.onSelect(null);
				return;
			}
			dragRef.current = d;
			if (d.kind === "shotAngle" && e.shiftKey) d.kind = "shotTime";
			cvs.setPointerCapture(e.pointerId);
			const s2 = stateRef.current;
			if (d.kind === "object") s2.onSelect({ kind: "object", idx: 0 });
			else if (d.kind === "cue") s2.onSelect({ kind: "cue", idx: d.idx });
			else if (d.kind === "cp" || d.kind === "cpR") s2.onSelect({ kind: "cp", idx: d.idx });
			else s2.onSelect({ kind: "shot", idx: d.idx });
			if (d.kind === "shotTime") {
				const sh = s2.shots[d.idx];
				dragRef.current!.base = sh.t;
			}
			if (d.kind === "cpR") dragRef.current!.base = s2.checkpoints[d.idx].r;
		};

		const onMove = (e: PointerEvent) => {
			const s = stateRef.current;
			const p = toWorld(e);
			hoverRef.current = p;
			const d = dragRef.current;
			if (!d) {
				const hitPick = pick(p);
				cvs.style.cursor = s.mode === "live" && s.live?.running ? "crosshair" : hitPick ? (s.pointerMode === "aim" ? "pointer" : "grab") : "default";
				s.onHint(hitPick ? dragLabel(hitPick) : s.pointerMode === "aim" ? "тяни наконечник стрелы — угол и сила · Shift — время · колесо — тонко" : "тяни шары и точки · переключись на «прицел» для ударов");
				return;
			}
			cvs.style.cursor = "grabbing";
			const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
			if (d.kind === "object") s.onMoveObject({ x: cl(p.x, 0.05, s.table.w - 0.05), y: cl(p.y, 0.05, s.table.h - 0.05) });
			else if (d.kind === "cue") s.onMoveCue(d.idx, { x: cl(p.x, 0.05, s.table.w - 0.05), y: cl(p.y, 0.05, s.table.h - 0.05) });
			else if (d.kind === "cp") s.onMoveCp(d.idx, { x: cl(p.x, 0.03, s.table.w - 0.03), y: cl(p.y, 0.03, s.table.h - 0.03) });
			else if (d.kind === "cpR") s.onResizeCp(d.idx, cl((d.base ?? 0.15) + (p.x - (d.grab?.x ?? 0)) * 1, 0.05, 0.5));
			else if (d.kind === "shotAngle") {
				const sh = s.shots[d.idx];
				const cueIdx = 1 + sh.player;
				const from = s.res ? s.res.frames.at(sh.t, cueIdx) : s.cues[sh.player];
				const ang = Math.atan2(p.y - from.y, p.x - from.x);
				const len = Math.hypot(p.x - from.x, p.y - from.y);
				const power = cl(((len - 0.1) / 0.62) * s.maxPower, 0.05, s.maxPower);
				s.onPatchShot(d.idx, { angle: ang, power });
			} else if (d.kind === "shotTime") {
				const sh = s.shots[d.idx];
				const dx = (p.x - (d.grab?.x ?? 0)) * viewRef.current!.scale;
				s.onPatchShot(d.idx, { t: Math.max(0, (d.base ?? sh.t) + dx / 110) });
			}
		};

		const onUp = () => {
			const s = stateRef.current;
			if (chargeRef.current.on) {
				const k = Math.min(1, (performance.now() - chargeRef.current.t0) / 1100);
				if (s.live && s.mode === "live") {
					const hb = s.live.humanBall;
					if (hb) s.live.shoot(s.live.cueOf, s.live.aim.angle, 0.15 + k * (s.maxPower - 0.15));
				}
				chargeRef.current.on = false;
			}
			dragRef.current = null;
			cvs.style.cursor = "default";
			try {
				cvs.releasePointerCapture(0);
			} catch {
				/* noop */
			}
		};

		const onWheel = (e: WheelEvent) => {
			const s = stateRef.current;
			if (s.mode !== "planner") return;
			const sel = s.selection;
			if (!sel) return;
			e.preventDefault();
			const k = e.deltaY > 0 ? 1 : -1;
			if (sel.kind === "shot") s.onPatchShot(sel.idx, { t: Math.max(0, s.shots[sel.idx].t + k * 0.02) });
			else if (sel.kind === "cp") s.onResizeCp(sel.idx, Math.max(0.05, Math.min(0.5, s.checkpoints[sel.idx].r + k * 0.008)));
		};

		cvs.addEventListener("pointerdown", onDown);
		cvs.addEventListener("pointermove", onMove);
		cvs.addEventListener("pointerup", onUp);
		cvs.addEventListener("pointercancel", onUp);
		cvs.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			cancelAnimationFrame(rafRef.current);
			ro.disconnect();
			cvs.removeEventListener("pointerdown", onDown);
			cvs.removeEventListener("pointermove", onMove);
			cvs.removeEventListener("pointerup", onUp);
			cvs.removeEventListener("pointercancel", onUp);
			cvs.removeEventListener("wheel", onWheel);
		};
	}, []);

	return (
		<div ref={wrapRef} className="relative h-full w-full">
			<canvas ref={cvsRef} className="block h-full w-full touch-none" />
		</div>
	);
}

function dragLabel(d: Drag) {
	switch (d.kind) {
		case "shotAngle":
			return "угол + сила";
		case "shotTime":
			return "время удара";
		case "cpR":
			return "радиус зоны";
		case "cp":
			return "перетащить точку";
		case "cue":
			return "переставить биток";
		case "object":
			return "переставить шар 1";
		default:
			return "";
	}
}

function simPositions(s: CanvasProps, t: number) {
	if (!s.res) return [{ x: s.object.x, y: s.object.y, r: s.params.ballRadius }, ...s.cues.map((c) => ({ ...c, r: s.params.ballRadius }))];
	const out: { x: number; y: number; r: number }[] = [];
	for (let i = 0; i < 1 + s.cues.length; i++) {
		const p = s.res.frames.at(t, i);
		out.push({ x: p.x, y: p.y, r: s.params.ballRadius });
	}
	return out;
}
