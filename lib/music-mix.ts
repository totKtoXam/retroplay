/**
 * Сколько музыки на самом деле звучит при выбранной громкости.
 *
 * «На фоне» — режим по умолчанию: музыка тише в целом и уступает голосам, пока
 * кто-то говорит в рацию. Без этого фон перекрывал бы переговоры, и игроку
 * пришлось бы самому крутить ползунок на каждой фразе. Режим «в полную» нужен,
 * когда встреча молчит и музыку хотят именно слушать.
 */

/** Доля громкости в фоновом режиме, пока все молчат. */
export const BACKGROUND_LEVEL = 0.45;
/** Доля громкости в фоновом режиме, пока кто-то говорит. */
export const DUCKED_LEVEL = 0.12;

export function musicGain(volume: number, background: boolean, voiceActive: boolean) {
  const v = Math.max(0, Math.min(1, volume));
  if (!background) return v;
  return v * (voiceActive ? DUCKED_LEVEL : BACKGROUND_LEVEL);
}

/** Название трека из имени файла: без расширения и с пробелами вместо подчёркиваний. */
export function trackTitleFromFile(name: string) {
  const base = name.replace(/\.[^.\\/]{1,5}$/, '').replace(/[_]+/g, ' ').trim();
  return (base || 'Без названия').slice(0, 80);
}
