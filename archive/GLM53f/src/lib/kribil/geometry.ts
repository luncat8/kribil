import type { BallId, BallState, TableSpec, Vec2 } from './types';
import { dist, dot, norm, scale, sub } from './vec';

export interface GhostAim {
  /** Направление удара битком. */
  aimDir: Vec2;
  /** Насколько «в лоб» биток догонит шар1: dot(aimDir, dir). ≤0 — удар невозможен. */
  along: number;
  /** Позиция «призрачного шара» — где центр битка должен быть в момент контакта. */
  ghost: Vec2;
}

/**
 * Геометрия «призрачного шара»: чтобы шар1 ушёл в направлении dir,
 * биток должен попасть в точку ghost = ball1 − dir·(r1+r2). Это единственная
 * часть задачи, решаемая аналитически — всё остальное требует численной оптимизации.
 */
export function ghostAim(cuePos: Vec2, ball1Pos: Vec2, dir: Vec2, rSum: number): GhostAim {
  const ghost = sub(ball1Pos, scale(dir, rSum));
  const delta = sub(ghost, cuePos);
  const d = Math.hypot(delta.x, delta.y);
  const aimDir = d < 1e-9 ? { x: dir.x, y: dir.y } : scale(delta, 1 / d);
  return { aimDir, along: aimDir.x * dir.x + aimDir.y * dir.y, ghost };
}

/** Первый шар, пересекающий отрезок (с учётом радиусов). null — путь свободен. */
export function segmentBlocked(
  from: Vec2,
  to: Vec2,
  balls: BallState[],
  ignore: Set<BallId>,
  extra: number
): BallId | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l2 = dx * dx + dy * dy;
  for (const b of balls) {
    if (ignore.has(b.id)) continue;
    let t = l2 > 1e-12 ? ((b.pos.x - from.x) * dx + (b.pos.y - from.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;
    if (Math.hypot(cx - b.pos.x, cy - b.pos.y) < b.radius + extra) return b.id;
  }
  return null;
}

/** Точка, где центр битка окажетcя в момент контакта с шаром при ударе вдоль dir. */
export function rayCircleContact(
  from: Vec2,
  dir: Vec2,
  target: Vec2,
  rSum: number
): Vec2 | null {
  const d = norm(dir);
  if (d.x === 0 && d.y === 0) return null;
  const tx = target.x - from.x;
  const ty = target.y - from.y;
  const t = tx * d.x + ty * d.y;
  if (t <= 0) return null;
  const perp2 = tx * tx + ty * ty - t * t;
  const r2 = rSum * rSum;
  if (perp2 > r2) return null;
  const back = Math.sqrt(r2 - perp2);
  const contact = t - back;
  if (contact <= 0) return null;
  return { x: from.x + d.x * contact, y: from.y + d.y * contact };
}

export interface WallLine {
  axis: 'x' | 'y';
  value: number;
}

/** Линии отражения для ЦЕНТРА шара (с отступом на радиус). */
export function wallLines(table: TableSpec): WallLine[] {
  const r = table.ballRadius;
  return [
    { axis: 'x', value: r },
    { axis: 'x', value: table.width - r },
    { axis: 'y', value: r },
    { axis: 'y', value: table.height - r },
  ];
}

export function mirrorAcrossWall(p: Vec2, w: WallLine): Vec2 {
  return w.axis === 'x' ? { x: 2 * w.value - p.x, y: p.y } : { x: p.x, y: 2 * w.value - p.y };
}
