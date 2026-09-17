// Где над головой крыша: карта укрытий для погоды. Модуль чистый — без three.js,
// чтобы его проверяли тесты.
//
// Раньше укрытие проверялось одной точкой — позицией камеры. Отсюда три ошибки:
// снаружи дождь и снег шли внутри домов (частицы заполняют коробку вокруг камеры
// целиком), изнутри погода пропадала и за окном, а ветер сносил игрока и пули и
// под крышей. Теперь у каждой клетки карты известна высота самого верхнего
// перекрытия: частица ниже него скрыта, игрока под ним не сносит, а пуля
// сносится только на открытой части пути.

import type { GameMap } from './maps/types.ts';

/** Нет перекрытия над клеткой. */
export const OPEN_SKY = -1000;

export type RoofMap = {
  minX: number;
  minZ: number;
  /** Размер клетки, м. */
  cell: number;
  cols: number;
  rows: number;
  /** Низ самого верхнего перекрытия над клеткой (OPEN_SKY — открытое небо). */
  heights: Float32Array;
};

/** Запас вокруг границ карты: погода видна и за её стенами. */
const MARGIN = 6;
/** Потолок ниже этой высоты над полом — не перекрытие, а часть стены или мебели. */
const MIN_CLEARANCE = 0.3;

export function buildRoofMap(map: GameMap, cell = 0.5): RoofMap {
  const b = map.bounds;
  const minX = b.minX - MARGIN,
    minZ = b.minZ - MARGIN;
  const cols = Math.ceil((b.maxX - b.minX + 2 * MARGIN) / cell),
    rows = Math.ceil((b.maxZ - b.minZ + 2 * MARGIN) / cell);
  const heights = new Float32Array(cols * rows).fill(OPEN_SKY);
  const arena = map.arena;
  if (arena) {
    // Боевые карты описаны коробками: перекрытие — любая твёрдая коробка или
    // плита, которая висит над землёй (плиты этажей, крыши, балконы, притолоки).
    // Растеризация коробок в сотни раз быстрее, чем опрос столкновений по клеткам.
    const boxes = [
      ...arena.boxes.filter((x) => x.solid || x.floor).map((x) => ({ x: x.x, z: x.z, w: x.w, d: x.d, bottom: x.y - x.h / 2 })),
      ...(arena.cylinders ?? [])
        .filter((c) => c.solid)
        .map((c) => ({ x: c.x, z: c.z, w: c.r * 2, d: c.r * 2, bottom: c.y - c.h / 2 })),
    ];
    for (const box of boxes) {
      if (box.bottom < MIN_CLEARANCE) continue;
      const c0 = Math.max(0, Math.floor((box.x - box.w / 2 - minX) / cell)),
        c1 = Math.min(cols - 1, Math.floor((box.x + box.w / 2 - minX) / cell - 1e-6)),
        r0 = Math.max(0, Math.floor((box.z - box.d / 2 - minZ) / cell)),
        r1 = Math.min(rows - 1, Math.floor((box.z + box.d / 2 - minZ) / cell - 1e-6));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          if (box.bottom > heights[i]) heights[i] = box.bottom;
        }
    }
  } else {
    // Хаб описан функциями потолка: поднимаемся от земли от перекрытия к
    // перекрытию и запоминаем самое верхнее.
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = minX + (c + 0.5) * cell,
          z = minZ + (r + 0.5) * cell;
        let y = map.groundHeight(x, z, 0);
        let top = OPEN_SKY;
        for (let step = 0; step < 6; step++) {
          const ceiling = map.ceilingHeight(x, z, y);
          if (!Number.isFinite(ceiling) || ceiling <= y + 0.01) break;
          top = ceiling;
          y = ceiling;
        }
        heights[r * cols + c] = top;
      }
  }
  return { minX, minZ, cell, cols, rows, heights };
}

/** Высота перекрытия над точкой (OPEN_SKY — открыто). */
export function roofAt(roof: RoofMap, x: number, z: number): number {
  const c = Math.floor((x - roof.minX) / roof.cell),
    r = Math.floor((z - roof.minZ) / roof.cell);
  if (c < 0 || r < 0 || c >= roof.cols || r >= roof.rows) return OPEN_SKY;
  return roof.heights[r * roof.cols + c];
}

/** Точка под крышей: над ней есть перекрытие. */
export const underRoof = (roof: RoofMap, x: number, y: number, z: number) => y < roofAt(roof, x, z);

/**
 * Доля пути от `from` до `to`, что идёт под открытым небом, 0..1. По ней снос
 * пули: выстрел из дома в окно сносит только на улице.
 */
export function openShare(
  roof: RoofMap,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  samples = 16,
): number {
  let open = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const x = from[0] + (to[0] - from[0]) * t,
      y = from[1] + (to[1] - from[1]) * t,
      z = from[2] + (to[2] - from[2]) * t;
    if (!underRoof(roof, x, y, z)) open++;
  }
  return open / samples;
}
