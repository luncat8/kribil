import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bot, ChevronDown, CircleHelp, Gauge, Hand, MousePointer2, Pause, Play, RotateCcw, Settings2, Sparkles, Zap } from "lucide-react";
import { closestSnapshot, defaultBalls, defaultCheckpoints, defaultShots, simulate, TABLE, type Ball, type Checkpoint, type Shot } from "./physics";

type Tool = "move" | "shot";
type GameMode = "planner" | "realtime";
type BotStyle = "precise" | "sprinter" | "safe";

const DURATION = 18;
const playerColors = ["#efc94c", "#ff7657", "#65d2bb", "#8aa5ff"];
const fmt = (value: number) => value.toFixed(2).replace(".", ",");
const initialBalls = (radius = 14, mass = 1) => defaultBalls(radius, mass);

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: string; kind: "ball" | "checkpoint" } | null>(null);
  const [balls, setBalls] = useState<Ball[]>(() => initialBalls());
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(defaultCheckpoints);
  const [shots, setShots] = useState<Shot[]>(defaultShots);
  const [tool, setTool] = useState<Tool>("move");
  const [mode, setMode] = useState<GameMode>("planner");
  const [selected, setSelected] = useState("cue-1");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [friction, setFriction] = useState(0.12);
  const [mass, setMass] = useState(1);
  const [radius, setRadius] = useState(14);
  const [placementMode, setPlacementMode] = useState<"free" | "fixed">("free");
  const [botStyle, setBotStyle] = useState<BotStyle>("precise");
  const [optimizing, setOptimizing] = useState(false);
  const [showPhysics, setShowPhysics] = useState(false);

  const result = useMemo(() => simulate(balls, checkpoints, shots, friction, DURATION, 1 / 80), [balls, checkpoints, shots, friction]);
  const snapshot = useMemo(() => closestSnapshot(result, time), [result, time]);
  const selectedPlayer = selected.startsWith("cue-") ? Number(selected.split("-")[1]) : 1;
  const selectedShot = shots.find((shot) => shot.player === selectedPlayer) ?? shots[0];
  const reached = snapshot.checkpointIndex;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      setTime((current) => {
        const next = current + delta;
        if (next >= DURATION) { setPlaying(false); return DURATION; }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = TABLE.width * dpr;
    canvas.height = TABLE.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    drawTable(ctx, result.snapshots, snapshot.balls, checkpoints, reached, shots, selected, tool, time);
  }, [result, snapshot, checkpoints, reached, shots, selected, tool, time]);

  const updateShot = (patch: Partial<Shot>) => setShots((current) => current.map((shot) => shot.player === selectedPlayer ? { ...shot, ...patch } : shot));
  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * TABLE.width / bounds.width, y: (event.clientY - bounds.top) * TABLE.height / bounds.height };
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointerPosition(event);
    const visibleBalls = time === 0 ? balls : snapshot.balls;
    const ball = [...visibleBalls].reverse().find((item) => Math.hypot(item.position.x - point.x, item.position.y - point.y) <= item.radius + 10);
    const checkpoint = checkpoints.find((item) => Math.hypot(item.position.x - point.x, item.position.y - point.y) <= item.radius + 8);
    if (ball) {
      setSelected(ball.id);
      if (tool === "move" && time === 0) dragRef.current = { id: ball.id, kind: "ball" };
    } else if (checkpoint) {
      setSelected(`checkpoint-${checkpoint.id}`);
      if (tool === "move") dragRef.current = { id: String(checkpoint.id), kind: "checkpoint" };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const point = pointerPosition(event);
    if (dragRef.current.kind === "ball") {
      setBalls((current) => current.map((ball) => ball.id === dragRef.current?.id ? { ...ball, position: { x: Math.max(radius, Math.min(TABLE.width - radius, point.x)), y: Math.max(radius, Math.min(TABLE.height - radius, point.y)) } } : ball));
    } else {
      setCheckpoints((current) => current.map((checkpoint) => String(checkpoint.id) === dragRef.current?.id ? { ...checkpoint, position: point } : checkpoint));
    }
  };

  const autoPlan = () => {
    setOptimizing(true);
    window.setTimeout(() => {
      const presets: Record<BotStyle, Shot[]> = {
        precise: [
          { player: 1, time: 0.35, angle: -0.34, power: 8.3 }, { player: 2, time: 4.25, angle: -1.02, power: 7.2 },
          { player: 3, time: 7.9, angle: -1.32, power: 7.6 }, { player: 4, time: 11.4, angle: -2.28, power: 6.6 },
        ],
        sprinter: defaultShots.map((shot, index) => ({ ...shot, time: Math.max(0.2, shot.time - index * 0.65), power: shot.power * 1.2 })),
        safe: defaultShots.map((shot, index) => ({ ...shot, time: shot.time + index * 0.8, power: shot.power * 0.86 })),
      };
      const seed = presets[botStyle];
      let best = seed;
      let bestScore = -Infinity;
      const iterations = botStyle === "precise" ? 72 : 48;

      // Collision events are non-smooth, so a bounded derivative-free search is more stable than raw gradient descent.
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const spread = 1 - iteration / iterations;
        const candidate = seed.map((shot) => ({
          ...shot,
          angle: shot.angle + (Math.random() - .5) * .42 * spread,
          power: Math.max(1, Math.min(12, shot.power + (Math.random() - .5) * 2.4 * spread)),
          time: Math.max(.1, Math.min(DURATION - .5, shot.time + (Math.random() - .5) * 1.4 * spread)),
        }));
        const trial = simulate(balls, checkpoints, candidate, friction, DURATION, 1 / 35);
        const last = trial.snapshots[trial.snapshots.length - 1];
        const target = last.balls.find((ball) => ball.kind === "target")!;
        const nextPoint = checkpoints[Math.min(last.checkpointIndex, checkpoints.length - 1)];
        const remainingDistance = Math.hypot(target.position.x - nextPoint.position.x, target.position.y - nextPoint.position.y);
        const finishBias = botStyle === "sprinter" ? 2 : botStyle === "safe" ? .6 : 1;
        const score = last.checkpointIndex * 10000 - remainingDistance - (trial.finishTime ?? DURATION) * finishBias;
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
      setShots(best);
      if (placementMode === "free") setBalls(initialBalls(radius, mass));
      setTime(0);
      setOptimizing(false);
    }, 650);
  };
  const reset = () => {
    setBalls(initialBalls()); setCheckpoints(defaultCheckpoints); setShots(defaultShots); setFriction(0.12);
    setMass(1); setRadius(14); setTime(0); setPlaying(false);
  };
  const updateBallProperties = (nextMass: number, nextRadius: number) => {
    setMass(nextMass); setRadius(nextRadius);
    setBalls((current) => current.map((ball) => ({ ...ball, mass: nextMass, radius: nextRadius })));
  };

  return (
    <div className="min-h-screen bg-[#efeee9] text-[#20231f]">
      <header className="flex h-16 items-center border-b border-black/10 bg-[#f7f6f2] px-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="brand-mark">K</div>
          <div><div className="flex items-baseline gap-2"><h1 className="font-display text-xl font-bold tracking-tight">КРИБИЛ</h1><span className="hidden text-[10px] font-bold uppercase tracking-[.22em] text-black/40 sm:inline">Cue Crew</span></div><p className="hidden text-[11px] text-black/45 sm:block">Тактический симулятор командного бильярда</p></div>
        </div>
        <div className="mx-auto hidden rounded-lg bg-black/[.055] p-1 md:flex">
          <button className={`nav-tab ${mode === "planner" ? "active" : ""}`} onClick={() => setMode("planner")}><Settings2 size={14} /> Планировщик</button>
          <button className={`nav-tab ${mode === "realtime" ? "active" : ""}`} onClick={() => setMode("realtime")}><Play size={14} /> Играть вживую</button>
        </div>
        <div className="ml-auto flex items-center gap-2"><button className="icon-button" onClick={reset} title="Сбросить"><RotateCcw size={17} /></button><button className="icon-button" onClick={() => setShowPhysics((value) => !value)} title="О физике"><CircleHelp size={18} /></button><div className="ml-1 hidden h-8 w-8 items-center justify-center rounded-full bg-[#263b34] text-[11px] font-bold text-white sm:flex">AK</div></div>
      </header>

      <main className="grid min-h-[calc(100vh-64px)] grid-cols-1 xl:grid-cols-[248px_minmax(600px,1fr)_302px]">
        <motion.aside initial={{ x: -18, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="order-2 border-r border-black/10 bg-[#f7f6f2] px-4 py-5 xl:order-1">
          <SectionTitle index="01" title="Режим расстановки" />
          <div className="segmented mb-6"><button className={placementMode === "free" ? "active" : ""} onClick={() => setPlacementMode("free")}>Свободный</button><button className={placementMode === "fixed" ? "active" : ""} onClick={() => setPlacementMode("fixed")}>Фиксированный</button></div>
          <p className="mb-7 text-xs leading-relaxed text-black/48">{placementMode === "free" ? "Битки можно переставить после фиксации маршрута. Время установки входит в результат." : "Битки и точки фиксируются до начала игры."}</p>
          <SectionTitle index="02" title="Команда" />
          <div className="mb-7 space-y-1.5">
            {[1, 2, 3, 4].map((player) => { const shot = shots.find((item) => item.player === player)!; return (
              <button key={player} onClick={() => setSelected(`cue-${player}`)} className={`player-row ${selected === `cue-${player}` ? "active" : ""}`}>
                <span className="ball-dot" style={{ background: playerColors[player - 1] }}>{player}</span><span className="min-w-0 flex-1 text-left"><b>Игрок {player}</b><small>{fmt(shot.time)} с · {fmt(shot.power)} Н</small></span><span className="text-black/30">{selected === `cue-${player}` ? "●" : "○"}</span>
              </button>); })}
          </div>
          <SectionTitle index="03" title="Инструмент" />
          <div className="grid grid-cols-2 gap-2"><button className={`tool-button ${tool === "move" ? "active" : ""}`} onClick={() => setTool("move")}><Hand size={17} /> Перемещение</button><button className={`tool-button ${tool === "shot" ? "active" : ""}`} onClick={() => setTool("shot")}><MousePointer2 size={17} /> Удар</button></div>
          <p className="mt-3 text-[11px] leading-relaxed text-black/42">Выберите шар или точку на столе. Перетаскивайте в режиме перемещения.</p>
        </motion.aside>

        <section className="order-1 flex min-w-0 flex-col px-3 py-4 sm:px-6 sm:py-5 xl:order-2">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div><p className="mb-1 text-[10px] font-bold uppercase tracking-[.2em] text-[#bd6246]">Сессия 07 / Маршрут A</p><h2 className="font-display text-2xl font-bold tracking-tight">Траектория команды</h2></div>
            <div className="flex items-center gap-4 text-xs"><span><b className="text-base">{reached}</b><span className="text-black/40"> / 4 точки</span></span><span className="h-7 w-px bg-black/10" /><span><b className="text-base tabular-nums">{fmt(time)}</b><span className="text-black/40"> сек</span></span></div>
          </div>
          <motion.div initial={{ opacity: 0, scale: .985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .45 }} className="table-shell">
            <canvas ref={canvasRef} className={`block aspect-[1000/560] w-full touch-none ${tool === "move" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { dragRef.current = null; }} />
          </motion.div>
          <div className="mt-4 border-t border-black/10 pt-4">
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-black/45"><span>00:00</span><span>Шкала времени</span><span>00:{DURATION}</span></div>
            <div className="timeline-wrap"><input aria-label="Время анимации" type="range" min="0" max={DURATION} step="0.01" value={time} onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); }} />{shots.map((shot, index) => <span key={shot.player} className="shot-tick" style={{ left: `${shot.time / DURATION * 100}%`, background: playerColors[index] }} />)}</div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2"><button className="play-button" onClick={() => { if (time >= DURATION) setTime(0); setPlaying((value) => !value); }}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><button className="secondary-button" onClick={() => { setTime(0); setPlaying(false); }}><RotateCcw size={14} /> В начало</button></div>
              <div className="legend"><span className="legend-line" /> Цвет траектории = время <span className="ml-2 text-black/30">0 с → {DURATION} с</span></div>
            </div>
          </div>
        </section>

        <motion.aside initial={{ x: 18, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="order-3 border-l border-black/10 bg-[#f7f6f2] px-5 py-5">
          {selected.startsWith("checkpoint") ? <CheckpointEditor selected={selected} checkpoints={checkpoints} setCheckpoints={setCheckpoints} /> : <>
            <SectionTitle index="04" title={`Удар игрока ${selectedPlayer}`} />
            <div className="shot-visual"><div className="aim-line" style={{ transform: `rotate(${selectedShot.angle}rad)` }}><span /></div><div className="mini-ball" style={{ background: playerColors[selectedPlayer - 1] }}>{selectedPlayer}</div></div>
            <RangeControl label="Сила" value={selectedShot.power} min={1} max={12} step={0.1} unit="Н" onChange={(power) => updateShot({ power })} />
            <RangeControl label="Направление" value={selectedShot.angle * 180 / Math.PI} min={-180} max={180} step={1} unit="°" onChange={(angle) => updateShot({ angle: angle * Math.PI / 180 })} />
            <RangeControl label="Время удара" value={selectedShot.time} min={0} max={DURATION} step={0.05} unit="с" onChange={(shotTime) => updateShot({ time: shotTime })} />
            {mode === "realtime" && <button className="live-hit" onClick={() => updateShot({ time })}><Zap size={15} /> Ударить сейчас · {fmt(time)} с</button>}
          </>}
          <div className="my-6 h-px bg-black/10" /><SectionTitle index="05" title="Физика" />
          <RangeControl label="Масса шаров" value={mass} min={0.5} max={2} step={0.05} unit="кг" onChange={(value) => updateBallProperties(value, radius)} />
          <RangeControl label="Трение сукна" value={friction} min={0} max={0.35} step={0.01} unit="μ" onChange={setFriction} />
          <RangeControl label="Радиус шаров" value={radius} min={9} max={20} step={1} unit="мм" onChange={(value) => updateBallProperties(mass, value)} />
          <div className="my-6 h-px bg-black/10" /><SectionTitle index="06" title="Автопланировщик" />
          <label className="select-label">Стратегия NPC</label><div className="select-wrap"><Bot size={15} /><select value={botStyle} onChange={(event) => setBotStyle(event.target.value as BotStyle)}><option value="precise">Архитектор · точность</option><option value="sprinter">Спринтер · скорость</option><option value="safe">Страховщик · надежность</option></select><ChevronDown size={14} /></div>
          <button className="optimize-button" onClick={autoPlan} disabled={optimizing}><Sparkles size={16} /> {optimizing ? "Считаем импульсы..." : "Рассчитать маршрут"}</button>
          <p className="mt-2 text-[10px] leading-relaxed text-black/42">Численный поиск минимизирует время и штрафы за пропуск точек. Полная симуляция ограничена {DURATION} секундами.</p>
        </motion.aside>
      </main>

      {showPhysics && <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/35 p-5" onClick={() => setShowPhysics(false)}><motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="max-w-lg bg-[#f7f6f2] p-7 shadow-2xl" onClick={(event) => event.stopPropagation()}><Gauge className="mb-5 text-[#bd6246]" /><h3 className="font-display text-2xl font-bold">Почему не аналитически?</h3><p className="mt-3 text-sm leading-6 text-black/60">Из-за последовательных столкновений, бортов, трения и ограничений задача кусочно-нелинейная. Градиентный спуск возможен, но чувствителен к моментам контакта. Практичнее сочетать стохастический поиск, CMA-ES или дифференциальную эволюцию с точной прямой симуляцией.</p><button className="secondary-button mt-6" onClick={() => setShowPhysics(false)}>Понятно</button></motion.div></div>}
    </div>
  );
}

function SectionTitle({ index, title }: { index: string; title: string }) {
  return <div className="mb-3 flex items-center gap-2"><span className="text-[9px] font-bold text-[#bd6246]">{index}</span><h3 className="text-[11px] font-bold uppercase tracking-[.14em]">{title}</h3></div>;
}

function RangeControl({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void }) {
  return <label className="mb-4 block"><span className="mb-2 flex items-center justify-between text-xs"><span className="text-black/55">{label}</span><b className="tabular-nums">{fmt(value)} {unit}</b></span><input className="control-range" type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function CheckpointEditor({ selected, checkpoints, setCheckpoints }: { selected: string; checkpoints: Checkpoint[]; setCheckpoints: React.Dispatch<React.SetStateAction<Checkpoint[]>> }) {
  const id = Number(selected.split("-")[1]);
  const checkpoint = checkpoints.find((item) => item.id === id) ?? checkpoints[0];
  return <><SectionTitle index="04" title={`Контрольная точка ${checkpoint.id}`} /><div className="mb-5 flex h-24 items-center justify-center bg-[#e9e6de]"><div className="flex items-center justify-center rounded-full border-2 border-dashed border-[#e9ae4f] text-sm font-bold" style={{ width: checkpoint.radius * 1.4, height: checkpoint.radius * 1.4 }}>{checkpoint.id}</div></div><RangeControl label="Размер области" value={checkpoint.radius} min={22} max={70} step={1} unit="мм" onChange={(radius) => setCheckpoints((items) => items.map((item) => item.id === id ? { ...item, radius } : item))} /><p className="text-[11px] leading-relaxed text-black/45">Игровой шар должен пересечь область после предыдущей точки маршрута.</p></>;
}

function drawTable(ctx: CanvasRenderingContext2D, snapshots: ReturnType<typeof simulate>["snapshots"], balls: Ball[], checkpoints: Checkpoint[], reached: number, shots: Shot[], selected: string, tool: Tool, time: number) {
  ctx.clearRect(0, 0, TABLE.width, TABLE.height); ctx.fillStyle = "#193f37"; ctx.fillRect(0, 0, TABLE.width, TABLE.height);
  ctx.strokeStyle = "rgba(255,255,255,.025)"; ctx.lineWidth = 1;
  for (let x = 16; x < TABLE.width; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, TABLE.height); ctx.stroke(); }
  for (let y = 16; y < TABLE.height; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TABLE.width, y); ctx.stroke(); }
  ctx.setLineDash([7, 8]); ctx.strokeStyle = "rgba(255,255,255,.23)"; ctx.lineWidth = 2; ctx.beginPath();
  checkpoints.forEach((checkpoint, index) => index === 0 ? ctx.moveTo(checkpoint.position.x, checkpoint.position.y) : ctx.lineTo(checkpoint.position.x, checkpoint.position.y)); ctx.stroke(); ctx.setLineDash([]);
  checkpoints.forEach((checkpoint, index) => {
    const active = index < reached; ctx.beginPath(); ctx.arc(checkpoint.position.x, checkpoint.position.y, checkpoint.radius, 0, Math.PI * 2); ctx.fillStyle = active ? "rgba(238,197,79,.22)" : "rgba(238,197,79,.08)"; ctx.fill();
    ctx.strokeStyle = active ? "#f4d26b" : "rgba(244,210,107,.65)"; ctx.lineWidth = selected === `checkpoint-${checkpoint.id}` ? 3 : 1.5; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#f5df9a"; ctx.font = "700 12px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(checkpoint.id), checkpoint.position.x, checkpoint.position.y);
  });
  const ids = snapshots[0]?.balls.map((ball) => ball.id) ?? [];
  ids.forEach((id, ballIndex) => {
    const stride = 4;
    for (let i = 0; i < snapshots.length - stride; i += stride) {
      const a = snapshots[i].balls.find((ball) => ball.id === id); const b = snapshots[i + stride].balls.find((ball) => ball.id === id);
      if (!a || !b || Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) < .5) continue;
      const progress = snapshots[i].time / DURATION; ctx.beginPath(); ctx.moveTo(a.position.x, a.position.y); ctx.lineTo(b.position.x, b.position.y);
      ctx.strokeStyle = ballIndex === 0 ? `hsla(${45 - progress * 30},90%,65%,.72)` : `hsla(${170 + progress * 65},70%,70%,.28)`; ctx.lineWidth = ballIndex === 0 ? 2.5 : 1.3; ctx.stroke();
    }
  });
  balls.forEach((ball) => {
    if (ball.id === selected) { ctx.beginPath(); ctx.arc(ball.position.x, ball.position.y, ball.radius + 7, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 2; ctx.stroke(); }
    const gradient = ctx.createRadialGradient(ball.position.x - 5, ball.position.y - 6, 2, ball.position.x, ball.position.y, ball.radius + 2);
    if (ball.kind === "target") { gradient.addColorStop(0, "#fff"); gradient.addColorStop(.7, "#f3eee0"); gradient.addColorStop(1, "#bcb7a9"); } else { const color = playerColors[(ball.player ?? 1) - 1]; gradient.addColorStop(0, "#fff8"); gradient.addColorStop(.25, color); gradient.addColorStop(1, "#172621"); }
    ctx.beginPath(); ctx.arc(ball.position.x, ball.position.y, ball.radius, 0, Math.PI * 2); ctx.fillStyle = gradient; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = ball.kind === "target" ? "#26312d" : "#fff"; ctx.font = "700 10px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ball.kind === "target" ? "Ш1" : String(ball.player), ball.position.x, ball.position.y + .5);
  });
  if (tool === "shot" && selected.startsWith("cue")) {
    const cue = balls.find((ball) => ball.id === selected); const shot = shots.find((item) => item.player === Number(selected.split("-")[1]));
    if (cue && shot) { ctx.beginPath(); ctx.moveTo(cue.position.x, cue.position.y); ctx.lineTo(cue.position.x + Math.cos(shot.angle) * shot.power * 15, cue.position.y + Math.sin(shot.angle) * shot.power * 15); ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 2; ctx.stroke(); }
  }
  ctx.fillStyle = "rgba(255,255,255,.65)"; ctx.font = "600 10px Arial"; ctx.textAlign = "left"; ctx.fillText(`t = ${fmt(time)} с`, 18, 24);
}