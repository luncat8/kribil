import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TABLE,
  defaultSetup,
  defaultShots,
  type BallState,
  type KribilSetup,
  type ShotSpec,
} from '../setup';
import { simulate } from '../simulate';
import { stepWorld, createWorld } from '../world';

/** Конструктор сценария для тестов. */
function makeSetup(opts: {
  balls?: Array<{ id: BallState['id']; x: number; y: number; vx?: number; vy?: number }>;
  cps?: Array<[number, number, number]>; // [x, y, radius]
  ordered?: boolean;
  table?: Partial<typeof DEFAULT_TABLE>;
}): KribilSetup {
  const table = { ...DEFAULT_TABLE, ...opts.table };
  const r = table.ballRadius;
  const balls: BallState[] =
    opts.balls?.map((b) => ({
      id: b.id,
      pos: { x: b.x, y: b.y },
      vel: { x: b.vx ?? 0, y: b.vy ?? 0 },
      radius: r,
    })) ?? [];
  const base = defaultSetup();
  return {
    table,
    balls,
    checkpoints:
      opts.cps?.map(([x, y, radius], i) => ({ index: i, pos: { x, y }, radius })) ??
      base.checkpoints.map((c) => ({ ...c })),
    ordered: opts.ordered ?? true,
  };
}

const shot = (player: number, t: number, angle: number, power: number, enabled = true): ShotSpec => ({
  player,
  t,
  angle,
  power,
  enabled,
});

describe('физика: трение и движение', () => {
  it('шар с трением останавливается точно на расчётной дистанции v0²/2μ', () => {
    // v0 = 200, μ = 100 → путь 200, время 2 c
    const setup = makeSetup({
      balls: [{ id: 'ball1', x: 300, y: 250, vx: 200 }],
      table: { frictionDecel: 100, maxSimTime: 10 },
    });
    const res = simulate(setup, []);
    const b1 = res.frames[res.frames.length - 1].pos['ball1'];
    expect(Math.abs(b1.x - 500)).toBeLessThan(2); // 300 + 200, погрешность дискретизации
    expect(b1.y).toBeCloseTo(250, 5);
    expect(res.endTime).toBeGreaterThan(1.9);
    expect(res.endTime).toBeLessThan(2.15);
  });

  it('абсолютно упругий лобовой удар (e=1) передаёт всю скорость шару1', () => {
    const setup = makeSetup({
      balls: [
        { id: 'p1', x: 300, y: 250, vx: 500 },
        { id: 'ball1', x: 500, y: 250 },
      ],
      table: { frictionDecel: 0, ballRestitution: 1, maxSimTime: 1 },
    });
    const res = simulate(setup, []);
    // контакт когда зазор = 2r: биток пройдёт 500-300-26 = 174 → t ≈ 0.348
    const last = res.frames[res.frames.length - 1].pos;
    expect(last['ball1'].x).toBeGreaterThan(780); // 500 + 500*(1-0.348) ≈ 826
    expect(last['p1'].x).toBeLessThan(490); // биток остановился у места контакта
  });

  it('отскок от борта: шар не покидает стол и возвращается внутрь', () => {
    const setup = makeSetup({
      balls: [{ id: 'ball1', x: 500, y: 100, vx: 400 }],
      table: { maxSimTime: 6 },
    });
    const res = simulate(setup, []);
    for (const f of res.frames) {
      const p = f.pos['ball1'];
      expect(p.x).toBeGreaterThanOrEqual(DEFAULT_TABLE.ballRadius - 1e-6);
      expect(p.x).toBeLessThanOrEqual(DEFAULT_TABLE.width - DEFAULT_TABLE.ballRadius + 1e-6);
    }
    const final = res.frames[res.frames.length - 1].pos['ball1'];
    expect(final.x).toBeGreaterThan(700); // отскочил от правого борта
    expect(final.x).toBeLessThan(900); // ...и покатился назад, не остался у борта
  });
});

describe('Тест 1: биток попадает по шару1', () => {
  it('удар битка p1 точно в шар1 фиксирует попадание и приводит шар1 в движение', () => {
    const setup = makeSetup({
      balls: [
        { id: 'p1', x: 300, y: 250 },
        { id: 'ball1', x: 500, y: 250 },
      ],
      cps: [[700, 250, 34]],
    });
    const res = simulate(setup, [shot(1, 0.1, 0, 600)]);
    expect(res.ball1HitCount).toBeGreaterThanOrEqual(1);
    const hit = res.events.find((e) => e.kind === 'hitBall1');
    expect(hit).toBeDefined();
    expect(hit?.player).toBe(1);
    expect(hit?.t).toBeGreaterThan(0.1); // после выстрела
    const final = res.frames[res.frames.length - 1].pos['ball1'];
    expect(final.x).toBeGreaterThan(500); // шар1 сдвинулся вправо
  });

  it('биток, посланный в противоположную сторону, НЕ попадает по шару1', () => {
    const setup = makeSetup({
      balls: [
        { id: 'p1', x: 300, y: 250 },
        { id: 'ball1', x: 500, y: 250 },
      ],
      cps: [[700, 250, 34]],
    });
    const res = simulate(setup, [shot(1, 0.1, Math.PI, 250)]);
    expect(res.ball1HitCount).toBe(0);
    const final = res.frames[res.frames.length - 1].pos['ball1'];
    expect(final.x).toBeCloseTo(500, 5); // шар1 стоит на месте
  });

  it('удар по движущемуся битку откладывается до его полной остановки', () => {
    const setup = makeSetup({
      balls: [{ id: 'p1', x: 300, y: 250, vx: 300 }],
      cps: [[900, 250, 34]],
      table: { maxSimTime: 20 },
    });
    // биток изначально катится (v=300 → остановится через ~3.33 c), удар запланирован на t=0.5
    const w = createWorld(setup, [shot(1, 0.5, Math.PI / 2, 400)]);
    const dt = 1 / 240;
    while (!w.done) stepWorld(w, dt);
    const shotEvent = w.events.find((e) => e.kind === 'shot');
    expect(shotEvent).toBeDefined();
    expect(shotEvent!.t).toBeGreaterThanOrEqual(3.3); // после остановки битка
  });

  it('отключённый удар никогда не выполняется', () => {
    const setup = makeSetup({
      balls: [
        { id: 'p1', x: 300, y: 250 },
        { id: 'ball1', x: 500, y: 250 },
      ],
    });
    const res = simulate(setup, [shot(1, 0.1, 0, 600, false)]);
    expect(res.events.some((e) => e.kind === 'shot')).toBe(false);
  });
});

