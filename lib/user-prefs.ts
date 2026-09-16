/**
 * Личные настройки, которые живут на устройстве и переживают выход из комнаты,
 * перезагрузку и выход из аккаунта. Хранилище может быть недоступно (приватный
 * режим, запрет сайта) — тогда настройка просто действует до конца сессии.
 */
export const PREF_KEYS = {
  sound: 'jinaly-sound',
  music: 'jinaly-music',
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

export type MusicPrefs = { track: string; volume: number };

export function readMusicPrefs(
  tracks: readonly string[],
  fallback: MusicPrefs,
): MusicPrefs {
  try {
    const parsed = JSON.parse(readPref(PREF_KEYS.music) || 'null') as {
      track?: unknown;
      volume?: unknown;
    } | null;
    if (!parsed || typeof parsed !== 'object') return { ...fallback };
    const volume = Number(parsed.volume);
    return {
      track: tracks.includes(parsed.track as string)
        ? (parsed.track as string)
        : fallback.track,
      volume:
        parsed.volume !== null && Number.isFinite(volume)
          ? Math.max(0, Math.min(1, volume))
          : fallback.volume,
    };
  } catch {
    return { ...fallback };
  }
}

export function writeMusicPrefs(prefs: MusicPrefs) {
  writePref(PREF_KEYS.music, JSON.stringify(prefs));
}
