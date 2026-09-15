import type { BallId, KribilSetup, ShotSpec, Vec2 } from './types';
import { PLAYER_COLORS } from './setup';
import { rayCircleContact } from './geometry';
import { clamp, fromAngle } from './vec';

export const BORDER = 40;

export interface SceneBall {
  id: BallId;
  pos: Vec2;
  radius: number;
}

export interface Scene {
  setup: KribilSetup;
  balls: SceneBall[];
  cpPassed: boolean[];
  nextCpIndex: number | null;
  time: number;
  planShots?: ShotSpec[] | null;
  selectedPlayer?: number | null;
  aim?: { player: number; angle: number; power: number } | null;
  trail?: Vec2[];
}

export function canvasSize(setup: KribilSetup): { w: number; h: number } {
  return { w: setup.table.width + BORDER * 2, h: setup.table.height + BORDER * 2 };
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  angle: number,
  length: number,
  color: string,
  width = 2.5
) {
  const to = {
    x: from.x + Math.cos(angle) * length,
    y: from.y + Math.sin(angle) * length,
  };
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  // наконечник
  const a1 = angle + Math.PI * 0.85;
  const a2 = angle - Math.PI * 0.85;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x + Math.cos(a1) * 9, to.y + Math.sin(a1) * 9);
  ctx.lineTo(to.x + Math.cos(a2) * 9, to.y + Math.sin(a2) * 9);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawBall(ctx: CanvasRenderingContext2D, b: SceneBall, color: string, label: string) {
  const { x, y } = b.pos;
  const r = b.radius;
  const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, color);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();
  // блик
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  // номер
  ctx.font = `bold ${Math.round(r * 0.95)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(label, x, y + 0.5);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, x, y + 0.5);
}

/** Главная отрисовка сцены на канвасе (логические координаты canvasSize). */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { setup } = scene;
  const t = setup.table;
  const B = BORDER;
  const W = t.width + B * 2;
  const H = t.height + B * 2;

  ctx.clearRect(0, 0, W, H);

  // деревянная рама
  const woodGrad = ctx.createLinearGradient(0, 0, 0, H);
  woodGrad.addColorStop(0, '#8a6540');
  woodGrad.addColorStop(0.5, '#6d4e30');
  woodGrad.addColorStop(1, '#59402a');
  roundRectPath(ctx, 0, 0, W, H, 18);
  ctx.fillStyle = woodGrad;
  ctx.fill();

  // сукно
  ctx.fillStyle = '#0f7a44';
  ctx.fillRect(B, B, t.width, t.height);
  const vign = ctx.createRadialGradient(
    B + t.width / 2,
    B + t.height / 2,
    80,
    B + t.width / 2,
    B + t.height / 2,
    t.width * 0.75
  );
  vign.addColorStop(0, 'rgba(255,255,255,0.05)');
  vign.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = vign;
  ctx.fillRect(B, B, t.width, t.height);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#0a5c33';
  ctx.strokeRect(B + 2.5, B + 2.5, t.width - 5, t.height - 5);

  ctx.save();
  ctx.translate(B, B);

  // траектория шар1
  if (scene.trail && scene.trail.length > 1) {
    ctx.beginPath();
    ctx.moveTo(scene.trail[0].x, scene.trail[0].y);
    for (const p of scene.trail) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = 'rgba(255,220,220,0.28)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([]);
    ctx.stroke();
  }

  // контрольные точки
  for (const cp of setup.checkpoints) {
    const passed = scene.cpPassed[cp.index] ?? false;
    const isNext = scene.nextCpIndex === cp.index;
    ctx.beginPath();
    ctx.arc(cp.pos.x, cp.pos.y, cp.radius, 0, Math.PI * 2);
    if (passed) {
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
    }
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = passed ? 'rgba(220,255,235,0.9)' : 'rgba(255,255,255,0.65)';
    ctx.stroke();
    ctx.setLineDash([]);
    if (isNext) {
      const pulse = 5 + Math.sin(scene.time * 5) * 2.5;
      ctx.beginPath();
      ctx.arc(cp.pos.x, cp.pos.y, cp.radius + pulse, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(253,224,71,0.85)';
      ctx.stroke();
    }
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = passed ? 'rgba(230,255,240,0.95)' : 'rgba(255,255,255,0.85)';
    ctx.fillText(String(cp.index + 1), cp.pos.x, cp.pos.y);
  }

  // стрелки плана (из стартовых позиций битков)
  if (scene.planShots) {
    for (const shot of scene.planShots) {
      if (!shot.enabled) continue;
      const id = ('p' + shot.player) as BallId;
      const start = scene.setup.balls.find((b) => b.id === id);
      if (!start) continue;
      const color = PLAYER_COLORS[id];
      const selected = scene.selectedPlayer === shot.player;
      const length = 26 + (clamp(shot.power, 0, 1400) / 1400) * 86;
      if (selected) {
        ctx.beginPath();
        ctx.arc(start.pos.x, start.pos.y, 19, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      drawArrow(ctx, start.pos, shot.angle, length, color, selected ? 3.5 : 2.2);
      ctx.font = '10px sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      const tip = {
        x: start.pos.x + Math.cos(shot.angle) * (length + 12),
        y: start.pos.y + Math.sin(shot.angle) * (length + 12),
      };
      ctx.fillText(`t=${shot.t.toFixed(1)}s`, tip.x - 10, tip.y);
    }
  }

  // прицеливание (перетаскивание)
  if (scene.aim) {
    const id = ('p' + scene.aim.player) as BallId;
    const cue = scene.balls.find((b) => b.id === id);
    const ball1 = scene.balls.find((b) => b.id === 'ball1');
    if (cue) {
      const dir = fromAngle(scene.aim.angle);
      const length = 40 + (clamp(scene.aim.power, 0, 1400) / 1400) * 160;
      ctx.setLineDash([8, 6]);
      drawArrow(ctx, cue.pos, scene.aim.angle, length, 'rgba(255,255,255,0.9)', 2.5);
      ctx.setLineDash([]);
      // предсказание: призрачный шар и направление шар1
      if (ball1) {
        const contact = rayCircleContact(cue.pos, dir, ball1.pos, cue.radius + ball1.radius);
        if (contact) {
          ctx.beginPath();
          ctx.arc(contact.x, contact.y, cue.radius, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.setLineDash([]);
          const nx = ball1.pos.x - contact.x;
          const ny = ball1.pos.y - contact.y;
          const nl = Math.hypot(nx, ny) || 1;
          drawArrow(
            ctx,
            ball1.pos,
            Math.atan2(ny, nx),
            52,
            'rgba(255,255,255,0.75)',
            2
          );
        }
      }
      // подпись силы
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.textAlign = 'left';
      ctx.fillText(
        `сила ${Math.round(scene.aim.power)}`,
        cue.pos.x + Math.cos(scene.aim.angle) * (length + 14) - 20,
        cue.pos.y + Math.sin(scene.aim.angle) * (length + 14)
      );
    }
  }

  // шары
  for (const b of scene.balls) {
    if (b.id === 'ball1') {
      drawBall(ctx, b, '#dc2626', '1');
    } else {
      drawBall(ctx, b, PLAYER_COLORS[b.id], b.id.slice(1));
    }
  }

  ctx.restore();
}
