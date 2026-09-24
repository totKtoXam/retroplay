import {
  perimeterWalls,
  type ArenaDef,
  type Bounds,
  type MapBox,
  type MapCylinder,
  type MapLight,
  type MapRamp,
  type MapRoof,
  type MapSphere,
  type MapWater,
  type SpawnPoint,
  type SurfaceMaterial,
} from './types.ts';
import { createFurnisher, darken, FLAME, IRON, type Furnisher, type Side } from './furnish.ts';

/**
 * «Ледниковая долина» — the big alpine map: 120 x 112 m, five times the area of the
 * mountain camp (56 x 48). Everything is mirrored across z = 0, so neither camp gets a
 * shorter way to anything.
 *
 *   z -56 | ---------------- КРАСНЫЙ ЛАГЕРЬ (дом, срубы, вышка) ----------------- |
 *   z -36 | === ЗАПАДНЫЕ ВОРОТА ====== ЦЕНТРАЛЬНЫЕ ====== ВОСТОЧНЫЕ ВОРОТА ====== | гряда
 *         |  ЛЕДНИК x -58..-40       ПОЛЕ: озёра,       СОСНОВЫЙ БОР x 30..43     |
 *   z   0 |  полка y = 2.5 и         остовы, валуны      КАРЬЕР: уступы           |
 *         |  колонный грот под ней                       y = 2.2 и y = 4.4        |
 *   z  36 | === ЗАПАДНЫЕ ВОРОТА ====== ЦЕНТРАЛЬНЫЕ ====== ВОСТОЧНЫЕ ВОРОТА ====== | гряда
 *   z  56 | ---------------- СИНИЙ ЛАГЕРЬ (зеркало красного) -------------------- |
 *         x -60                         x 0                                  x 60
 *
 * Центр долины — плато x -22..22, z -18..18 высотой 3,4 м с руиной станции наверху.
 * Наверх ведут только четыре пандуса, а насквозь — крестовый тоннель на уровне земли
 * с четырьмя устьями. Западный фланг двухэтажный: ледяная полка сверху, колонный грот
 * под ней. Восточный — лесной подход к двум уступам карьера. Между лагерями и центром
 * открытое поле с укрытиями и двумя замёрзшими озёрами.
 *
 * Отделка: у каждой твёрдой коробки есть материал (скала, лёд, бетон, брёвна, ржавчина),
 * дом и срубы обставлены изнутри. Обстановку северной половины собирает один набор мебели
 * (lib/maps/furnish.ts), и она отражается целиком, как и всё остальное; то, что лежит на
 * самой оси z = 0, собирает второй набор и само по себе симметрично.
 */

const BOUNDS: Bounds = { minX: -60, maxX: 60, minZ: -56, maxZ: 56 };

// --- палитра ---------------------------------------------------------------------------
const SNOW = '#e8eff5';
const SNOW_DRIFT = '#f6fafd';
const CLIFF = '#79848f';
const ROCK = '#6d7883';
const ROCK_DARK = '#5b6572';
const SLATE = '#4c5666';
const RAMP_STONE = '#8b939c';
const WOOD = '#7c5838';
const WOOD_DARK = '#5f4128';
const LOG = '#8c6544';
const ROOF = '#46505e';
const CANVAS_RED = '#8e403a';
const PINE_TRUNK = '#4a3526';
const PINE_1 = '#1f4a30';
const PINE_2 = '#245638';
const PINE_3 = '#2c6642';
const ICE = '#a8dcee';
const ICE_PALE = '#cfe9f4';
const ICE_DEEP = '#7fb8d4';
const METAL = '#59626e';
const RUST = '#8a5a3c';
// Отделка и обстановка. Всё не-снежное темнее светлоты 0,78: иначе летом «растает» в луг.
const PLANK = '#8a6a4a';
const CEILING = '#9a7c5c';
const CONCRETE = '#7d8185';
const RIB = '#6a6d71';
const CRATE = '#a3763f';
const CRATE_DARK = '#8a6236';
const FROST_WOOD = '#7f8f99';
const SACK = '#9c8f6e';
const TARP = '#6b5a44';
const BLANKET_RED = '#7c3b35';
const BLANKET_BLUE = '#3b4f6b';
const RUG_RED = '#7a2f2a';
const RUG_BROWN = '#6b4a2f';
const PAPER = '#c8b88a';
const RADIO = '#3f4247';
const LOCKER = '#5d6670';
const GLASS_DARK = '#27303a';
const TIRE = '#26282b';
const SOOT = '#2b2622';
const RAIL = '#4a4f57';
const RUST_DARK = darken(RUST, 0.25);
const GOODS = ['#8a4a36', '#b0603f', '#6b5a44', '#9c8f6e'];
// Светящееся: сезон его не перекрашивает.
const DIAL = '#ffb347';
const LAMP_COOL = '#dfeaff';
const SEARCH = '#fff1c8';
const ICE_GLOW = '#8fd6ff';
const EMBER = '#ff7a2e';
const BEACON = '#ff4a3a';

// --- примитивы -------------------------------------------------------------------------

/** Solid block given by its extents. */
const block = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: string,
  material?: SurfaceMaterial,
): MapBox => ({
  x: (x0 + x1) / 2,
  y: (y0 + y1) / 2,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h: y1 - y0,
  d: z1 - z0,
  color,
  solid: true,
  ...(material ? { material } : {}),
});

/** Walkable slab 0.2 m thick whose top is at `top`; its underside is a ceiling. */
const slab = (
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  top: number,
  color: string,
  material?: SurfaceMaterial,
): MapBox => ({
  x: (x0 + x1) / 2,
  y: top - 0.1,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h: 0.2,
  d: z1 - z0,
  color,
  floor: true,
  ...(material ? { material } : {}),
});

/** Flat paint on the snow (trodden ground, lake ice): decoration only. */
const paint = (
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  color: string,
  h = 0.3,
  material?: SurfaceMaterial,
): MapBox => ({
  x: (x0 + x1) / 2,
  y: h / 2,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h,
  d: z1 - z0,
  color,
  ...(material ? { material } : {}),
});

// Один приём на всю карту: половина при z < 0 описана явно, вторая получается
// отражением. Так обе команды получают одинаковые расстояния, укрытия и подъёмы.
// Поворот декора при отражении z -> -z: углы вокруг x и y меняют знак, вокруг z — нет.
const flipRot = (r: [number, number, number]): [number, number, number] => [-r[0], -r[1], r[2]];
const mirrorBoxes = (bs: MapBox[]): MapBox[] => bs.map((b) => ({ ...b, z: -b.z, ...(b.rot ? { rot: flipRot(b.rot) } : {}) }));
const mirrorCylinders = (cs: MapCylinder[]): MapCylinder[] => cs.map((c) => ({ ...c, z: -c.z }));
const mirrorSpheres = (ss: MapSphere[]): MapSphere[] => ss.map((s) => ({ ...s, z: -s.z }));
const mirrorLights = (ls: MapLight[]): MapLight[] => ls.map((l) => ({ ...l, z: -l.z }));
const mirrorWater = (ws: MapWater[]): MapWater[] => ws.map((w) => ({ ...w, minZ: -w.maxZ, maxZ: -w.minZ }));
const mirrorRoofs = (rs: MapRoof[]): MapRoof[] => rs.map((r) => ({ ...r, minZ: -r.maxZ, maxZ: -r.minZ }));
/** A z-axis ramp also swaps its ends, so the mirrored copy still rises the same way. */
const mirrorRamps = (rs: MapRamp[]): MapRamp[] =>
  rs.map((r) => ({
    ...r,
    minZ: -r.maxZ,
    maxZ: -r.minZ,
    ...(r.axis === 'z' ? { from: -r.from, to: -r.to } : {}),
  }));

/** Обстановка северной половины (отражается целиком). */
const f = createFurnisher();
/** Обстановка на самой оси z = 0: не отражается, поэтому каждая вещь в ней симметрична сама. */
const fc = createFurnisher();

/**
 * Декоративная балка из точки `a` в точку `b`: коробка вдоль своей оси y, повёрнутая
 * углами Эйлера XYZ (сначала наклон вокруг z, потом вокруг x) — распорки, растяжки, упавшие балки.
 */
function strut(
  fu: Furnisher,
  a: [number, number, number],
  b: [number, number, number],
  t: number,
  color: string,
  material?: SurfaceMaterial,
) {
  // Ось коробки всегда смотрит вверх: иначе горизонтальная балка получала бы переворот
  // на π вокруг x, и её зеркальная копия не совпадала бы с ней по углам.
  const k = b[1] < a[1] ? -1 : 1;
  const [dx, dy, dz] = [(b[0] - a[0]) * k, (b[1] - a[1]) * k, (b[2] - a[2]) * k];
  const len = Math.hypot(dx, dy, dz);
  fu.decor.push({
    x: (a[0] + b[0]) / 2,
    y: (a[1] + b[1]) / 2,
    z: (a[2] + b[2]) / 2,
    w: t,
    h: len,
    d: t,
    color,
    ...(material ? { material } : {}),
    rot: [Math.atan2(dz, dy), 0, -Math.asin(dx / len)],
  });
}

/** Снежная подушка на верху коробки (декор): зимой снег лежит на каждом уступе. */
const snowTop = (fu: Furnisher, b: MapBox, t = 0.22) => {
  const top = b.y + b.h / 2;
  fu.deco(b.x - b.w / 2 + 0.1, b.x + b.w / 2 - 0.1, top, top + t, b.z - b.d / 2 + 0.1, b.z + b.d / 2 - 0.1, SNOW_DRIFT, 'snow');
};

/**
 * Снег на скатной крыше: такая же крыша на 12 см выше, чуть короче и с меньшим выносом —
 * снизу видна кромка настоящей кровли, торцы снега прячутся в её чердаке.
 */
