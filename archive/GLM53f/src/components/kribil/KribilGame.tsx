'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import TableCanvas, { type PointerPhase } from './TableCanvas';
import PlannerPanel from './PlannerPanel';
import RealtimePanel, { type RtPlayerStatus } from './RealtimePanel';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  defaultSetup,
  defaultShots,
  heuristicShots,
  randomizeCheckpoints,
} from '@/lib/kribil/setup';
import { simulate, frameAt, trailFromFrames } from '@/lib/kribil/simulate';
import { createCemSession } from '@/lib/kribil/solver';
import {
  createBankerBot,
  createRusherBot,
  createSniperBot,
  createTacticianBot,
} from '@/lib/kribil/bots';
import { LiveGame, startPositions } from '@/lib/kribil/live';
import { resultFromWorld } from '@/lib/kribil/world';
import type { Scene } from '@/lib/kribil/renderer';
import type { BallId, KribilSetup, ShotSpec, SimEvent, SimResult, Vec2 } from '@/lib/kribil/types';
import { angleOf, clamp, sub } from '@/lib/kribil/vec';
import { useLatestRef } from '@/hooks/use-latest-ref';
import { Info, Play, RotateCcw, Timer, Trophy } from 'lucide-react';

type Mode = 'planner' | 'realtime';
type Bot = ReturnType<typeof createSniperBot>;

const BEST_KEY = 'kribil-best-time';
const mapPower = (d: number) => 60 + clamp((d - 20) / 200, 0, 1) * 1340;

// Рекорд — внешний стор (localStorage) для useSyncExternalStore
const bestListeners = new Set<() => void>();
function subscribeBest(cb: () => void) {
  bestListeners.add(cb);
  return () => {
    bestListeners.delete(cb);
  };
}
function getBestSnapshot(): number | null {
  const raw = localStorage.getItem(BEST_KEY);
  const v = raw == null ? NaN : Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}
function getServerBest(): number | null {
  return null;
}

interface PlayState {
  frames: SimResult['frames'];
  duration: number;
  t0: number;
  simTime: number;
  cpTimes: (number | null)[];
}

