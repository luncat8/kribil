import type { Vec2 } from './types';

export const TAU = Math.PI * 2;

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const len2 = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export const fromAngle = (a: number, k = 1): Vec2 => ({ x: Math.cos(a) * k, y: Math.sin(a) * k });
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);

export function lerpV(a: Vec2, b: Vec2, k: number): Vec2 {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export function wrapAngle(a: number): number {
  let x = a % TAU;
  if (x < 0) x += TAU;
  return x;
}

export const deg = (rad: number): number => ((rad * 180) / Math.PI + 360) % 360;
export const rad = (d: number): number => (d * Math.PI) / 180;