const snowCap = (r: MapRoof): MapRoof => {
  const alongX = r.ridge === 'x';
  return {
    ...r,
    minX: alongX ? r.minX + 0.2 : r.minX,
    maxX: alongX ? r.maxX - 0.2 : r.maxX,
    minZ: alongX ? r.minZ : r.minZ + 0.2,
    maxZ: alongX ? r.maxZ : r.maxZ - 0.2,
    y: r.y + 0.12,
    color: SNOW_DRIFT,
    material: 'snow',
    gable: SNOW_DRIFT,
    gableMaterial: 'snow',
    overhang: Math.max(0.05, (r.overhang ?? 0.4) - 0.15),
  };
};

/** Солидный ствол в коре и крона из четырёх ярусов хвои-конусов — вся выше роста человека. */
const pine = ([x, z]: [number, number]): MapCylinder[] => [
  { x, y: 2.25, z, r: 0.3, h: 4.5, color: PINE_TRUNK, solid: true, sides: 8, material: 'bark' },
  { x, y: 3.1, z, r: 1.7, rTop: 0.25, h: 1.6, color: PINE_1, sides: 9, material: 'foliage' },
  { x, y: 4.05, z, r: 1.3, rTop: 0.18, h: 1.5, color: PINE_2, sides: 9, material: 'foliage' },
  { x, y: 4.95, z, r: 0.9, rTop: 0.1, h: 1.3, color: PINE_3, sides: 8, material: 'foliage' },
  { x, y: 5.6, z, r: 0.5, rTop: 0.03, h: 1.0, color: PINE_3, sides: 8, material: 'foliage' },
];

/** Ржавая бочка: твёрдый цилиндр (идёт в список цилиндров) и два обруча-декора. */
const rustBarrel = (fu: Furnisher, x: number, z: number, base = 0): MapCylinder => {
  for (const k of [0.2, 0.8]) fu.decoCyl(x, base + 1.1 * k - 0.03, z, 0.515, 0.06, RUST_DARK, 'metal', { sides: 12 });
  return { x, y: base + 0.55, z, r: 0.5, h: 1.1, color: RUST, solid: true, sides: 12, material: 'rust' };
};

// --- лагерь ----------------------------------------------------------------------------

const LODGE_TOP = 4.2;

/**
 * Северный (красный) лагерь. Дом стоит спиной к обрыву, перед ним двор с палатками и
 * костром, по бокам два сруба, справа вышка с пандусом. Выход из лагеря — только через
 * трое ворот в гряде на z = -36: западные x -46..-38, центральные x -6..6, восточные
 * x 38..46.
 */
const campBoxes: MapBox[] = [
  // Дом: бревенчатые стены 0..4,2 м, два проёма в южной стене, плита крыши поверх —
  // твёрдая: на ней стоит скатная кровля, под ней не идёт снег.
  block(-13, 13, 0, LODGE_TOP, -54, -53.5, WOOD, 'logs'),
  block(-13, -12.5, 0, LODGE_TOP, -54, -46, WOOD, 'logs'),
  block(12.5, 13, 0, LODGE_TOP, -54, -46, WOOD, 'logs'),
  block(-13, -8, 0, LODGE_TOP, -46.5, -46, WOOD, 'logs'),
  block(-3, 3, 0, LODGE_TOP, -46.5, -46, WOOD, 'logs'),
  block(8, 13, 0, LODGE_TOP, -46.5, -46, WOOD, 'logs'),
  block(-8, -3, 2.6, LODGE_TOP, -46.5, -46, WOOD, 'logs'),
  block(3, 8, 2.6, LODGE_TOP, -46.5, -46, WOOD, 'logs'),
  block(-14.5, 14.5, LODGE_TOP, 4.8, -55.5, -45, WOOD_DARK, 'planks'),
  // Стол радиста у северной стены — прежняя стойка, то же укрытие.
  block(-2, 2, 0, 1.2, -53, -51, WOOD_DARK, 'wood'),

  // Вышка над западной частью двора: площадка на 3 м, перила с разрывом под пандус,
  // который заходит с севера. Под площадкой остаётся крытый проход (потолок 2,8 м).
  slab(-19, -13, -44, -38, 3, WOOD_DARK, 'planks'),
  block(-19, -18, 3, 3.9, -44, -43.6, WOOD_DARK, 'wood'),
  block(-14, -13, 3, 3.9, -44, -43.6, WOOD_DARK, 'wood'),
  block(-19, -18.6, 3, 3.9, -43.6, -38, WOOD_DARK, 'wood'),
  block(-13.4, -13, 3, 3.9, -43.6, -38, WOOD_DARK, 'wood'),
  block(-18.6, -13.4, 3, 3.9, -38.4, -38, WOOD_DARK, 'wood'),

  // Утоптанный снег вокруг костра.
  paint(-7, 7, -46, -40, SNOW_DRIFT, 0.3, 'snow'),

  // Валуны, прикрывающие двор.
  block(-11, -7, 0, 1.2, -39, -38, ROCK, 'rock'),
  block(7, 11, 0, 1.2, -39, -38, ROCK, 'rock'),
  block(-34, -31, 0, 1.5, -44, -41, ROCK, 'rock'),
  block(31, 34, 0, 1.5, -44, -41, ROCK, 'rock'),
  block(-40, -36, 0, 1.4, -50, -47, ROCK, 'rock'),
  block(36, 40, 0, 1.4, -50, -47, ROCK, 'rock'),
  block(-46, -42, 0, 1.6, -42, -39, ROCK, 'rock'),
  block(42, 46, 0, 1.6, -42, -39, ROCK, 'rock'),
  block(-52, -48, 0, 1.4, -48, -45, ROCK, 'rock'),
  block(48, 52, 0, 1.4, -48, -45, ROCK, 'rock'),

  // Гряда на z = -36 с тремя воротами и каменными столбами по их краям.
  block(-59, -46, 0, 5, -37, -35, ROCK, 'rock'),
  block(-38, -6, 0, 5, -37, -35, ROCK, 'rock'),
  block(6, 38, 0, 5, -37, -35, ROCK, 'rock'),
  block(46, 59, 0, 5, -37, -35, ROCK, 'rock'),
  block(-46.8, -45, 0, 6, -37.6, -34.4, ROCK_DARK, 'rock'),
  block(-38, -36.2, 0, 6, -37.6, -34.4, ROCK_DARK, 'rock'),
  block(-6.8, -5, 0, 6, -37.6, -34.4, ROCK_DARK, 'rock'),
  block(5, 6.8, 0, 6, -37.6, -34.4, ROCK_DARK, 'rock'),
  block(36.2, 38, 0, 6, -37.6, -34.4, ROCK_DARK, 'rock'),
  block(45, 46.8, 0, 6, -37.6, -34.4, ROCK_DARK, 'rock'),
];

