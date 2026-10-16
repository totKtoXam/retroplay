/**
 * Фильтр движений мыши при захвате. Браузер иногда отдаёт одиночный огромный
 * movement (после захвата, сворачивания окна, скачка курсора) — его надо
 * отбросить, иначе камера дёрнется. Но быстрый рывок игрока тоже даёт большие
 * значения, и выбрасывать его нельзя: рывок нарастает за несколько событий, а
 * сбой приходит на фоне спокойной мыши. Поэтому отбрасывается только всплеск,
 * во много раз больший недавнего среднего; остальное лишь ограничивается.
 */
export const MOVE_SPIKE = 300;
export const MOVE_LIMIT = 400;

export function createMoveFilter() {
  let average = 0;
  return {
    /** Движение для камеры или null, если это сбой браузера. */
    filter(dx: number, dy: number): [number, number] | null {
      const size = Math.hypot(dx, dy);
      if (size > MOVE_SPIKE && size > average * 6 + 60) return null;
      average = average * 0.7 + size * 0.3;
      const k = size > MOVE_LIMIT ? MOVE_LIMIT / size : 1;
      return [dx * k, dy * k];
    },
    /** После захвата мыши или паузы история движений устарела. */
    reset() {
      average = 0;
    },
  };
}
