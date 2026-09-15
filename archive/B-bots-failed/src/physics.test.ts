import { describe, expect, it } from "vitest";
import { defaultBalls, simulate, type Ball, type Checkpoint } from "./physics";

const stationaryBall = (id: string, kind: Ball["kind"], x: number, player?: number): Ball => ({
  id, kind, player, position: { x, y: 280 }, velocity: { x: 0, y: 0 }, mass: 1, radius: 14,
});

describe("Kribil physics", () => {
  it("registers a cue ball impact with the target ball", () => {
    const balls = [stationaryBall("target", "target", 300), stationaryBall("cue-1", "cue", 180, 1)];
    const result = simulate(balls, [], [{ player: 1, time: 0, angle: 0, power: 5 }], 0, 2);
    expect(result.collisions.some((hit) => hit.a === "target" || hit.b === "target")).toBe(true);
  });

  it("marks a checkpoint when the target crosses its area", () => {
    const balls = [stationaryBall("target", "target", 300), stationaryBall("cue-1", "cue", 180, 1)];
    const checkpoints: Checkpoint[] = [{ id: 1, position: { x: 430, y: 280 }, radius: 42 }];
    const result = simulate(balls, checkpoints, [{ player: 1, time: 0, angle: 0, power: 7 }], 0, 3);
    expect(result.checkpointTimes[0]).not.toBeNull();
  });

  it("returns the total time when the last checkpoint is reached", () => {
    const balls = [stationaryBall("target", "target", 300), stationaryBall("cue-1", "cue", 180, 1)];
    const checkpoints: Checkpoint[] = [
      { id: 1, position: { x: 400, y: 280 }, radius: 38 },
      { id: 2, position: { x: 500, y: 280 }, radius: 38 },
    ];
    const result = simulate(balls, checkpoints, [{ player: 1, time: 0, angle: 0, power: 8 }], 0, 4);
    expect(result.finishTime).not.toBeNull();
    expect(result.finishTime).toBe(result.checkpointTimes[1]);
  });

  it("keeps all default balls inside the table", () => {
    expect(defaultBalls().every((ball) => ball.position.x > 0 && ball.position.y > 0)).toBe(true);
  });
});