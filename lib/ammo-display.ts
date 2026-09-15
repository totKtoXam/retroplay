/** Как показывать магазин: цифрами «12 / 24» или графически, без чисел. */
export type AmmoDisplay = 'numbers' | 'graphic';
export const DEFAULT_AMMO_DISPLAY: AmmoDisplay = 'numbers';
const AMMO_DISPLAY_KEY = 'jinaly-ammo-display';
/**
 * Своё событие вместо `storage`: браузер шлёт `storage` только ДРУГИМ вкладкам,
 * а настройку меняют в меню той же вкладки, где идёт бой. Без него индикатор
 * перерисовался бы лишь после перезагрузки.
 */
export const AMMO_DISPLAY_EVENT = 'jinaly-ammo-display';
export function readAmmoDisplay(): AmmoDisplay {
  if (typeof window === 'undefined') return DEFAULT_AMMO_DISPLAY;
  try {
    return localStorage.getItem(AMMO_DISPLAY_KEY) === 'graphic'
      ? 'graphic'
      : DEFAULT_AMMO_DISPLAY;
  } catch {}
  return DEFAULT_AMMO_DISPLAY;
}
export function writeAmmoDisplay(value: AmmoDisplay) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AMMO_DISPLAY_KEY, value);
  } catch {}
  window.dispatchEvent(new Event(AMMO_DISPLAY_EVENT));
}
