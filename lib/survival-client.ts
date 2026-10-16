// Чистые помощники клиента «Выживания»: без three.js и DOM, чтобы их гоняли тесты.
// Рендер зомби живёт в components/world-zombies.ts, правила — в lib/survival.ts.
import { ZOMBIES, type ZombieKind } from './survival.ts';

/** Устойчивый хэш строки (FNV-1a): одному id зомби всегда одна и та же модель. */
export function hashId(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Модель зомби по id и виду: из `ZOMBIES[kind].models` по хэшу id. Клиенты
 * выбирают одинаково, не сговариваясь, и после переподключения зомби не меняет лица.
 */
export function zombieModelFor(id: string, kind: ZombieKind) {
  const models = ZOMBIES[kind].models;
  return models[hashId(id) % models.length];
}

/**
 * Скорость клипа ходьбы под скорость шага: бегун при 4,3 м/с перебирает ногами
 * вдвое чаще ходячего, иначе он скользил бы по земле. Клипы сделаны под ~1,4 м/с.
 */
export function walkTimeScale(speed: number) {
  return Math.max(0.6, Math.min(2.6, 0.45 + speed / 1.9));
}

/**
 * Клип по имени, как у фигур атмосферы (components/world-ambient-npcs.ts): точно,
 * потом без регистра, потом по вхождению (`walk` → `Zombie_Walk`); вариант «на
 * месте» (`Walk_InPlace`) предпочтительнее, потому что у обычной ходьбы бывает
 * движение корня, и зомби уходил бы от своей серверной позиции. Нет ничего
 * похожего — `undefined`: у некоторых моделей нет клипа `attack`, и укус тогда
 * показывается наклоном корпуса.
 */
export function pickClip<C extends { name: string }>(clips: readonly C[], name: string): C | undefined {
  const lower = name.toLowerCase();
  const flat = (c: C) => c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const inPlace = clips.find((c) => flat(c) === `${lower.replace(/[^a-z0-9]/g, '')}inplace`);
  if (inPlace && !lower.includes('inplace')) return inPlace;
  return (
    clips.find((c) => c.name === name) ??
    clips.find((c) => c.name.toLowerCase() === lower) ??
    clips.find((c) => c.name.toLowerCase().includes(lower))
  );
}

/** Сколько мс фигура погибшего лежит после того, как сервер убрал его из снимка. */
export const CORPSE_LINGER_MS = 4000;
/** Падение тела: наклон на 90° и опускание, мс. */
export const FALL_MS = 800;
/** Дальше этого полоску здоровья не показываем, м. */
export const HP_BAR_RANGE = 35;
/** Ближе этого фигура отбрасывает тень, м. */
export const SHADOW_RANGE = 40;
/** Дальше этого анимация не считается, м. */
export const ANIMATE_RANGE = 200;
