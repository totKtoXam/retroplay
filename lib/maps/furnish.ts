// Мебель и постройки для декларативных карт: срубы, палатки, нары, печки, ящики, фонари.
// Всё собирается в списки обычного ArenaDef, поэтому столкновения, миникарта, шаги и укрытие
// от погоды видят их без отдельной поддержки.
//
// Правило, как в «Особняке»: крупные части (столешница, сиденье, короб шкафа, ящик, печь)
// твёрдые и лежат в `boxes`, мелкие (ножки, спинки, подушки, рамы, трубы) — декор без
// столкновений в `decor`. Твёрдое не выше 0,55 м можно перешагнуть. Покрытия пола и ковры
// тоже лежат в `boxes` (нетвёрдыми): по ним шаги узнают, что под ногами (lib/footsteps.ts).
//
// Стороны света как в особняке: 'n' — к −z, 's' — к +z, 'w' — к −x, 'e' — к +x.
import type { MapBox, MapCylinder, MapLight, MapRoof, MapSphere, SurfaceMaterial } from './types.ts';

export type Side = 'n' | 's' | 'e' | 'w';

/** Проём в стене: отрезок [a, b] вдоль стены и список открытых диапазонов высоты. */
export type Opening = { a: number; b: number; open: [number, number][] };

/**
 * Твёрдые куски прямой стены, прорезанной дверями и окнами.
 * `axis: 'z'` — стена вдоль z при x = `at`; `axis: 'x'` — вдоль x при z = `at`.
 */
export function wallSegments(
  axis: 'x' | 'z',
  at: number,
  p0: number,
  p1: number,
  bottom: number,
  top: number,
  color: string,
  thickness = 0.4,
  gaps: Opening[] = [],
): MapBox[] {
  const out: MapBox[] = [];
  const piece = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 1e-6 || y1 - y0 < 1e-6) return;
    out.push(
      axis === 'z'
        ? { x: at, y: (y0 + y1) / 2, z: (a + b) / 2, w: thickness, h: y1 - y0, d: b - a, color, solid: true }
        : { x: (a + b) / 2, y: (y0 + y1) / 2, z: at, w: b - a, h: y1 - y0, d: thickness, color, solid: true },
    );
  };
  let cursor = p0;
  for (const g of [...gaps].sort((m, n) => m.a - n.a)) {
    piece(cursor, g.a, bottom, top);
    let y = bottom;
    for (const [y0, y1] of g.open) {
      piece(g.a, g.b, y, y0);
      y = y1;
    }
    piece(g.a, g.b, y, top);
    cursor = g.b;
  }
  piece(cursor, p1, bottom, top);
  return out;
}

/** Коробка по границам. */
export const extents = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: string,
  material?: SurfaceMaterial,
): MapBox => ({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, w: x1 - x0, h: y1 - y0, d: z1 - z0, color, material });

/** `hex`, смешанный с белым на `k` (0…1): подушка на тон светлее дивана. */
export const lighten = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) + (255 - ((n >> shift) & 255)) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};

/** `hex`, затемнённый на `k` (0…1). */
export const darken = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - k));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};

export const WOOD = '#7a5634';
export const DARK_WOOD = '#5a3d26';
export const IRON = '#3d3b3a';
/** Небелёный лён: светлее не брать — на зимних картах почти белое тает летом как снег. */
export const LINEN = '#d6ccb4';
export const GLASS = '#a9cbd9';
export const FLAME = '#ffc46e';

/**
 * Сборщик обстановки. Складывает детали в списки, которые карта вливает в свой ArenaDef:
 * `boxes` → `boxes`, `cylinders` → `cylinders`, `decor` → `furnishings`, `decorCylinders` →
 * `furnishingCylinders`, `spheres`, `roofs`, `lights` — в одноимённые поля.
 */
