import { describe, expect, it } from 'vitest';
import {
  createBankerBot,
  createRusherBot,
  createSniperBot,
  createTacticianBot,
  unpassedTargets,
  type BotContext,
} from '../bots';
import {
  DEFAULT_TABLE,
  defaultSetup,
  defaultShots,
  heuristicShots,
  type BallState,
  type KribilSetup,
  type ShotSpec,
} from '../setup';
import { solvePlan, planLoss, mulberry32 } from '../solver';
import { simulate } from '../simulate';
import { LiveGame, makeBotController } from '../live';
import type { Checkpoint } from '../types';

const shot = (player: number, t: number, angle: number, power: number, enabled = true): ShotSpec => ({
  player,
  t,
  angle,
  power,
  enabled,
});

function ball(id: BallState['id'], x: number, y: number): BallState {
  return { id, pos: { x, y }, vel: { x: 0, y: 0 }, radius: DEFAULT_TABLE.ballRadius };
}

function ctxOf(
  balls: BallState[],
  myId: BallState['id'],
  cps: Checkpoint[],
  ordered = true,
  passedCount = 0
): BotContext {
  const myBall = balls.find((b) => b.id === myId)!;
  const ball1 = balls.find((b) => b.id === 'ball1')!;
  const cpPassed = cps.map((_, i) => i < passedCount);
  return {
    table: DEFAULT_TABLE,
    balls,
    myBall,
    ball1,
    targets: unpassedTargets(ordered, cps, cpPassed, passedCount, ball1),
    time: 1,
  };
}

