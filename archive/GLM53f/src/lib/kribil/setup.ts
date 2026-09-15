import type { BallId, BallState, Checkpoint, KribilSetup, ShotSpec, TableSpec } from './types';
import { PLAYER_IDS } from './types';
import { ghostAim } from './geometry';
import { angleOf, norm, sub } from './vec';

export const DEFAULT_TABLE: TableSpec = {
  width: 1000,
  height: 500,
  ballRadius: 13,
  frictionDecel: 90,
  wallRestitution: 0.7,
  ballRestitution: 0.95,
  maxSimTime: 90,
};

export const CP_RADIUS = 34;
export const MAX_POWER = 1400;
export const MIN_POWER = 60;
export const MAX_SHOT_TIME = 30;

export const PLAYER_COLORS: Record<BallId, string> = {
  ball1: '#ef4444',
  p1: '#f59e0b', // янтарный
  p2: '#f43f5e', // розовый
  p3: '#a855f7', // пурпурный
  p4: '#14b8a6', // бирюзовый
};

export const PLAYER_NAMES: Record<number, string> = {
  1: 'Игрок 1',
  2: 'Игрок 2',
  3: 'Игрок 3',
  4: 'Игрок 4',
};

export function defaultSetup(): KribilSetup {
  const r = DEFAULT_TABLE.ballRadius;
  const mk = (id: BallId, x: number, y: number): BallState => ({
    id,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    radius: r,
  });
  const cp = (index: number, x: number, y: number): Checkpoint => ({
    index,
    pos: { x, y },
    radius: CP_RADIUS,
  });
  return {
    table: { ...DEFAULT_TABLE },
    balls: [
      mk('ball1', 140, 250),
      mk('p1', 70, 250),
      mk('p2', 300, 455),
      mk('p3', 640, 30),
      mk('p4', 450, 460),
    ],
    checkpoints: [cp(0, 400, 250), cp(1, 620, 110), cp(2, 620, 390), cp(3, 880, 250)],
    ordered: true,
  };
}

/** План по умолчанию (найден CEM-солвером для defaultSetup): финиш за ~6.5 с. */
export function defaultShots(): ShotSpec[] {
  return [
    { player: 1, t: 0.62, angle: 0.0549, power: 923, enabled: true },
    { player: 2, t: 2.593, angle: 3.9326, power: 692, enabled: true },
    { player: 3, t: 3.435, angle: 2.752, power: 524, enabled: true },
    { player: 4, t: 2.526, angle: 4.3576, power: 745, enabled: true },
  ];
}

/** Стартовые планы по эвристике призрачного шара (для перемешанных раскладок). */
export function heuristicShots(setup: KribilSetup): ShotSpec[] {
  const ball1 = setup.balls.find((b) => b.id === 'ball1')!;
  const rSum = ball1.radius * 2;
  return PLAYER_IDS.map((id, i) => {
    const player = i + 1;
    const cue = setup.balls.find((b) => b.id === id)!;
    const target = setup.checkpoints[0];
    const dir = norm(sub(target.pos, ball1.pos));
    const g = ghostAim(cue.pos, ball1.pos, dir, rSum);
    const angle =
      g.along > 0.08 ? angleOf(g.aimDir) : angleOf(sub(ball1.pos, cue.pos));
    return {
      player,
      t: 0.5 + i * 1.2,
      angle,
      power: 620,
      enabled: true,
    };
  });
}

/** Перемешать контрольные точки (и шар1) с сохранением разумных зазоров. */
export function randomizeCheckpoints(setup: KribilSetup, seed = Date.now()): KribilSetup {
  let s = seed >>> 0;
  const rng = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const margin = 70;
  const minGap = 150;
  const cps: Checkpoint[] = [];
  let guard = 0;
  while (cps.length < 4 && guard++ < 4000) {
    const x = margin + rng() * (setup.table.width - 2 * margin);
    const y = margin + rng() * (setup.table.height - 2 * margin);
    const okDist = (p: { x: number; y: number }, gap: number) =>
      Math.hypot(x - p.x, y - p.y) >= gap;
    if (!okDist({ x: 140, y: 250 }, 130)) continue;
    if (!cps.every((c) => okDist(c.pos, minGap))) continue;
    cps.push({ index: cps.length, pos: { x, y }, radius: CP_RADIUS });
  }
  if (cps.length < 4) return { ...setup, checkpoints: setup.checkpoints.map((c) => ({ ...c })) };
  return { ...setup, checkpoints: cps };
}
