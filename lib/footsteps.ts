// Шаги: по чему идёт игрок и как нарезать записи на одиночные шаги. Модуль чистый — без
// three.js и Web Audio, чтобы его проверяли тесты; звук играет components/world-footsteps.ts.
//
// Записи шагов лежат в public/sounds/footsteps/<поверхность>.mp3: в каждом файле несколько
// шагов подряд, разделённых тишиной (источники и лицензии — README.md рядом с файлами).
// Карты не хранят материалов, только цвета коробок, поэтому поверхность угадывается по цвету
// того, на чём стоит игрок: зелень — трава, коричневое — дерево, снег — снег. Цвет берётся уже
// перекрашенным под текущий сезон, так что летний луг на зимней карте хрустит снегом.

import { rampHeight, type GameMap, type MapBox, type SurfaceMaterial } from './maps/types.ts';
import {
  hexToHsl,
  isSnowy,
  isVegetation,
  seasonColor,
  type Season,
} from './season-colors.ts';

export const FOOTSTEP_SURFACES = [
  'metal',
  'tile',
  'stone',
  'wood',
  'carpet',
  'grass',
  'gravel',
  'snow',
  'wet',
] as const;
export type FootstepSurface = (typeof FOOTSTEP_SURFACES)[number];

export const footstepUrl = (surface: FootstepSurface) =>
  `/sounds/footsteps/${surface}.mp3`;

/** Тонкая плита не выше этого, м, — ковёр или дорожка, а не стол и не ящик. */
const RUG_HEIGHT = 0.15;

/** Звук шагов для вида поверхности, заданного на карте явно. */
const SURFACE_OF_MATERIAL: Record<SurfaceMaterial, FootstepSurface> = {
  plaster: 'stone',
  wallpaper: 'stone',
  wood: 'wood',
  parquet: 'wood',
  tile: 'tile',
  checker: 'tile',
  marble: 'tile',
  carpet: 'carpet',
  fabric: 'carpet',
  leather: 'carpet',
  metal: 'metal',
  brick: 'stone',
  books: 'wood',
};

/** Поверхность по цвету материала. `thin` — плоская плита на полу. */
export function surfaceOfColor(hex: string, thin = false): FootstepSurface {
  if (isSnowy(hex)) return 'snow';
  if (isVegetation(hex)) return 'grass';
  const [h, s, l] = hexToHsl(hex);
  // Вода: насыщенный голубой.
  if (h >= 185 && h <= 215 && s > 0.35 && l < 0.5 && !thin) return 'wet';
  // Дерево: тёмный тёплый коричневый (доски, ящики, лестницы).
  if (h >= 15 && h <= 42 && s >= 0.25 && l >= 0.15 && l <= 0.5) return 'wood';
  // Песок и глина: светлый тёплый — хрустит как мелкий гравий.
  if (h >= 20 && h <= 60 && s >= 0.3 && l > 0.5) return 'gravel';
  // Ковёр: насыщенная ткань на полу.
  if (thin && s > 0.3) return 'carpet';
  return 'stone';
}

export type SurfaceContext = {
  map: GameMap;
  /** Сезон комнаты: от него зависит цвет земли. */
  season: string;
  /** Над точкой перекрытие: в помещении камень звучит как плитка, осадки не мочат пол. */
  sheltered: boolean;
  /** Плотность дождя и снегопада сейчас, 0…1 (WeatherLook). */
  rain: number;
  snow: number;
};

/** Верх коробки, на которой стоят ноги на высоте `y`, — самый высокий в пределах шага. */
function supportBox(
  boxes: readonly MapBox[],
  x: number,
  z: number,
  y: number,
): MapBox | null {
  let best: MapBox | null = null;
  let bestTop = -Infinity;
  for (const b of boxes) {
    const top = b.y + b.h / 2;
    if (top < y - 0.3 || top > y + 0.15 || top <= bestTop) continue;
    if (Math.abs(x - b.x) > b.w / 2 || Math.abs(z - b.z) > b.d / 2) continue;
    best = b;
    bestTop = top;
  }
  return best;
}

