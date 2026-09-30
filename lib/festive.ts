// Праздничный акцент мира (план UX/UI, этап 5): палитра обложки комнаты в
// лобби (components/room-cover.tsx) и праздничного финала в «Итогах»
// (components/room-results.tsx). Чистые данные и функции без DOM: их
// проверяет tests/festive.test.mjs.
//
// У каждого мира три праздничных цвета — фон, акцент, узор — и три служебных:
//   ground — холмы и земля под сценой;
//   ink    — текст прямо поверх фона (шапка итогов), ≥ 4.5:1 к bg;
//   strong — акцент для данных на поверхностях интерфейса (полоски голосов,
//            полоса под шапкой): ≥ 3:1 и к светлой, и к тёмной поверхности, то
//            есть одинаково читается в обеих темах.
// Бейджи на обложке лежат на --jin-surface с --jin-text и от мира не зависят.
import { THEMES } from './model.ts';

export type FestivePalette = {
  /** id мира из THEMES; у неизвестной темы — 'neutral'. */
  id: string;
  bg: string;
  accent: string;
  pattern: string;
  ground: string;
  ink: string;
  strong: string;
};

/**
 * Поверхности, к которым проверяется `strong`: --jin-surface светлой и тёмной
 * темы (app/theme.css). Меняется тема — меняются и эти значения.
 */
export const SURFACES = { light: '#ffffff', dark: '#1c2130' } as const;

export const NEUTRAL_PALETTE: FestivePalette = {
  id: 'neutral',
  bg: '#e6e8f1',
  accent: '#6a58d6',
  pattern: '#a9b0c6',
  ground: '#c3c8d8',
  ink: '#2a3043',
  strong: '#6a58d6',
};

const PALETTES: Record<string, FestivePalette> = {
  // Рассвет над весенней степью, красные тюльпаны и солнце.
  nauryz: {
    id: 'nauryz',
    bg: '#fcecd0',
    accent: '#d8435c',
    pattern: '#f2a93b',
    ground: '#86ad6d',
    ink: '#3a2a1c',
    strong: '#c93b54',
  },
  // Бледное летнее небо, синие горы со снежными шапками, золотая трава.
  steppe: {
    id: 'steppe',
    bg: '#e3edf2',
    accent: '#5d7796',
    pattern: '#f6f3ea',
    ground: '#cfae6c',
    ink: '#22303f',
    strong: '#5d7796',
  },
  // Золотая осень: рыжие холмы, деревья и шанырак над ними.
  republic: {
    id: 'republic',
    bg: '#f6e3c6',
    accent: '#8c3b1f',
    pattern: '#e3a33a',
    ground: '#c47a3a',
    ink: '#3a2414',
    strong: '#b8662c',
  },
  // Бирюза и золото флага: солнце, орёл-беркут и орнамент «қошқар мүйіз».
  independence: {
    id: 'independence',
    bg: '#0f6874',
    accent: '#f3c14b',
    pattern: '#63c3cc',
    ground: '#0b5560',
    ink: '#ffffff',
    strong: '#1a8e9c',
  },
  // Зимняя ночь, снег, ёлки и огоньки гирлянды.
  newyear: {
    id: 'newyear',
    bg: '#22375a',
    accent: '#2f7d5b',
    pattern: '#ffd166',
    ground: '#eef3f7',
    ink: '#ffffff',
    strong: '#2f8a63',
  },
  // Тёплый весенний день, сплетённые кольца — «встречаемся вместе».
  unity: {
    id: 'unity',
    bg: '#f3ebdc',
    accent: '#d9643a',
    pattern: '#4f86c6',
    ground: '#a9b98d',
    ink: '#2f3326',
    strong: '#4f7fbd',
  },
};

/** Палитра мира; у темы, которой нет в THEMES или в таблице, — нейтральная. */
export function festivePalette(theme: string | undefined | null): FestivePalette {
  if (!theme || !THEMES.some((t) => t.id === theme)) return NEUTRAL_PALETTE;
  return PALETTES[theme] ?? NEUTRAL_PALETTE;
}

/** Палитра как CSS-переменные для атрибута style. */
export function festiveVars(p: FestivePalette): Record<string, string> {
  return {
    '--festive-bg': p.bg,
    '--festive-accent': p.accent,
    '--festive-pattern': p.pattern,
    '--festive-ground': p.ground,
    '--festive-ink': p.ink,
    '--color-festive': p.strong,
  };
}

/** Относительная яркость sRGB по WCAG 2.x. Принимает #rgb и #rrggbb. */
export function luminance(hex: string) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст двух непрозрачных цветов по WCAG 2.x, от 1 до 21. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Цвета конфетти финала: праздничные цвета мира. */
export function confettiColors(p: FestivePalette) {
  return [p.accent, p.pattern, p.strong, p.ground];
}
