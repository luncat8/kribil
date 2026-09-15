// «Крибил» — типы игровых сущностей.
// Координаты: канвас-система (x вправо, y вниз), единицы — условные «юниты» стола.

export interface Vec2 {
  x: number;
  y: number;
}

export type BallId = 'ball1' | 'p1' | 'p2' | 'p3' | 'p4';

export const PLAYER_IDS: BallId[] = ['p1', 'p2', 'p3', 'p4'];

export interface BallState {
  id: BallId;
  pos: Vec2;
  vel: Vec2;
  radius: number;
}

/** Удар игрока: момент времени, направление (рад) и сила (начальная скорость битка, у/с). */
export interface ShotSpec {
  player: number; // 1..4
  t: number; // плановое время удара, с
  angle: number; // направление, радианы
  power: number; // сила удара = скорость битка, у/с
  enabled: boolean;
}

export interface TableSpec {
  width: number;
  height: number;
  ballRadius: number;
  frictionDecel: number; // трение сукна: постоянное замедление, у/с²
  wallRestitution: number; // упругость борта
  ballRestitution: number; // упругость соударения шаров
  maxSimTime: number; // лимит времени симуляции, с
}

export interface Checkpoint {
  index: number; // 0..3
  pos: Vec2;
  radius: number;
}

export interface KribilSetup {
  table: TableSpec;
  balls: BallState[];
  checkpoints: Checkpoint[];
  ordered: boolean; // КТ проходятся строго по порядку 1→2→3→4
}

export type EventKind =
  | 'shot'
  | 'hitBall1'
  | 'ballCollision'
  | 'checkpoint'
  | 'finish'
  | 'allStopped'
  | 'timeout';

export interface SimEvent {
  t: number;
  kind: EventKind;
  player?: number;
  ballA?: BallId;
  ballB?: BallId;
  cp?: number;
  text: string;
}

export interface SimFrame {
  t: number;
  pos: Record<BallId, Vec2>;
}

export interface SimResult {
  success: boolean;
  finishTime: number | null;
  cpTimes: (number | null)[];
  /** Минимальная дистанция центр-шар1-КТ: для пройденных — глубина прохода, для непройденных — насколько близко подошёл. */
  cpMiss: number[];
  passedCount: number;
  events: SimEvent[];
  frames: SimFrame[];
  endTime: number;
  ball1HitCount: number;
}