// Дом изнутри: столовая с двумя длинными столами, нары по северной стене, печь, полки и
// поленница по западной, шкафчики и пирамида для лыж и винтовок по восточной, стол радиста
// с картой долины посередине, вешалка у дверей. Спавн (0, -49.5) — на свободном ковре.
f.cover(-12.5, 12.5, -53.5, -46, 0, PLANK, 'planks', 0.03); // пол и пороги
f.deco(-12.5, 12.5, LODGE_TOP - 0.03, LODGE_TOP - 0.01, -53.5, -46.5, CEILING, 'planks');
for (const x of [-10.5, -7, -3.5, 0, 3.5, 7, 10.5]) f.deco(x - 0.12, x + 0.12, 3.95, LODGE_TOP - 0.03, -53.5, -46.5, WOOD_DARK, 'wood');
// Скатная кровля над плитой: конёк вдоль дома, фронтоны из брёвен.
f.roofs.push({ minX: -14.5, maxX: 14.5, minZ: -55.5, maxZ: -45, y: 4.8, rise: 2.3, ridge: 'x', color: ROOF, material: 'planks', gable: WOOD, gableMaterial: 'logs', overhang: 0.25 });
// Выпуски брёвен на углах: через венец то вдоль x, то вдоль z.
for (let i = 0; i < 14; i++) {
  const y0 = i * 0.3,
    y1 = y0 + 0.3;
  for (const [x, z] of [
    [-13, -54],
    [13, -54],
    [-13, -46],
    [13, -46],
  ]) {
    const sx = Math.sign(x),
      sz = z < -50 ? -1 : 1;
    if (i % 2 === 0) {
      const zc = z - sz * 0.25;
      f.deco(Math.min(x, x + sx * 0.35), Math.max(x, x + sx * 0.35), y0, y1, zc - 0.14, zc + 0.14, WOOD, 'bark');
    } else {
      const xc = x - sx * 0.25;
      f.deco(xc - 0.14, xc + 0.14, y0, y1, Math.min(z, z + sz * 0.37), Math.max(z, z + sz * 0.37), WOOD, 'bark');
    }
  }
}
// Сосульки с южной кромки плиты крыши — выше 3,6 м.
for (let i = 0; i < 22; i++) {
  const h = 0.25 + ((i * 7) % 5) * 0.08;
  f.decoCyl(-13.9 + i * 1.33, LODGE_TOP - h, -45.12, 0.01, h, ICE, 'ice', { rTop: 0.07, sides: 6 });
}
// Проёмы: наличники поверх стены (проём не сужают), распахнутые наружу створки у фасада,
// фонарь над каждым входом.
for (const [a, b] of [
  [-8, -3],
  [3, 8],
]) {
  f.deco(a - 0.18, a, 0, 2.78, -46.58, -45.92, WOOD_DARK, 'wood');
  f.deco(b, b + 0.18, 0, 2.78, -46.58, -45.92, WOOD_DARK, 'wood');
  f.deco(a - 0.18, b + 0.18, 2.6, 2.78, -46.58, -45.92, WOOD_DARK, 'wood');
  for (const [p, q, tilt] of [
    [a - 2.4, a - 0.2, 1],
    [b + 0.2, b + 2.4, -1],
  ]) {
    f.deco(p, q, 0.05, 2.5, -45.9, -45.84, WOOD_DARK, 'planks');
    for (const y of [0.4, 2.1]) f.deco(p, q, y - 0.06, y + 0.06, -45.84, -45.8, WOOD, 'wood');
    f.decor.push({ x: (p + q) / 2, y: 1.25, z: -45.82, w: Math.hypot(q - p, 1.7) - 0.1, h: 0.1, d: 0.04, color: WOOD, material: 'wood', rot: [0, 0, tilt * Math.atan2(1.7, q - p)] });
  }
  const mid = (a + b) / 2;
  f.deco(mid - 0.03, mid + 0.03, 3.1, 3.16, -46, -45.7, IRON, 'metal');
  f.lantern(mid, 2.9, -45.72);
}
// Два длинных стола (на месте прежних столов 4 x 4 м) со скамьями, мисками и фонарём.
for (const s of [-1, 1]) {
  const x = 7 * s;
  f.table(x - 0.7, x + 0.7, -52, -48, { height: 0.9, color: WOOD_DARK });
  f.bench(x - 1.85, x - 1.3, -51.8, -48.2, { color: WOOD });
  f.bench(x + 1.3, x + 1.85, -51.8, -48.2, { color: WOOD });
  for (const z of [-51.4, -50.4, -49.4, -48.6])
    for (const side of [-1, 1]) {
      f.decoCyl(x + side * 0.42, 0.9, z, 0.13, 0.02, METAL, 'metal', { sides: 12 });
      f.decoCyl(x + side * 0.2, 0.9, z + 0.25, 0.05, 0.11, IRON, 'metal', { sides: 8 });
    }
  f.lantern(x, 0.9, -50);
}
// Нары по северной стене: по две в каждом конце, коврики перед ними, ковёр на стене.
for (const s of [-1, 1]) {
  const X = (a: number, b: number): [number, number] => (s < 0 ? [a, b] : [-b, -a]);
  f.bunk(...X(-12.4, -10.4), -53.4, -52.5, s < 0 ? 'w' : 'e', { blanket: BLANKET_RED });
  f.bunk(...X(-10.2, -8.2), -53.4, -52.5, s < 0 ? 'e' : 'w', { blanket: BLANKET_BLUE });
  f.rug(...X(-12, -9.2), -52.4, -51.1, RUG_BROWN, 0.03);
  f.wallRug('n', -53.5, ...X(-12.1, -8.5), 1.95, 2.9, RUG_RED);
}
// Западная стена: полки, поленница и печь впритык друг к другу, труба сквозь крышу.
f.shelf(-12.5, -12.05, -51.8, -50.2, 1.9, 'e', { goods: GOODS });
f.woodpile(-12.5, -12, -50.2, -48.6, 0.9, { along: 'z', color: LOG });
f.stove(-12.2, -48.25, 'e', 7.3);
f.decoCyl(-12.2, 7.3, -48.25, 0.14, 0.06, IRON, 'metal', { sides: 10 });
f.deco(-12.5, -12.46, 0, 1.7, -48.9, -47.6, '#8a4a36', 'brick');
f.deco(-12.46, -11.5, 0.03, 0.05, -48.9, -47.6, ROCK_DARK, 'ashlar');
f.decoCyl(-12.02, 0.72, -48.45, 0.1, 0.14, SOOT, 'metal', { rTop: 0.07, sides: 10 });
f.rug(-11.4, -10.2, -48.9, -47.6, '#5a4632', 0.03);
// Восточная стена: железные шкафчики и пирамида с лыжами и винтовками.
f.solid(12, 12.5, 0, 2, -52, -49.8, LOCKER, 'metal');
for (const z of [-51.45, -50.9, -50.35]) f.deco(11.98, 12, 0.05, 1.95, z - 0.01, z + 0.01, SOOT, 'metal');
for (let i = 0; i < 4; i++) {
  const z = -51.725 + i * 0.55;
  f.deco(11.97, 12, 1, 1.12, z + 0.12, z + 0.16, IRON, 'metal');
  for (const y of [1.62, 1.7, 1.78]) f.deco(11.985, 12, y, y + 0.03, z - 0.15, z + 0.15, SOOT, 'metal');
}
f.deco(12.3, 12.5, 0.2, 0.28, -49.4, -47.1, WOOD_DARK, 'wood');
f.deco(12.3, 12.5, 1.45, 1.53, -49.4, -47.1, WOOD_DARK, 'wood');
['#8a3b2f', BLANKET_BLUE, RUG_BROWN].forEach((c, i) => {
  for (const dz of [0, 0.11]) f.decor.push({ x: 12.36, y: 0.95, z: -49.2 + i * 0.4 + dz, w: 0.02, h: 1.8, d: 0.08, color: c, material: 'wood', rot: [0, 0, -0.1] });
});
for (let i = 0; i < 3; i++) {
  const z = -47.9 + i * 0.3;
  f.deco(12.33, 12.43, 0.05, 0.5, z - 0.05, z + 0.05, WOOD, 'wood');
  f.deco(12.36, 12.4, 0.5, 1.45, z - 0.02, z + 0.02, IRON, 'metal');
}
// Стол радиста: рация со светящейся шкалой и антенной, карта на столе, лампа, табурет.
f.deco(-2.05, 2.05, 1.2, 1.24, -53.05, -50.95, WOOD, 'wood');
f.deco(-2, 2, 0.08, 1.16, -50.97, -50.95, WOOD, 'planks');
f.deco(-1.5, -0.4, 1.24, 1.68, -52.9, -52.4, RADIO, 'metal');
f.deco(-1.38, -0.92, 1.42, 1.58, -52.4, -52.39, DIAL, undefined, 2);
f.deco(-0.85, -0.5, 1.3, 1.6, -52.4, -52.395, SOOT, 'metal');
for (const x of [-1.3, -1.12, -0.98]) f.deco(x - 0.03, x + 0.03, 1.3, 1.36, -52.4, -52.36, IRON, 'metal');
f.decoCyl(-0.5, 1.68, -52.8, 0.012, 1, IRON, 'metal', { sides: 6 });
f.deco(-0.2, 0.05, 1.24, 1.3, -52.3, -52.1, SOOT, 'metal');
f.deco(0.2, 1.4, 1.24, 1.246, -52.5, -51.4, PAPER, 'fabric');
f.lantern(1.7, 1.24, -52.7);
f.stump(0.9, -50.6);
// Карта долины на стене за столом: север сверху — гряды, плато, ледник, карьер, лагеря.
f.deco(-1.75, 1.75, 1.45, 2.75, -53.5, -53.46, WOOD_DARK, 'wood');
f.deco(-1.65, 1.65, 1.55, 2.65, -53.46, -53.45, PAPER, 'fabric');
for (const y of [1.78, 2.42]) f.deco(-1.5, 1.5, y - 0.015, y + 0.015, -53.45, -53.44, ROCK_DARK);
f.deco(-0.4, 0.4, 1.95, 2.25, -53.45, -53.44, SLATE);
f.deco(-1.55, -1, 1.65, 2.55, -53.45, -53.44, ICE_DEEP);
f.deco(1, 1.55, 1.8, 2.4, -53.45, -53.44, RUST);
f.deco(-0.06, 0.06, 2.5, 2.6, -53.44, -53.42, CANVAS_RED);
f.deco(-0.06, 0.06, 1.6, 1.7, -53.44, -53.42, BLANKET_BLUE);
// Вешалка у дверей: скамья, куртки на крючках, валенки.
f.bench(-2.6, 2.6, -47, -46.55, { color: WOOD });
f.deco(-2.7, 2.7, 1.78, 1.84, -46.58, -46.5, WOOD_DARK, 'wood');
[-2.1, -1, 1, 2.1].forEach((x, i) => {
  f.deco(x - 0.27, x + 0.27, 1, 1.8, -46.74, -46.52, ['#8a3b2f', BLANKET_BLUE, '#6b5a44', BLANKET_RED][i], 'fabric');
  f.deco(x - 0.2, x + 0.2, 0.45, 0.72, -46.9, -46.6, SOOT, 'leather');
});
// Ковёр посередине и фонари под балками — выше 2,4 м.
f.rug(-3.2, 3.2, -51, -48, RUG_RED, 0.03);
for (const x of [-10.5, 0, 10.5]) f.lantern(x, 2.5, -50, { hang: 3.95 });

