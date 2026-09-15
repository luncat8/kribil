export type Vec = { x: number; y: number };

export type Ball = {
  id: string;
  kind: "target" | "cue";
  player?: number;
  position: Vec;
  velocity: Vec;
  mass: number;
  radius: number;
};

export type Checkpoint = { id: number; position: Vec; radius: number };

export type Shot = {
  player: number;
  time: number;
  angle: number;
  power: number;
};

export type Snapshot = {
  time: number;
  balls: Ball[];
  checkpointIndex: number;
};

export type SimulationResult = {
  snapshots: Snapshot[];
  finishTime: number | null;
  checkpointTimes: Array<number | null>;
  collisions: Array<{ time: number; a: string; b: string }>;
};

export const TABLE = { width: 1000, height: 560 };

const cloneBall = (ball: Ball): Ball => ({
  ...ball,
  position: { ...ball.position },
  velocity: { ...ball.velocity },
});

const length = (v: Vec) => Math.hypot(v.x, v.y);

export function simulate(
  inputBalls: Ball[],
  checkpoints: Checkpoint[],
  shots: Shot[],
  friction = 0.12,
  duration = 24,
  dt = 1 / 100,
): SimulationResult {
  const balls = inputBalls.map(cloneBall);
  const orderedShots = [...shots].sort((a, b) => a.time - b.time);
  const snapshots: Snapshot[] = [];
  const checkpointTimes = checkpoints.map(() => null as number | null);
  const collisions: SimulationResult["collisions"] = [];
  let checkpointIndex = 0;
  let shotIndex = 0;
  let finishTime: number | null = null;
  let lastSample = -1;

  for (let step = 0; step <= Math.ceil(duration / dt); step += 1) {
    const time = step * dt;

    while (shotIndex < orderedShots.length && orderedShots[shotIndex].time <= time + dt / 2) {
      const shot = orderedShots[shotIndex];
      const cue = balls.find((ball) => ball.player === shot.player && ball.kind === "cue");
      if (cue) {
        const speed = shot.power * 36 / cue.mass;
        cue.velocity.x += Math.cos(shot.angle) * speed;
        cue.velocity.y += Math.sin(shot.angle) * speed;
      }
      shotIndex += 1;
    }

    for (const ball of balls) {
      ball.position.x += ball.velocity.x * dt;
      ball.position.y += ball.velocity.y * dt;

      if (ball.position.x < ball.radius) {
        ball.position.x = ball.radius;
        ball.velocity.x = Math.abs(ball.velocity.x) * 0.92;
      } else if (ball.position.x > TABLE.width - ball.radius) {
        ball.position.x = TABLE.width - ball.radius;
        ball.velocity.x = -Math.abs(ball.velocity.x) * 0.92;
      }
      if (ball.position.y < ball.radius) {
        ball.position.y = ball.radius;
        ball.velocity.y = Math.abs(ball.velocity.y) * 0.92;
      } else if (ball.position.y > TABLE.height - ball.radius) {
        ball.position.y = TABLE.height - ball.radius;
        ball.velocity.y = -Math.abs(ball.velocity.y) * 0.92;
      }

      const speed = length(ball.velocity);
      if (speed > 0) {
        const nextSpeed = Math.max(0, speed - friction * 90 * dt);
        const ratio = nextSpeed / speed;
        ball.velocity.x *= ratio;
        ball.velocity.y *= ratio;
      }
    }

    for (let i = 0; i < balls.length; i += 1) {
      for (let j = i + 1; j < balls.length; j += 1) {
        const a = balls[i];
        const b = balls[j];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const distance = Math.hypot(dx, dy);
        const minDistance = a.radius + b.radius;
        if (distance <= 0 || distance >= minDistance) continue;

        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = minDistance - distance;
        const totalMass = a.mass + b.mass;
        a.position.x -= nx * overlap * (b.mass / totalMass);
        a.position.y -= ny * overlap * (b.mass / totalMass);
        b.position.x += nx * overlap * (a.mass / totalMass);
        b.position.y += ny * overlap * (a.mass / totalMass);

        const relativeNormal = (b.velocity.x - a.velocity.x) * nx + (b.velocity.y - a.velocity.y) * ny;
        if (relativeNormal < 0) {
          const impulse = -(1 + 0.96) * relativeNormal / (1 / a.mass + 1 / b.mass);
          a.velocity.x -= (impulse / a.mass) * nx;
          a.velocity.y -= (impulse / a.mass) * ny;
          b.velocity.x += (impulse / b.mass) * nx;
          b.velocity.y += (impulse / b.mass) * ny;
          collisions.push({ time, a: a.id, b: b.id });
        }
      }
    }

    const target = balls.find((ball) => ball.kind === "target");
    const checkpoint = checkpoints[checkpointIndex];
    if (target && checkpoint && Math.hypot(target.position.x - checkpoint.position.x, target.position.y - checkpoint.position.y) <= checkpoint.radius) {
      checkpointTimes[checkpointIndex] = time;
      checkpointIndex += 1;
      if (checkpointIndex === checkpoints.length) finishTime = time;
    }

    if (time - lastSample >= 0.06 || step === 0 || step === Math.ceil(duration / dt)) {
      snapshots.push({ time, balls: balls.map(cloneBall), checkpointIndex });
      lastSample = time;
    }
  }

  return { snapshots, finishTime, checkpointTimes, collisions };
}

export function closestSnapshot(result: SimulationResult, time: number) {
  let closest = result.snapshots[0];
  for (const snapshot of result.snapshots) {
    if (Math.abs(snapshot.time - time) < Math.abs(closest.time - time)) closest = snapshot;
  }
  return closest;
}

export function defaultBalls(radius = 14, mass = 1): Ball[] {
  return [
    { id: "target", kind: "target", position: { x: 190, y: 390 }, velocity: { x: 0, y: 0 }, radius, mass },
    { id: "cue-1", kind: "cue", player: 1, position: { x: 95, y: 425 }, velocity: { x: 0, y: 0 }, radius, mass },
    { id: "cue-2", kind: "cue", player: 2, position: { x: 390, y: 470 }, velocity: { x: 0, y: 0 }, radius, mass },
    { id: "cue-3", kind: "cue", player: 3, position: { x: 680, y: 410 }, velocity: { x: 0, y: 0 }, radius, mass },
    { id: "cue-4", kind: "cue", player: 4, position: { x: 865, y: 225 }, velocity: { x: 0, y: 0 }, radius, mass },
  ];
}

export const defaultCheckpoints: Checkpoint[] = [
  { id: 1, position: { x: 340, y: 360 }, radius: 35 },
  { id: 2, position: { x: 535, y: 275 }, radius: 35 },
  { id: 3, position: { x: 735, y: 205 }, radius: 35 },
  { id: 4, position: { x: 875, y: 105 }, radius: 38 },
];

export const defaultShots: Shot[] = [
  { player: 1, time: 0.4, angle: -0.33, power: 8.6 },
  { player: 2, time: 4.1, angle: -1.0, power: 7.4 },
  { player: 3, time: 7.8, angle: -1.33, power: 7.8 },
  { player: 4, time: 11.2, angle: -2.28, power: 6.8 },
];