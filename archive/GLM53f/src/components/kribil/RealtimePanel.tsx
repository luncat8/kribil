'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BotStrategy } from '@/lib/kribil/bots';
import { PLAYER_COLORS } from '@/lib/kribil/setup';
import type { BallId } from '@/lib/kribil/types';
import { Play, RotateCcw, MousePointer2 } from 'lucide-react';

export interface RtPlayerStatus {
  player: number;
  botName: string | null; // null → играет человек
  fired: boolean;
}

interface Props {
  humanPlayer: number; // 0 — наблюдатель
  onHumanPlayerChange: (p: number) => void;
  statuses: RtPlayerStatus[];
  running: boolean;
  done: boolean;
  onStart: () => void;
  onReset: () => void;
}

export default function RealtimePanel({
  humanPlayer,
  onHumanPlayerChange,
  statuses,
  running,
  done,
  onStart,
  onReset,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label className="text-sm">Ваша роль</Label>
        <Select
          value={String(humanPlayer)}
          onValueChange={(v) => onHumanPlayerChange(Number(v))}
          disabled={running}
        >
          <SelectTrigger data-testid="role-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((p) => (
              <SelectItem key={p} value={String(p)}>
                Играть за игрока {p}
              </SelectItem>
            ))}
            <SelectItem value="0">Только NPC (наблюдать)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1">
        {statuses.map((st) => {
          const color = PLAYER_COLORS[('p' + st.player) as BallId];
          return (
            <div
              key={st.player}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
            >
              <span
                className="inline-block w-3.5 h-3.5 rounded-full border border-black/20"
                style={{ background: color }}
              />
              <span className="text-sm font-medium">Игрок {st.player}</span>
              <span className="text-xs text-muted-foreground">
                {st.botName ?? 'это вы'}
              </span>
              <span
                className={`ml-auto text-xs font-medium ${
                  st.fired ? 'text-emerald-600' : 'text-muted-foreground'
                }`}
              >
                {st.fired ? 'удар выполнен' : 'готов'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground flex gap-2">
        <MousePointer2 className="w-4 h-4 shrink-0" />
        <span>
          Зажмите левую кнопку мыши на столе и тяните — появится линия прицела и
          предсказание направления шар1. Отпустите — удар. Каждый игрок бьёт один
          раз, только когда его биток стоит.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onStart} disabled={running && !done} data-testid="rt-start">
          <Play className="w-4 h-4 mr-1" /> {running ? 'Идёт заезд…' : 'Начать заезд'}
        </Button>
        <Button onClick={onReset} variant="outline" data-testid="rt-reset">
          <RotateCcw className="w-4 h-4 mr-1" /> Заново
        </Button>
      </div>
    </div>
  );
}

export type { BotStrategy };
