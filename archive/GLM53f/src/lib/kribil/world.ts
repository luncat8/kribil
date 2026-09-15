import type {
  BallId,
  BallState,
  Checkpoint,
  KribilSetup,
  ShotSpec,
  SimEvent,
  SimFrame,
  TableSpec,
} from './types';
import { deg, fromAngle } from './vec';

export interface ActiveShot {
  shot: ShotSpec;
  fired: boolean;
}

export interface World {
  time: number;
  table: TableSpec;
  balls: BallState[];
  checkpoints: Checkpoint[];
  ordered: boolean;
  shots: ActiveShot[];
  cpPassed: boolean[];
  cpMinDist: number[];
  passedCount: number;
  finished: boolean;
  finishTime: number | null;
  events: SimEvent[];
  ball1HitCount: number;
  done: boolean;
  doneReason: 'finish' | 'allStopped' | 'timeout' | null;
  /** false — режим ручных ударов (LiveGame): завершение allStopped решает вызывающий код. */
  autoAllStopped: boolean;
}

export function ballById(w: World, id: BallId): BallState | undefined {
  return w.balls.find((b) => b.id === id);
}

export function createWorld(
  setup: KribilSetup,
  shots: ShotSpec[],
  opts: { autoAllStopped?: boolean } = {}
): World {
  return {
    time: 0,
    table: { ...setup.table },
    balls: setup.balls.map((b) => ({ id: b.id, pos: { ...b.pos }, vel: { ...b.vel }, radius: b.radius })),
    checkpoints: setup.checkpoints.map((c) => ({ ...c, pos: { ...c.pos } })),
    ordered: setup.ordered,
    shots: shots.map((s) => ({ shot: { ...s }, fired: false })),
    cpPassed: setup.checkpoints.map(() => false),
    cpMinDist: setup.checkpoints.map(() => Infinity),
    passedCount: 0,
    finished: false,
    finishTime: null,
    events: [],
    ball1HitCount: 0,
    done: false,
    doneReason: null,
    autoAllStopped: opts.autoAllStopped ?? true,
  };
}

const EPS = 1e-9;

