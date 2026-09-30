/**
 * Настройки игрока, которые читают мир и HUD (план UX/UI, этап 3.4): поле зрения,
 * громкость эффектов, прицел, масштаб HUD и режим для дальтоников. Меню настроек
 * пишет их через `writePrefNotify` (lib/user-prefs.ts), здесь — только чтение с
 * проверкой: в localStorage может лежать что угодно, от старой версии до мусора.
 */
import { PREF_KEYS, readChoice, readNumberPref, readPref } from './user-prefs.ts';

export const CROSSHAIR_STYLES = ['cross', 'dot', 'cross-dot'] as const;
export type CrosshairStyle = (typeof CROSSHAIR_STYLES)[number];

export type HudPrefs = {
  /** Поле зрения камеры от первого лица, градусы: 70–100. */
  fov: number;
  /** Множитель громкости игровых эффектов: 0–1. */
  sfxVolume: number;
  crosshairStyle: CrosshairStyle;
  /** Цвет прицела, #rrggbb. */
  crosshairColor: string;
  /** Масштаб HUD: 0.9–1.25. */
  hudScale: number;
  colorblind: boolean;
  /** Блок частоты кадров и пинга в углу HUD. */
  showStats: boolean;
  /** Кровь и тела на мрачных картах («Зона заражения»). */
  gore: boolean;
};

export const DEFAULT_HUD_PREFS: HudPrefs = {
  fov: 80,
  sfxVolume: 1,
  crosshairStyle: 'cross',
  crosshairColor: '#f4f7ff',
  hudScale: 1,
  colorblind: false,
  showStats: true,
  gore: true,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function readHudPrefs(): HudPrefs {
  const color = readPref(PREF_KEYS.crosshairColor);
  return {
    fov: readNumberPref(PREF_KEYS.fov, 70, 100, DEFAULT_HUD_PREFS.fov),
    sfxVolume: readNumberPref(PREF_KEYS.sfxVolume, 0, 1, DEFAULT_HUD_PREFS.sfxVolume),
    crosshairStyle: readChoice(PREF_KEYS.crosshairStyle, CROSSHAIR_STYLES, DEFAULT_HUD_PREFS.crosshairStyle),
    crosshairColor: color && HEX_COLOR.test(color) ? color.toLowerCase() : DEFAULT_HUD_PREFS.crosshairColor,
    hudScale: readNumberPref(PREF_KEYS.hudScale, 0.9, 1.25, DEFAULT_HUD_PREFS.hudScale),
    colorblind: readPref(PREF_KEYS.colorblind) === '1',
    showStats: readPref(PREF_KEYS.showStats) !== '0',
    gore: readPref(PREF_KEYS.gore) !== '0',
  };
}

export function sameHudPrefs(a: HudPrefs, b: HudPrefs) {
  return (
    a.fov === b.fov &&
    a.sfxVolume === b.sfxVolume &&
    a.crosshairStyle === b.crosshairStyle &&
    a.crosshairColor === b.crosshairColor &&
    a.hudScale === b.hudScale &&
    a.colorblind === b.colorblind &&
    a.showStats === b.showStats &&
    a.gore === b.gore
  );
}

/*
 * Поле зрения. До настройки оно было зашито: 80° от первого лица, 68° от третьего,
 * при прицеливании 56° и 50°. Настройка задаёт первое лицо, остальное держит те же
 * пропорции — прицеливание приближает ровно настолько же, насколько раньше.
 */
const BASE_FIRST = 80;
const BASE_THIRD = 68;
const AIM_FIRST = 56;
const AIM_THIRD = 50;

/** Поле зрения без прицеливания. */
export function viewFov(pref: number, perspective: 'first' | 'third') {
  return perspective === 'first' ? pref : (pref * BASE_THIRD) / BASE_FIRST;
}

/** Поле зрения при прицеливании (кроме оптики снайперки: у неё свои кратности). */
export function aimFov(pref: number, perspective: 'first' | 'third') {
  return ((perspective === 'first' ? AIM_FIRST : AIM_THIRD) * pref) / BASE_FIRST;
}
