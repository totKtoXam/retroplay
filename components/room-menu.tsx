'use client';
import type { ReactNode } from 'react';
import {
  Ellipsis,
  EyeOff,
  Maximize,
  Minimize,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { ConnectionStatus } from '@/lib/room-connection';
import { ConnectionIndicator } from './room-status';

export type RoomMenuItem = {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  onSelect: () => void;
};

/**
 * Меню «⋯» в шапке комнаты: всё второстепенное, что раньше стояло в шапке
 * отдельными кнопками, — музыка, погода, полный экран, приватность, настройки.
 * На узком экране (до 620px) шапка оставляет только «назад», название,
 * участников и это меню, поэтому сюда же попадают таймер, голоса, итоги,
 * приглашение и статус связи (`compact` — видны только на узком экране).
 */
export function RoomMenu({
  open,
  onOpenChange,
  compact,
  status,
  music,
  world,
  privacy,
  fullscreen,
  onToggleFullscreen,
  onSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compact: RoomMenuItem[];
  status: ConnectionStatus;
  /** Плеер — живой компонент со своими всплывающими окнами. */
  music: ReactNode;
  /** Время суток и погода; нет на корабле «Предателя». */
  world?: ReactNode;
  privacy?: { value: boolean; host: boolean; onToggle: () => void };
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onSettings: () => void;
}) {
  // Пункт сначала закрывает меню, потом действует: подтверждения и диалоги
  // открываются уже поверх сцены, а не поверх всплывающего меню.
  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className="game-tag room-menu-trigger"
        aria-label="Ещё: музыка, погода, полный экран и настройки"
        title="Ещё"
      >
        <Ellipsis size={16} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        className="room-menu-pop"
        align="end"
        aria-label="Меню комнаты"
      >
        <div className="room-menu-compact">
          <ConnectionIndicator status={status} compact />
          {compact.map((item) => (
            <button
              key={item.id}
              type="button"
              className="room-menu-item"
              onClick={run(item.onSelect)}
            >
              <item.icon size={16} aria-hidden="true" />
              <span>
                <strong>{item.label}</strong>
                {item.hint && <small>{item.hint}</small>}
              </span>
            </button>
          ))}
        </div>
        <div className="room-menu-block">
          <span className="room-menu-title">Музыка</span>
          {music}
        </div>
        {world && (
          <div className="room-menu-block">
            <span className="room-menu-title">Время суток и погода</span>
            {world}
          </div>
        )}
        {privacy && (
          <button
            type="button"
            className="room-menu-item"
            aria-pressed={privacy.value}
            title={
              privacy.host ? undefined : 'Приватное написание включает ведущий'
            }
            onClick={run(privacy.onToggle)}
          >
            <EyeOff size={16} aria-hidden="true" />
            <span>
              <strong>
                Приватное написание: {privacy.value ? 'включено' : 'выключено'}
              </strong>
              <small>
                {privacy.host
                  ? privacy.value
                    ? 'Новые заметки видны только автору, пока он их не раскроет'
                    : 'Новые заметки сразу видны всем'
                  : 'Меняет ведущий'}
              </small>
            </span>
          </button>
        )}
        <button
          type="button"
          className="room-menu-item"
          onClick={run(onToggleFullscreen)}
        >
          {fullscreen ? (
            <Minimize size={16} aria-hidden="true" />
          ) : (
            <Maximize size={16} aria-hidden="true" />
          )}
          <span>
            <strong>
              {fullscreen ? 'Выйти из полного экрана' : 'Полный экран'}
            </strong>
            <small>Игровой ввод без системных клавиш браузера</small>
          </span>
        </button>
        <button
          type="button"
          className="room-menu-item"
          onClick={run(onSettings)}
        >
          <Settings2 size={16} aria-hidden="true" />
          <span>
            <strong>Настройки</strong>
            <small>Графика, управление, профиль и правила комнаты</small>
          </span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
