'use client';

import { dayMoment, type DaySource, type TimeOfDay } from '@/lib/day-cycle';

/**
 * Внутриигровые часы под счётом матча.
 *
 * Формат выбран так, чтобы одним взглядом читались три вещи: что сейчас
 * (значок фазы), сколько «времени» в мире (игровые ЧЧ:ММ — привычнее любой
 * шкалы прогресса) и сколько осталось до смены (М:СС реального времени, ведь
 * планировать ночную вылазку игрок будет в реальных секундах). Полоска под
 * строкой показывает то же, но без чтения — ею удобно ловить момент заката.
 *
 * Остановленные сутки честно говорят «сутки на паузе»: иначе застывшие часы
 * читались бы как зависший интерфейс.
 */

const PHASES: Record<TimeOfDay, { icon: string; label: string }> = {
  dawn: { icon: '🌅', label: 'Рассвет' },
  day: { icon: '☀️', label: 'День' },
  sunset: { icon: '🌇', label: 'Закат' },
  night: { icon: '🌙', label: 'Ночь' },
};

const two = (v: number) => String(v).padStart(2, '0');

export function GameClock({ state, now }: { state: DaySource; now: number }) {
  const moment = dayMoment(state, now);
  const phase = PHASES[moment.time];
  const next = PHASES[moment.next];
  const left = `${Math.floor(moment.secondsLeft / 60)}:${two(moment.secondsLeft % 60)}`;
  return (
    <div
      className={`game-clock ${moment.running ? 'running' : 'paused'} time-${moment.time}`}
      title={
        moment.running
          ? `Игровое время ${two(moment.hours)}:${two(moment.minutes)} · ${next.label} через ${left}`
          : `Сутки остановлены на «${phase.label.toLowerCase()}»`
      }
    >
      <span className="game-clock-phase" aria-hidden="true">
        {phase.icon}
      </span>
      <span className="game-clock-time">
        {two(moment.hours)}:{two(moment.minutes)}
      </span>
      <span className="game-clock-next">
        {moment.running ? (
          <>
            {next.icon} через {left}
          </>
        ) : (
          'сутки на паузе'
        )}
      </span>
      <span
        className="game-clock-track"
        aria-hidden="true"
        style={{ ['--phase-progress' as string]: moment.running ? moment.progress : 1 }}
      />
    </div>
  );
}
