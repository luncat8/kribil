import type { BallState, Checkpoint, KribilSetup, ShotSpec, TableSpec } from './types';
import { ghostAim, mirrorAcrossWall, segmentBlocked, wallLines } from './geometry';
import { solvePlan } from './solver';
import { MAX_POWER, MIN_POWER } from './setup';
import { angleOf, clamp, dist, norm, sub } from './vec';

export interface BotContext {
  table: TableSpec;
  balls: BallState[];
  myBall: BallState;
  ball1: BallState;
  targets: Checkpoint[]; // приоритетные непройденные КТ
  time: number;
}

export interface BotDecision {
  angle: number;
  power: number;
}

export interface BotStrategy {
  id: string;
  name: string;
  description: string;
  minFireTime: number;
  decide(ctx: BotContext): BotDecision | null;
}

/** Доля скорости битка, передаваемая шару1 при контакте: (1+e)/2 · cos(угла). */
function transferFactor(along: number, e: number): number {
  return ((1 + e) / 2) * Math.max(along, 1e-6);
}

/** Целевые КТ: по порядку — следующая; вразнобой — все непройденные, ближайшая first. */
export function unpassedTargets(
  ordered: boolean,
  checkpoints: Checkpoint[],
  cpPassed: boolean[],
  passedCount: number,
  ball1: BallState
): Checkpoint[] {
  if (ordered) {
    const next = checkpoints[passedCount];
    return next ? [next] : [];
  }
  return checkpoints
    .filter((_, i) => !cpPassed[i])
    .sort((a, b) => dist(ball1.pos, a.pos) - dist(ball1.pos, b.pos));
}

/** Снайпер: бьёт только когда есть чистый прямой «призрачный» выстрел в следующую КТ. */
export function createSniperBot(rng: () => number = Math.random): BotStrategy {
  return {
    id: 'sniper',
    name: 'Снайпер',
    description: 'Ждёт чистый прямой выстрел по призрачному шару, бьёт точно и экономно.',
    minFireTime: 0.4,
    decide(ctx) {
      const cp = ctx.targets[0];
      if (!cp) return null;
      const rSum = ctx.myBall.radius + ctx.ball1.radius;
      const dir = norm(sub(cp.pos, ctx.ball1.pos));
      const g = ghostAim(ctx.myBall.pos, ctx.ball1.pos, dir, rSum);
      if (g.along <= 0.08) return null;
      const blockedSelf = segmentBlocked(
        ctx.myBall.pos,
        g.ghost,
        ctx.balls,
        new Set([ctx.myBall.id, 'ball1']),
        ctx.myBall.radius + 1
      );
      if (blockedSelf) return null;
      const blockedPath = segmentBlocked(
        ctx.ball1.pos,
        cp.pos,
        ctx.balls,
        new Set(['ball1', ctx.myBall.id]),
        ctx.ball1.radius + 1
      );
      if (blockedPath) return null;
      const d = dist(ctx.ball1.pos, cp.pos);
      const v1 = Math.sqrt(2 * ctx.table.frictionDecel * (d + 90));
      const speed = v1 / transferFactor(g.along, ctx.table.ballRestitution);
      if (speed > MAX_POWER) return null;
      return {
        angle: angleOf(g.aimDir) + (rng() - 0.5) * 0.008,
        power: clamp(speed * 1.03, MIN_POWER, MAX_POWER),
      };
    },
  };
}

/** Бортовик: предпочитает удар шар1 через борт (метод зеркала), когда прямой путь занят. */
export function createBankerBot(rng: () => number = Math.random): BotStrategy {
  return {
    id: 'banker',
    name: 'Бортовик',
    description: 'Играет рикошетами: отражает КТ от борта и бьёт по зеркальной геометрии.',
    minFireTime: 0.8,
    decide(ctx) {
      const cp = ctx.targets[0];
      if (!cp) return null;
      const rSum = ctx.myBall.radius + ctx.ball1.radius;
      for (const wall of wallLines(ctx.table)) {
        const mirror = mirrorAcrossWall(cp.pos, wall);
        const dir = norm(sub(mirror, ctx.ball1.pos));
        if (dir.x === 0 && dir.y === 0) continue;
        const coord = wall.axis === 'x' ? ctx.ball1.pos.x : ctx.ball1.pos.y;
        const dcomp = wall.axis === 'x' ? dir.x : dir.y;
        if (Math.abs(dcomp) < 1e-9) continue;
        const s = (wall.value - coord) / dcomp;
        if (s <= 10) continue;
        const bounce = {
          x: ctx.ball1.pos.x + dir.x * s,
          y: ctx.ball1.pos.y + dir.y * s,
        };
        const L = dist(ctx.ball1.pos, mirror);
        if (s >= L * 0.98) continue;
        const ignoreSelf = new Set(['ball1' as const, ctx.myBall.id]);
        if (segmentBlocked(ctx.ball1.pos, bounce, ctx.balls, ignoreSelf, ctx.ball1.radius + 1))
          continue;
        if (segmentBlocked(bounce, cp.pos, ctx.balls, ignoreSelf, ctx.ball1.radius + 1)) continue;
        const g = ghostAim(ctx.myBall.pos, ctx.ball1.pos, dir, rSum);
        if (g.along <= 0.1) continue;
        if (
          segmentBlocked(
            ctx.myBall.pos,
            g.ghost,
            ctx.balls,
            new Set([ctx.myBall.id, 'ball1']),
            ctx.myBall.radius + 1
          )
        )
          continue;
        const pathLen = s + dist(bounce, cp.pos) + 120;
        const v1 = Math.sqrt(2 * ctx.table.frictionDecel * pathLen);
        const speed = (v1 / transferFactor(g.along, ctx.table.ballRestitution)) * 1.22;
        if (speed > MAX_POWER) continue;
        return {
          angle: angleOf(g.aimDir) + (rng() - 0.5) * 0.01,
          power: clamp(speed, MIN_POWER, MAX_POWER),
        };
      }
      return null;
    },
  };
}

