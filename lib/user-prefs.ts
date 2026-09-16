/**
 * Личные настройки, которые живут на устройстве и переживают выход из комнаты,
 * перезагрузку и выход из аккаунта. Хранилище может быть недоступно (приватный
 * режим, запрет сайта) — тогда настройка просто действует до конца сессии.
 */
export const PREF_KEYS = {
  sound: 'jinaly-sound',
  paintColor: 'jinaly-paint-color',
  confettiStyle: 'jinaly-confetti-style',
  grenadeStyle: 'jinaly-grenade-style',
  fireworkStyle: 'jinaly-firework-style',
} as const;

export function readPref(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Только на эту сессию. */
  }
}

/** Сохранённое значение из списка вариантов; устаревшее или чужое — по умолчанию. */
export function readChoice<T extends string>(
  key: string,
  options: readonly T[],
  fallback: T,
): T {
  const raw = readPref(key);
  return options.includes(raw as T) ? (raw as T) : fallback;
}