describe('Тест 2: шар1 проходит контрольную точку', () => {
  it('шар1, вытолкнутый битком, проходит через КТ и время прохода фиксируется', () => {
    const setup = makeSetup({
      balls: [
        { id: 'p1', x: 300, y: 250 },
        { id: 'ball1', x: 500, y: 250 },
      ],
      cps: [[700, 250, 34]],
    });
    const res = simulate(setup, [shot(1, 0.1, 0, 600)]);
    expect(res.cpTimes[0]).not.toBeNull();
    expect(res.cpTimes[0]!).toBeGreaterThan(0);
    expect(res.passedCount).toBe(1);
  });

  it('в режиме «по порядку» КТ2 не засчитывается раньше КТ1', () => {
    // шар1 стартует рядом с КТ2, КТ1 дальше по ходу движения
    const setup = makeSetup({
      balls: [
        { id: 'p1', x: 380, y: 250 },
        { id: 'ball1', x: 450, y: 250 },
      ],
      cps: [
        [700, 250, 34],
        [500, 250, 34],
      ],
      ordered: true,
    });
    const res = simulate(setup, [shot(1, 0.1, 0, 240)]);
    expect(res.cpTimes[0]).not.toBeNull(); // КТ1 пройдена
    expect(res.cpTimes[1]).toBeNull(); // КТ2 — только после КТ1
    expect(res.passedCount).toBe(1);
  });

  it('в режиме «любой порядок» ближняя КТ засчитывается первой', () => {
    const setup = makeSetup({
      balls: [
        { id: 'p1', x: 380, y: 250 },
        { id: 'ball1', x: 450, y: 250 },
      ],
      cps: [
        [700, 250, 34],
        [500, 250, 34],
      ],
      ordered: false,
    });
    const res = simulate(setup, [shot(1, 0.1, 0, 240)]);
    expect(res.cpTimes[1]).not.toBeNull(); // КТ2 пройдена первой
    expect(res.cpTimes[0]).not.toBeNull(); // потом КТ1
    expect(res.cpTimes[1]!).toBeLessThan(res.cpTimes[0]!);
    expect(res.passedCount).toBe(2);
  });

  it('шар, не долетевший до КТ, оставляет её непройденной', () => {
    const setup = makeSetup({
      balls: [
        { id: 'p1', x: 300, y: 250 },
        { id: 'ball1', x: 500, y: 250 },
      ],
      cps: [[990, 250, 34]],
      table: { maxSimTime: 12 },
    });
    const res = simulate(setup, [shot(1, 0.1, 0, 260)]); // слабый удар
    expect(res.cpTimes[0]).toBeNull();
    expect(res.success).toBe(false);
    expect(res.endTime).toBeGreaterThan(0);
  });
});

describe('Тест 3: общее время до финиша шар1', () => {
  it('скриптованный план: шар1 проходит 4 КТ, фиксируется общее время финиша', () => {
    const setup = makeSetup({
      balls: [
        { id: 'ball1', x: 150, y: 250 },
        { id: 'p1', x: 60, y: 250 },
      ],
      cps: [
        [320, 250, 34],
        [470, 250, 34],
        [620, 250, 34],
        [770, 250, 34],
      ],
      table: { maxSimTime: 20 },
    });
    const shots = [
      shot(1, 0.3, 0, 400),
      shot(2, 5, 0, 100, false),
      shot(3, 5, 0, 100, false),
      shot(4, 5, 0, 100, false),
    ];
    const res = simulate(setup, shots);
    expect(res.success).toBe(true);
    expect(res.finishTime).not.toBeNull();
    // v1 ≈ 400·0.975 = 390 → путь 620 пройден за ≈ (390−57.6)/90 ≈ 3.7 c + 0.3 c удара
    expect(res.finishTime!).toBeGreaterThan(2.5);
    expect(res.finishTime!).toBeLessThan(5);
    // времена прохода КТ строго возрастают
    const times = res.cpTimes.map((t) => t!);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    // и общее время = времени последней КТ
    expect(res.finishTime!).toBeCloseTo(times[3], 6);
  });

  it('детерминизм: два одинаковых заезда дают побитово идентичный результат', () => {
    const setup = defaultSetup();
    const shots = defaultShots();
    const a = simulate(setup, shots);
    const b = simulate(setup, shots);
    expect(a.finishTime).toBe(b.finishTime);
    expect(a.cpTimes).toEqual(b.cpTimes);
    expect(a.frames.length).toBe(b.frames.length);
    expect(JSON.stringify(a.frames)).toBe(JSON.stringify(b.frames));
    expect(a.events.length).toBe(b.events.length);
  });

  it('дефолтный план завершается финишем (санити-проверка игровой раскладки)', () => {
    const res = simulate(defaultSetup(), defaultShots());
    expect(res.success).toBe(true);
    expect(res.finishTime!).toBeLessThan(DEFAULT_TABLE.maxSimTime);
  });
});
