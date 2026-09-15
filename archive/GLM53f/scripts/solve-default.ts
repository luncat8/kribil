/* Подбирает и печатает хороший дефолтный план для раскладки по умолчанию.
 * Запуск: bun scripts/solve-default.ts */
import { defaultSetup, heuristicShots } from '../src/lib/kribil/setup';
import { solvePlan } from '../src/lib/kribil/solver';

const setup = defaultSetup();
for (const seed of [7, 11, 20260915, 3, 42]) {
  const t0 = Date.now();
  const out = solvePlan(setup, heuristicShots(setup), {
    iterations: 10,
    population: 60,
    seed,
  });
  const ok = out.result?.success;
  console.log(
    `seed=${seed} success=${ok} finish=${out.result?.finishTime?.toFixed(2) ?? '-'} loss=${out.loss.toFixed(2)} evals=${out.evaluations} ms=${Date.now() - t0}`
  );
  if (ok) {
    console.log(
      JSON.stringify(
        out.plan.map((s) => ({
          player: s.player,
          t: +s.t.toFixed(2),
          angle: +s.angle.toFixed(3),
          power: Math.round(s.power),
          enabled: s.enabled,
        }))
      )
    );
    break;
  }
}
