'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { PLAYER_COLORS } from '@/lib/kribil/setup';
import type { BallId, ShotSpec } from '@/lib/kribil/types';
import { deg, rad } from '@/lib/kribil/vec';
import { Shuffle, Sparkles, Play, RotateCcw, Loader2 } from 'lucide-react';

interface Props {
  shots: ShotSpec[];
  onChange: (shots: ShotSpec[]) => void;
  selectedPlayer: number;
  onSelectPlayer: (p: number) => void;
  ordered: boolean;
  onOrderedChange: (v: boolean) => void;
  onRun: () => void;
  onAutoSolve: () => void;
  onResetPlan: () => void;
  onRandomize: () => void;
  solving: { done: number; total: number; best: number | null } | null;
  busy: boolean;
}

const PLAYER_LABEL: Record<number, string> = {
  1: 'Игрок 1',
  2: 'Игрок 2',
  3: 'Игрок 3',
  4: 'Игрок 4',
};

export default function PlannerPanel({
  shots,
  onChange,
  selectedPlayer,
  onSelectPlayer,
  ordered,
  onOrderedChange,
  onRun,
  onAutoSolve,
  onResetPlan,
  onRandomize,
  solving,
  busy,
}: Props) {
  const update = (player: number, patch: Partial<ShotSpec>) => {
    onChange(shots.map((s, i) => (i === player - 1 ? { ...s, ...patch } : s)));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch id="ordered" checked={ordered} onCheckedChange={onOrderedChange} />
          <Label htmlFor="ordered" className="text-sm cursor-pointer">
            КТ строго по порядку 1→4
          </Label>
        </div>
        <Button variant="outline" size="sm" onClick={onRandomize} disabled={busy}>
          <Shuffle className="w-4 h-4 mr-1" /> Перемешать
        </Button>
      </div>

      <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1">
        {shots.map((shot, i) => {
          const player = i + 1;
          const id = ('p' + player) as BallId;
          const color = PLAYER_COLORS[id];
          const selected = selectedPlayer === player;
          return (
            <div
              key={player}
              role="button"
              tabIndex={0}
              onClick={() => onSelectPlayer(player)}
              onKeyDown={(e) => e.key === 'Enter' && onSelectPlayer(player)}
              className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                selected ? 'border-foreground/60 bg-muted/60' : 'border-border bg-card'
              }`}
              data-testid={`shot-row-${player}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Checkbox
                  checked={shot.enabled}
                  onCheckedChange={(v) => update(player, { enabled: v === true })}
                  aria-label={`Удар игрока ${player}`}
                />
                <span
                  className="inline-block w-3.5 h-3.5 rounded-full border border-black/20"
                  style={{ background: color }}
                />
                <span className="text-sm font-medium">{PLAYER_LABEL[player]}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {selected ? 'тяните на столе — угол и сила' : 'клик — выбрать для прицеливания'}
                </span>
              </div>
              <div className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 ${shot.enabled ? '' : 'opacity-45 pointer-events-none'}`}>
                <Label className="text-xs text-muted-foreground self-center">Время, с</Label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  step={0.1}
                  value={Number(shot.t.toFixed(2))}
                  onChange={(e) => update(player, { t: Math.max(0, Number(e.target.value) || 0) })}
                  className="h-7 text-sm"
                />
                <Label className="text-xs text-muted-foreground self-center">
                  Угол, °
                </Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[Math.round(deg(shot.angle))]}
                    min={0}
                    max={359}
                    step={1}
                    onValueChange={(v) => update(player, { angle: rad(v[0]) })}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={359}
                    value={Math.round(deg(shot.angle))}
                    onChange={(e) =>
                      update(player, { angle: rad(Math.max(0, Math.min(359, Number(e.target.value) || 0))) })
                    }
                    className="h-7 w-16 text-sm"
                  />
                </div>
                <Label className="text-xs text-muted-foreground self-center">Сила</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[Math.round(shot.power)]}
                    min={60}
                    max={1400}
                    step={10}
                    onValueChange={(v) => update(player, { power: v[0] })}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={60}
                    max={1400}
                    value={Math.round(shot.power)}
                    onChange={(e) =>
                      update(player, { power: Math.max(60, Math.min(1400, Number(e.target.value) || 60)) })
                    }
                    className="h-7 w-16 text-sm"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {solving && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3" data-testid="solve-progress">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Авто-расчёт: {Math.round((solving.done / solving.total) * 100)}%
            {solving.best != null && (
              <span className="text-muted-foreground">
                · лучший финиш ≈ {solving.best.toFixed(2)} с
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${(solving.done / solving.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onRun} disabled={busy} data-testid="run-plan">
          <Play className="w-4 h-4 mr-1" /> Симуляция
        </Button>
        <Button onClick={onAutoSolve} disabled={busy} variant="secondary" data-testid="auto-solve">
          <Sparkles className="w-4 h-4 mr-1" /> Авто-расчёт
        </Button>
        <Button onClick={onResetPlan} disabled={busy} variant="outline" className="col-span-2">
          <RotateCcw className="w-4 h-4 mr-1" /> Сбросить план
        </Button>
      </div>
    </div>
  );
}
