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
  meleeStyle: 'jinaly-melee-style',
  // Настройки игрока из плана UX/UI (этап 3.4). Читает мир и HUD
  // (components/world*.tsx), пишет раздел «Управление» в настройках.
  /** Поле зрения камеры в градусах: 70–100, по умолчанию 80. */
  fov: 'jinaly-fov',
  /** Громкость игровых эффектов 0–1 отдельно от музыки, по умолчанию 1. */
  sfxVolume: 'jinaly-sfx-volume',
  /** Вид прицела: 'cross' | 'dot' | 'cross-dot', по умолчанию 'cross'. */
  crosshairStyle: 'jinaly-crosshair-style',
  /** Цвет прицела: #rrggbb, по умолчанию #f4f7ff. */
  crosshairColor: 'jinaly-crosshair-color',
  /** Масштаб HUD 0.9–1.25, по умолчанию 1. */
  hudScale: 'jinaly-hud-scale',
  /** Палитра для дальтоников: '1' — включена (формы и контрастные пары). */
  colorblind: 'jinaly-colorblind',
} as const;

/** Число из настроек в пределах [min, max]; нет или мусор — по умолчанию. */
export function readNumberPref(key: string, min: number, max: number, fallback: number) {
  const n = Number(readPref(key));
  return readPref(key) !== null && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Событие окна: настройка игрока поменялась в этой вкладке (detail — ключ). */
export const PREF_CHANGED_EVENT = 'jinaly-pref-changed';

/** Записать настройку и сообщить об этом миру и HUD в этой же вкладке. */
export function writePrefNotify(key: string, value: string) {
  writePref(key, value);
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(PREF_CHANGED_EVENT, { detail: key }));
}

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