// Два сруба по бокам двора. Дверь смотрит во двор (к x = 0) между опорами вышки, окна —
// в поле и в сторону от двора. Внутри нары, печь с поленницей, стол с чурбаками, полки.
for (const s of [-1, 1]) {
  const cx = 24 * s;
  // Координаты ниже — для западного сруба; восточный — его отражение по x.
  const X = (v: number) => (s < 0 ? v : -v);
  const XR = (a: number, b: number): [number, number] => (s < 0 ? [a, b] : [-b, -a]);
  const yard: Side = s < 0 ? 'e' : 'w';
  const back: Side = s < 0 ? 'w' : 'e';
  f.logCabin({
    minX: cx - 4,
    maxX: cx + 4,
    minZ: -46,
    maxZ: -40,
    height: 3.2,
    wall: WOOD,
    roof: ROOF,
    rise: 1.3,
    doors: [{ side: yard, at: -41.4 }],
    windows: [
      { side: 's', at: cx, w: 1.2 },
      { side: back, at: -43.4 },
    ],
  });
  f.bunk(...XR(-27.6, -25.6), -45.6, -44.7, back, { blanket: BLANKET_RED });
  f.bunk(...XR(-25.4, -23.4), -45.6, -44.7, yard, { blanket: BLANKET_BLUE });
  f.stove(X(-20.65), -45.4, 's', 4.6);
  f.decoCyl(X(-20.65), 4.6, -45.4, 0.14, 0.06, IRON, 'metal', { sides: 10 });
  f.woodpile(...XR(-20.8, -20.3), -45.1, -44.1, 0.9, { along: 'z', color: LOG });
  f.table(...XR(-25.1, -23.9), -42.8, -41.9, { color: WOOD_DARK });
  f.lantern(X(-24.5), 0.76, -42.35);
  f.decoCyl(X(-24.9), 0.76, -42.2, 0.05, 0.11, IRON, 'metal', { sides: 8 });
  f.decoCyl(X(-24.1), 0.76, -42.5, 0.05, 0.11, IRON, 'metal', { sides: 8 });
  for (const [x, z] of [
    [-25.5, -42.35],
    [-23.5, -42.35],
    [-24.5, -43.25],
  ])
    f.stump(X(x), z);
  f.shelf(...XR(-27.7, -27.3), -41.9, -40.3, 1.6, yard, { goods: GOODS });
  f.rug(...XR(-26.8, -22.6), -44.4, -43.3, RUG_RED, 0.03);
  // Фонарь снаружи у двери, на кронштейне.
  f.deco(...XR(-20, -19.75), 2.6, 2.64, -42.38, -42.32, IRON, 'metal');
  f.lantern(X(-19.78), 2.3, -42.35);
}

// Палатки во дворе: брезентовая двускатная крыша на земле по прежним габаритам.
f.tent(-9, -5.6, -45, -42, 1.9, CANVAS_RED);
f.tent(5.6, 9, -45, -42, 1.9, CANVAS_RED);

// Костёр: кольцо камней, угли, пламя, котелок на треноге; три бревна-сиденья вокруг
// (0,45 м — на них встают, проход не перекрывают).
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  f.spheres.push({ x: Math.cos(a) * 0.95, y: 0.1, z: -43 + Math.sin(a) * 0.95, r: 0.26, color: ROCK_DARK, material: 'rock' });
}
f.decoCyl(0, 0, -43, 0.6, 0.08, EMBER, undefined, { glow: 2.2, sides: 12 });
f.deco(-0.55, 0.55, 0.05, 0.25, -43.1, -42.9, SOOT, 'bark');
f.deco(-0.1, 0.1, 0.05, 0.25, -43.55, -42.45, SOOT, 'bark');
f.decoCyl(0, 0.08, -43, 0.32, 0.75, FLAME, undefined, { rTop: 0.02, glow: 2.5, sides: 7 });
f.decoCyl(0.18, 0.08, -42.85, 0.18, 0.45, '#ffdf8a', undefined, { rTop: 0.01, glow: 2.5, sides: 6 });
f.decoCyl(-0.15, 0.08, -43.15, 0.2, 0.5, FLAME, undefined, { rTop: 0.01, glow: 2.5, sides: 6 });
for (let i = 0; i < 3; i++) {
  const a = (i / 3) * Math.PI * 2 + 0.3;
  strut(f, [Math.cos(a) * 0.85, 0, -43 + Math.sin(a) * 0.85], [0, 1.45, -43], 0.05, WOOD_DARK, 'wood');
}
f.decoCyl(0, 1.0, -43, 0.01, 0.45, IRON, 'metal', { sides: 5 });
f.decoCyl(0, 0.72, -43, 0.2, 0.28, SOOT, 'metal', { rTop: 0.23, sides: 12 });
f.solid(-2.55, -2.1, 0, 0.45, -43.9, -42.1, LOG, 'bark');
f.solid(2.1, 2.55, 0, 0.45, -43.9, -42.1, LOG, 'bark');
f.solid(-0.9, 0.9, 0, 0.45, -45.35, -44.9, LOG, 'bark');
// Ряд ящиков на месте прежней штабели x -3..3 (тот же габарит и высота), мешки поверх.
for (let i = 0; i < 6; i++) f.crate(-2.5 + i, -40.5, 1, { color: i % 2 ? CRATE_DARK : CRATE });
f.deco(-1.9, -1.2, 1, 1.4, -40.78, -40.3, SACK, 'sack');
f.deco(1.3, 1.95, 1, 1.35, -40.7, -40.25, SACK, 'sack');

// Вышка: подкосы под площадкой (выше 2,4 м — над крытым проходом), прожектор на юго-
// восточном углу перил, фонарь на шесте над северо-западным.
for (const x of [-18, -14]) f.deco(x - 0.08, x + 0.08, 2.45, 2.6, -43, -39, WOOD_DARK, 'wood');
for (const z of [-43, -39]) f.deco(-18, -14, 2.45, 2.6, z - 0.08, z + 0.08, WOOD_DARK, 'wood');
f.deco(-13.4, -13, 3.9, 4, -38.4, -38, IRON, 'metal');
f.deco(-13.24, -13.16, 4, 4.1, -38.24, -38.16, IRON, 'metal');
f.decorCylinders.push(
  { x: -13.2, y: 4.3, z: -38.2, r: 0.22, h: 0.5, color: IRON, material: 'metal', axis: 'z', sides: 12 },
  { x: -13.2, y: 4.3, z: -37.93, r: 0.19, h: 0.04, color: SEARCH, axis: 'z', glow: 2.5, sides: 12 },
);
f.deco(-18.95, -18.85, 3.9, 5.8, -43.95, -43.85, WOOD_DARK, 'wood');
f.deco(-18.95, -18.3, 5.7, 5.78, -43.94, -43.86, WOOD_DARK, 'wood');
f.lantern(-18.4, 5.1, -43.9, { hang: 5.7 });

/** Двенадцать точек спавна на лагерь: одиннадцать во дворе, одна в доме. */
const SPAWN_XZ: [number, number][] = [
  [-17, 51],
  [17, 51],
  [-24, 50],
  [24, 50],
  [-11, 41],
  [11, 41],
  [-3.5, 44],
  [3.5, 44],
  [0, 38.5],
  [-20, 38.5],
  [20, 38.5],
  [0, 49.5],
];

/** Красные стоят на севере и смотрят на юг (yaw π), синие — наоборот. */
const campSpawns = (s: 1 | -1): SpawnPoint[] =>
  SPAWN_XZ.map(([x, z]) => ({ x, z: s * z, yaw: s < 0 ? Math.PI : 0 }));

// --- центральное плато -----------------------------------------------------------------

const PLATEAU_TOP = 3.4;
const TUNNEL_CEIL = 3;

/** Северная половина плато: четверть-блоки, крыша северного рукава тоннеля, бруствер. */
const plateauNorth: MapBox[] = [
  block(-22, -3, 0, PLATEAU_TOP, -18, -3, CLIFF, 'rock'),
  block(3, 22, 0, PLATEAU_TOP, -18, -3, CLIFF, 'rock'),
  // Свод тоннеля — бетонная плита; сверху она дорожкой ведёт к проёму станции.
  block(-3, 3, TUNNEL_CEIL, PLATEAU_TOP, -18, -3, CONCRETE, 'concrete'),
  // Бруствер по северной кромке с разрывами под пандусы (x -14..-8 и 8..14).
  block(-22, -14, PLATEAU_TOP, 4.4, -18, -17.4, ROCK_DARK, 'rock'),
  block(-8, 8, PLATEAU_TOP, 4.4, -18, -17.4, ROCK_DARK, 'rock'),
  block(14, 22, PLATEAU_TOP, 4.4, -18, -17.4, ROCK_DARK, 'rock'),
  // Руина станции: северная стена с проёмом и северные половины боковых стен.
  block(-10, -2, PLATEAU_TOP, 6.4, -10, -9.2, SLATE, 'concrete'),
  block(2, 10, PLATEAU_TOP, 6.4, -10, -9.2, SLATE, 'concrete'),
  block(-10, -9.2, PLATEAU_TOP, 6.4, -10, -2, SLATE, 'concrete'),
  block(9.2, 10, PLATEAU_TOP, 6.4, -10, -2, SLATE, 'concrete'),
  // Две угловые башни — ориентир, видимый через всю долину.
  block(-21, -17, PLATEAU_TOP, 8.2, -15, -11, SLATE, 'concrete'),
  block(17, 21, PLATEAU_TOP, 8.2, -15, -11, SLATE, 'concrete'),
  // Укрытия во дворе руины (штабели досок под брезентом) и в северном рукаве тоннеля.
  block(-6, -3, PLATEAU_TOP, 4.4, -7, -5, WOOD_DARK, 'planks'),
  block(3, 6, PLATEAU_TOP, 4.4, -7, -5, WOOD_DARK, 'planks'),
  block(-2.4, 2.4, 0, 1.2, -13, -11, ROCK, 'rock'),
  // Старый ржавый генератор у западной стены двора.
  block(-9.2, -8.2, PLATEAU_TOP, 4.5, -5.6, -3.8, RUST, 'rust'),
];

/** Части плато, лежащие на самой оси z = 0. */
const plateauCentre: MapBox[] = [
  block(-22, 22, TUNNEL_CEIL, PLATEAU_TOP, -3, 3, CONCRETE, 'concrete'),
  block(-22, -21.4, PLATEAU_TOP, 4.4, -18, 18, ROCK_DARK, 'rock'),
  block(21.4, 22, PLATEAU_TOP, 4.4, -18, 18, ROCK_DARK, 'rock'),
  block(-13, -11, 0, 1.2, -2.4, 2.4, ROCK, 'rock'),
  block(11, 13, 0, 1.2, -2.4, 2.4, ROCK, 'rock'),
];