/** Один фиксированный шаг физики. Детерминирован: одинаковый вход → одинаковый выход. */
export function stepWorld(w: World, dt: number): void {
  if (w.done) return;
  const t = w.table;

  // 1. Удары по расписанию (биток можно толкнуть только когда он неподвижен)
  for (const a of w.shots) {
    if (a.fired || !a.shot.enabled) continue;
    if (w.time + EPS < a.shot.t) continue;
    const owner = ballById(w, ('p' + a.shot.player) as BallId);
    if (!owner) continue;
    if (Math.abs(owner.vel.x) + Math.abs(owner.vel.y) > EPS) continue; // ждём остановки битка
    owner.vel = fromAngle(a.shot.angle, a.shot.power);
    a.fired = true;
    w.events.push({
      t: w.time,
      kind: 'shot',
      player: a.shot.player,
      text: `Игрок ${a.shot.player}: удар (угол ${Math.round(deg(a.shot.angle))}°, сила ${Math.round(a.shot.power)})`,
    });
  }

  // 2. Интегрирование + трение сукна (постоянное замедление)
  for (const b of w.balls) {
    const s = Math.hypot(b.vel.x, b.vel.y);
    if (s > 0) {
      const ns = Math.max(0, s - t.frictionDecel * dt);
      const k = ns / s;
      b.vel.x *= k;
      b.vel.y *= k;
      b.pos.x += b.vel.x * dt;
      b.pos.y += b.vel.y * dt;
    }
  }

  // 3. Борта
  for (const b of w.balls) {
    const r = b.radius;
    if (b.pos.x < r) {
      b.pos.x = r;
      if (b.vel.x < 0) b.vel.x = -b.vel.x * t.wallRestitution;
    } else if (b.pos.x > t.width - r) {
      b.pos.x = t.width - r;
      if (b.vel.x > 0) b.vel.x = -b.vel.x * t.wallRestitution;
    }
    if (b.pos.y < r) {
      b.pos.y = r;
      if (b.vel.y < 0) b.vel.y = -b.vel.y * t.wallRestitution;
    } else if (b.pos.y > t.height - r) {
      b.pos.y = t.height - r;
      if (b.vel.y > 0) b.vel.y = -b.vel.y * t.wallRestitution;
    }
  }

  // 4. Соударения шаров (равные массы, два прохода для устойчивости)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < w.balls.length; i++) {
      for (let j = i + 1; j < w.balls.length; j++) {
        const a = w.balls[i];
        const c = w.balls[j];
        const dx = c.pos.x - a.pos.x;
        const dy = c.pos.y - a.pos.y;
        const d = Math.hypot(dx, dy);
        const minD = a.radius + c.radius;
        if (d >= minD) continue;
        const nx = d > EPS ? dx / d : 1;
        const ny = d > EPS ? dy / d : 0;
        const overlap = minD - d;
        a.pos.x -= (nx * overlap) / 2;
        a.pos.y -= (ny * overlap) / 2;
        c.pos.x += (nx * overlap) / 2;
        c.pos.y += (ny * overlap) / 2;
        const rvn = (c.vel.x - a.vel.x) * nx + (c.vel.y - a.vel.y) * ny;
        if (rvn < 0) {
          const jm = (-(1 + t.ballRestitution) * rvn) / 2; // массы равны, m = 1
          a.vel.x -= jm * nx;
          a.vel.y -= jm * ny;
          c.vel.x += jm * nx;
          c.vel.y += jm * ny;
          const involvesBall1 = a.id === 'ball1' || c.id === 'ball1';
          if (involvesBall1) {
            w.ball1HitCount++;
            const other = a.id === 'ball1' ? c : a;
            const player = other.id.startsWith('p') ? Number(other.id.slice(1)) : undefined;
            w.events.push({
              t: w.time,
              kind: 'hitBall1',
              ballA: other.id,
              ballB: 'ball1',
              player,
              text: player
                ? `Биток игрока ${player} попал по шару1`
                : `Столкновение: ${other.id} → шар1`,
            });
          } else if (pass === 0) {
            w.events.push({
              t: w.time,
              kind: 'ballCollision',
              ballA: a.id,
              ballB: c.id,
              text: `Битки столкнулись: ${a.id} × ${c.id}`,
            });
          }
        }
      }
    }
  }

  // 5. Контрольные точки (только шар1) + учёт минимальной дистанции для формы функции потерь
  const ball1 = ballById(w, 'ball1');
  if (ball1) {
    for (let i = 0; i < w.checkpoints.length; i++) {
      if (w.cpPassed[i]) continue;
      const cp = w.checkpoints[i];
      const d = Math.hypot(ball1.pos.x - cp.pos.x, ball1.pos.y - cp.pos.y);
      if (d < w.cpMinDist[i]) w.cpMinDist[i] = d;
    }
    if (w.ordered) {
      if (w.passedCount < w.checkpoints.length) {
        const cp = w.checkpoints[w.passedCount];
        if (Math.hypot(ball1.pos.x - cp.pos.x, ball1.pos.y - cp.pos.y) < cp.radius) {
          passCp(w, cp.index);
        }
      }
    } else {
      for (let i = 0; i < w.checkpoints.length; i++) {
        if (w.cpPassed[i]) continue;
        const cp = w.checkpoints[i];
        if (Math.hypot(ball1.pos.x - cp.pos.x, ball1.pos.y - cp.pos.y) < cp.radius) {
          passCp(w, cp.index);
        }
      }
    }
  }

  // 6. Завершение
  const allFired = w.shots.every((a) => a.fired || !a.shot.enabled);
  const allStopped = w.balls.every((b) => b.vel.x === 0 && b.vel.y === 0);
  if (allFired && allStopped && w.autoAllStopped) {
    w.done = true;
    w.doneReason = 'allStopped';
    w.events.push({ t: w.time, kind: 'allStopped', text: 'Все шары остановились' });
  } else if (w.time >= t.maxSimTime) {
    w.done = true;
    w.doneReason = 'timeout';
    w.events.push({ t: w.time, kind: 'timeout', text: 'Достигнут лимит времени симуляции' });
  }

  w.time += dt;
}

function passCp(w: World, cpIndex: number): void {
  w.cpPassed[cpIndex] = true;
  w.passedCount++;
  w.events.push({
    t: w.time,
    kind: 'checkpoint',
    cp: cpIndex,
    text: `КТ${cpIndex + 1} пройдена за ${w.time.toFixed(2)} с`,
  });
  if (w.passedCount >= w.checkpoints.length) {
    w.finished = true;
    w.finishTime = w.time;
    w.done = true;
    w.doneReason = 'finish';
    w.events.push({ t: w.time, kind: 'finish', text: `Финиш! Время ${w.time.toFixed(2)} с` });
  }
}

export function snapshot(w: World): SimFrame {
  const pos = {} as Record<BallId, { x: number; y: number }>;
  for (const b of w.balls) pos[b.id] = { x: b.pos.x, y: b.pos.y };
  return { t: w.time, pos };
}

/** Итог из живого мира (режим реального времени). */
export function resultFromWorld(w: World): import('./types').SimResult {
  const cpTimes = w.checkpoints.map(() => null as number | null);
  for (const e of w.events) {
    if (e.kind === 'checkpoint' && e.cp != null && cpTimes[e.cp] == null) cpTimes[e.cp] = e.t;
  }
  return {
    success: w.finished,
    finishTime: w.finishTime,
    cpTimes,
    cpMiss: w.cpMinDist.map((d) => (d === Infinity ? w.table.width : d)),
    passedCount: w.passedCount,
    events: [...w.events],
    frames: [],
    endTime: w.time,
    ball1HitCount: w.ball1HitCount,
  };
}
