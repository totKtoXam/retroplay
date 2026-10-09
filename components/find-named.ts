import type * as T from 'three';

/**
 * Узел по имени внутри бойца — без обхода всего дерева каждый кадр.
 *
 * `getObjectByName` обходит поддерево целиком, а у бойца с человеком это сотни
 * узлов. Кадр спрашивает одни и те же имена у каждого бойца (что в руках, мешок
 * анонима, скин), и с семью ботами на поиск уходило больше половины кадра.
 *
 * Найденный узел запоминается и перед выдачей проверяется: имя то же, и он всё
 * ещё внутри `root` (человек переносит оружие и аксессуары к своим костям —
 * узел при этом остаётся внутри бойца). Если нет — ищем заново. Промах тоже
 * запоминается, но ненадолго: модели оружия догружаются позже и добавляют узлы.
 */
const found = new WeakMap<T.Object3D, Map<string, T.Object3D | number>>();

/** Сколько миллисекунд верить промаху. */
export const MISS_TTL_MS = 1000;

export function findNamed(root: T.Object3D, name: string, now = performance.now()): T.Object3D | undefined {
  let names = found.get(root);
  if (!names) found.set(root, (names = new Map()));
  const hit = names.get(name);
  if (typeof hit === 'number') {
    if (now < hit) return undefined;
  } else if (hit && hit.name === name && inside(hit, root)) return hit;
  const o = root.getObjectByName(name);
  names.set(name, o ?? now + MISS_TTL_MS);
  return o;
}

function inside(o: T.Object3D, root: T.Object3D) {
  for (let q: T.Object3D | null = o; q; q = q.parent) if (q === root) return true;
  return false;
}
