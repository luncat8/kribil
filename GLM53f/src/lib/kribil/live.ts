import type { BallId, KribilSetup, Vec2 } from './types';
import { ballById, createWorld, stepWorld, type World } from './world';
import { MAX_POWER } from './setup';
import { clamp, deg, fromAngle } from './vec';
import type { BotContext, BotStrategy } from './bots';
import { unpassedTargets } from './bots';

export interface LiveApi {
  world: World;
  firedPlayers: Set<number>;
  fireShot(player: number, angle: number, power: number): boolean;
}

export type BotController = (api: LiveApi) => void;

/**
 * Живая партия (режим реального времени): фиксированный шаг физики,
 * удары игроков выполняются вручную через fireShot, боты опрашиваются контроллером.
 */
export class LiveGame {
  readonly world: World;
  readonly trail: Vec2[] = [];
  readonly firedPlayers = new Set<number>();
  private acc = 0;
  private botAcc = 0;
  private static readonly DT = 1 / 240;

  constructor(public readonly setup: KribilSetup) {
    const shots = [1, 2, 3, 4].map((player) => ({
      player,
      t: 0,
      angle: 0,
      power: 0,
      enabled: false,
    }));
    // авто-завершение по allStopped отключено: в ручном режиме учитываем firedPlayers
    this.world = createWorld(setup, shots, { autoAllStopped: false });
  }

  /** Все ли 4 игрока уже ударили. */
  get allFired(): boolean {
    return this.firedPlayers.size >= 4;
  }

  canFire(player: number): boolean {
    if (this.world.done || this.firedPlayers.has(player)) return false;
    const b = ballById(this.world, ('p' + player) as BallId);
    if (!b) return false;
    return Math.abs(b.vel.x) + Math.abs(b.vel.y) <= 1e-9;
  }

  fireShot(player: number, angle: number, power: number): boolean {
    if (!this.canFire(player)) return false;
    const b = ballById(this.world, ('p' + player) as BallId)!;
    b.vel = fromAngle(angle, clamp(power, 10, MAX_POWER));
    this.firedPlayers.add(player);
    this.world.events.push({
      t: this.world.time,
      kind: 'shot',
      player,
      text: `Игрок ${player}: удар (угол ${Math.round(deg(angle))}°, сила ${Math.round(power)})`,
    });
    return true;
  }

  /** Продвижение живого времени; controller опрашивается раз в 0.3 с игрового времени. */
  advance(dtReal: number, speed: number, controller?: BotController): void {
    if (this.world.done) return;
    this.acc += Math.min(Math.max(dtReal, 0), 0.25) * speed;
    const dt = LiveGame.DT;
    let steps = 0;
    let poll = false;
    while (this.acc >= dt && !this.world.done && steps < 2400) {
      stepWorld(this.world, dt);
      this.acc -= dt;
      steps++;
      // ручной режим: когда все ударили и всё остановилось — конец заезда
      if (
        !this.world.done &&
        this.allFired &&
        this.world.balls.every((b) => b.vel.x === 0 && b.vel.y === 0)
      ) {
        this.world.done = true;
        this.world.doneReason = 'allStopped';
        this.world.events.push({
          t: this.world.time,
          kind: 'allStopped',
          text: 'Все шары остановились',
        });
      }
      const b1 = ballById(this.world, 'ball1');
      if (b1) {
        this.trail.push({ x: b1.pos.x, y: b1.pos.y });
        if (this.trail.length > 900) this.trail.shift();
      }
      this.botAcc += dt;
      if (this.botAcc >= 0.3) {
        this.botAcc = 0;
        poll = true;
      }
      if (poll && controller) {
        poll = false;
        controller(this.api());
      }
    }
  }

  api(): LiveApi {
    return {
      world: this.world,
      firedPlayers: this.firedPlayers,
      fireShot: (p, a, pw) => this.fireShot(p, a, pw),
    };
  }
}

/** Контроллер ботов: опрашивает стратегии и выполняет удары. */
export function makeBotController(
  lineup: Array<{ player: number; bot: BotStrategy }>,
  setup: KribilSetup
): BotController {
  return (api) => {
    const w = api.world;
    for (const { player, bot } of lineup) {
      if (w.time < bot.minFireTime) continue;
      if (api.firedPlayers.has(player)) continue;
      const my = ballById(w, ('p' + player) as BallId);
      const b1 = ballById(w, 'ball1');
      if (!my || !b1) continue;
      if (Math.abs(my.vel.x) + Math.abs(my.vel.y) > 1e-9) continue;
      const ctx: BotContext = {
        table: w.table,
        balls: w.balls,
        myBall: my,
        ball1: b1,
        targets: unpassedTargets(w.ordered, w.checkpoints, w.cpPassed, w.passedCount, b1),
        time: w.time,
      };
      const d = bot.decide(ctx);
      if (d) api.fireShot(player, d.angle, d.power);
    }
  };
}

/** Стартовые позиции шаров из setup. */
export function startPositions(setup: KribilSetup): Record<BallId, Vec2> {
  const out = {} as Record<BallId, Vec2>;
  for (const b of setup.balls) out[b.id] = { ...b.pos };
  return out;
}