// Руина: брезент на штабелях, обломки верха стен с арматурой, завалы у подножия стен,
// упавшие балки (одна поперёк угла по верху стен, одна прислонена к стене), детали
// генератора, радиомачта с растяжками и маячком на западной башне.
for (const [x0, x1] of [
  [-6, -3],
  [3, 6],
]) {
  f.deco(x0 - 0.05, x1 + 0.05, 4.4, 4.46, -7.05, -4.95, TARP, 'canvas');
  f.deco(x0 - 0.05, x1 + 0.05, 3.85, 4.4, -7.05, -7, TARP, 'canvas');
  f.deco(x0 - 0.05, x1 + 0.05, 3.95, 4.4, -5, -4.95, TARP, 'canvas');
}
for (const [x0, x1, z0, z1, h] of [
  [-10, -8.8, -10, -9.2, 0.5],
  [-3.2, -2, -10, -9.2, 0.35],
  [8.6, 10, -10, -9.2, 0.45],
  [9.2, 10, -3.4, -2, 0.4],
]) {
  f.deco(x0, x1, 6.4, 6.4 + h, z0, z1, SLATE, 'concrete');
  for (let i = 0; i < 3; i++) f.decoCyl(x0 + 0.2 + i * 0.3, 6.4 + h, (z0 + z1) / 2, 0.015, 0.5 - i * 0.1, RUST, 'rust', { sides: 5 });
}
for (const [x, y, z, r] of [
  [-8.7, 3.5, -8.7, 0.45],
  [-8, 3.45, -8.85, 0.3],
  [-8.85, 3.45, -8, 0.32],
  [8.8, 3.48, -8.6, 0.38],
  [-6, 3.5, -10.5, 0.4],
  [-4.6, 3.45, -10.4, 0.28],
  [6.5, 3.48, -10.45, 0.35],
]) f.spheres.push({ x, y, z, r, color: ROCK_DARK, material: 'rock' });
f.decor.push(
  { x: -8.3, y: 3.47, z: -8.6, w: 1.1, h: 0.14, d: 0.6, color: SLATE, material: 'concrete', rot: [0.12, 0.3, 0.08] },
  { x: 8.3, y: 3.47, z: -8.8, w: 0.9, h: 0.12, d: 0.5, color: SLATE, material: 'concrete', rot: [-0.1, -0.5, 0.1] },
  { x: -14, y: 3.5, z: -8, w: 3, h: 0.2, d: 0.4, color: SLATE, material: 'concrete', rot: [0, 0.4, 0] },
);
strut(f, [-9.6, 6.53, -5], [-5, 6.53, -9.6], 0.2, RUST_DARK, 'rust');
strut(f, [8.6, PLATEAU_TOP, -6], [9.15, 5.9, -6], 0.18, RUST_DARK, 'rust');
f.deco(-9.1, -8.3, 3.6, 4.4, -3.8, -3.77, SOOT, 'metal');
f.decorCylinders.push({ x: -8.7, y: 4.72, z: -4.7, r: 0.22, h: 1.5, color: RUST_DARK, material: 'rust', axis: 'z', sides: 10 });
f.decoCyl(-9.05, 4.5, -5.3, 0.06, 1.3, SOOT, 'metal', { sides: 8 });
f.deco(-8.2, -8.17, 3.9, 4.35, -5.2, -4.6, RADIO, 'metal');
f.deco(-8.17, -8.16, 4.1, 4.25, -5.05, -4.9, METAL, 'metal');
{
  const [mx, mz, top] = [-19, -13, 8.2];
  for (const [dx, dz] of [
    [-0.3, -0.3],
    [0.3, -0.3],
    [-0.3, 0.3],
    [0.3, 0.3],
  ])
    f.deco(mx + dx - 0.03, mx + dx + 0.03, top, top + 6, mz + dz - 0.03, mz + dz + 0.03, RUST, 'metal');
  for (let y = top + 0.5; y < top + 6; y += 0.6) {
    f.deco(mx - 0.33, mx + 0.33, y, y + 0.04, mz - 0.33, mz - 0.27, RUST, 'metal');
    f.deco(mx - 0.33, mx + 0.33, y, y + 0.04, mz + 0.27, mz + 0.33, RUST, 'metal');
    f.deco(mx - 0.33, mx - 0.27, y, y + 0.04, mz - 0.33, mz + 0.33, RUST, 'metal');
    f.deco(mx + 0.27, mx + 0.33, y, y + 0.04, mz - 0.33, mz + 0.33, RUST, 'metal');
  }
  f.deco(mx - 0.9, mx + 0.9, top + 5.2, top + 5.24, mz - 0.02, mz + 0.02, IRON, 'metal');
  f.decorCylinders.push({ x: mx + 0.45, y: top + 4, z: mz, r: 0.35, h: 0.08, color: METAL, material: 'metal', axis: 'x', sides: 14 });
  f.decoCyl(mx, top + 6, mz, 0.12, 0.2, BEACON, undefined, { glow: 2.4, sides: 8 });
  for (const [cx, cz] of [
    [-20.9, -14.9],
    [-17.1, -14.9],
    [-20.9, -11.1],
    [-17.1, -11.1],
  ])
    strut(f, [mx, top + 5.6, mz], [cx, top, cz], 0.02, IRON, 'metal');
}

// Тоннель: бетонный пол и порталы устьев, рёбра обделки вдоль стен и по своду (не толще
// 0,15 м), лотки с кабелем и трубы выше 2,2 м, светильники под сводом, решётка водостока.
// Рукава шириной 6 м остаются свободными — всё это декор у стен и над головой.
f.cover(-3, 3, -18, -3, 0, CONCRETE, 'concrete', 0.02);
f.cover(-22, 22, -3, 0, 0, CONCRETE, 'concrete', 0.02);
for (const z of [-16.5, -13.5, -10.5, -7.5, -4.5]) {
  f.deco(-3, -2.87, 0, TUNNEL_CEIL, z - 0.2, z + 0.2, RIB, 'concrete');
  f.deco(2.87, 3, 0, TUNNEL_CEIL, z - 0.2, z + 0.2, RIB, 'concrete');
  f.deco(-3, 3, TUNNEL_CEIL - 0.15, TUNNEL_CEIL, z - 0.2, z + 0.2, RIB, 'concrete');
}
for (const x of [4.5, 7.5, 10.5, 13.5, 16.5, 19.5])
  for (const X of [-x, x]) {
    f.deco(X - 0.2, X + 0.2, 0, TUNNEL_CEIL, -3, -2.87, RIB, 'concrete');
    f.deco(X - 0.2, X + 0.2, TUNNEL_CEIL - 0.15, TUNNEL_CEIL, -3, 0, RIB, 'concrete');
  }
// Северный рукав: лоток с кабелями по западной стене, трубы по восточной.
f.deco(-2.87, -2.55, 2.3, 2.34, -17.9, -3.1, IRON, 'metal');
f.decorCylinders.push(
  { x: -2.78, y: 2.37, z: -10.5, r: 0.03, h: 14.8, color: SOOT, axis: 'z', sides: 6 },
  { x: -2.66, y: 2.37, z: -10.5, r: 0.03, h: 14.8, color: BLANKET_RED, axis: 'z', sides: 6 },
  { x: 2.7, y: 2.62, z: -10.5, r: 0.12, h: 14.9, color: RUST, material: 'rust', axis: 'z', sides: 10 },
  { x: 2.74, y: 2.32, z: -10.5, r: 0.06, h: 14.9, color: METAL, material: 'metal', axis: 'z', sides: 8 },
);
// Поперечный рукав: то же по северной стене (южную даёт отражение).
for (const sx of [-1, 1]) {
  f.deco(Math.min(3.1 * sx, 21.9 * sx), Math.max(3.1 * sx, 21.9 * sx), 2.3, 2.34, -2.87, -2.55, IRON, 'metal');
  f.decorCylinders.push(
    { x: 12.5 * sx, y: 2.37, z: -2.78, r: 0.03, h: 18.8, color: SOOT, axis: 'x', sides: 6 },
    { x: 12.5 * sx, y: 2.37, z: -2.66, r: 0.03, h: 18.8, color: BLANKET_RED, axis: 'x', sides: 6 },
    { x: 12.5 * sx, y: 2.62, z: -2.72, r: 0.1, h: 18.9, color: RUST, material: 'rust', axis: 'x', sides: 10 },
  );
}
for (const z of [-15, -10, -5]) {
  f.deco(-0.3, 0.3, 2.9, TUNNEL_CEIL, z - 0.15, z + 0.15, IRON, 'metal');
  f.deco(-0.25, 0.25, 2.88, 2.9, z - 0.1, z + 0.1, LAMP_COOL, undefined, 2.2);
}
f.deco(-0.3, 0.3, 0.02, 0.035, -18, -3, IRON, 'metal');
f.deco(-22, 22, 0.02, 0.035, -0.3, 0, IRON, 'metal');
// Бетонные порталы устьев на скальном срезе плато.
f.deco(-3.45, -3, 0, 3.45, -18.2, -18, CONCRETE, 'concrete');
f.deco(3, 3.45, 0, 3.45, -18.2, -18, CONCRETE, 'concrete');
f.deco(-3.45, 3.45, TUNNEL_CEIL, 3.45, -18.2, -18, CONCRETE, 'concrete');
for (const [x0, x1] of [
  [-22.2, -22],
  [22, 22.2],
]) {
  f.deco(x0, x1, 0, 3.45, -3.45, -3, CONCRETE, 'concrete');
  f.deco(x0, x1, TUNNEL_CEIL, 3.45, -3.45, 0, CONCRETE, 'concrete');
}
// Светильники поперечного рукава и перекрёстка висят на оси z = 0.
for (const x of [-18, -12, -6, 0, 6, 12, 18]) {
  fc.deco(x - 0.15, x + 0.15, 2.9, TUNNEL_CEIL, -0.3, 0.3, IRON, 'metal');
  fc.deco(x - 0.1, x + 0.1, 2.88, 2.9, -0.25, 0.25, LAMP_COOL, undefined, 2.2);
}

