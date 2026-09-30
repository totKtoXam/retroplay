'use client';
import type { CSSProperties } from 'react';
import { PHASES, THEMES, type RoomState } from '@/lib/model';
import { confettiColors, festivePalette, festiveVars } from '@/lib/festive';
import { meetingStats } from '@/lib/room-export';
import { WorldScene } from './room-cover';

const rules = new Intl.PluralRules('ru-RU');
/** Форма слова без числа: число в шапке набрано отдельно и крупнее. */
const word = (n: number, [one, few, many]: [string, string, string]) => {
  const form = rules.select(n);
  return form === 'one' ? one : form === 'few' ? few : many;
};

/** Встреча дошла до последнего этапа — «Итоги». */
export const isFinale = (s: RoomState) => s.phase === PHASES.length - 1;

/**
 * Шапка «Итогов»: мир комнаты, название встречи и её цифры. На этапе «Итоги»
 * при открытии один раз падает конфетти цветами мира — единственный
 * «праздничный» момент панели; с prefers-reduced-motion его нет совсем.
 */
export function ResultsHero({ s }: { s: RoomState }) {
  const palette = festivePalette(s.theme);
  const world = THEMES.find((t) => t.id === s.theme)?.name;
  const stats = meetingStats(s);
  const finale = isFinale(s);
  const items: [number, [string, string, string]][] = [
    [stats.ideas, ['идея', 'идеи', 'идей']],
    [stats.votes, ['голос', 'голоса', 'голосов']],
    [stats.actions, ['действие', 'действия', 'действий']],
    [stats.people, ['участник', 'участника', 'участников']],
  ];
  return (
    <header
      className="results-hero"
      data-finale={finale || undefined}
      style={festiveVars(palette) as CSSProperties}
    >
      <WorldScene theme={s.theme} className="results-hero-scene" />
      <div className="results-hero-text">
        {world && <p className="results-hero-world">{world}</p>}
        <p className="results-hero-title">{s.title || 'Ретроспектива'}</p>
        <p className="results-hero-lead">
          {finale
            ? 'Встреча подошла к финалу. Вот что команда успела вместе.'
            : 'Промежуточные итоги — встреча ещё идёт.'}
        </p>
        <dl className="results-stats">
          {items.map(([n, forms]) => (
            <div key={forms[2]}>
              <dt>{word(n, forms)}</dt>
              <dd>{n}</dd>
            </div>
          ))}
        </dl>
      </div>
      {finale && <Confetti colors={confettiColors(palette)} />}
    </header>
  );
}

/** Кусочки конфетти: раскладка детерминированная, чтобы не прыгала при перерисовке. */
function Confetti({ colors }: { colors: string[] }) {
  return (
    <div className="results-confetti" aria-hidden="true">
      {Array.from({ length: 18 }, (_, i) => (
        <i
          key={i}
          style={
            {
              '--x': `${(i * 37 + 11) % 100}%`,
              '--d': `${(i % 6) * 60}ms`,
              '--r': `${((i * 53) % 90) - 45}deg`,
              '--drift': `${((i * 29) % 40) - 20}px`,
              '--c': colors[i % colors.length],
            } as CSSProperties
          }
          className={i % 3 === 0 ? 'round' : undefined}
        />
      ))}
    </div>
  );
}
