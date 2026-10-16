import type { PropModelInfo } from './types';

/*
 * Процедурные здания «Зоны заражения». Здесь — только чистая часть: разбор id,
 * рамка и общие параметры (высота этажа, крыша, базовый стиль руины). Клиент
 * (components/world-proc-buildings.ts) строит геометрию по тому же id, а
 * buildArena и миникарта берут отсюда рамку для столкновений — поэтому модуль
 * без three.js и без состояния.
 *
 * Id: `proc/building:<w>x<d>x<floors>:<seed>:<style>` — ширина и глубина в метрах
 * (целые), этажи 1–12, зерно — целое, стиль — один из PROC_BUILDING_STYLES.
 */

export const PROC_BUILDING_PREFIX = 'proc/building:';
/** Высота этажа, м — одна для всех стилей, иначе окна разных домов не совпадут по ритму. */
export const FLOOR_H = 3.1;
/** Этажей не больше: выше дома ломают бюджет треугольников и тени. */
export const MAX_FLOORS = 12;
export const MIN_SIDE = 4;
export const MAX_SIDE = 80;

export const PROC_BUILDING_STYLES = [
  'apt',
  'office',
  'house',
  'industrial',
  'ruin',
] as const;
export type ProcBuildingStyle = (typeof PROC_BUILDING_STYLES)[number];
/** Стиль, по которому строится корпус: у руины — один из целых стилей. */
export type ProcBuildingBase = Exclude<ProcBuildingStyle, 'ruin'>;

export type ProcBuildingParams = {
  w: number;
  d: number;
  floors: number;
  seed: number;
  style: ProcBuildingStyle;
};

/** Что добавляет крыша над последним перекрытием, м (парапет, скат, конёк). */
export const ROOF_H: Record<ProcBuildingBase, number> = {
  apt: 0.7,
  office: 0.6,
  house: 2.5,
  industrial: 1.2,
};

/** mulberry32 — тот же генератор, что и в генераторе карты: одно зерно → один дом. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isInt = (n: number) => Number.isInteger(n);

export function isProcBuildingParams(p: ProcBuildingParams): boolean {
  return (
    isInt(p.w) &&
    isInt(p.d) &&
    isInt(p.floors) &&
    isInt(p.seed) &&
    p.w >= MIN_SIDE &&
    p.w <= MAX_SIDE &&
    p.d >= MIN_SIDE &&
    p.d <= MAX_SIDE &&
    p.floors >= 1 &&
    p.floors <= MAX_FLOORS &&
    (PROC_BUILDING_STYLES as readonly string[]).includes(p.style)
  );
}

export function procBuildingId(p: ProcBuildingParams): string {
  return `${PROC_BUILDING_PREFIX}${p.w}x${p.d}x${p.floors}:${p.seed}:${p.style}`;
}

const ID_RE = /^(\d+)x(\d+)x(\d+):(-?\d+):([a-z]+)$/;

export function parseProcBuilding(id: string): ProcBuildingParams | undefined {
  if (!id.startsWith(PROC_BUILDING_PREFIX)) return undefined;
  const m = ID_RE.exec(id.slice(PROC_BUILDING_PREFIX.length));
  if (!m) return undefined;
  const p: ProcBuildingParams = {
    w: Number(m[1]),
    d: Number(m[2]),
    floors: Number(m[3]),
    seed: Number(m[4]),
    style: m[5] as ProcBuildingStyle,
  };
  return isProcBuildingParams(p) ? p : undefined;
}

/**
 * Базовый стиль корпуса. Руина — обрушенный дом любого стиля: низкий (≤ 2 этажа)
 * рушится как частный дом, остальные — жилой, офисный или ангар по зерну.
 */
export function procBuildingBase(p: ProcBuildingParams): ProcBuildingBase {
  if (p.style !== 'ruin') return p.style;
  if (p.floors <= 2)
    return mulberry32(p.seed ^ 0x5a17)() < 0.5 ? 'house' : 'industrial';
  const r = mulberry32(p.seed ^ 0x5a17)();
  return r < 0.65 ? 'apt' : 'office';
}

/** Полная высота рамки: этажи плюс крыша базового стиля. */
export function procBuildingHeight(p: ProcBuildingParams): number {
  return p.floors * FLOOR_H + ROOF_H[procBuildingBase(p)];
}

/**
 * Рамка для столкновений и миникарты: центр x/z = 0, низ y = 0. Щебень у руин
 * выходит за рамку намеренно — через него можно пройти, как через россыпь.
 */
export function procBuildingInfo(id: string): PropModelInfo | undefined {
  const p = parseProcBuilding(id);
  if (!p) return undefined;
  return {
    min: [-p.w / 2, 0, -p.d / 2],
    max: [p.w / 2, procBuildingHeight(p), p.d / 2],
    hit: 'box',
  };
}