export function createFurnisher() {
  const boxes: MapBox[] = [];
  const cylinders: MapCylinder[] = [];
  const decor: MapBox[] = [];
  const decorCylinders: MapCylinder[] = [];
  const spheres: MapSphere[] = [];
  const roofs: MapRoof[] = [];
  const lights: MapLight[] = [];

  /** Твёрдая коробка (в `boxes`). */
  const solid = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, material?: SurfaceMaterial) => {
    const b: MapBox = { ...extents(x0, x1, y0, y1, z0, z1, color, material), solid: true };
    boxes.push(b);
    return b;
  };
  /** Декор без столкновений (в `decor`). */
  const deco = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, material?: SurfaceMaterial, glow?: number) => {
    const b: MapBox = { ...extents(x0, x1, y0, y1, z0, z1, color, material), ...(glow ? { glow } : {}) };
    decor.push(b);
    return b;
  };
  /** Декоративный цилиндр, заданный низом `y0` (стоит на полу, на столе). */
  const decoCyl = (x: number, y0: number, z: number, r: number, h: number, color: string, material?: SurfaceMaterial, extra: Partial<MapCylinder> = {}) => {
    const c: MapCylinder = { x, y: y0 + h / 2, z, r, h, color, material, ...extra };
    decorCylinders.push(c);
    return c;
  };
  /** Покрытие пола или ковёр толщиной `h` на поверхности высотой `base` (нетвёрдое, в `boxes`). */
  const cover = (x0: number, x1: number, z0: number, z1: number, base: number, color: string, material: SurfaceMaterial, h = 0.02) => {
    const b = extents(x0, x1, base, base + h, z0, z1, color, material);
    boxes.push(b);
    return b;
  };

  /** Четыре ножки внутри прямоугольника. */
  const legs = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, color: string, t = 0.07) => {
    for (const [x, z] of [
      [x0, z0],
      [x1 - t, z0],
      [x0, z1 - t],
      [x1 - t, z1 - t],
    ])
      deco(x, x + t, y0, y1, z, z + t, color, 'wood');
  };

  type Opts = { base?: number; color?: string };

  const f = {
    boxes,
    cylinders,
    decor,
    decorCylinders,
    spheres,
    roofs,
    lights,
    solid,
    deco,
    decoCyl,
    cover,
    legs,

    /** Стол: твёрдая столешница на декоративных ножках. */
    table(x0: number, x1: number, z0: number, z1: number, { base = 0, color = WOOD, height = 0.76 }: Opts & { height?: number } = {}) {
      solid(x0, x1, base + height - 0.06, base + height, z0, z1, color, 'wood');
      legs(x0 + 0.05, x1 - 0.05, z0 + 0.05, z1 - 0.05, base, base + height - 0.06, color);
    },

    /** Скамья: твёрдое сиденье на ножках (на неё можно встать). */
    bench(x0: number, x1: number, z0: number, z1: number, { base = 0, color = WOOD, height = 0.45 }: Opts & { height?: number } = {}) {
      solid(x0, x1, base + height - 0.06, base + height, z0, z1, color, 'wood');
      legs(x0 + 0.04, x1 - 0.04, z0 + 0.04, z1 - 0.04, base, base + height - 0.06, color, 0.06);
    },

    /** Табурет-чурбак: короткий кусок бревна. */
    stump(x: number, z: number, { base = 0, color = '#6e4d31' }: Opts = {}) {
      cylinders.push({ x, y: base + 0.22, z, r: 0.22, h: 0.44, color, material: 'bark', solid: true, sides: 10 });
      decoCyl(x, base + 0.44, z, 0.2, 0.01, '#c29a6b', 'wood', { sides: 10 });
    },

    /** Деревянный ящик (твёрдый). */
    crate(x: number, z: number, size = 1, { base = 0, color = '#a3763f', h = size }: Opts & { h?: number } = {}) {
      return solid(x - size / 2, x + size / 2, base, base + h, z - size / 2, z + size / 2, color, 'crate');
    },

    /** Мешок (твёрдый, если высокий; иначе на него просто наступают). */
    sack(x: number, z: number, { base = 0, color = '#c9b58a', w = 0.62, d = 0.45, h = 0.5 }: Opts & { w?: number; d?: number; h?: number } = {}) {
      return solid(x - w / 2, x + w / 2, base, base + h, z - d / 2, z + d / 2, color, 'sack');
    },

    /** Бочка: твёрдый цилиндр с двумя обручами. */
    barrel(x: number, z: number, { base = 0, color = '#7a5634', r = 0.42, h = 1, material = 'wood' as SurfaceMaterial } = {}) {
      cylinders.push({ x, y: base + h / 2, z, r, h, color, material, solid: true, sides: 14 });
      for (const k of [0.18, 0.82]) decoCyl(x, base + h * k - 0.03, z, r + 0.015, 0.06, IRON, 'metal', { sides: 14 });
    },

    /** Глиняный кувшин или горшок: пузатый низ, узкое горло. */
    jar(x: number, z: number, { base = 0, color = '#b0603f', r = 0.3, h = 0.7, solid: isSolid = false }: Opts & { r?: number; h?: number; solid?: boolean } = {}) {
      const body: MapCylinder = { x, y: base + h * 0.35, z, r: r * 0.75, rTop: r, h: h * 0.7, color, material: 'adobe', sides: 12, ...(isSolid ? { solid: true } : {}) };
      (isSolid ? cylinders : decorCylinders).push(body);
      decoCyl(x, base + h * 0.7, z, r, h * 0.18, color, 'adobe', { rTop: r * 0.45, sides: 12 });
      decoCyl(x, base + h * 0.88, z, r * 0.4, h * 0.12, color, 'adobe', { rTop: r * 0.48, sides: 12 });
    },

    /**
     * Стеллаж у стены: твёрдый короб, на передней стороне `front` — полки с товаром
     * (цвета `goods` по кругу: банки, свёртки, коробки).
     */
    shelf(
      x0: number,
      x1: number,
      z0: number,
      z1: number,
      height: number,
      front: Side,
      { base = 0, color = WOOD, goods = ['#b0603f', '#d9c28a', '#6f8f4a', '#8a4a36'] }: Opts & { goods?: string[] } = {},
    ) {
      solid(x0, x1, base, base + height, z0, z1, darken(color, 0.25), 'wood');
      const along = front === 'n' || front === 's';
      const lo = along ? x0 : z0,
        hi = along ? x1 : z1;
      const face = front === 'n' ? z0 : front === 's' ? z1 : front === 'w' ? x0 : x1;
      const out = front === 'n' || front === 'w' ? -1 : 1;
      const slab = (a: number, b: number, y0: number, y1: number, d0: number, d1: number, c: string, m?: SurfaceMaterial) => {
        const p = Math.min(face + out * d0, face + out * d1),
          q = Math.max(face + out * d0, face + out * d1);
        if (along) deco(a, b, y0, y1, p, q, c, m);
        else deco(p, q, y0, y1, a, b, c, m);
      };
      const levels = Math.max(2, Math.round(height / 0.45));
      let g = 0;
      for (let i = 0; i < levels; i++) {
        const y = base + 0.08 + (i * (height - 0.2)) / (levels - 1);
        slab(lo, hi, y - 0.03, y, 0, 0.04, color, 'wood');
        if (i === levels - 1) break;
        for (let a = lo + 0.08; a < hi - 0.2; a += 0.28) {
          const c = goods[g++ % goods.length];
          const hgt = 0.14 + ((g * 37) % 5) * 0.03;
          slab(a, a + 0.2, y, y + hgt, 0.005, 0.03, c, g % 3 === 0 ? 'sack' : g % 3 === 1 ? 'adobe' : 'crate');
        }
      }
      // Боковины.
      slab(lo, lo + 0.05, base, base + height, 0, 0.05, color, 'wood');
      slab(hi - 0.05, hi, base, base + height, 0, 0.05, color, 'wood');
    },

    /**
     * Двухъярусные нары головой к `head`: нижняя лежанка твёрдая, верхняя — декор над ней
     * (под ней остаётся место сесть), стойки по углам.
     */
    bunk(x0: number, x1: number, z0: number, z1: number, head: Side, { base = 0, blanket = '#7c3b35', frame = DARK_WOOD, upper = true }: { base?: number; blanket?: string; frame?: string; upper?: boolean } = {}) {
      solid(x0, x1, base, base + 0.42, z0, z1, frame, 'wood');
      const bedding = (y: number) => {
        deco(x0 + 0.05, x1 - 0.05, y, y + 0.12, z0 + 0.05, z1 - 0.05, LINEN, 'fabric');
        const pillow = 0.5;
        if (head === 'w') {
          deco(x0 + 0.1, x0 + pillow, y + 0.12, y + 0.24, z0 + 0.12, z1 - 0.12, LINEN, 'fabric');
          deco(x0 + pillow + 0.1, x1 - 0.03, y + 0.12, y + 0.18, z0 + 0.03, z1 - 0.03, blanket, 'felt');
        } else if (head === 'e') {
          deco(x1 - pillow, x1 - 0.1, y + 0.12, y + 0.24, z0 + 0.12, z1 - 0.12, LINEN, 'fabric');
          deco(x0 + 0.03, x1 - pillow - 0.1, y + 0.12, y + 0.18, z0 + 0.03, z1 - 0.03, blanket, 'felt');
        } else if (head === 'n') {
          deco(x0 + 0.12, x1 - 0.12, y + 0.12, y + 0.24, z0 + 0.1, z0 + pillow, LINEN, 'fabric');
          deco(x0 + 0.03, x1 - 0.03, y + 0.12, y + 0.18, z0 + pillow + 0.1, z1 - 0.03, blanket, 'felt');
        } else {
          deco(x0 + 0.12, x1 - 0.12, y + 0.12, y + 0.24, z1 - pillow, z1 - 0.1, LINEN, 'fabric');
          deco(x0 + 0.03, x1 - 0.03, y + 0.12, y + 0.18, z0 + 0.03, z1 - pillow - 0.1, blanket, 'felt');
        }
      };
      bedding(base + 0.42);
      if (!upper) return;
      const y = base + 1.35;
      deco(x0, x1, y - 0.12, y, z0, z1, frame, 'wood');
      bedding(y);
      for (const [x, z] of [
        [x0, z0],
        [x1 - 0.08, z0],
        [x0, z1 - 0.08],
        [x1 - 0.08, z1 - 0.08],
      ])
        deco(x, x + 0.08, base, y + 0.45, z, z + 0.08, frame, 'wood');
    },

    /**
     * Железная печь-буржуйка: твёрдый корпус, светящаяся топка на стороне `front`, труба
     * до `pipeTop` (потолок или над крышей).
     */
    stove(x: number, z: number, front: Side, pipeTop: number, { base = 0, color = '#2f2d2c' }: Opts = {}) {
      const w = 0.7,
        d = 0.6,
        h = 0.72;
      const across = front === 'n' || front === 's';
      const hw = (across ? w : d) / 2,
        hd = (across ? d : w) / 2;
      solid(x - hw, x + hw, base + 0.12, base + h, z - hd, z + hd, color, 'rust');
      legs(x - hw + 0.03, x + hw - 0.03, z - hd + 0.03, z + hd - 0.03, base, base + 0.12, color, 0.06);
      const fy0 = base + 0.26,
        fy1 = base + 0.5;
      if (front === 'n') deco(x - 0.18, x + 0.18, fy0, fy1, z - hd - 0.01, z - hd, FLAME, undefined, 2.2);
      if (front === 's') deco(x - 0.18, x + 0.18, fy0, fy1, z + hd, z + hd + 0.01, FLAME, undefined, 2.2);
      if (front === 'w') deco(x - hw - 0.01, x - hw, fy0, fy1, z - 0.18, z + 0.18, FLAME, undefined, 2.2);
      if (front === 'e') deco(x + hw, x + hw + 0.01, fy0, fy1, z - 0.18, z + 0.18, FLAME, undefined, 2.2);
      decoCyl(x, base + h, z, 0.08, pipeTop - base - h, color, 'metal', { sides: 10 });
      decoCyl(x, base + h, z, 0.16, 0.04, color, 'metal', { sides: 10 });
    },

    /** Фонарь: рамка, светящееся стекло, колпак; при `hang` висит на цепи от этой высоты. */
    lantern(x: number, y: number, z: number, { hang, color = FLAME, frame = IRON }: { hang?: number; color?: string; frame?: string } = {}) {
      deco(x - 0.1, x + 0.1, y - 0.02, y, z - 0.1, z + 0.1, frame, 'metal');
      deco(x - 0.08, x + 0.08, y, y + 0.22, z - 0.08, z + 0.08, color, undefined, 1.8);
      decoCyl(x, y + 0.22, z, 0.13, 0.1, frame, 'metal', { rTop: 0.03, sides: 8 });
      if (hang !== undefined && hang > y + 0.32) decoCyl(x, y + 0.32, z, 0.012, hang - y - 0.32, frame, 'metal', { sides: 6 });
    },

    /** Ковёр на полу (в `boxes`, чтобы шаги по нему были мягкими). */
    rug(x0: number, x1: number, z0: number, z1: number, color: string, base = 0) {
      return cover(x0, x1, z0, z1, base, color, 'carpet', 0.02);
    },

    /** Ковёр на стене, висящий по плоскости `side` стены с гранью `at`. */
    wallRug(side: Side, at: number, a: number, b: number, y0: number, y1: number, color: string) {
      const t = 0.03,
        s = side === 'n' || side === 'w' ? 1 : -1;
      if (side === 'n' || side === 's') deco(a, b, y0, y1, Math.min(at, at + s * t), Math.max(at, at + s * t), color, 'carpet');
      else deco(Math.min(at, at + s * t), Math.max(at, at + s * t), y0, y1, a, b, color, 'carpet');
    },

    /**
     * Поленница: ряды поленьев вдоль `along`, сверху донизу; твёрдость даёт невидимая коробка
     * по её габаритам.
     */
    woodpile(x0: number, x1: number, z0: number, z1: number, height: number, { base = 0, along = 'x' as 'x' | 'z', color = '#7a5634' } = {}) {
      boxes.push({ ...extents(x0, x1, base, base + height, z0, z1, color), solid: true, invisible: true });
      const r = 0.09;
      const across = along === 'x' ? [z0, z1] : [x0, x1];
      for (let row = 0; base + r * 2 * (row + 1) <= base + height + 1e-6; row++) {
        const y = base + r + row * r * 1.8;
        for (let c = across[0] + r + (row % 2) * r; c <= across[1] - r + 1e-6; c += r * 2.05) {
          if (along === 'x') decorCylinders.push({ x: (x0 + x1) / 2, y, z: c, r, h: x1 - x0, color, material: 'bark', axis: 'x', sides: 7 });
          else decorCylinders.push({ x: c, y, z: (z0 + z1) / 2, r, h: z1 - z0, color, material: 'bark', axis: 'z', sides: 7 });
        }
      }
    },

    /**
     * Окно в проёме [a, b] × [y0, y1] стены вдоль `axis` при `at`: рама, переплёт и стекло.
     * `t` — толщина стены.
     */
    window(axis: 'x' | 'z', at: number, a: number, b: number, y0: number, y1: number, { t = 0.3, frame = DARK_WOOD, glass = GLASS } = {}) {
      const bar = 0.06,
        mid = (a + b) / 2,
        ym = (y0 + y1) / 2;
      const put = (p0: number, p1: number, q0: number, q1: number, c: string, m: SurfaceMaterial, depth: number) => {
        if (axis === 'x') deco(p0, p1, q0, q1, at - depth / 2, at + depth / 2, c, m);
        else deco(at - depth / 2, at + depth / 2, q0, q1, p0, p1, c, m);
      };
      put(a, b, y0 + 0.01, y1 - 0.01, glass, 'marble', 0.02);
      put(a, b, y0, y0 + bar, frame, 'wood', t + 0.04);
      put(a, b, y1 - bar, y1, frame, 'wood', t + 0.04);
      put(a, a + bar, y0, y1, frame, 'wood', t + 0.04);
      put(b - bar, b, y0, y1, frame, 'wood', t + 0.04);
      put(mid - bar / 2, mid + bar / 2, y0, y1, frame, 'wood', 0.08);
      put(a, b, ym - bar / 2, ym + bar / 2, frame, 'wood', 0.08);
    },

    /**
     * Дверь в проёме [a, b] высотой `h` стены вдоль `axis` при `at`: наличники и перемычка,
     * полотно распахнуто и прижато к стене по сторону `leaf` (+1 или −1 по нормали стены).
     */
    door(axis: 'x' | 'z', at: number, a: number, b: number, h: number, { base = 0, t = 0.3, frame = DARK_WOOD, color = WOOD, leaf = 1 as 1 | -1 } = {}) {
      const jamb = 0.08;
      const put = (p0: number, p1: number, q0: number, q1: number, d0: number, d1: number, c: string) => {
        if (axis === 'x') deco(p0, p1, q0, q1, at + d0, at + d1, c, 'wood');
        else deco(at + d0, at + d1, q0, q1, p0, p1, c, 'wood');
      };
      const half = t / 2 + 0.03;
      put(a - jamb, a, base, base + h + jamb, -half, half, frame);
      put(b, b + jamb, base, base + h + jamb, -half, half, frame);
      put(a - jamb, b + jamb, base + h, base + h + jamb, -half, half, frame);
      // Распахнутое полотно: вдоль стены от петли у `a`, в стороне `leaf`.
      const w = b - a;
      const off = leaf * (t / 2 + 0.03);
      put(a - w - 0.02, a - 0.02, base + 0.02, base + h - 0.02, Math.min(off, off + leaf * 0.05), Math.max(off, off + leaf * 0.05), color);
    },

    /**
     * Двускатная палатка: невидимая твёрдая коробка по габаритам и брезентовая «крыша»,
     * стоящая прямо на земле; конёк вдоль длинной стороны.
     */
    tent(x0: number, x1: number, z0: number, z1: number, height: number, color: string, { base = 0 } = {}) {
      boxes.push({ ...extents(x0, x1, base, base + height, z0, z1, color), solid: true, invisible: true });
      roofs.push({
        minX: x0,
        maxX: x1,
        minZ: z0,
        maxZ: z1,
        y: base,
        rise: height,
        ridge: x1 - x0 >= z1 - z0 ? 'x' : 'z',
        color,
        material: 'canvas',
        gable: darken(color, 0.12),
        gableMaterial: 'canvas',
        overhang: 0.06,
      });
      // Колышки по углам.
      for (const [x, z] of [
        [x0 - 0.15, z0 - 0.15],
        [x1 + 0.15, z0 - 0.15],
        [x0 - 0.15, z1 + 0.15],
        [x1 + 0.15, z1 + 0.15],
      ])
        decoCyl(x, base, z, 0.03, 0.25, DARK_WOOD, 'wood', { sides: 6 });
    },

    /**
     * Сруб: стены из брёвен с дверью и окнами, плоское перекрытие (твёрдое — на нём стоит
     * крыша и от него не течёт дождь), двускатная крыша сверху, пол и дощатый потолок внутри,
     * выпуски брёвен на углах. `doors` и `windows` — проёмы по сторонам: `at` — центр проёма
     * вдоль стены.
     */
    logCabin({
      minX,
      maxX,
      minZ,
      maxZ,
      height = 3,
      base = 0,
      wall = '#7c5838',
      roof = '#46505e',
      roofMaterial = 'planks' as SurfaceMaterial,
      rise = 1.3,
      ridge,
      t = 0.3,
      doors = [] as { side: Side; at: number; w?: number; h?: number; leaf?: 1 | -1 }[],
      windows = [] as { side: Side; at: number; w?: number; y0?: number; y1?: number }[],
      floor = '#8a6a4a',
    }: {
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
      height?: number;
      base?: number;
      wall?: string;
      roof?: string;
      roofMaterial?: SurfaceMaterial;
      rise?: number;
      ridge?: 'x' | 'z';
      t?: number;
      doors?: { side: Side; at: number; w?: number; h?: number; leaf?: 1 | -1 }[];
      windows?: { side: Side; at: number; w?: number; y0?: number; y1?: number }[];
      floor?: string;
    }) {
      const top = base + height;
      const gaps = (side: Side): Opening[] => [
        ...doors.filter((d) => d.side === side).map((d) => ({ a: d.at - (d.w ?? 1.2) / 2, b: d.at + (d.w ?? 1.2) / 2, open: [[base, base + (d.h ?? 2.2)]] as [number, number][] })),
        ...windows.filter((w) => w.side === side).map((w) => ({ a: w.at - (w.w ?? 1) / 2, b: w.at + (w.w ?? 1) / 2, open: [[base + (w.y0 ?? 1), base + (w.y1 ?? 1.9)]] as [number, number][] })),
      ];
      const walls = [
        ...wallSegments('x', minZ + t / 2, minX, maxX, base, top, wall, t, gaps('n')),
        ...wallSegments('x', maxZ - t / 2, minX, maxX, base, top, wall, t, gaps('s')),
        ...wallSegments('z', minX + t / 2, minZ + t, maxZ - t, base, top, wall, t, gaps('w')),
        ...wallSegments('z', maxX - t / 2, minZ + t, maxZ - t, base, top, wall, t, gaps('e')),
      ];
      boxes.push(...walls.map((b): MapBox => ({ ...b, material: 'logs' })));
      // Перекрытие: твёрдая плита по стенам.
      boxes.push({ ...extents(minX, maxX, top, top + 0.25, minZ, maxZ, wall, 'logs'), solid: true });
      roofs.push({
        minX: minX - 0.05,
        maxX: maxX + 0.05,
        minZ: minZ - 0.05,
        maxZ: maxZ + 0.05,
        y: top + 0.25,
        rise,
        ridge: ridge ?? (maxX - minX >= maxZ - minZ ? 'x' : 'z'),
        color: roof,
        material: roofMaterial,
        gable: wall,
        gableMaterial: 'logs',
        overhang: 0.45,
      });
      // Пол и потолок внутри.
      cover(minX + t, maxX - t, minZ + t, maxZ - t, base, floor, 'planks', 0.03);
      deco(minX + t, maxX - t, top - 0.03, top - 0.01, minZ + t, maxZ - t, lighten(floor, 0.15), 'planks');
      // Выпуски брёвен на углах: через венец то вдоль x, то вдоль z.
      const course = 0.27,
        tail = 0.28;
      for (let i = 0; base + (i + 1) * course <= top + 1e-6; i++) {
        const y0 = base + i * course,
          y1 = y0 + course;
        for (const [x, z] of [
          [minX, minZ],
          [maxX, minZ],
          [minX, maxZ],
          [maxX, maxZ],
        ]) {
          const sx = x === minX ? -1 : 1,
            sz = z === minZ ? -1 : 1;
          if (i % 2 === 0) {
            const xa = x + sx * tail,
              zc = z - sz * (t / 2);
            deco(Math.min(x, xa), Math.max(x, xa), y0, y1, zc - course / 2, zc + course / 2, wall, 'bark');
          } else {
            const za = z + sz * tail,
              xc = x - sx * (t / 2);
            deco(xc - course / 2, xc + course / 2, y0, y1, Math.min(z, za), Math.max(z, za), wall, 'bark');
          }
        }
      }
      // Двери и окна: наличники, распахнутые полотна, рамы со стёклами.
      for (const d of doors) {
        const w = d.w ?? 1.2,
          h = d.h ?? 2.2;
        const [axis, at] = d.side === 'n' ? (['x', minZ + t / 2] as const) : d.side === 's' ? (['x', maxZ - t / 2] as const) : d.side === 'w' ? (['z', minX + t / 2] as const) : (['z', maxX - t / 2] as const);
        // Полотно распахнуто внутрь, если не сказано иначе.
        const inward = d.side === 'n' || d.side === 'w' ? 1 : -1;
        f.door(axis, at, d.at - w / 2, d.at + w / 2, h, { base, t, leaf: d.leaf ?? inward });
      }
      for (const w of windows) {
        const width = w.w ?? 1;
        const [axis, at] = w.side === 'n' ? (['x', minZ + t / 2] as const) : w.side === 's' ? (['x', maxZ - t / 2] as const) : w.side === 'w' ? (['z', minX + t / 2] as const) : (['z', maxX - t / 2] as const);
        f.window(axis, at, w.at - width / 2, w.at + width / 2, base + (w.y0 ?? 1), base + (w.y1 ?? 1.9), { t });
      }
    },
  };
  return f;
}

export type Furnisher = ReturnType<typeof createFurnisher>;
