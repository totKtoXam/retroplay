// Чистая логика управления мини-играми «Предателя» с клавиатуры и простыми касаниями
// (components/impostor-tasks.tsx). Вынесена отдельно, чтобы её можно было проверить тестами
// без браузера: сами мини-игры живут в React и DOM.

/**
 * Сдвиг по оси от клавиши: стрелки — `small`, со Shift — `big`, PageUp/PageDown — всегда `big`.
 * Вправо и вверх — плюс, влево и вниз — минус (как у ползунка). `vertical: false` — вертикальные
 * стрелки не двигают (прицел турели ходит только вбок). `null` — клавиша не про движение.
 */
export function arrowStep(key: string, shift: boolean, small: number, big: number, vertical = true): number | null {
  const step = shift ? big : small;
  if (key === 'ArrowRight' || (vertical && key === 'ArrowUp')) return step;
  if (key === 'ArrowLeft' || (vertical && key === 'ArrowDown')) return -step;
  if (key === 'PageUp') return big;
  if (key === 'PageDown') return -big;
  return null;
}

export type SwipeVerdict = 'short' | 'fast' | 'slow' | 'ok';

/**
 * Приговор проведению пропуска — один на мышь, касание и клавиатуру: карта дошла до конца
 * считывателя (не меньше 92 % пути) и прошла его не быстрее `minMs` и не медленнее `maxMs`.
 */
export function judgeSwipe(end: number, ms: number, len: number, minMs: number, maxMs: number): SwipeVerdict {
  if (end < len * 0.92) return 'short';
  if (ms < minMs) return 'fast';
  if (ms > maxMs) return 'slow';
  return 'ok';
}

/**
 * Следующий доступный элемент по кругу от `from` в сторону `dir`; сам `from` проверяется
 * последним. −1 — доступных нет. Им ходят стрелками по проводам и возвращают фокус после того,
 * как нажатый элемент исчез или выключился.
 */
export function nextEnabled(enabled: readonly boolean[], from: number, dir: 1 | -1): number {
  const n = enabled.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (enabled[i]) return i;
  }
  return -1;
}

type Span = { left: number; right: number; top: number; bottom: number };

/**
 * В какой астероид попадёт выстрел турели вертикально вверх из точки `x`: из тех, что уже
 * видны над полем (`fieldTop`) и перекрывают `x` с запасом `pad`, — ближайший к турели, то есть
 * самый нижний. −1 — промах.
 */
export function columnTarget(rocks: readonly Span[], x: number, fieldTop: number, pad: number): number {
  let best = -1;
  rocks.forEach((r, i) => {
    if (r.bottom <= fieldTop || x < r.left - pad || x > r.right + pad) return;
    if (best < 0 || r.bottom > rocks[best].bottom) best = i;
  });
  return best;
}