export default function KribilGame() {
  const [mode, setMode] = useState<Mode>('planner');
  const [setup, setSetup] = useState<KribilSetup>(() => defaultSetup());
  const [ordered, setOrdered] = useState(true);
  const [shots, setShots] = useState<ShotSpec[]>(() => defaultShots());
  const [isDefaultLayout, setIsDefaultLayout] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [humanPlayer, setHumanPlayer] = useState(1);

  const fullSetup = useMemo(() => ({ ...setup, ordered }), [setup, ordered]);

  // планировщик
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [solving, setSolving] = useState<{ done: number; total: number; best: number | null } | null>(
    null
  );
  const playRef = useRef<PlayState | null>(null);
  const playingRef = useRef(false);

  // реалтайм
  const gameRef = useRef<LiveGame | null>(null);
  const botsRef = useRef<Array<{ player: number; bot: Bot }>>([]);
  const [rtStatuses, setRtStatuses] = useState<RtPlayerStatus[]>([]);
  const [rtResult, setRtResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);

  // HUD
  const [hudTime, setHudTime] = useState(0);
  const [hudCpPassed, setHudCpPassed] = useState<boolean[]>([false, false, false, false]);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const best = useSyncExternalStore(subscribeBest, getBestSnapshot, getServerBest);

  // refs для rAF и обработчиков
  const modeRef = useLatestRef(mode);
  const speedRef = useLatestRef(speed);
  const runningRef = useRef(false);
  const aimRef = useRef<{ player: number; angle: number; power: number } | null>(null);
  const humanRef = useLatestRef(humanPlayer);
  const setupRef = useLatestRef(fullSetup);
  const shotsRef = useLatestRef(shots);
  const selectedPlayerRef = useLatestRef(selectedPlayer);
  const solvingRef = useLatestRef(solving);
  const simResultRef = useLatestRef<SimResult | null>(simResult);

  const saveBest = (t: number) => {
    const prev = getBestSnapshot();
    if (prev == null || t < prev) {
      localStorage.setItem(BEST_KEY, String(t));
      bestListeners.forEach((l) => l());
    }
  };

  const clearPlayback = () => {
    playRef.current = null;
    playingRef.current = false;
    setPlaying(false);
  };

  const resetHud = () => {
    setEvents([]);
    setHudTime(0);
    setHudCpPassed([false, false, false, false]);
  };

  // ===== главный rAF-цикл =====
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (modeRef.current === 'realtime' && gameRef.current && runningRef.current) {
        const g = gameRef.current;
        g.advance(dt, speedRef.current, (api) => {
          for (const { player, bot } of botsRef.current) {
            if (api.world.time < bot.minFireTime) continue;
            if (api.firedPlayers.has(player)) continue;
            const my = api.world.balls.find((b) => b.id === ('p' + player) as BallId);
            const b1 = api.world.balls.find((b) => b.id === 'ball1');
            if (!my || !b1) continue;
            if (Math.abs(my.vel.x) + Math.abs(my.vel.y) > 1e-9) continue;
            const targets = api.world.ordered
              ? [api.world.checkpoints[api.world.passedCount]].filter(Boolean)
              : [...api.world.checkpoints]
                  .filter((_, i) => !api.world.cpPassed[i])
                  .sort(
                    (a, b) =>
                      Math.hypot(b1.pos.x - a.pos.x, b1.pos.y - a.pos.y) -
                      Math.hypot(b1.pos.x - b.pos.x, b1.pos.y - b.pos.y)
                  );
            const d = bot.decide({
              table: api.world.table,
              balls: api.world.balls,
              myBall: my,
              ball1: b1,
              targets,
              time: api.world.time,
            });
            if (d) api.fireShot(player, d.angle, d.power);
          }
        });
        if (now - lastHud > 100) {
          lastHud = now;
          const w = g.world;
          setHudTime(w.time);
          setHudCpPassed([...w.cpPassed]);
          setEvents(w.events.slice(-40).reverse());
          setRtStatuses((prev) =>
            prev.map((st) => ({ ...st, fired: g.firedPlayers.has(st.player) }))
          );
          if (w.done && runningRef.current) {
            runningRef.current = false;
            setRunning(false);
            const res = resultFromWorld(w);
            setRtResult(res);
            if (res.success && res.finishTime != null) {
              saveBest(res.finishTime);
              toast.success(`Финиш за ${res.finishTime.toFixed(2)} с!`);
            } else {
              toast.error(
                `Промах: пройдено ${res.passedCount}/4 КТ — ${
                  w.doneReason === 'timeout' ? 'вышло время' : 'шары остановились'
                }`
              );
            }
          }
        }
      } else if (modeRef.current === 'planner' && playRef.current && playingRef.current) {
        const p = playRef.current;
        p.simTime = ((now - p.t0) / 1000) * speedRef.current;
        if (p.simTime >= p.duration) {
          p.simTime = p.duration;
          playingRef.current = false;
          setPlaying(false);
        }
        if (now - lastHud > 100) {
          lastHud = now;
          setHudTime(p.simTime);
          setHudCpPassed(p.cpTimes.map((t) => t != null && t <= p.simTime));
          setEvents((simResultRef.current ?? { events: [] }).events.slice(-40).reverse());
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ===== планировщик =====
  const runPlan = (plan?: ShotSpec[]) => {
    const usePlan = plan ?? shotsRef.current;
    const res = simulate(setupRef.current, usePlan);
    setSimResult(res);
    clearPlayback();
    playRef.current = {
      frames: res.frames,
      duration: res.endTime,
      t0: performance.now(),
      simTime: 0,
      cpTimes: res.cpTimes,
    };
    playingRef.current = true;
    setPlaying(true);
    if (res.success && res.finishTime != null) {
      saveBest(res.finishTime);
      toast.success(`Финиш за ${res.finishTime.toFixed(2)} с`);
    } else {
      toast.error(`Промах: пройдено ${res.passedCount}/4 КТ`);
    }
  };

  const autoSolve = async () => {
    clearPlayback();
    const session = createCemSession(setupRef.current, shotsRef.current, {
      iterations: 14,
      population: 72,
      seed: 99 + Math.floor(Math.random() * 1000) * 7919,
    });
    const total = session.totalEvals;
    setSolving({ done: 0, total, best: null });
    while (!session.done) {
      session.runChunk(12);
      const bl = session.bestLoss;
      setSolving({ done: session.evaluations, total, best: bl != null && bl < 10000 ? bl : null });
      await new Promise((r) => setTimeout(r, 0));
    }
    const fin = session.finish();
    setSolving(null);
    setShots(fin.plan);
    runPlan(fin.plan);
  };

  const resetPlan = () => {
    setShots(isDefaultLayout ? defaultShots() : heuristicShots(setupRef.current));
    setSimResult(null);
    clearPlayback();
    resetHud();
  };

  const randomize = () => {
    const s = randomizeCheckpoints(setupRef.current);
    setSetup(s);
    setShots(heuristicShots(s));
    setIsDefaultLayout(false);
    setSimResult(null);
    setRtResult(null);
    clearPlayback();
    resetHud();
    toast('Раскладка перемешана — план сброшен на эвристику');
  };

  const replay = () => {
    const p = playRef.current;
    if (!p) return;
    p.t0 = performance.now();
    p.simTime = 0;
    playingRef.current = true;
    setPlaying(true);
  };

  // ===== реалтайм =====
  const startRealtime = () => {
    const g = new LiveGame(setupRef.current);
    gameRef.current = g;
    const lineup: Array<{ player: number; bot: Bot }> = [];
    for (const p of [1, 2, 3, 4]) {
      if (p === humanRef.current) continue;
      const bot =
        p === 1
          ? createSniperBot()
          : p === 2
            ? createBankerBot()
            : p === 3
              ? createRusherBot()
              : createTacticianBot();
      lineup.push({ player: p, bot });
    }
    botsRef.current = lineup;
    setRtStatuses(
      [1, 2, 3, 4].map((p) => ({
        player: p,
        botName: p === humanRef.current ? null : lineup.find((l) => l.player === p)!.bot.name,
        fired: false,
      }))
    );
    setRtResult(null);
    resetHud();
    runningRef.current = true;
    setRunning(true);
  };

  const resetRealtime = () => {
    gameRef.current = null;
    runningRef.current = false;
    setRunning(false);
    setRtResult(null);
    setRtStatuses([]);
    resetHud();
    aimRef.current = null;
  };

  // ===== прицеливание =====
  const cuePosFor = (player: number): Vec2 | null => {
    const id = ('p' + player) as BallId;
    if (modeRef.current === 'realtime' && gameRef.current) {
      return gameRef.current.world.balls.find((b) => b.id === id)?.pos ?? null;
    }
    return setupRef.current.balls.find((b) => b.id === id)?.pos ?? null;
  };

  const handlePointer = (phase: PointerPhase, pt: Vec2) => {
    if (phase === 'start') {
      if (modeRef.current === 'realtime') {
        const g = gameRef.current;
        if (!g || !runningRef.current) {
          toast('Сначала нажмите «Начать заезд»');
          return;
        }
        if (humanRef.current === 0) {
          toast('Вы наблюдатель — удары делают NPC');
          return;
        }
        if (g.firedPlayers.has(humanRef.current)) {
          toast('Ваш удар уже выполнен');
          return;
        }
        if (!g.canFire(humanRef.current)) {
          toast('Ваш биток ещё движется — дождитесь остановки');
          return;
        }
        const pos = cuePosFor(humanRef.current)!;
        aimRef.current = { player: humanRef.current, angle: angleOf(sub(pt, pos)), power: 400 };
      } else {
        if (playingRef.current || solvingRef.current) return;
        const player = selectedPlayerRef.current;
        const shot = shotsRef.current[player - 1];
        if (!shot?.enabled) {
          toast(`Удар игрока ${player} отключён`);
          return;
        }
        const pos = cuePosFor(player)!;
        aimRef.current = { player, angle: shot.angle, power: shot.power };
      }
    } else if (phase === 'move' && aimRef.current) {
      const pos = cuePosFor(aimRef.current.player);
      if (!pos) return;
      const d = sub(pt, pos);
      const L = Math.hypot(d.x, d.y);
      if (L > 6) {
        aimRef.current.angle = angleOf(d);
        aimRef.current.power = mapPower(L);
      }
    } else if (phase === 'end' && aimRef.current) {
      const a = aimRef.current;
      aimRef.current = null;
      if (modeRef.current === 'realtime') {
        const ok = gameRef.current?.fireShot(a.player, a.angle, a.power);
        if (!ok) toast.error('Удар не выполнен');
      } else {
        setShots((prev) =>
          prev.map((s, i) => (i === a.player - 1 ? { ...s, angle: a.angle, power: a.power } : s))
        );
      }
    }
  };

  // ===== сцена для канваса =====
  const getScene = (): Scene => {
    const s = setupRef.current;
    if (modeRef.current === 'realtime' && gameRef.current) {
      const w = gameRef.current.world;
      return {
        setup: s,
        balls: w.balls.map((b) => ({ id: b.id, pos: b.pos, radius: b.radius })),
        cpPassed: [...w.cpPassed],
        nextCpIndex: s.ordered ? (w.passedCount < 4 ? w.passedCount : null) : null,
        time: w.time,
        planShots: null,
        aim: aimRef.current,
        trail: gameRef.current.trail,
      };
    }
    let positions = startPositions(s) as Record<string, Vec2>;
    let cpPassed = [false, false, false, false];
    let time = 0;
    let trail: Vec2[] | undefined;
    let planShots: ShotSpec[] | null = shotsRef.current;
    const p = playRef.current;
    if (p) {
      time = p.simTime;
      positions = frameAt(p.frames, p.simTime);
      cpPassed = p.cpTimes.map((t) => t != null && t <= p.simTime);
      trail = trailFromFrames(p.frames, p.simTime);
      planShots = playingRef.current ? null : shotsRef.current;
    }
    const passedCount = cpPassed.filter(Boolean).length;
    return {
      setup: s,
      balls: s.balls.map((b) => ({
        id: b.id,
        pos: positions[b.id] ?? b.pos,
        radius: b.radius,
      })),
      cpPassed,
      nextCpIndex: s.ordered ? (passedCount < 4 ? passedCount : null) : null,
      time,
      planShots,
      selectedPlayer: modeRef.current === 'planner' ? selectedPlayerRef.current : null,
      aim: aimRef.current,
      trail,
    };
  };

  const activeResult = mode === 'planner' ? simResult : rtResult;
  const passedCount = hudCpPassed.filter(Boolean).length;
  const busy = solving != null;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-emerald-950/5 to-transparent">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold tracking-wide">КРИБИЛ</h1>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            проведите шар1 через 4 контрольные точки — быстрее всех
          </span>
          <div className="ml-auto flex items-center gap-3">
            <div
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-lg tabular-nums"
              data-testid="timer"
            >
              <Timer className="w-4 h-4 text-muted-foreground" />
              {hudTime.toFixed(2)}
              <span className="text-xs text-muted-foreground">с</span>
            </div>
            <div className="flex gap-1" data-testid="cp-dots">
              {hudCpPassed.map((p, i) => (
                <span
                  key={i}
                  className={`w-6 h-6 rounded-full text-xs font-bold grid place-items-center border ${
                    p
                      ? 'bg-emerald-500 text-white border-emerald-600'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {i + 1}
                </span>
              ))}
            </div>
            <div
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
              data-testid="best-time"
            >
              <Trophy className="w-4 h-4 text-amber-500" />
              {best != null ? `${best.toFixed(2)} с` : '—'}
            </div>
            <div className="flex rounded-md border overflow-hidden">
              {[0.5, 1, 2, 4].map((v) => (
                <button
                  key={v}
                  onClick={() => setSpeed(v)}
                  className={`px-2 py-1.5 text-xs font-medium ${
                    speed === v ? 'bg-foreground text-background' : 'hover:bg-muted'
                  }`}
                >
                  ×{v}
                </button>
              ))}
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Правила и метод">
                  <Info className="w-5 h-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Правила и математика</DialogTitle>
                  <DialogDescription asChild>
                    <div className="text-sm text-muted-foreground space-y-3 pt-2">
                      <p>
                        <b>Задача.</b> На столе один игровой шар — шар1. Команда из 4 игроков
                        должна провести его через 4 контрольные точки (КТ). Кием можно толкать
                        только битки, сам шар1 кием трогать нельзя. Каждый игрок делает один
                        удар: момент времени, направление и силу. Побеждает план с меньшим
                        временем финиша шар1 (по умолчанию КТ проходятся по порядку 1→4).
                      </p>
                      <p>
                        <b>Планировщик.</b> Задайте каждому игроку время, угол и силу удара.
                        Выбранного игрока можно прицеливать мышью прямо на столе. «Симуляция»
                        проигрывает план, «Авто-расчёт» подбирает параметры за вас.
                      </p>
                      <p>
                        <b>Реалтайм.</b> Вы играете за одного из игроков: боты бьют по своим
                        стратегиям, а ваш удар выполняется перетаскиванием мыши в удобный
                        момент. Биток можно толкнуть только когда он неподвижен.
                      </p>
                      <p>
                        <b>Боты.</b> «Снайпер» ждёт чистый прямой выстрел по призрачному шару;
                        «Бортовик» играет рикошетом от борта (метод зеркала); «Таран» бьёт
                        сразу и в полную силу; «Тактик» перед ударом запускает мини-оптимизацию
                        для текущей позиции.
                      </p>
                      <p>
                        <b>Почему не аналитика и не градиентный спуск?</b> Одиночный удар
                        «биток → шар1 → цель» решается аналитически (геометрия призрачного
                        шара). Но полный план с таймингами, рикошетами и трением — нет:
                        столкновения делают ландшафт функции потерь кусочно-разрывным, и
                        градиенты нужно считать через дифференцируемую физику. Поэтому здесь
                        используется стохастическая оптимизация — кросс-энтропийный метод
                        (CEM) с элитизмом и локальной доводкой, а лосс дополнительно штрафует
                        проходы КТ «по краю», чтобы найденные планы имели запас. Физика
                        детерминирована (фиксированный шаг 1/240 с), поэтому план
                        воспроизводим побитово.
                      </p>
                    </div>
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex flex-col gap-3 min-w-0">
          <TableCanvas getScene={getScene} onPointer={handlePointer} />

          {activeResult && (
            <div
              className={`rounded-lg border p-3 text-sm font-medium ${
                activeResult.success && activeResult.finishTime != null
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700'
                  : 'border-red-500/50 bg-red-500/10 text-red-700'
              }`}
              data-testid="result-banner"
            >
              {activeResult.success && activeResult.finishTime != null
                ? `Финиш! Шар1 прошёл все 4 КТ за ${activeResult.finishTime.toFixed(2)} с. Попробуйте улучшить время или перемешать раскладку.`
                : `Промах: пройдено ${activeResult.passedCount}/4 КТ за ${activeResult.endTime.toFixed(1)} с. Скорректируйте план или запустите авто-расчёт.`}
            </div>
          )}

          {mode === 'planner' && simResult && !playing && (
            <div>
              <Button variant="outline" size="sm" onClick={replay}>
                <Play className="w-4 h-4 mr-1" /> Повторить проигрыш
              </Button>
            </div>
          )}

          <div className="rounded-lg border bg-card">
            <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground">
              Журнал событий
            </div>
            <div
              className="max-h-44 overflow-y-auto p-2 flex flex-col gap-1"
              data-testid="event-log"
            >
              {events.length === 0 && (
                <span className="text-xs text-muted-foreground px-1">Пока пусто…</span>
              )}
              {events.map((e, i) => (
                <div key={`${e.t}-${e.kind}-${i}`} className="text-xs flex gap-2">
                  <span className="font-mono text-muted-foreground shrink-0">
                    {e.t.toFixed(2)}с
                  </span>
                  <span>{e.text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="min-w-0">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-2 w-full mb-3">
              <TabsTrigger value="planner">Планировщик</TabsTrigger>
              <TabsTrigger value="realtime">Реалтайм</TabsTrigger>
            </TabsList>
            <TabsContent value="planner">
              <PlannerPanel
                shots={shots}
                onChange={setShots}
                selectedPlayer={selectedPlayer}
                onSelectPlayer={setSelectedPlayer}
                ordered={ordered}
                onOrderedChange={setOrdered}
                onRun={() => runPlan()}
                onAutoSolve={autoSolve}
                onResetPlan={resetPlan}
                onRandomize={randomize}
                solving={solving}
                busy={busy}
              />
            </TabsContent>
            <TabsContent value="realtime">
              <RealtimePanel
                humanPlayer={humanPlayer}
                onHumanPlayerChange={setHumanPlayer}
                statuses={
                  rtStatuses.length > 0
                    ? rtStatuses
                    : [1, 2, 3, 4].map((p) => ({
                        player: p,
                        botName:
                          p === 1 ? 'Снайпер' : p === 2 ? 'Бортовик' : p === 3 ? 'Таран' : 'Тактик',
                        fired: false,
                      }))
                }
                running={running}
                done={rtResult != null}
                onStart={startRealtime}
                onReset={resetRealtime}
              />
            </TabsContent>
          </Tabs>
        </aside>
      </main>

      <footer className="border-t mt-auto">
        <div className="mx-auto max-w-7xl px-4 py-2.5 text-xs text-muted-foreground flex gap-4 flex-wrap">
          <span>Пройдено КТ: {passedCount}/4</span>
          <span>Физика: трение 90 у/с², борт e=0.7, шары e=0.95, шаг 1/240 с</span>
          <span className="ml-auto">Unit-тесты: bun run test · 25 проверок</span>
        </div>
      </footer>
    </div>
  );
}
