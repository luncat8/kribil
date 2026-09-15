import {
	Bot,
	Check,
	Crosshair,
	Flag,
	Gauge,
	Lock,
	Move,
	Pause,
	Play,
	Plus,
	RotateCcw,
	Route as RouteIcon,
	SkipBack,
	Sparkles,
	Target,
	Timer,
	Trash2,
	Unlock,
	User,
	Weight,
	X,
} from "lucide-react";
import { Btn, Check as CheckBox, Panel, Seg, Slider, Stat, cx } from "./ui";
import { CP_COLORS, PLAYERS } from "@/game/levels";
import { timeColor } from "@/game/render";
import type { AppMode, Doc, PlacementMode, PointerMode, Shot } from "@/game/types";
import type { Progress } from "@/game/optimizer";
import type { SimResult } from "@/game/simulate";
import type { Sel } from "./TableCanvas";
import type { LiveEngine } from "@/game/realtime";

import type { ReactNode } from "react";

const DEG = 180 / Math.PI;

/* ══════════════════════════ СОСТАВ КОМАНДЫ ══════════════════════════ */

export function CrewPanel({
	doc,
	setShots,
	selection,
	onSelect,
	mode,
	human,
	setHuman,
	ai,
	setAi,
	live,
}: {
	doc: Doc;
	setShots: (s: Shot[]) => void;
	selection: Sel;
	onSelect: (s: Sel) => void;
	mode: AppMode;
	human: number;
	setHuman: (n: number) => void;
	ai: boolean[];
	setAi: (a: boolean[]) => void;
	live: LiveEngine | null;
}) {
	const addShot = (p: number) => {
		const last = doc.shots.reduce((m, s) => Math.max(m, s.t), 0);
		const obj = doc.object;
		const c = doc.cues[p];
		setShots([
			...doc.shots,
			{
				id: `s${Date.now().toString(36)}${p}`,
				player: p,
				t: Math.round((last + 0.5) * 20) / 20,
				angle: Math.atan2(obj.y - c.y, obj.x - c.x),
				power: 1,
			},
		]);
	};
	return (
		<Panel
			title="ЭКИПАЖ · 4 ИГРОКА"
			right={<span className="mono text-[10px] text-chalk/40">{doc.shots.length} удар.</span>}
		>
			<div className="flex flex-col gap-2">
				{PLAYERS.map((pl) => {
					const shots = doc.shots.map((s, i) => ({ s, i })).filter(({ s }) => s.player === pl.id);
					const isHuman = mode === "live" && human === pl.id;
					const status = live ? live.notes[pl.id] : null;
					const shotsN = live ? live.shotCount[pl.id] : 0;
					return (
						<div
							key={pl.id}
							className={cx(
								"rounded border bg-black/25 px-2 py-2 transition-colors",
								isHuman ? "border-brass-500/70" : "border-white/8",
							)}
							style={isHuman ? { boxShadow: "0 0 22px -10px #ffb703" } : undefined}
						>
							<div className="flex items-center gap-2">
								<span
									className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/50"
									style={{ background: pl.color, boxShadow: `0 0 10px ${pl.color}88` }}
								/>
								<button
									className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
									onClick={() => setHuman(pl.id)}
									title="Играть за этого игрока (реалтайм)"
								>
									<span className="font-display text-[13px] tracking-wide" style={{ color: pl.color }}>
										{pl.nick}
									</span>
									<span className="truncate text-[10px] text-chalk/45">{pl.role}</span>
								</button>
								<button
									onClick={() => {
										const nx = [...ai];
										nx[pl.id] = !nx[pl.id];
										setAi(nx);
									}}
									title={ai[pl.id] ? "ИИ управляет" : "только вы"}
									className={cx(
										"rounded px-1 py-[2px] transition-colors",
										ai[pl.id] ? "bg-white/8 text-ice" : "bg-brass-500/20 text-brass-400",
									)}
								>
									{ai[pl.id] ? <Bot size={13} /> : <User size={13} />}
								</button>
								{isHuman ? <span className="font-display text-[9px] tracking-[0.2em] text-brass-400">ВЫ</span> : null}
							</div>

							{shots.length === 0 ? (
								<div className="mt-1.5 flex items-center justify-between">
									<span className="text-[10px] text-chalk/35">ударов не назначено</span>
									<Btn onClick={() => addShot(pl.id)} className="!py-[2px] !text-[9px]">
										<Plus size={11} /> удар
									</Btn>
								</div>
							) : (
								<div className="mt-1.5 flex flex-col gap-1.5">
									{shots.map(({ s, i }) => {
										const sel = selection?.kind === "shot" && selection.idx === i;
										return (
											<div
												key={s.id}
												onClick={() => onSelect({ kind: "shot", idx: i })}
												className={cx(
													"cursor-pointer rounded px-1.5 pb-1 pt-[3px] transition-colors",
													sel ? "bg-white/10 ring-1 ring-brass-500/40" : "hover:bg-white/6",
												)}
											>
												<div className="flex items-center justify-between">
													<span className="mono text-[9px] uppercase tracking-wider text-chalk/50">
														удар {i + 1}
													</span>
													<div className="flex items-center gap-1">
														<span className="mono text-[9px] text-chalk/40">
															{s.locked ? "зафикс." : `t=${s.t.toFixed(2)}`}
														</span>
														<button
															className="text-chalk/45 hover:text-brass-400"
															title={s.locked ? "Отдать параметр оптимизатору" : "Зафиксировать удар"}
															onClick={(e) => {
																e.stopPropagation();
																setShots(doc.shots.map((x, j) => (j === i ? { ...x, locked: !x.locked } : x)));
															}}
														>
															{s.locked ? <Lock size={11} /> : <Unlock size={11} />}
														</button>
														<button
															className="text-chalk/40 hover:text-clay"
															onClick={(e) => {
																e.stopPropagation();
																setShots(doc.shots.filter((_x, j) => j !== i));
																onSelect(null);
															}}
														>
															<Trash2 size={11} />
														</button>
													</div>
												</div>
												<div className="grid grid-cols-3 gap-1.5">
													<Slider
														label="t,с"
														knob={pl.color}
														digits={2}
														min={0}
														max={Math.max(1, doc.maxTime)}
														step={0.01}
														value={s.t}
														onChange={(v) => setShots(doc.shots.map((x, j) => (j === i ? { ...x, t: v } : x)))}
													/>
													<Slider
														label="угол"
														knob={pl.color}
														digits={0}
														unit="°"
														min={-180}
														max={180}
														step={0.5}
														value={s.angle * DEG}
														onChange={(v) => setShots(doc.shots.map((x, j) => (j === i ? { ...x, angle: v / DEG } : x)))}
													/>
													<Slider
														label="сила"
														knob={pl.color}
														digits={2}
														min={0.05}
														max={doc.maxPower}
														step={0.02}
														value={s.power}
														onChange={(v) => setShots(doc.shots.map((x, j) => (j === i ? { ...x, power: v } : x)))}
													/>
												</div>
											</div>
										);
									})}
									<Btn onClick={() => addShot(pl.id)} className="!py-[2px] !text-[9px] self-start">
										<Plus size={11} /> ещё удар
									</Btn>
								</div>
							)}
							{live ? (
								<div className="mono mt-1 flex items-center justify-between text-[9px] text-chalk/40">
									<span>{status}</span>
									<span>
										ударов {shotsN}
										{live.cooldown[pl.id] > live.t ? ` · пауза ${(live.cooldown[pl.id] - live.t).toFixed(1)}с` : ""}
									</span>
								</div>
							) : null}
						</div>
					);
				})}
			</div>
		</Panel>
	);
}

