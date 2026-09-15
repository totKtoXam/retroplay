'use client';

import { CloudSun, Lock, Pause, Play } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { dayMoment, type DayCycle } from '@/lib/day-cycle';

/**
 * Время суток и время года прямо в шапке комнаты.
 *
 * Раньше они лежали в «Облике мира» — третьим экраном в глубине меню, — хотя
 * их крутят посреди встречи чаще всего остального. Один чип показывает, что
 * сейчас стоит, и открывает обе шкалы; отдельного чипа на каждую не делаем,
 * чтобы не отбирать место у фаз и таймера.
 */

const TIMES = [
  { id: 'dawn', label: 'Рассвет', icon: '🌅' },
  { id: 'day', label: 'День', icon: '☀️' },
  { id: 'sunset', label: 'Закат', icon: '🌇' },
  { id: 'night', label: 'Ночь', icon: '🌙' },
] as const;

const SEASONS = [
  { id: 'spring', label: 'Весна', icon: '🌱' },
  { id: 'summer', label: 'Лето', icon: '🌻' },
  { id: 'autumn', label: 'Осень', icon: '🍂' },
  { id: 'winter', label: 'Зима', icon: '❄️' },
] as const;

export function WorldQuickChip({
  time,
  season,
  now,
  dayCycle,
  host,
  onTimeChange,
  onSeasonChange,
  onDayCycleChange,
  onLocked,
}: {
  time: string;
  season: string;
  /** Серверное время: по нему считается фаза идущих суток. */
  now: number;
  dayCycle?: DayCycle;
  host: boolean;
  onTimeChange: (time: string) => void;
  onSeasonChange: (season: string) => void;
  onDayCycleChange: (running: boolean) => void;
  /** Не ведущий тоже открывает чип, но вместо молчания получает объяснение. */
  onLocked: () => void;
}) {
  // Пока сутки идут, чип показывает не сохранённое `time`, а ту фазу, которая
  // сейчас на небе: иначе значок расходился бы с картинкой.
  const moment = dayMoment({ time, dayCycle }, now);
  const nowTime = TIMES.find((t) => t.id === moment.time) || TIMES[1];
  const nowSeason = SEASONS.find((s) => s.id === season) || SEASONS[1];
  const running = moment.running;
  return (
    <Popover>
      <PopoverTrigger
        className="game-tag world-chip"
        title="Время суток и время года"
        aria-label={`Мир: ${nowTime.label}, ${nowSeason.label}`}
      >
        <CloudSun size={14} />
        <span className="world-chip-now">
          {nowTime.icon}
          {nowSeason.icon}
        </span>
      </PopoverTrigger>
      <PopoverContent className="world-chip-pop" align="end">
        {!host && (
          <p className="world-chip-locked">
            <Lock size={13} /> Облик мира меняет ведущий встречи
          </p>
        )}
        <span className="world-chip-title">Время суток</span>
        {/* Сутки идут сами; любой ручной выбор ниже их останавливает и
            фиксирует время — про это здесь и написано, чтобы ведущий не решил,
            что выбор «не сработал». Вернуть ход суток можно этой же кнопкой. */}
        <button
          type="button"
          className={`world-chip-cycle ${running ? 'active' : ''}`}
          onClick={() => (host ? onDayCycleChange(!running) : onLocked())}
        >
          {running ? <Pause size={13} /> : <Play size={13} />}
          {running ? 'Сутки идут · 12 минут' : 'Время суток зафиксировано'}
        </button>
        <div className="world-chip-grid">
          {TIMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`world-chip-option ${!running && t.id === nowTime.id ? 'active' : ''}`}
              onClick={() => (host ? onTimeChange(t.id) : onLocked())}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        <span className="world-chip-title">Время года</span>
        <div className="world-chip-grid">
          {SEASONS.map((sn) => (
            <button
              key={sn.id}
              type="button"
              className={`world-chip-option ${sn.id === nowSeason.id ? 'active' : ''}`}
              onClick={() => (host ? onSeasonChange(sn.id) : onLocked())}
            >
              <span>{sn.icon}</span>
              {sn.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