// --- западный фланг: ледник и грот -----------------------------------------------------

const SHELF_TOP = 2.5;
/** Низ полки: под ней 2,3 м — во весь рост проходится, вставать можно. */
const SHELF_UNDER = SHELF_TOP - 0.2;
/** Ряды колонн, держащих полку: x у двух колонн ряда. */
const PILLAR_X: [number, number][] = [
  [-54.9, -53.1],
  [-47.9, -46.1],
];

/** Ряд ледяных колонн, держащих полку. */
const grottoPillars = (z: number): MapBox[] =>
  PILLAR_X.map(([x0, x1]) => block(x0, x1, 0, SHELF_UNDER, z - 0.9, z + 0.9, ICE_DEEP, 'ice'));

const glacierNorth: MapBox[] = [
  ...grottoPillars(-24),
  ...grottoPillars(-16),
  ...grottoPillars(-8),
  // Сераки на полке — единственные укрытия наверху.
  block(-56, -53, SHELF_TOP, 4.6, -22, -19, ICE, 'ice'),
  block(-48, -45, SHELF_TOP, 4.6, -14, -11, ICE, 'ice'),
  block(-44, -41.5, SHELF_TOP, 4.2, -24, -21, ICE, 'ice'),
  block(-57, -54, SHELF_TOP, 4, -9, -6, ICE, 'ice'),
  // Глыбы льда в гроте.
  block(-52, -50, 0, 1.4, -26, -24, ICE, 'ice'),
  block(-45, -43, 0, 1.5, -19, -17, ICE, 'ice'),
  block(-51, -49, 0, 1.3, -12, -10, ICE, 'ice'),
  // Каменный порог у восточного пандуса на полку.
  block(-40, -37, 0, 1.4, -16, -14, ROCK, 'rock'),
];

const glacierCentre: MapBox[] = [
  slab(-58, -40, -28, 28, SHELF_TOP, ICE_PALE, 'ice'),
  ...grottoPillars(0),
  block(-52, -49, SHELF_TOP, 4.4, -5, 5, ICE, 'ice'),
  block(-46, -44, 0, 1.4, -2, 2, ICE, 'ice'),
];

