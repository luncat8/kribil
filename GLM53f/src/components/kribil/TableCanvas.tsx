'use client';

import { useEffect, useRef } from 'react';
import { BORDER, canvasSize, drawScene, type Scene } from '@/lib/kribil/renderer';
import type { Vec2 } from '@/lib/kribil/types';
import { useLatestRef } from '@/hooks/use-latest-ref';

export type PointerPhase = 'start' | 'move' | 'end';

interface Props {
  getScene: () => Scene;
  onPointer?: (phase: PointerPhase, pt: Vec2) => void;
  className?: string;
}

/** Игровой стол: рисует сцену в rAF-цикле и переводит указатель в координаты поля. */
export default function TableCanvas({ getScene, onPointer, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useLatestRef(getScene);
  const pointerRef = useLatestRef(onPointer);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const scene = sceneRef.current();
      const { w, h } = canvasSize(scene.setup);
      // HiDPI
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScene(ctx, scene);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toTable = (e: React.PointerEvent<HTMLCanvasElement>): Vec2 => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scene = sceneRef.current();
    const { w, h } = canvasSize(scene.setup);
    const x = ((e.clientX - rect.left) * w) / rect.width - BORDER;
    const y = ((e.clientY - rect.top) * h) / rect.height - BORDER;
    return { x, y };
  };

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-auto touch-none select-none rounded-xl shadow-lg ${className ?? ''}`}
      style={{ aspectRatio: '1080 / 580' }}
      data-testid="kribil-table"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pointerRef.current?.('start', toTable(e));
      }}
      onPointerMove={(e) => pointerRef.current?.('move', toTable(e))}
      onPointerUp={(e) => pointerRef.current?.('end', toTable(e))}
      onPointerCancel={(e) => pointerRef.current?.('end', toTable(e))}
    />
  );
}
