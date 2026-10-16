// Пятна на земле (`ArenaDef.decals`): как id текстуры превращается в файлы и какие пятна
// считаются кровью. Чистый модуль без three.js: его проверяют тесты и читает генератор.
import type { MapDecal } from './types.ts';

/** Папка декалей и PBR-наборов в public/. */
const DECALS = '/textures/outbreak/decals';
const SETS = '/textures/outbreak';

/**
 * Файлы одной декали. `map` — цвет с прозрачностью (RGBA), `alphaMap` — отдельная маска
 * (берётся её зелёный канал), `color` — заливка, когда своего цвета у маски нет.
 * `frame` — кадр атласа `cols × rows` (флипбук брызг d4).
 */
export type DecalTextures = {
  map?: string;
  alphaMap?: string;
  normalMap?: string;
  color?: string;
  frame?: { cols: number; rows: number; index: number };
  /** Влажная кровь блестит, грязь и ржавчина — матовые. */
  roughness: number;
};

/**
 * Кровь прячет настройка «Кровь и жестокость». Пятна d1–d4 — брызги крови из набора
 * scratchpad, `proc-blood` — процедурная лужа, `blood…` — на будущее.
 */
export function isGoreDecal(texture: string) {
  return /^(blood|proc-blood|d[1-4])/.test(texture);
}

/**
 * Id текстуры → файлы:
 *   - `proc-blood` — процедурный набор public/textures/outbreak/proc-blood/{albedo,normal}.webp (RGBA);
 *   - `d4…[#кадр]` — флипбук 3 × 3 белых брызг на чёрном без альфы: он маска, цвет — тёмно-красный;
 *   - `d5-<имя>` — набор ambientCG decals/d5<буква>-{basecolor,opacity,normal}.webp;
 *   - `d3…` — цвет decals/<id>.webp и рельеф decals/d3-normal.webp;
 *   - остальное — один RGBA-файл decals/<id>.webp.
 */
/** Id наборов грязи → префикс файлов в decals/ (сборка scripts/build-outbreak-real-models.mjs). */
const D5_FILES: Record<string, string> = {
  'd5-leaking-grime': 'd5a',
  'd5-smear-grime': 'd5b',
  'd5-surface-imperfections': 'd5c',
  'd5-rust-decal': 'd5d',
  'd5-graffiti': 'd5e',
};

export function decalTextures(texture: string): DecalTextures {
  const [id, frameText] = texture.split('#');
  const roughness = isGoreDecal(id) ? 0.3 : 0.9;
  if (id === 'proc-blood')
    return {
      map: `${SETS}/proc-blood/albedo.webp`,
      normalMap: `${SETS}/proc-blood/normal.webp`,
      roughness,
    };
  if (id.startsWith('d4')) {
    const index = Math.max(0, Math.min(8, Math.floor(Number(frameText) || 0)));
    return {
      alphaMap: `${DECALS}/${id}.webp`,
      color: '#5a0a07',
      frame: { cols: 3, rows: 3, index },
      roughness,
    };
  }
  if (id.startsWith('d5')) {
    // Файлы наборов ambientCG лежат как decals/d5a-basecolor.webp…: буква — по имени набора.
    const prefix = D5_FILES[id] ?? id;
    return {
      map: `${DECALS}/${prefix}-basecolor.webp`,
      alphaMap: `${DECALS}/${prefix}-opacity.webp`,
      normalMap: `${DECALS}/${prefix}-normal.webp`,
      roughness,
    };
  }
  if (id.startsWith('d3'))
    return {
      map: `${DECALS}/${id}.webp`,
      normalMap: `${DECALS}/d3-normal.webp`,
      roughness,
    };
  return { map: `${DECALS}/${id}.webp`, roughness };
}

/** Рамка пятна на земле по x/z (повёрнутый квадрат) — для разбивки по чанкам и проверок. */
export function decalBounds(d: MapDecal) {
  const half = (d.s ?? 1) / 2;
  const yaw = d.yaw ?? 0;
  const reach = half * (Math.abs(Math.cos(yaw)) + Math.abs(Math.sin(yaw)));
  return {
    minX: d.x - reach,
    maxX: d.x + reach,
    minZ: d.z - reach,
    maxZ: d.z + reach,
  };
}