/** Детерминированный «случайный» разброс 0..1: сосульки не выстраиваются по линейке. */
const hash = (i: number) => {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const inPillar = (x: number, z: number) =>
  PILLAR_X.some(([x0, x1]) => x > x0 - 0.2 && x < x1 + 0.2) && [-24, -16, -8, 0].some((c) => Math.abs(z - c) < 1.1);

// Грот: под сводом — короткие сосульки (низ не ниже 2,1 м), длинные — только вплотную
// к колоннам; у подножия колонн светятся голубые кристаллы; у колонн вмёрзшие ящики.
for (let i = 0; i < 70; i++) {
  const x = -57.6 + hash(i) * 17.2,
    z = -27.6 + hash(i + 100) * 27;
  if (inPillar(x, z)) continue;
  const h = 0.12 + hash(i + 200) * 0.08;
  f.decoCyl(x, SHELF_UNDER - h, z, 0.01, h, ICE, 'ice', { rTop: 0.05 + hash(i + 300) * 0.05, sides: 6 });
}
// Кромки полки: восточная (x = -40) и северная (z = -28).
for (let z = -27.5; z < -0.3; z += 0.7) {
  const h = 0.12 + hash(z * 10) * 0.08;
  f.decoCyl(-40.15, SHELF_UNDER - h, z, 0.01, h, ICE, 'ice', { rTop: 0.07, sides: 6 });
}
for (let x = -57.5; x < -40.3; x += 0.7) {
  const h = 0.12 + hash(x * 10) * 0.08;
  f.decoCyl(x, SHELF_UNDER - h, -27.85, 0.01, h, ICE, 'ice', { rTop: 0.07, sides: 6 });
}
/**
 * Длинные сосульки и светящиеся кристаллы на гранях колонны ряда `c`. Разброс берётся от
 * |dz|: у колонн на оси z = 0 пары по обе стороны оси выходят одинаковыми.
 */
const dressPillar = (fu: Furnisher, x0: number, x1: number, c: number, dzs: number[]) => {
  for (const [x, sx] of [
    [x0 - 0.1, -1],
    [x1 + 0.1, 1],
  ])
    for (const dz of dzs) {
      const h = 0.6 + hash(x * 3 + c + Math.abs(dz)) * 0.5;
      fu.decoCyl(x, SHELF_UNDER - h, c + dz, 0.01, h, ICE, 'ice', { rTop: 0.1, sides: 6 });
      fu.decoCyl(x + sx * 0.05, 0, c + dz * 1.3, 0.12, 0.3 + hash(x + Math.abs(dz)) * 0.3, ICE_GLOW, undefined, { rTop: 0.01, glow: 1.6, sides: 5 });
    }
};
for (const c of [-24, -16, -8]) for (const [x0, x1] of PILLAR_X) dressPillar(f, x0, x1, c, [-0.5, 0.45]);
for (const [x0, x1] of PILLAR_X) dressPillar(fc, x0, x1, 0, [-0.5, 0.5]);
// Вмёрзшие ящики: вплотную к колоннам, с ледяной коркой сверху.
const frozenCrate = (fu: Furnisher, x: number, z: number) => {
  fu.crate(x, z, 0.8, { color: FROST_WOOD });
  fu.deco(x - 0.43, x + 0.43, 0.8, 0.88, z - 0.43, z + 0.43, ICE, 'ice');
};
frozenCrate(f, -45.7, -8);
f.deco(-45.9, -45.45, 0.88, 1.33, -8.25, -7.8, FROST_WOOD, 'crate');
frozenCrate(f, -54, -25.3);
frozenCrate(fc, -52.7, 0);
// Надувы снега на полке у подветренных сторон сераков.
for (const [x0, x1, z0, z1] of [
  [-56, -53, -19, -18.4],
  [-48, -45, -11, -10.4],
  [-44, -41.5, -21, -20.4],
  [-57, -54, -6, -5.4],
])
  f.deco(x0, x1, SHELF_TOP, SHELF_TOP + 0.3, z0, z1, SNOW_DRIFT, 'snow');
fc.deco(-49, -48.4, SHELF_TOP, SHELF_TOP + 0.3, -5, 5, SNOW_DRIFT, 'snow');

// --- восточный фланг: карьер -----------------------------------------------------------

const quarryNorth: MapBox[] = [
  block(45, 48, 2.2, 3.4, -18, -15, ROCK_DARK, 'rock'),
  block(50, 53, 2.2, 3.2, -18, -16, ROCK_DARK, 'rock'),
  block(55, 58, 4.4, 5.6, -10, -7, SLATE, 'rock'),
  block(54, 57, 4.4, 5.4, -13.6, -11.6, SLATE, 'rock'),
  // Рудный бункер у пандуса на второй уступ.
  block(48, 51, 2.2, 3.2, -8, -6, METAL, 'rust'),
  // Вагонетка с рудой в конце путей у подошвы уступа.
  block(40, 43, 0, 1.6, -23, -21, RUST, 'rust'),
];

const quarryCentre: MapBox[] = [
  block(44, 59, 0, 2.2, -20, 20, ROCK, 'rock'),
  block(53, 59, 0, 4.4, -14, 14, ROCK_DARK, 'rock'),
  block(45, 47, 2.2, 3.4, -3, 3, ROCK_DARK, 'rock'),
  block(54, 56, 4.4, 5.4, -2, 2, SLATE, 'rock'),
];

/** Узкоколейка вдоль z от `z0` до `z1` по оси `x` на высоте `base`: шпалы и два рельса. */
const railsZ = (x: number, z0: number, z1: number, base: number) => {
  for (let z = z0 + 0.3; z < z1 - 0.1; z += 0.8) f.deco(x - 0.5, x + 0.5, base, base + 0.06, z - 0.1, z + 0.1, WOOD_DARK, 'wood');
  for (const dx of [-0.3, 0.3]) f.deco(x + dx - 0.04, x + dx + 0.04, base + 0.06, base + 0.14, z0, z1, RAIL, 'metal');
};
railsZ(44.6, -19.9, 0, 2.2);
railsZ(58.5, -14, 0, 4.4);
// Тупик у вагонетки — вдоль x.
for (let x = 37.8; x < 43.9; x += 0.8) f.deco(x - 0.1, x + 0.1, 0, 0.06, -22.5, -21.5, WOOD_DARK, 'wood');
for (const z of [-22.3, -21.7]) f.deco(37.5, 43.9, 0.06, 0.14, z - 0.04, z + 0.04, RAIL, 'metal');
// Вагонетка: колёса на боковинах, обвязка, горка руды поверх.
for (const x of [40.6, 42.4])
  for (const z of [-23.03, -20.97]) f.decorCylinders.push({ x, y: 0.3, z, r: 0.3, h: 0.1, color: IRON, material: 'metal', axis: 'z', sides: 12 });
for (const x of [40.2, 41.5, 42.8]) {
  f.deco(x - 0.05, x + 0.05, 0.4, 1.6, -23.03, -23, RUST_DARK, 'rust');
  f.deco(x - 0.05, x + 0.05, 0.4, 1.6, -21, -20.97, RUST_DARK, 'rust');
}
f.spheres.push({ x: 41.5, y: 1.55, z: -22, r: 0.8, color: ROCK_DARK, material: 'rock' });
// Мачта прожектора: лестница-скобы, перекладина с двумя прожекторами, смотрящими в поле.
for (let y = 2.6; y < 7.8; y += 0.35) f.deco(51.22, 51.32, y, y + 0.03, -19.2, -18.8, IRON, 'metal');
f.deco(50.9, 51.1, 8.05, 8.15, -19.9, -18.1, METAL, 'metal');
for (const z of [-19.6, -18.4]) {
  f.deco(50.55, 51, 7.9, 8.35, z - 0.25, z + 0.25, IRON, 'metal');
  f.deco(50.53, 50.55, 7.95, 8.3, z - 0.2, z + 0.2, SEARCH, undefined, 2.5);
}
// Бочки на уступе и в лагере — ржавые, с обручами.
const quarryBarrels: MapCylinder[] = [rustBarrel(f, 46, -12, 2.2)];
// Деррик-кран на центральной плите второго уступа: А-образная стойка, подкос, стрела над
// карьером, трос с крюком (всё выше 5,4 м — на плиту не встать).
{
  const [x, top] = [55, 11];
  for (const s of [-1, 1]) strut(fc, [x, 5.4, 1.8 * s], [x, top, 0], 0.18, RUST, 'rust');
  strut(fc, [55.9, 5.4, 0], [x, top, 0], 0.16, RUST, 'rust');
  fc.deco(46.5, 56.5, top - 0.2, top, -0.12, 0.12, RUST, 'rust');
  for (let bx = 47; bx < 56; bx += 1) strut(fc, [bx, top - 0.2, 0], [bx + 0.5, top - 0.7, 0], 0.06, RUST_DARK, 'rust');
  fc.deco(46.5, 56.5, top - 0.76, top - 0.7, -0.08, 0.08, RUST_DARK, 'rust');
  fc.deco(55.4, 56.6, top - 0.5, top + 0.2, -0.4, 0.4, CONCRETE, 'concrete');
  fc.decoCyl(47.5, 6.6, 0, 0.012, top - 0.76 - 6.6, IRON, 'metal', { sides: 5 });
  fc.deco(47.4, 47.6, 6.3, 6.6, -0.05, 0.05, IRON, 'metal');
}

// --- поле между лагерями и центром -----------------------------------------------------

/** Стенка из мешков с песком: твёрдость даёт невидимая коробка, сами мешки — декор. */
function sandbags(x0: number, x1: number, z0: number, z1: number, h: number): MapBox {
  const rows = Math.round(h / 0.3),
    rowH = h / rows,
    n = Math.round((x1 - x0) / 0.8),
    len = (x1 - x0) / n;
  for (let r = 0; r < rows; r++) {
    const shift = r % 2 ? len / 2 : 0;
    for (let i = -1; i < n; i++) {
      const a = Math.max(x0, x0 + shift + i * len),
        b = Math.min(x1, x0 + shift + (i + 1) * len);
      if (b - a < 0.2) continue;
      for (const [p, q] of [
        [z0, (z0 + z1) / 2],
        [(z0 + z1) / 2, z1],
      ])
        f.deco(a + 0.02, b - 0.02, r * rowH, (r + 1) * rowH, p + 0.02, q - 0.02, SACK, 'sack');
    }
  }
  return { ...block(x0, x1, 0, h, z0, z1, SACK), invisible: true };
}

const fieldNorth: MapBox[] = [
  // Остов грузовика на центральном подходе: ржавый кузов и железная кабина.
  block(-4, 2, 0, 2.4, -30, -27, RUST, 'rust'),
  block(2, 5, 0, 2.8, -30, -27.5, METAL, 'metal'),
  // Мешки с песком и брёвна.
  sandbags(8, 14, -28, -27, 1.2),
  sandbags(18, 22, -25, -24, 1.3),
  block(-11, -7, 0, 0.9, -22, -21, LOG, 'bark'),
  block(24, 28, 0, 0.9, -31, -30, LOG, 'bark'),
  // Сухая кладка в два метра.
  block(-34, -28, 0, 2, -22, -21.4, ROCK_DARK, 'ashlar'),
  block(-24, -19, 0, 2, -22, -21.4, ROCK_DARK, 'ashlar'),
  block(28, 33, 0, 2, -22, -21.4, ROCK_DARK, 'ashlar'),
  // Валуны.
  block(-30, -27.5, 0, 1.5, -13, -11, ROCK, 'rock'),
  block(-27, -25, 0, 1.3, -30, -28, ROCK, 'rock'),
  block(26, 28.5, 0, 1.5, -13, -11, ROCK, 'rock'),
  block(30, 32, 0, 1.4, -8, -6, ROCK, 'rock'),
  block(-14, -12, 0, 1.3, -32, -30, ROCK, 'rock'),
  block(14, 16, 0, 1.4, -34, -32, ROCK, 'rock'),
  block(-38, -35, 0, 1.6, -26, -24, ROCK, 'rock'),
  block(35, 38, 0, 1.6, -30, -28, ROCK, 'rock'),
  block(-8, -6, 0, 1.2, -20, -19, ROCK, 'rock'),
  block(6, 8, 0, 1.2, -20, -19, ROCK, 'rock'),
  // Замёрзшее озеро и глыба на его берегу. Лёд — дно под водой: зимой вода сама замерзает
  // (waterFrozen), летом озеро оттаивает и лёд виден сквозь неё.
  paint(-26, -8, -34, -26, ICE_PALE, 0.12, 'ice'),
  block(-9, -7, 0, 1.1, -33, -31, ICE, 'ice'),
  // Снежные надувы.
  paint(-44, -36, -18, -13, SNOW_DRIFT, 0.3, 'snow'),
  paint(16, 24, -18, -14, SNOW_DRIFT, 0.3, 'snow'),
  paint(-20, -12, -29, -25, SNOW_DRIFT, 0.3, 'snow'),
  paint(44, 52, -32, -27, SNOW_DRIFT, 0.3, 'snow'),
  paint(-56, -48, -34, -30, SNOW_DRIFT, 0.3, 'snow'),
];

// Грузовик: сдвоенные задние колёса и переднее, рёбра кузова, тёмные стёкла, решётка,
// фары и бампер, пятна ржавчины на кабине, снег на крышах.
for (const [x, zs] of [
  [-3, [-30, -27]],
  [-1.6, [-30, -27]],
  [3.8, [-30, -27.5]],
] as const)
  for (const z of zs) {
    const out = z < -28.5 ? -1 : 1;
    f.decorCylinders.push(
      { x, y: 0.5, z, r: 0.5, h: 0.32, color: TIRE, axis: 'z', sides: 14 },
      { x, y: 0.5, z: z + out * 0.17, r: 0.22, h: 0.03, color: RUST_DARK, material: 'rust', axis: 'z', sides: 10 },
    );
  }
for (const x of [-3.6, -2.4, -1.2, 0, 1.2]) {
  f.deco(x - 0.06, x + 0.06, 0.15, 2.4, -30.05, -30, RUST_DARK, 'rust');
  f.deco(x - 0.06, x + 0.06, 0.15, 2.4, -27, -26.95, RUST_DARK, 'rust');
}
for (const [z0, z1] of [
  [-30.05, -30],
  [-27, -26.95],
])
  f.deco(-4, 2, 2.28, 2.4, z0, z1, RUST_DARK, 'rust');
f.deco(5, 5.03, 1.65, 2.55, -29.75, -27.75, GLASS_DARK, 'marble');
f.deco(2.3, 4.6, 1.65, 2.5, -30.03, -30, GLASS_DARK, 'marble');
f.deco(2.3, 4.6, 1.65, 2.5, -27.5, -27.47, GLASS_DARK, 'marble');
f.deco(5, 5.04, 0.6, 1.4, -29.4, -28.1, SOOT, 'metal');
for (const [z0, z1] of [
  [-29.75, -29.45],
  [-28.05, -27.75],
])
  f.deco(5, 5.05, 0.9, 1.1, z0, z1, METAL, 'metal');
f.deco(5, 5.15, 0.35, 0.6, -29.95, -27.55, IRON, 'metal');
f.deco(2.6, 3.4, 0.4, 1.2, -30.02, -30, RUST, 'rust');
f.deco(3.9, 4.7, 0.3, 0.9, -27.5, -27.48, RUST, 'rust');
f.deco(-3.9, 1.9, 2.4, 2.62, -29.9, -27.1, SNOW_DRIFT, 'snow');
f.deco(2.1, 4.9, 2.8, 2.98, -29.9, -27.6, SNOW_DRIFT, 'snow');
// Снег на брёвнах.
f.deco(-10.8, -7.2, 0.85, 1, -21.8, -21.2, SNOW_DRIFT, 'snow');
f.deco(24.2, 27.8, 0.85, 1, -30.8, -30.2, SNOW_DRIFT, 'snow');

// --- сосны -----------------------------------------------------------------------------

const FOREST_NORTH: [number, number][] = [
  [31, -33],
  [35, -31],
  [40, -33],
  [33, -27],
  [38, -25],
  [42, -28],
  [30.5, -21],
  [36, -20],
  [41, -18],
  [32, -14],
  [37, -11],
  [42, -7],
];

const FIELD_TREES_NORTH: [number, number][] = [
  [-36, -32],
  [-31, -25],
  [-28.5, -31],
  [-19, -24],
  [-28, -9],
  [-32, -17],
  [-25, -21],
  [-6, -32],
  [10, -25],
  [22, -26],
];

const FOREST_CENTRE: [number, number][] = [
  [36, 0],
  [41, 0],
];

// --- снег на уступах -------------------------------------------------------------------

/**
 * Снежная подушка ложится на верх каждой каменной, бетонной и ледяной коробки под открытым
 * небом: валуны, гряда, столбы ворот, стены руины, сераки. Не на огромные плиты (по плато
 * и уступам ходят) и не под сводом тоннеля или полки.
 */
const SNOWY: (SurfaceMaterial | undefined)[] = ['rock', 'ashlar', 'concrete', 'ice'];
const takesSnow = (b: MapBox) => {
  const top = b.y + b.h / 2;
  const underShelf = b.x > -58 && b.x < -40 && Math.abs(b.z) < 28 && top < SHELF_TOP;
  const inTunnel = Math.abs(b.x) < 22 && Math.abs(b.z) < 18 && top < PLATEAU_TOP;
  return !!b.solid && !b.invisible && SNOWY.includes(b.material) && b.h >= 0.8 && b.w * b.d < 70 && !underShelf && !inTunnel;
};
for (const b of [...campBoxes, ...plateauNorth, ...glacierNorth, ...quarryNorth, ...fieldNorth]) if (takesSnow(b)) snowTop(f, b);
for (const b of [...plateauCentre, ...glacierCentre, ...quarryCentre]) if (takesSnow(b)) snowTop(fc, b);
// Гребень периметра: северный отражается в южный, западный и восточный лежат на оси.
f.deco(-60, 60, 6, 6.3, -56, -55, SNOW_DRIFT, 'snow');
for (const [x0, x1] of [
  [-60, -59],
  [59, 60],
])
  fc.deco(x0, x1, 6, 6.3, -55, 55, SNOW_DRIFT, 'snow');
// Снег на скатных крышах дома и срубов (палатки остаются брезентовыми).
f.roofs.push(...f.roofs.filter((r) => r.material !== 'canvas').map(snowCap));

// --- сборка ----------------------------------------------------------------------------

const northBoxes: MapBox[] = [
  ...campBoxes,
  ...plateauNorth,
  ...glacierNorth,
  ...quarryNorth,
  ...fieldNorth,
  ...f.boxes,
];

const boxes: MapBox[] = [
  ...perimeterWalls(BOUNDS, 6, 1, CLIFF).map((b): MapBox => ({ ...b, material: 'rock' })),
  ...plateauCentre,
  ...glacierCentre,
  ...quarryCentre,
  ...fc.boxes,
  ...northBoxes,
  ...mirrorBoxes(northBoxes),
];

const northRamps: MapRamp[] = [
  // Два пандуса на плато с севера — каменные лестницы (идут по-прежнему по ровному склону).
  { minX: -14, maxX: -8, minZ: -25, maxZ: -18, axis: 'z', from: -25, to: -18, y0: 0, y1: PLATEAU_TOP, color: RAMP_STONE, material: 'ashlar', steps: 17 },
  { minX: 8, maxX: 14, minZ: -25, maxZ: -18, axis: 'z', from: -25, to: -18, y0: 0, y1: PLATEAU_TOP, color: RAMP_STONE, material: 'ashlar', steps: 17 },
  // Подъёмы на ледяную полку: с севера и с востока.
  { minX: -52, maxX: -46, minZ: -35, maxZ: -28, axis: 'z', from: -35, to: -28, y0: 0, y1: SHELF_TOP, color: ICE_PALE, material: 'ice' },
  { minX: -40, maxX: -33, minZ: -12, maxZ: -6, axis: 'x', from: -33, to: -40, y0: 0, y1: SHELF_TOP, color: ICE_PALE, material: 'ice' },
  // Уступы карьера: с поля на первый, с первого на второй.
  { minX: 44, maxX: 50, minZ: -27, maxZ: -20, axis: 'z', from: -27, to: -20, y0: 0, y1: 2.2, color: RAMP_STONE, material: 'rock' },
  { minX: 47, maxX: 53, minZ: -11, maxZ: -5, axis: 'x', from: 47, to: 53, y0: 2.2, y1: 4.4, color: RAMP_STONE, material: 'rock' },
  // Дощатая лестница на вышку лагеря.
  { minX: -18, maxX: -14, minZ: -50, maxZ: -44, axis: 'z', from: -50, to: -44, y0: 0, y1: 3, color: WOOD_DARK, material: 'planks', steps: 15 },
];

const ramps: MapRamp[] = [...northRamps, ...mirrorRamps(northRamps)];

const northCylinders: MapCylinder[] = [
  ...FOREST_NORTH.flatMap(pine),
  ...FIELD_TREES_NORTH.flatMap(pine),
  // Опоры вышки — ошкуренные брёвна.
  { x: -18, y: 1.5, z: -43, r: 0.25, h: 3, color: WOOD_DARK, solid: true, sides: 8, material: 'bark' },
  { x: -14, y: 1.5, z: -43, r: 0.25, h: 3, color: WOOD_DARK, solid: true, sides: 8, material: 'bark' },
  { x: -18, y: 1.5, z: -39, r: 0.25, h: 3, color: WOOD_DARK, solid: true, sides: 8, material: 'bark' },
  { x: -14, y: 1.5, z: -39, r: 0.25, h: 3, color: WOOD_DARK, solid: true, sides: 8, material: 'bark' },
  // Бочки в лагере и на уступе карьера.
  rustBarrel(f, -17, -41),
  rustBarrel(f, 17, -41),
  ...quarryBarrels,
  // Мачта прожектора карьера.
  { x: 51, y: 5.2, z: -19, r: 0.22, h: 6, color: METAL, solid: true, sides: 8, material: 'metal' },
  // Чурбаки-табуреты из набора мебели.
  ...f.cylinders,
];

const cylinders: MapCylinder[] = [
  ...FOREST_CENTRE.flatMap(pine),
  ...fc.cylinders,
  ...northCylinders,
  ...mirrorCylinders(northCylinders),
];

const northSpheres: MapSphere[] = [
  // Снежные шапки на валунах и ледяные натёки.
  { x: -30, y: 1.6, z: -12, r: 1, color: SNOW_DRIFT, material: 'snow' },
  { x: 27, y: 1.6, z: -12, r: 1, color: SNOW_DRIFT, material: 'snow' },
  { x: -38, y: 1.7, z: -25, r: 0.9, color: SNOW_DRIFT, material: 'snow' },
  { x: 36, y: 1.7, z: -29, r: 0.9, color: SNOW_DRIFT, material: 'snow' },
  { x: -14, y: 1.4, z: -31, r: 0.8, color: SNOW_DRIFT, material: 'snow' },
  { x: 40, y: 1.7, z: -22, r: 0.85, color: SNOW_DRIFT, material: 'snow' },
  { x: -51, y: 1.5, z: -25, r: 0.75, color: ICE, material: 'ice' },
  { x: -50, y: 1.4, z: -11, r: 0.7, color: ICE, material: 'ice' },
  { x: -43, y: 0.6, z: -30, r: 0.8, color: ICE, material: 'ice' },
  ...f.spheres,
];

const spheres: MapSphere[] = [...fc.spheres, ...northSpheres, ...mirrorSpheres(northSpheres)];

const northWater: MapWater[] = [{ minX: -26, maxX: -8, minZ: -34, maxZ: -26, y: 0.14, color: '#8fc4dc' }];
const water: MapWater[] = [...northWater, ...mirrorWater(northWater)];

const northLights: MapLight[] = [
  { x: 0, y: 1.6, z: -43, color: '#ffa95e', intensity: 10, distance: 18 },
  // Дом: середина и оба конца, у печи и у шкафчиков.
  { x: 0, y: 3, z: -50, color: '#ffd9a0', intensity: 5, distance: 15 },
  { x: -10, y: 2.6, z: -50, color: '#ffb070', intensity: 3, distance: 9 },
  { x: 10, y: 2.6, z: -50, color: '#ffd9a0', intensity: 3, distance: 9 },
  // Срубы: фонарь на столе светит и в окна.
  { x: -24, y: 2.4, z: -42.4, color: '#ffd9a0', intensity: 4, distance: 10 },
  { x: 24, y: 2.4, z: -42.4, color: '#ffd9a0', intensity: 4, distance: 10 },
  // Вышка: фонарь и прожектор.
  { x: -16, y: 4.6, z: -41, color: '#ffe2b0', intensity: 3, distance: 12 },
  { x: -54, y: 1.7, z: -20, color: '#5fa6dc', intensity: 4, distance: 14 },
  { x: -47, y: 1.7, z: -8, color: '#5fa6dc', intensity: 4, distance: 14 },
  { x: 0, y: 2.4, z: -10, color: '#7fa8c8', intensity: 3.5, distance: 12 },
  { x: 51, y: 7.5, z: -19, color: '#ffeccb', intensity: 7, distance: 22 },
  ...f.lights,
];

const lights: MapLight[] = [
  ...northLights,
  ...mirrorLights(northLights),
  { x: -50, y: 1.7, z: 0, color: '#5fa6dc', intensity: 4, distance: 14 },
  { x: -12, y: 2.4, z: 0, color: '#7fa8c8', intensity: 3.5, distance: 12 },
  { x: 12, y: 2.4, z: 0, color: '#7fa8c8', intensity: 3.5, distance: 12 },
  { x: 0, y: 5.4, z: 0, color: '#c9dcf2', intensity: 4, distance: 16 },
];

export const VALLEY: ArenaDef = {
  id: 'valley',
  title: 'Ледниковая долина',
  bounds: BOUNDS,
  groundColor: SNOW,
  groundMaterial: 'snow',
  season: 'winter',
  outsideColor: '#c4d2de',
  boxes,
  ramps,
  cylinders,
  spheres,
  roofs: [...f.roofs, ...mirrorRoofs(f.roofs)],
  water,
  furnishings: [...fc.decor, ...f.decor, ...mirrorBoxes(f.decor)],
  furnishingCylinders: [...fc.decorCylinders, ...f.decorCylinders, ...mirrorCylinders(f.decorCylinders)],
  lights,
  spawns: { red: campSpawns(-1), blue: campSpawns(1) },
};