/* ══════════════════════════ СТОЛ / ФИЗИКА ══════════════════════════ */

export function SetupPanel({
	doc,
	patch,
	placement,
	setPlacement,
	pointerMode,
	setPointerMode,
	showObj,
	setShowObj,
	showCues,
	setShowCues,
	selection,
	onSelect,
	preset,
}: {
	doc: Doc;
	patch: (p: Partial<Doc>) => void;
	placement: PlacementMode;
	setPlacement: (m: PlacementMode) => void;
	pointerMode: PointerMode;
	setPointerMode: (m: PointerMode) => void;
	showObj: boolean;
	setShowObj: (v: boolean) => void;
	showCues: boolean;
	setShowCues: (v: boolean) => void;
	selection: Sel;
	onSelect: (s: Sel) => void;
	preset: (k: "zigzag" | "arc" | "rail" | "random") => void;
}) {
	const p = doc.physics;
	const setP = (q: Partial<typeof p>) => patch({ physics: { ...p, ...q } });
	const cp = selection?.kind === "cp" ? doc.checkpoints[selection.idx] : null;
	const setCp = (q: Partial<Doc["checkpoints"][number]>) => {
		if (!cp) return;
		patch({ checkpoints: doc.checkpoints.map((c, i) => (i === selection!.idx ? { ...c, ...q } : c)) });
	};
	return (
		<Panel title="РЕЖИМ · СТОЛ · ФИЗИКА">
			<div className="flex flex-col gap-2.5">
				<div>
					<div className="eyebrow mb-1">Курсор</div>
					<Seg
						value={pointerMode}
						onChange={setPointerMode}
						options={[
							{ v: "drag", label: "перемещение", icon: <Move size={11} /> },
							{ v: "aim", label: "сила / время", icon: <Crosshair size={11} /> },
						]}
					/>
				</div>
				<div>
					<div className="eyebrow mb-1">Битки на столе</div>
					<Seg
						value={placement}
						onChange={setPlacement}
						options={[
							{ v: "free", label: "где угодно", icon: <Target size={11} /> },
							{ v: "locked", label: "как в игре", icon: <Lock size={11} /> },
						]}
					/>
					<p className="mt-1 text-[10px] leading-snug text-chalk/45">
						{placement === "free"
							? "Режим А: маршрут зафиксирован, битки можно ставить куда угодно — оптимизатор подбирает и позиции, и удары."
							: "Режим Б: битки расставляются вместе с точками до начала — оптимизатор трогает только удары."}
					</p>
				</div>

				<div>
					<div className="eyebrow mb-1">Маршрут КТ</div>
					<div className="grid grid-cols-4 gap-1">
						{(
							[
								["zigzag", "зигзаг"],
								["arc", "дуга"],
								["rail", "борта"],
								["random", "рандом"],
							] as const
						).map(([k, label]) => (
							<Btn key={k} onClick={() => preset(k)} className="!py-[3px] !text-[9px]">
								<RouteIcon size={10} /> {label}
							</Btn>
						))}
					</div>
					<div className="mt-1.5 flex flex-wrap gap-1">
						{doc.checkpoints.map((c, i) => (
							<button
								key={c.id}
								onClick={() => onSelect({ kind: "cp", idx: i })}
								className={cx(
									"mono rounded border px-1.5 py-[2px] text-[10px] transition-colors",
									selection?.kind === "cp" && selection.idx === i ? "border-transparent text-[#0b1a12]" : "border-white/10 text-chalk/60 hover:border-white/30",
								)}
								style={
									selection?.kind === "cp" && selection.idx === i
										? { background: CP_COLORS[i], color: "#0b1a12" }
										: undefined
								}
							>
								К{i + 1} <span style={{ color: CP_COLORS[i] }}>●</span>
							</button>
						))}
					</div>
					{cp ? (
						<div className="mt-1.5 grid grid-cols-3 gap-1.5 rounded border border-white/8 bg-black/25 p-1.5">
							<Slider label="x" digits={2} min={0.03} max={2.37} step={0.005} value={cp.x} onChange={(v) => setCp({ x: v })} knob={CP_COLORS[selection!.idx]} />
							<Slider label="y" digits={2} min={0.03} max={1.17} step={0.005} value={cp.y} onChange={(v) => setCp({ y: v })} knob={CP_COLORS[selection!.idx]} />
							<Slider label="r зоны" digits={3} min={0.05} max={0.5} step={0.005} value={cp.r} onChange={(v) => setCp({ r: v })} knob={CP_COLORS[selection!.idx]} />
						</div>
					) : (
						<p className="mt-1 text-[10px] text-chalk/35">Тяни точку мышью; в режиме «сила / время» тяни правый край — радиус зоны.</p>
					)}
				</div>

				<div className="rule" />
				<div className="grid grid-cols-2 gap-x-2.5 gap-y-1.5">
					<Slider label="трение" min={0} max={3} step={0.01} value={p.friction} onChange={(v) => setP({ friction: v })} hint="0 = лёд" />
					<Slider label="упругость шаров" min={0.5} max={1} step={0.01} value={p.restitution} onChange={(v) => setP({ restitution: v })} knob="#48cae4" />
					<Slider label="отскок борта" min={0.3} max={1} step={0.01} value={p.cushion} onChange={(v) => setP({ cushion: v })} knob="#48cae4" />
					<Slider label="размер шара" digits={3} min={0.012} max={0.075} step={0.001} value={p.ballRadius} onChange={(v) => setP({ ballRadius: v })} knob="#8ecf6f" hint="единый радиус всех шаров" />
					<Slider label="масса шара 1" digits={2} min={0.2} max={4} step={0.05} value={p.objectMass} onChange={(v) => setP({ objectMass: v })} knob="#ff6b8b" />
					<Slider label="масса битка" digits={2} min={0.2} max={4} step={0.05} value={p.cueMass} onChange={(v) => setP({ cueMass: v })} knob="#c77dff" />
					<Slider label="лимит симуляции" digits={1} unit="с" min={2} max={30} step={0.5} value={doc.maxTime} onChange={(v) => patch({ maxTime: v })} knob="#ffd166" hint="полная длина трека — держим разумной, чтобы не висло" />
					<Slider label="макс. сила" digits={2} min={0.5} max={8} step={0.05} value={doc.maxPower} onChange={(v) => patch({ maxPower: v })} knob="#ffd166" />
				</div>

				<div className="flex flex-wrap items-center gap-1.5">
					<Tag active={showObj} onClick={() => setShowObj(!showObj)} icon={<Flag size={10} />} label="трек шара 1" />
					<Tag active={showCues} onClick={() => setShowCues(!showCues)} icon={<Gauge size={10} />} label="треки битков" />
					<Tag
						active={p.friction === 0}
						onClick={() => setP({ friction: p.friction === 0 ? 0.55 : 0 })}
						icon={<Weight size={10} />}
						label="абсолютный лёд"
					/>
				</div>
			</div>
		</Panel>
	);
}