/** По чему идёт нога в точке (x, y, z): y — высота ступней. */
export function footstepSurface(
  ctx: SurfaceContext,
  x: number,
  y: number,
  z: number,
): FootstepSurface {
  const { map, sheltered } = ctx;
  if (map.id === 'ship') return 'metal';
  const arena = map.arena;
  let surface: FootstepSurface = 'stone';
  // Хаб собран вручную, без цветных коробок: площадь каменная.
  let terrain = !arena;
  if (arena) {
    for (const w of arena.water ?? [])
      if (
        x >= w.minX &&
        x <= w.maxX &&
        z >= w.minZ &&
        z <= w.maxZ &&
        y <= w.y + 0.05
      )
        return 'wet';

    const native: Season = arena.season ?? 'summer';
    const paint = (hex: string, role: 'ground' | 'surface') =>
      seasonColor(hex, ctx.season, native, role);
    const box = supportBox(arena.boxes, x, z, y);
    const ramp = (arena.ramps ?? []).find(
      (r) =>
        x >= r.minX &&
        x <= r.maxX &&
        z >= r.minZ &&
        z <= r.maxZ &&
        Math.abs(rampHeight(r, x, z) - y) < 0.3,
    );
    if (box?.material) surface = SURFACE_OF_MATERIAL[box.material];
    else if (box)
      surface = surfaceOfColor(
        paint(box.color, 'surface'),
        box.h <= RUG_HEIGHT,
      );
    else if (ramp) surface = surfaceOfColor(paint(ramp.color, 'surface'));
    else {
      surface = surfaceOfColor(paint(arena.groundColor, 'ground'));
      terrain = true;
    }
    // Голубая плита — бассейн или витраж, а не вода: по ней идут как по камню.
    if (surface === 'wet' && box) surface = 'stone';
  }
  if (sheltered) return surface === 'stone' ? 'tile' : surface;

  // Под открытым небом погода важнее покрытия: снегопад заметает землю, дождь мочит всё твёрдое.
  if (
    ctx.snow > 0.3 &&
    (terrain ||
      surface === 'grass' ||
      surface === 'gravel' ||
      surface === 'stone')
  )
    return 'snow';
  if (ctx.rain > 0.25 && surface !== 'snow' && surface !== 'carpet')
    return 'wet';
  return surface;
}

/** Длина шага, м: чем быстрее, тем шире шаг — бег не превращается в пулемётную очередь. */
export const strideLength = (speed: number) => 0.5 + 0.22 * Math.max(0, speed);

/**
 * Одиночные шаги в записи: куски звука, разделённые тишиной не короче `gap` секунд.
 * Возвращает [начало, конец] в секундах. Тишина — огибающая ниже `threshold`.
 */
export function splitSteps(
  samples: Float32Array,
  sampleRate: number,
  { gap = 0.12, threshold = 0.004, minLength = 0.05 } = {},
): [number, number][] {
  const hop = Math.max(1, Math.round(sampleRate * 0.005));
  const quietHops = Math.ceil((gap * sampleRate) / hop);
  const steps: [number, number][] = [];
  let start = -1,
    lastLoud = -1,
    quiet = 0;
  for (let k = 0; k * hop < samples.length; k++) {
    let peak = 0;
    const end = Math.min(samples.length, (k + 1) * hop);
    for (let i = k * hop; i < end; i++)
      peak = Math.max(peak, Math.abs(samples[i]));
    if (peak >= threshold) {
      if (start < 0) start = k;
      lastLoud = k;
      quiet = 0;
    } else if (start >= 0 && ++quiet >= quietHops) {
      steps.push([
        (start * hop) / sampleRate,
        ((lastLoud + 1) * hop) / sampleRate,
      ]);
      start = -1;
    }
  }
  if (start >= 0)
    steps.push([
      (start * hop) / sampleRate,
      ((lastLoud + 1) * hop) / sampleRate,
    ]);
  return steps.filter(([a, b]) => b - a >= minLength);
}