/** Таран: бьёт сразу, сильно и не очень точно — прямо в шар1. */
export function createRusherBot(rng: () => number = Math.random): BotStrategy {
  return {
    id: 'rusher',
    name: 'Таран',
    description: 'Бьёт сразу и в полную силу прямо по шару1. Точность — не его стиль.',
    minFireTime: 0.2,
    decide(ctx) {
      const base = angleOf(sub(ctx.ball1.pos, ctx.myBall.pos));
      return {
        angle: base + (rng() - 0.5) * 0.09,
        power: MAX_POWER * 0.92,
      };
    },
  };
}

/** Тактик: локальная CEM-оптимизация собственного удара по текущей позиции. */
export function createTacticianBot(seedBase = 11): BotStrategy {
  let cache: { key: string; decision: BotDecision | null } | null = null;
  return {
    id: 'tactician',
    name: 'Тактик',
    description: 'Перед ударом просчитывает мини-оптимизацию (CEM) для текущей позиции.',
    minFireTime: 1.0,
    decide(ctx) {
      const cp = ctx.targets[0];
      if (!cp) return null;
      const key = `${cp.index}:${Math.round(ctx.ball1.pos.x / 14)}:${Math.round(ctx.ball1.pos.y / 14)}`;
      if (cache && cache.key === key) return cache.decision;
      const playerNum = Number(ctx.myBall.id.slice(1));
      const rSum = ctx.myBall.radius + ctx.ball1.radius;
      // «умный» старт: призрачный шар в сторону КТ + расчёт силы по трению
      const dir = norm(sub(cp.pos, ctx.ball1.pos));
      const g = ghostAim(ctx.myBall.pos, ctx.ball1.pos, dir, rSum);
      const startAngle = g.along > 0.08 ? angleOf(g.aimDir) : angleOf(sub(ctx.ball1.pos, ctx.myBall.pos));
      const need = Math.sqrt(2 * ctx.table.frictionDecel * (dist(ctx.ball1.pos, cp.pos) + 100));
      const startPower = clamp(need / 0.9, 200, MAX_POWER);
      const mini: KribilSetup = {
        table: ctx.table,
        balls: [
          { ...ctx.ball1, pos: { ...ctx.ball1.pos }, vel: { x: 0, y: 0 } },
          { ...ctx.myBall, pos: { ...ctx.myBall.pos }, vel: { x: 0, y: 0 } },
        ],
        checkpoints: [cp],
        ordered: true,
      };
      const base: ShotSpec[] = [
        {
          player: playerNum,
          t: 0,
          angle: startAngle,
          power: startPower,
          enabled: true,
        },
      ];
      const out = solvePlan(mini, base, {
        iterations: 5,
        population: 24,
        seed: (seedBase * 977 + Math.round(ctx.time * 3) + cp.index * 31) >>> 0,
        optimize: ['angle', 'power'],
      });
      const decision: BotDecision | null =
        out.result && out.result.success
          ? { angle: out.plan[0].angle, power: clamp(out.plan[0].power, MIN_POWER, MAX_POWER) }
          : null;
      cache = { key, decision };
      return decision;
    },
  };
}

/** Состав ботов по номерам игроков (в порядке 1..4). */
export function defaultBotLineup(): Array<{ player: number; bot: BotStrategy }> {
  return [
    { player: 1, bot: createSniperBot() },
    { player: 2, bot: createBankerBot() },
    { player: 3, bot: createRusherBot() },
    { player: 4, bot: createTacticianBot() },
  ];
}