function Tag({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
	return (
		<button
			onClick={onClick}
			className={cx(
				"flex items-center gap-1 rounded-full border px-2 py-[3px] font-display text-[9px] uppercase tracking-[0.14em] transition-colors",
				active ? "border-brass-500/60 bg-brass-500/15 text-brass-400" : "border-white/10 text-chalk/40 hover:text-chalk/70",
			)}
		>
			{icon}
			{label}
		</button>
	);
}

/* ══════════════════════════ АВТОРАСЧЁТ ══════════════════════════ */

export function SolverPanel({
	progress,
	solving,
	iters,
	setIters,
	timeMode,
	setTimeMode,
	useSeed,
	setUseSeed,
	onRun,
	onStop,
	onFallback,
	solved,
}: {
	progress: Progress | null;
	solving: boolean;
	iters: number;
	setIters: (n: number) => void;
	timeMode: boolean;
	setTimeMode: (v: boolean) => void;
	useSeed: boolean;
	setUseSeed: (v: boolean) => void;
	onRun: () => void;
	onStop: () => void;
	onFallback: () => void;
	solved: boolean;
}) {
	return (
		<Panel
			title="АВТОРАСЧЁТ МАРШРУТА"
			right={
				solved ? (
					<span className="mono rounded bg-[#7ee2a8]/15 px-1.5 text-[10px] text-[#7ee2a8]">route ok</span>
				) : (
					<span className="mono text-[10px] text-chalk/35">не решается аналитически</span>
				)
			}
		>
			<div className="flex gap-1.5">
				<Btn variant="solid" onClick={onRun} disabled={solving} className="flex-1 !py-1.5">
					{solving ? <Sparkles size={12} className="animate-spin" /> : <Target size={12} />}
					{solving ? "считаю…" : "рассчитать"}
				</Btn>
				<Btn onClick={onStop} disabled={!solving} className="!py-1.5" title="Остановить">
					<X size={13} />
				</Btn>
				<Btn onClick={onFallback} className="!py-1.5" title="Только геометрический черновик, без полировки">
					<SkipBack size={13} />
				</Btn>
			</div>
			<div className="mt-2 h-[6px] overflow-hidden rounded-full bg-black/50">
				<div
					className={cx("h-full rounded-full transition-[width] duration-200", solving && "sweep")}
					style={{
						width: `${Math.min(100, progress ? (progress.iter / Math.max(1, iters)) * 100 : 0)}%`,
						background: "linear-gradient(90deg,#ffd166,#ffb703,#f4623a)",
					}}
				/>
			</div>
			<div className="mono mt-1 flex items-center justify-between text-[10px] text-chalk/55">
				<span>{progress ? `${progress.phase} · ит. ${progress.iter}` : "готов к запуску"}</span>
				<span>{progress ? `${progress.evals} прогонов` : ""}</span>
			</div>
			<div className="mt-1.5 grid grid-cols-2 gap-1.5">
				<Stat label="стоимость" value={progress && Number.isFinite(progress.cost) ? progress.cost.toFixed(2) : "—"} accent="#48cae4" />
				<Stat
					label="время финиша"
					value={progress && Number.isFinite(progress.time) ? `${progress.time.toFixed(2)}с` : "—"}
					accent="#ffd166"
				/>
			</div>
			<div className="mt-2">
				<Slider label="итераций полировки" digits={0} min={6} max={140} step={1} value={iters} onChange={(v) => setIters(Math.round(v))} knob="#8ecf6f" />
			</div>
			<div className="mt-1.5 flex flex-col gap-1">
				<Tick checked={timeMode} onChange={() => setTimeMode(!timeMode)} label="подбирать время удара (t)" />
				<Tick checked={useSeed} onChange={() => setUseSeed(!useSeed)} label="стартовать от моего плана, а не с нуля" />
			</div>
			<p className="mt-1.5 text-[10px] leading-snug text-chalk/40">
				Этап 1 — геометрия: для каждого ребра строится точка касания <span className="mono">C = Ш₁ − d·2r</span>, назначается ближайший
				биток, перебором уточняются угол → сила → t. Этап 2 — численная полировка: градиентный спуск на конечных разностях +
				координатный спуск + отжиг Метрополиса. Каждое улучшение сразу пересчитывает траектории.
			</p>
		</Panel>
	);
}

function Tick({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
	return (
		<button onClick={onChange} className="group flex items-center gap-2 text-left">
			<span
				className={cx(
					"flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition-colors",
					checked ? "border-brass-500 bg-brass-500 text-[#10240f]" : "border-white/25 text-transparent group-hover:border-white/50",
				)}
			>
				<Check size={10} strokeWidth={3} />
			</span>
			<span className={cx("text-[11px] transition-colors", checked ? "text-chalk" : "text-chalk/55 group-hover:text-chalk/80")}>{label}</span>
		</button>
	);
}

/* ══════════════════════════ МЕТРИКИ + СОБЫТИЯ ══════════════════════════ */

export function MetricsPanel({ res, best, maxTime }: { res: SimResult | null; best: number | null; maxTime: number }) {
	if (!res) return null;
	const dur = res.duration;
	const ok = res.solved;
	const checks = [
		{ ok: Number.isFinite(res.firstContact), label: "биток попал по шару 1", note: Number.isFinite(res.firstContact) ? `${res.firstContact.toFixed(2)}с` : "нет контакта" },
		...res.passed.map((p, i) => ({
			ok: !Number.isNaN(p),
			label: `шар 1 прошёл К-${i + 1}${i === 3 ? " (финиш)" : ""}`,
			note: !Number.isNaN(p) ? `${p.toFixed(2)}с` : `мимо · бл. ${Number.isFinite(res.nearest[i]) ? res.nearest[i].toFixed(2) : "—"}м`,
		})),
		{ ok: ok && res.finishAt <= maxTime, label: "укладывается в лимит", note: `${res.finishAt.toFixed(2)} / ${maxTime.toFixed(1)}с` },
	];
	return (
		<Panel
			title="ЗАМЕРЫ"
			right={
				<span className={cx("mono rounded px-1.5 text-[10px]", ok ? "bg-[#7ee2a8]/15 text-[#7ee2a8]" : "bg-clay/15 text-clay")}>
					{ok ? "route complete" : "маршрут не пройден"}
				</span>
			}
		>
			<div className="grid grid-cols-3 gap-1.5">
				<Stat label="финиш" value={Number.isFinite(res.finishAt) ? res.finishAt.toFixed(2) : "—"} sub="секунд" accent="#ffd166" />
				<Stat label="рекорд" value={best ? best.toFixed(2) : "—"} sub="ваш лучший" accent="#8ecf6f" />
				<Stat label="контактов" value={res.contacts} sub={`длит. ${dur.toFixed(2)}с`} accent="#48cae4" />
			</div>
			<div className="mt-2 grid grid-cols-4 gap-1">
				{res.passed.map((p, i) => (
					<div key={i} className="rounded border border-white/8 bg-black/25 px-1 py-1 text-center">
						<div className="eyebrow text-[8px]" style={{ color: CP_COLORS[i] }}>
							leg {i + 1}
						</div>
						<div className="mono text-[11px] text-chalk/85">
							{Number.isNaN(p) ? "—" : i === 0 ? p.toFixed(2) : (p - res.passed[i - 1]).toFixed(2)}
						</div>
					</div>
				))}
			</div>
			<div className="mt-2">
				<div className="eyebrow mb-0.5">Проверки (как в unit-тестах)</div>
				{checks.map((c, i) => (
					<CheckBox key={i} ok={c.ok} label={c.label} note={c.note} />
				))}
			</div>
			<div className="mt-2">
				<div className="eyebrow mb-1">Журнал событий</div>
				<div className="scroll max-h-[128px] overflow-y-auto rounded border border-white/8 bg-black/30 p-1">
					{res.events.length === 0 ? (
						<div className="p-1 text-[10px] text-chalk/30">пусто — добавьте удары</div>
					) : (
						res.events
							.slice(-70)
							.reverse()
							.map((e, i) => (
								<div key={i} className="mono flex items-center gap-2 border-b border-white/5 px-1 py-[2px] text-[10px] last:border-0">
									<span className="text-brass-400">{e.t.toFixed(2)}с</span>
									<span className="text-chalk/70">{evLabel(e)}</span>
									{e.imp !== undefined ? <span className="ml-auto text-chalk/35">J={e.imp.toFixed(2)}</span> : null}
								</div>
							))
					)}
				</div>
			</div>
		</Panel>
	);
}

function evLabel(e: { type: string; a: number; b: number; label?: string }) {
	const names: Record<string, string> = {
		shot: "удар",
		contact: "касание",
		cushion: "борт",
		checkpoint: e.label ?? "К",
		finish: "ФИНИШ",
		rest: "шары в покое",
		foul: "фол",
	};
	if (e.type === "contact") return `шары ${e.a}–${e.b}`;
	return names[e.type] ?? e.type;
}

/* ══════════════════════════ ТАЙМЛАЙН ══════════════════════════ */

export function Timeline({
	t,
	setT,
	duration,
	playing,
	setPlaying,
	speed,
	setSpeed,
	marks,
	onStep,
}: {
	t: number;
	setT: (v: number) => void;
	duration: number;
	playing: boolean;
	setPlaying: (v: boolean) => void;
	speed: number;
	setSpeed: (v: number) => void;
	marks: { t: number; color: string; label: string }[];
	onStep: (d: number) => void;
}) {
	const k = duration > 0 ? Math.min(1, t / duration) : 0;
	return (
		<div className="panel flex items-center gap-2.5 rounded-md px-2.5 py-2">
			<div className="flex items-center gap-1">
				<Btn onClick={() => setT(0)} title="в начало">
					<SkipBack size={13} />
				</Btn>
				<Btn variant="solid" onClick={() => setPlaying(!playing)} title="проиграть/пауза" className="!px-2.5">
					{playing ? <Pause size={14} /> : <Play size={14} />}
				</Btn>
				<Btn onClick={() => onStep(1)} title="кадр вперёд (.)">
					<Timer size={13} />
				</Btn>
			</div>
			<div className="mono w-[92px] shrink-0 text-[12px] text-chalk/85">
				t = <span style={{ color: timeColor(k) }}>{t.toFixed(2)}</span>
				<span className="text-chalk/35">/{duration.toFixed(2)}с</span>
			</div>
			<div className="relative flex-1">
				<div
					className="pointer-events-none absolute top-1/2 h-[5px] w-full -translate-y-1/2 rounded-full"
					style={{
						background: `linear-gradient(90deg, ${Array.from({ length: 12 }, (_u, i) => timeColor(i / 11)).join(",")})`,
						opacity: 0.85,
					}}
				/>
				<div className="pointer-events-none absolute -top-1 left-0 right-0 h-2">
					{marks.map((m, i) => (
						<div
							key={i}
							className="absolute -top-1 flex -translate-x-1/2 flex-col items-center"
							style={{ left: `${(m.t / Math.max(0.001, duration)) * 100}%` }}
							title={`${m.label} · ${m.t.toFixed(2)}с`}
						>
							<span className="h-3 w-[2px]" style={{ background: m.color }} />
						</div>
					))}
				</div>
				<input
					className="bare relative"
					type="range"
					min={0}
					max={Math.max(0.01, duration)}
					step={1 / 240}
					value={t}
					onChange={(e) => {
						setPlaying(false);
						setT(parseFloat(e.target.value));
					}}
				/>
			</div>
			<div className="w-[168px] shrink-0">
				<Seg
					size="sm"
					value={String(speed)}
					onChange={(v) => setSpeed(parseFloat(v))}
					options={[
						{ v: "0.15", label: "0.15×" },
						{ v: "0.5", label: "0.5×" },
						{ v: "1", label: "1×" },
						{ v: "4", label: "4×" },
					]}
				/>
			</div>
		</div>
	);
}

/* ══════════════════════════ РЕАЛТАЙМ ══════════════════════════ */

export function LivePanel({
	live,
	onStart,
	onPause,
	onReset,
	human,
	running,
	solved,
}: {
	live: LiveEngine | null;
	onStart: () => void;
	onPause: () => void;
	onReset: () => void;
	human: number;
	running: boolean;
	solved: boolean;
}) {
	return (
		<Panel title="РЕАЛТАЙМ · ВЫ ИГРАЕТЕ ЗА ЭТОГО ИГРОКА">
			<div className="flex items-center gap-1.5">
				<Btn variant="solid" onClick={running ? onPause : onStart} className="flex-1 !py-1.5">
					{running ? <Pause size={13} /> : <Play size={13} />} {running ? "пауза" : solved ? "заново" : "пуск"}
				</Btn>
				<Btn onClick={onReset} className="!py-1.5" title="Сбросить расстановку">
					<RotateCcw size={13} />
				</Btn>
			</div>
			<div className="mono mt-2 grid grid-cols-2 gap-1.5 text-[10px] text-chalk/60">
				<div className="rounded border border-white/8 bg-black/25 px-2 py-1">
					таймер: <span className="text-[13px] text-chalk">{live ? live.t.toFixed(2) : "0.00"}с</span>
				</div>
				<div className="rounded border border-white/8 bg-black/25 px-2 py-1">
					следующая:{" "}
					<span className="text-[13px]" style={{ color: CP_COLORS[Math.min(human >= 0 ? live?.nextCp ?? 0 : 0, 3)] }}>
						{live ? `К-${live.nextCp + 1}` : "К-1"}
					</span>
				</div>
			</div>
			<div className="mt-2 rounded border border-brass-500/25 bg-brass-500/8 p-2 text-[10px] leading-snug text-chalk/70">
				<div className="eyebrow mb-1 text-brass-400">правила</div>
				Кий прижимается только к <b>своему</b> битку — по шару 1 бить нельзя, он идёт с битков. Наведение — курсором от
				вашего битка, <b>удержание ЛКМ</b> — набор силы, отпускание — удар. Пробел — тоже удар. Остальные трое играют
				своими стратегиями.
			</div>
			<div className="mt-2 flex flex-wrap gap-1">
				{PLAYERS.map((pl) => (
					<button
						key={pl.id}
						onClick={() => onStart}
						className="mono rounded border border-white/10 px-1.5 py-[2px] text-[9px] text-chalk/55 hover:border-white/30"
					>
						<span style={{ color: pl.color }}>P{pl.id + 1}</span> {pl.bot}
					</button>
				))}
			</div>
		</Panel>
	);
}