describe('солвер (авто-расчёт)', () => {
  it('простой сценарий: находит план, проводящий шар1 через одну КТ', () => {
    const setup: KribilSetup = {
      table: DEFAULT_TABLE,
      balls: [ball('ball1', 200, 250), ball('p1', 80, 250)],
      checkpoints: [{ index: 0, pos: { x: 600, y: 250 }, radius: 34 }],
      ordered: true,
    };
    const out = solvePlan(setup, [shot(1, 0.5, 0, 300)], {
      iterations: 6,
      population: 40,
      seed: 5,
    });
    expect(out.result?.success).toBe(true);
    expect(out.result?.finishTime).toBeLessThan(20);
  });

  it('полная задача: план на 4 удара проводит шар1 через все 4 КТ дефолтной раскладки', () => {
    const setup = defaultSetup();
    const out = solvePlan(setup, heuristicShots(setup), {
      iterations: 14,
      population: 72,
      seed: 99,
    });
    expect(out.result?.success).toBe(true);
    expect(out.result?.passedCount).toBe(4);
    const finishTime = out.result?.finishTime ?? Number.POSITIVE_INFINITY;
    expect(finishTime).toBeLessThan(DEFAULT_TABLE.maxSimTime);
    // все 4 удара найдены и находятся в допустимых границах
    for (const s of out.plan) {
      expect(s.enabled).toBe(true);
      expect(s.t).toBeGreaterThanOrEqual(0);
      expect(s.t).toBeLessThanOrEqual(30);
      expect(s.power).toBeGreaterThan(0);
      expect(s.power).toBeLessThanOrEqual(1400);
    }
  }, 120000);

  it('детерминизм: одинаковый seed → идентичный план', () => {
    const setup = defaultSetup();
    const a = solvePlan(setup, heuristicShots(setup), { iterations: 3, population: 24, seed: 99 });
    const b = solvePlan(setup, heuristicShots(setup), { iterations: 3, population: 24, seed: 99 });
    expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
    expect(a.loss).toBe(b.loss);
  });

  it('planLoss: финиш лучше любого недобора, время финиша минимизируется', () => {
    const cps = [
      { index: 0, pos: { x: 0, y: 0 }, radius: 34 },
      { index: 1, pos: { x: 0, y: 0 }, radius: 34 },
      { index: 2, pos: { x: 0, y: 0 }, radius: 34 },
      { index: 3, pos: { x: 0, y: 0 }, radius: 34 },
    ];
    const finished = {
      success: true,
      finishTime: 10,
      cpTimes: [],
      cpMiss: [5, 5, 5, 5],
      passedCount: 4,
      events: [],
      frames: [],
      endTime: 10,
      ball1HitCount: 4,
    };
    const failed3 = { ...finished, success: false, finishTime: null, passedCount: 3, endTime: 20 };
    expect(planLoss(finished, cps)).toBeLessThan(planLoss(failed3, cps));
    // проход через центр (cpMiss≈0) лучше прохода по краю (cpMiss≈30)
    const thin = { ...finished, finishTime: 9, cpMiss: [30, 30, 30, 30] };
    const robust = { ...finished, finishTime: 10, cpMiss: [2, 2, 2, 2] };
    expect(planLoss(robust, cps)).toBeLessThan(planLoss(thin, cps));
  });

  it('mulberry32 детерминирован', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});

describe('NPC-боты', () => {
  it('Снайпер: прямой выстрел — шар1 проходит КТ', () => {
    const rng = mulberry32(1);
    const bot = createSniperBot(rng);
    const balls = [ball('ball1', 200, 250), ball('p1', 80, 250)];
    const cps: Checkpoint[] = [{ index: 0, pos: { x: 500, y: 250 }, radius: 34 }];
    const ctx = ctxOf(balls, 'p1', cps);
    const d = bot.decide(ctx);
    expect(d).not.toBeNull();
    const res = simulate(
      {
        table: DEFAULT_TABLE,
        balls,
        checkpoints: cps,
        ordered: true,
      },
      [shot(1, 0.1, d!.angle, d!.power)]
    );
    expect(res.cpTimes[0]).not.toBeNull();
  });

  it('Снайпер: если путь перекрыт другим шаром — ждёт (null)', () => {
    const rng = mulberry32(1);
    const bot = createSniperBot(rng);
    const balls = [
      ball('ball1', 200, 250),
      ball('p1', 80, 250),
      ball('p3', 350, 250), // блокер на линии
    ];
    const cps: Checkpoint[] = [{ index: 0, pos: { x: 500, y: 250 }, radius: 34 }];
    const d = bot.decide(ctxOf(balls, 'p1', cps));
    expect(d).toBeNull();
  });

  it('Бортовик: при перекрытой линии бьёт рикошетом от борта — шар1 проходит КТ', () => {
    const rng = mulberry32(2);
    const bot = createBankerBot(rng);
    const balls = [
      ball('ball1', 250, 400),
      ball('p1', 100, 400),
      ball('p3', 475, 400), // блокер на прямой линии к КТ
    ];
    const cps: Checkpoint[] = [{ index: 0, pos: { x: 700, y: 400 }, radius: 34 }];
    const ctx = ctxOf(balls, 'p1', cps);
    expect(createSniperBot(mulberry32(2)).decide(ctx)).toBeNull(); // прямой выстрел невозможен
    const d = bot.decide(ctx);
    expect(d).not.toBeNull();
    const res = simulate(
      { table: DEFAULT_TABLE, balls, checkpoints: cps, ordered: true },
      [shot(1, 0.1, d!.angle, d!.power)]
    );
    expect(res.cpTimes[0]).not.toBeNull();
  });

  it('Таран: всегда бьёт в допустимых границах и прямо в шар1', () => {
    const rng = mulberry32(3);
    const bot = createRusherBot(rng);
    const balls = [ball('ball1', 400, 300), ball('p1', 200, 200)];
    const d = bot.decide(ctxOf(balls, 'p1', defaultSetup().checkpoints));
    expect(d).not.toBeNull();
    expect(d!.power).toBeLessThanOrEqual(1400);
    expect(d!.power).toBeGreaterThan(0);
    const expected = Math.atan2(100, 200);
    expect(Math.abs(d!.angle - expected)).toBeLessThan(0.05);
  });

  it('Тактик: мини-CEM находит решение в простой позиции — шар1 проходит КТ', () => {
    const bot = createTacticianBot(7);
    const balls = [ball('ball1', 500, 300), ball('p1', 400, 420)];
    const cps: Checkpoint[] = [{ index: 0, pos: { x: 700, y: 150 }, radius: 34 }];
    const ctx = ctxOf(balls, 'p1', cps);
    const d = bot.decide(ctx);
    expect(d).not.toBeNull();
    const res = simulate(
      { table: DEFAULT_TABLE, balls, checkpoints: cps, ordered: true },
      [shot(1, 0.1, d!.angle, d!.power)]
    );
    expect(res.cpTimes[0]).not.toBeNull();
  }, 60000);

  it('живая партия: состав ботов (без игрока-человека) проводит шар1 через трассу', () => {
    const setup = defaultSetup();
    const game = new LiveGame(setup);
    const lineup = [
      { player: 1, bot: createSniperBot(mulberry32(11)) },
      { player: 2, bot: createBankerBot(mulberry32(12)) },
      { player: 4, bot: createTacticianBot(14) },
    ];
    const dt = 1 / 240;
    const controller = makeBotController(lineup, setup);
    // вручную крутит симуляцию опросами контроллера (до 95 с игрового времени)
    let guard = 0;
    while (!game.world.done && guard++ < 240 * 95) {
      game.advance(dt, 1, controller);
    }
    const res = game.world;
    expect(res.passedCount).toBeGreaterThanOrEqual(1);
    expect(res.finished || res.doneReason === 'allStopped' || res.doneReason === 'timeout').toBe(
      true
    );
  }, 120000);
});

