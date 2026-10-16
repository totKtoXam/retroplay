import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  FLOOR_H,
  ROOF_H,
  mulberry32,
  parseProcBuilding,
  procBuildingBase,
  type ProcBuildingBase,
  type ProcBuildingParams,
} from '@/lib/maps/proc-buildings';
import type { TextureSetLoader } from './world-pbr-textures';

/*
 * Процедурные здания «Зоны заражения» — порт scratchpad/real/proc/model_building.mjs
 * (4-этажный разрушенный дом) на параметры из id (lib/maps/proc-buildings.ts): размер,
 * этажность, зерно, стиль. Геометрия в метрах, центр x/z = 0, низ y = 0 — как рамка.
 *
 * Стены — плоскость фасада с прямоугольными проёмами (ShapeGeometry) плюс откосы
 * ниш 0.3 м; ExtrudeGeometry не нужна: внутренней грани стены никто не видит.
 * UV — метры мира, один повтор набора = размер плитки набора. Всё, что есть у
 * здания, сливается в одну геометрию на материал: слой моделей делает из каждой
 * InstancedMesh, поэтому важнее число материалов, чем число деталей.
 *
 * Бюджет: ≤ 6000 треугольников у apt/office обычного размера (16–24 м, до 9 этажей),
 * ≤ 10000 у руины; большие корпуса стоят пропорционально числу окон. Копоть и грязь
 * у земли общим шейдером добавляет слой моделей — здесь только копоть над проёмами
 * (цвета вершин).
 */

const WT = 0.3;
/** Глубина рамы окна в нише. */
const REVEAL = 0.15;
const WIN_W = 1.4;
const WIN_H = 1.6;
const PLINTH_H = 0.6;

/** Размер плитки набора, м (один повтор текстуры). */
const TILE: Record<string, number> = {
  bricks097: 1.1,
  brick_wall_02: 1.2,
  paintedbricks001: 2,
  plaster007: 2.2,
  concrete016: 2.4,
  concrete034: 2.4,
  concrete_wall_006: 2.6,
  planks023a: 1.8,
  roofingtiles012a: 2.4,
  corrugatedsteel005: 1.5,
  metal032: 1,
  'proc-plaster': 2.4,
  'proc-brick': 1.4,
  'proc-concrete': 2.2,
  'proc-asphalt': 2.4,
  'proc-rust': 1.2,
};

type Vec2 = [number, number];
type Rect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Есть подоконник: нижний откос скрыт за ним и рамой. */
  sill?: boolean;
};
type Side = 'front' | 'right' | 'back' | 'left';
type WinKind = 'intact' | 'broken' | 'boarded';
type Facade = {
  side: Side;
  /** Длина фасада, м; локальный x — вдоль него от −L/2 до L/2, z — наружу от 0. */
  L: number;
  m: T.Matrix4;
  /** Сдвиг UV по периметру: текстура не начинается заново на каждом углу. */
  uOff: number;
};

type MatOpts = {
  color?: number;
  roughness?: number;
  metalness?: number;
  side?: T.Side;
  normalScale?: number;
};
type AddOpts = {
  /** 'world' — планарные UV в метрах по доминирующей нормали после трансформации. */
  uv?: 'world' | 'keep';
  /** Множители UV для 'keep' (цилиндры: длина окружности и высота в метрах). */
  uvScale?: Vec2;
  uvShift?: Vec2;
  color?: [number, number, number];
};

const nonIndexed = (g: T.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

/** Планарная проекция UV в метрах по доминирующей оси нормали. */
function planarUV(g: T.BufferGeometry, shift: Vec2 = [0, 0]) {
  const p = g.attributes.position,
    n = g.attributes.normal,
    uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const nx = Math.abs(n.getX(i)),
      ny = Math.abs(n.getY(i)),
      nz = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ny >= nx && ny >= nz) {
      u = x;
      v = z;
    } else if (nx >= nz) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv.setXY(i, u + shift[0], v + shift[1]);
  }
}

/** Копилка частей по ключу материала; в конце — одна слитая геометрия на ключ. */
class Acc {
  parts = new Map<string, T.BufferGeometry[]>();
  makers = new Map<string, () => T.Material>();

  add(key: string, geom: T.BufferGeometry, m?: T.Matrix4, o: AddOpts = {}) {
    const g = nonIndexed(geom);
    if (g !== geom) geom.dispose();
    if (m) g.applyMatrix4(m);
    if (o.uv === 'world') planarUV(g, o.uvShift);
    else if (o.uvScale || o.uvShift) {
      const uv = g.attributes.uv,
        s = o.uvScale ?? [1, 1],
        d = o.uvShift ?? [0, 0];
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, uv.getX(i) * s[0] + d[0], uv.getY(i) * s[1] + d[1]);
    }
    if (!g.attributes.color) {
      const c = o.color ?? [1, 1, 1];
      const arr = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < arr.length; i += 3) arr.set(c, i);
      g.setAttribute('color', new T.BufferAttribute(arr, 3));
    }
    for (const name of Object.keys(g.attributes))
      if (!['position', 'normal', 'uv', 'color'].includes(name))
        g.deleteAttribute(name);
    g.clearGroups();
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(g);
  }

  material(key: string, make: () => T.Material) {
    if (!this.makers.has(key)) this.makers.set(key, make);
    return key;
  }

  finish() {
    const out: { geometry: T.BufferGeometry; material: T.Material }[] = [];
    for (const [key, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const make = this.makers.get(key);
      if (!make) continue;
      out.push({ geometry: merged, material: make() });
    }
    return out;
  }
}

/** Выпуклый четырёхугольник a-b-c-d с нормалью по `n` (порядок вершин подбирается). */
function quadGeom(
  a: T.Vector3,
  b: T.Vector3,
  c: T.Vector3,
  d: T.Vector3,
  n: T.Vector3,
  uv?: [Vec2, Vec2, Vec2, Vec2],
) {
  const ab = new T.Vector3().subVectors(b, a),
    ad = new T.Vector3().subVectors(d, a);
  const cross = new T.Vector3().crossVectors(ab, ad);
  const pts = cross.dot(n) >= 0 ? [a, b, c, d] : [a, d, c, b];
  const uvs = uv
    ? cross.dot(n) >= 0
      ? uv
      : [uv[0], uv[3], uv[2], uv[1]]
    : null;
  const nn = cross.normalize();
  const pos = new Float32Array(18),
    nor = new Float32Array(18),
    tex = new Float32Array(12);
  const order = [0, 1, 2, 0, 2, 3];
  for (let i = 0; i < 6; i++) {
    const k = order[i];
    pos.set([pts[k].x, pts[k].y, pts[k].z], i * 3);
    nor.set([nn.x, nn.y, nn.z], i * 3);
    if (uvs) tex.set(uvs[k], i * 2);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.BufferAttribute(tex, 2));
  return g;
}

const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
type RGB = [number, number, number];
/** Оттенок для цвета вершин: hex (sRGB) → линейный, как делает Color у материала. */
const rgb = (hex: number) => new T.Color(hex).toArray() as RGB;
const DARK: RGB = [0.52, 0.52, 0.52];
const LIGHT: RGB = [1.25, 1.22, 1.18];

/** Грани BoxGeometry по порядку групп three.js. */
const FACES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;
type Face = (typeof FACES)[number];

/** Параллелепипед; `faces` — какие грани оставить (невидимые не нужны). */
function boxGeom(sx: number, sy: number, sz: number, faces?: Face[]) {
  const g = new T.BoxGeometry(sx, sy, sz);
  if (!faces) return g;
  const ng = g.toNonIndexed();
  g.dispose();
  const keep = ng.groups.filter((gr) =>
    faces.includes(FACES[gr.materialIndex ?? 0]),
  );
  const count = keep.reduce((s, gr) => s + gr.count, 0);
  const out = new T.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const src = ng.attributes[name];
    const arr = new Float32Array(count * src.itemSize);
    let off = 0;
    for (const gr of keep) {
      arr.set(
        (src.array as Float32Array).subarray(
          gr.start * src.itemSize,
          (gr.start + gr.count) * src.itemSize,
        ),
        off,
      );
      off += gr.count * src.itemSize;
    }
    out.setAttribute(name, new T.BufferAttribute(arr, src.itemSize));
  }
  ng.dispose();
  return out;
}

const mat4 = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new T.Matrix4().compose(
    V(x, y, z),
    new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)),
    V(1, 1, 1),
  );

/** Наименьший x контура в полосе высот [y0, y1] (до чего доходит обрушение). */
function polyMinX(poly: Vec2[], y0: number, y1: number) {
  let mn = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x, y] = poly[i];
    if (y >= y0 && y <= y1) mn = Math.min(mn, x);
    if (i > 0) {
      const [px, py] = poly[i - 1];
      for (const yy of [y0, y1])
        if ((py - yy) * (y - yy) < 0) {
          const t = (yy - py) / (y - py);
          mn = Math.min(mn, px + (x - px) * t);
        }
    }
  }
  return mn;
}

/** Контекст одной постройки: генератор, копилка и материалы. */
class Build {
  acc = new Acc();
  R: () => number;
  W: number;
  D: number;
  W2: number;
  D2: number;
  floors: number;
  /** Отметка верха последнего перекрытия. */
  H0: number;
  base: ProcBuildingBase;
  ruin: boolean;
  facades: Facade[];
  /** Обрушение: контуры разлома фронтального и правого фасада (в их локальных x,y). */
  cut?: { front: Vec2[]; right: Vec2[]; cw: number; cd: number };
  /**
   * Общая палитра: один материал на роль, оттенки — цветом вершин. Чем меньше
   * материалов, тем меньше InstancedMesh (и вызовов отрисовки) у слоя моделей.
   */
  readonly M = {
    concrete: this.pbr('concrete034', { color: 0xb3afa6 }),
    raw: this.pbr('concrete016', { color: 0xa5a29b }),
    brick: this.pbr('bricks097', { color: 0x8a7f78 }),
    chunk: this.pbr('proc-concrete', { color: 0x9a948a }),
    paint: this.pbr('proc-plaster', {}),
    roof: this.pbr('proc-asphalt', { color: 0x6e6c68 }),
    corr: this.pbr('corrugatedsteel005', {
      color: 0x8c8a82,
      roughness: 0.7,
      metalness: 0.4,
      side: T.DoubleSide,
    }),
    metal: this.pbr('metal032', {
      color: 0xb3b6ae,
      roughness: 0.55,
      metalness: 0.5,
    }),
    rust: this.pbr('proc-rust', {
      color: 0x8f8276,
      roughness: 0.9,
      metalness: 0.3,
      side: T.DoubleSide,
    }),
    planks: this.pbr('planks023a', { color: 0x9a8f80 }),
    steel: this.plain(0x3a3d37, 0.55, 0.6),
    frame: this.plain(0xb9b3a6, 0.8),
    dark: this.plain(0x0b0a09, 1),
    under: this.plain(0x5e5850, 0.95),
    glass: this.glass(),
    soot: this.soot(),
  };

  constructor(
    public p: ProcBuildingParams,
    public textures: TextureSetLoader,
  ) {
    this.R = mulberry32(p.seed);
    this.W = p.w;
    this.D = p.d;
    this.W2 = p.w / 2;
    this.D2 = p.d / 2;
    this.floors = p.floors;
    this.H0 = p.floors * FLOOR_H;
    this.base = procBuildingBase(p);
    this.ruin = p.style === 'ruin';
    const { W, D, W2, D2 } = this;
    this.facades = [
      { side: 'front', L: W, m: mat4(0, 0, D2), uOff: 0 },
      { side: 'right', L: D, m: mat4(W2, 0, 0, 0, Math.PI / 2), uOff: W },
      { side: 'back', L: W, m: mat4(0, 0, -D2, 0, Math.PI), uOff: W + D },
      {
        side: 'left',
        L: D,
        m: mat4(-W2, 0, 0, 0, -Math.PI / 2),
        uOff: 2 * W + D,
      },
    ];
  }

  rr(a: number, b: number) {
    return a + (b - a) * this.R();
  }
  pick<X>(list: readonly X[]): X {
    return list[Math.floor(this.R() * list.length) % list.length];
  }

  // ---------------------------------------------------------------- материалы
  pbr(set: string, o: MatOpts = {}, tile = TILE[set] ?? 2) {
    const key = `pbr:${set}:${tile}:${o.color ?? 0xffffff}:${o.roughness ?? 1}:${o.metalness ?? 0}:${o.side ?? 0}`;
    return this.acc.material(key, () => {
      const t = this.textures.get(set, { repeat: 1 / tile });
      const m = new T.MeshStandardMaterial({
        map: t.map,
        normalMap: t.normalMap,
        roughnessMap: t.roughnessMap,
        color: o.color ?? 0xffffff,
        roughness: o.roughness ?? 1,
        metalness: o.metalness ?? 0,
        side: o.side ?? T.FrontSide,
        vertexColors: true,
      });
      if (o.normalScale !== undefined)
        m.normalScale.set(o.normalScale, o.normalScale);
      return m;
    });
  }
  plain(
    color: number,
    roughness = 0.9,
    metalness = 0,
    side: T.Side = T.FrontSide,
  ) {
    return this.acc.material(
      `plain:${color}:${roughness}:${metalness}:${side}`,
      () =>
        new T.MeshStandardMaterial({
          color,
          roughness,
          metalness,
          side,
          vertexColors: true,
        }),
    );
  }
  glass() {
    return this.acc.material(
      'glass',
      () =>
        new T.MeshPhysicalMaterial({
          color: 0x1a232b,
          roughness: 0.12,
          metalness: 0,
          transparent: true,
          opacity: 0.74,
          envMapIntensity: 1.6,
          depthWrite: false,
          vertexColors: true,
        }),
    );
  }
  /** Копоть над проёмом: чёрная плоскость с альфой в цвете вершин (itemSize 4). */
  soot() {
    return this.acc.material(
      'soot',
      () =>
        new T.MeshBasicMaterial({
          color: 0x0a0806,
          transparent: true,
          vertexColors: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
    );
  }

  // ---------------------------------------------------------------- примитивы
  box(
    key: string,
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    o: {
      m?: T.Matrix4;
      rot?: [number, number, number];
      faces?: Face[];
      jitter?: boolean;
      color?: [number, number, number];
      keep?: boolean;
    } = {},
  ) {
    const g = boxGeom(sx, sy, sz, o.faces);
    const local = mat4(x, y, z, ...(o.rot ?? [0, 0, 0]));
    const m = o.m ? o.m.clone().multiply(local) : local;
    const shift: Vec2 = o.jitter ? [this.R() * 3, this.R() * 3] : [0, 0];
    this.acc.add(
      key,
      g,
      m,
      o.keep
        ? { uvShift: shift, color: o.color }
        : { uv: 'world', uvShift: shift, color: o.color },
    );
  }
  quad(
    key: string,
    a: T.Vector3,
    b: T.Vector3,
    c: T.Vector3,
    d: T.Vector3,
    n: T.Vector3,
    o: {
      m?: T.Matrix4;
      uv?: [Vec2, Vec2, Vec2, Vec2];
      uvShift?: Vec2;
      color?: [number, number, number];
    } = {},
  ) {
    const g = quadGeom(a, b, c, d, n, o.uv);
    this.acc.add(
      key,
      g,
      o.m,
      o.uv
        ? { color: o.color, uvShift: o.uvShift }
        : { uv: 'world', uvShift: o.uvShift, color: o.color },
    );
  }
  /** Прямоугольник в плоскости z = const локальной системы фасада, нормаль ±z. */
  rectZ(
    key: string,
    r: Rect,
    z: number,
    m: T.Matrix4,
    out = true,
    uvShift: Vec2 = [0, 0],
    color?: [number, number, number],
  ) {
    const uv: [Vec2, Vec2, Vec2, Vec2] = [
      [r.x0 + uvShift[0], r.y0 + uvShift[1]],
      [r.x1 + uvShift[0], r.y0 + uvShift[1]],
      [r.x1 + uvShift[0], r.y1 + uvShift[1]],
      [r.x0 + uvShift[0], r.y1 + uvShift[1]],
    ];
    this.quad(
      key,
      V(r.x0, r.y0, z),
      V(r.x1, r.y0, z),
      V(r.x1, r.y1, z),
      V(r.x0, r.y1, z),
      V(0, 0, out ? 1 : -1),
      { m, uv, color },
    );
  }
  cyl(
    key: string,
    rt: number,
    rb: number,
    h: number,
    seg: number,
    x: number,
    y: number,
    z: number,
    o: {
      m?: T.Matrix4;
      rot?: [number, number, number];
      open?: boolean;
      color?: [number, number, number];
    } = {},
  ) {
    const g = new T.CylinderGeometry(rt, rb, h, seg, 1, !!o.open);
    const local = mat4(x, y, z, ...(o.rot ?? [0, 0, 0]));
    const m = o.m ? o.m.clone().multiply(local) : local;
    this.acc.add(key, g, m, {
      uvScale: [Math.PI * (rt + rb), h],
      uvShift: [this.R(), this.R()],
      color: o.color,
    });
  }
  /** Фигура в плане (точки [x, z]) на высоте y, нормаль вверх; с `t` — плита толщиной t вниз. */
  plan(key: string, pts: Vec2[], y: number, t = 0, color?: RGB) {
    const shape = new T.Shape(pts.map(([x, z]) => new T.Vector2(x, -z)));
    const g =
      t > 0
        ? new T.ExtrudeGeometry(shape, {
            depth: t,
            bevelEnabled: false,
            steps: 1,
            curveSegments: 1,
          })
        : new T.ShapeGeometry(shape, 1);
    // Выдавливание идёт вверх по y; плита должна лежать под отметкой y.
    const m = new T.Matrix4()
      .makeRotationX(-Math.PI / 2)
      .premultiply(new T.Matrix4().makeTranslation(0, y - t, 0));
    this.acc.add(key, g, m, { uv: 'world', color });
  }

  /**
   * Стена фасада: контур (CCW, локальные x,y) с прямоугольными проёмами, откосы ниш
   * на WT вглубь и боковые грани контура (разлом руины) материалом `core`.
   */
  wall(f: Facade, outline: Vec2[], holes: Rect[], face: string, core: string) {
    const shape = new T.Shape(outline.map(([x, y]) => new T.Vector2(x, y)));
    for (const h of holes) {
      const p = new T.Path();
      p.moveTo(h.x0, h.y0);
      p.lineTo(h.x1, h.y0);
      p.lineTo(h.x1, h.y1);
      p.lineTo(h.x0, h.y1);
      p.closePath();
      shape.holes.push(p);
    }
    const g = new T.ShapeGeometry(shape, 1);
    const uv = g.attributes.uv,
      pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, pos.getX(i) + f.uOff, pos.getY(i));
    this.acc.add(face, g, f.m, { uv: 'keep' });
    for (const h of holes) {
      const u = f.uOff;
      // Откосы: левый/правый — нормаль внутрь проёма, низ/верх — тоже.
      this.quad(
        face,
        V(h.x0, h.y0, 0),
        V(h.x0, h.y0, -WT),
        V(h.x0, h.y1, -WT),
        V(h.x0, h.y1, 0),
        V(1, 0, 0),
        {
          m: f.m,
          uv: [
            [u + h.x0, h.y0],
            [u + h.x0 + WT, h.y0],
            [u + h.x0 + WT, h.y1],
            [u + h.x0, h.y1],
          ],
        },
      );
      this.quad(
        face,
        V(h.x1, h.y0, 0),
        V(h.x1, h.y0, -WT),
        V(h.x1, h.y1, -WT),
        V(h.x1, h.y1, 0),
        V(-1, 0, 0),
        {
          m: f.m,
          uv: [
            [u + h.x1, h.y0],
            [u + h.x1 - WT, h.y0],
            [u + h.x1 - WT, h.y1],
            [u + h.x1, h.y1],
          ],
        },
      );
      this.quad(
        face,
        V(h.x0, h.y1, 0),
        V(h.x1, h.y1, 0),
        V(h.x1, h.y1, -WT),
        V(h.x0, h.y1, -WT),
        V(0, -1, 0),
        {
          m: f.m,
          uv: [
            [u + h.x0, h.y1],
            [u + h.x1, h.y1],
            [u + h.x1, h.y1 + WT],
            [u + h.x0, h.y1 + WT],
          ],
        },
      );
      if (h.y0 > 0.01 && !h.sill)
        this.quad(
          face,
          V(h.x0, h.y0, 0),
          V(h.x1, h.y0, 0),
          V(h.x1, h.y0, -WT),
          V(h.x0, h.y0, -WT),
          V(0, 1, 0),
          {
            m: f.m,
            uv: [
              [u + h.x0, h.y0],
              [u + h.x1, h.y0],
              [u + h.x1, h.y0 - WT],
              [u + h.x0, h.y0 - WT],
            ],
          },
        );
    }
    // Боковые грани контура: только разлом (не низ, не вертикальные края у углов, не верх).
    const L2 = f.L / 2;
    for (let i = 0; i < outline.length; i++) {
      const [ax, ay] = outline[i],
        [bx, by] = outline[(i + 1) % outline.length];
      if (ay < 0.01 && by < 0.01) continue;
      if (
        Math.abs(ax) > L2 - 0.01 &&
        Math.abs(bx) > L2 - 0.01 &&
        Math.abs(ax - bx) < 0.01
      )
        continue;
      if (Math.abs(ay - by) < 0.01 && ay > this.H0 - 0.01) continue;
      const nx = by - ay,
        ny = -(bx - ax);
      this.quad(
        core,
        V(ax, ay, 0),
        V(bx, by, 0),
        V(bx, by, -WT),
        V(ax, ay, -WT),
        V(nx, ny, 0),
        { m: f.m },
      );
    }
  }

  // ---------------------------------------------------------------- окна и двери
  /** Рама, стекло/проём/доски, подоконник; `r` — проём в локальных координатах фасада. */
  window(
    f: Facade,
    r: Rect,
    kind: WinKind,
    o: { sill?: boolean; soot?: boolean; cross?: boolean } = {},
  ) {
    const frame = this.M.frame;
    const ft = 0.07,
      cx = (r.x0 + r.x1) / 2;
    const z = -REVEAL;
    this.rectZ(frame, { x0: r.x0, y0: r.y0, x1: r.x0 + ft, y1: r.y1 }, z, f.m);
    this.rectZ(frame, { x0: r.x1 - ft, y0: r.y0, x1: r.x1, y1: r.y1 }, z, f.m);
    this.rectZ(
      frame,
      { x0: r.x0 + ft, y0: r.y0, x1: r.x1 - ft, y1: r.y0 + ft },
      z,
      f.m,
    );
    this.rectZ(
      frame,
      { x0: r.x0 + ft, y0: r.y1 - ft, x1: r.x1 - ft, y1: r.y1 },
      z,
      f.m,
    );
    if (o.cross !== false) {
      const ty = r.y0 + (r.y1 - r.y0) * 0.64;
      this.rectZ(
        frame,
        { x0: cx - ft * 0.4, y0: r.y0 + ft, x1: cx + ft * 0.4, y1: r.y1 - ft },
        z,
        f.m,
      );
      this.rectZ(
        frame,
        { x0: r.x0 + ft, y0: ty - ft * 0.4, x1: r.x1 - ft, y1: ty + ft * 0.4 },
        z,
        f.m,
      );
    }
    if (kind === 'intact') {
      this.rectZ(this.glass(), r, z - 0.02, f.m);
    } else {
      // Выбитое окно: тёмная комната в глубине ниши.
      this.rectZ(this.M.dark, r, -WT + 0.02, f.m);
    }
    if (kind === 'boarded') {
      const planks = this.M.planks;
      const n = 3 + Math.floor(this.R() * 2);
      const h = r.y1 - r.y0,
        w = r.x1 - r.x0;
      for (let i = 0; i < n; i++) {
        const by =
          r.y0 + 0.1 + (h - 0.2) * ((i + 0.5) / n) + this.rr(-0.05, 0.05);
        const bw = w + this.rr(0.25, 0.5),
          bh = this.rr(0.16, 0.22);
        const m = f.m
          .clone()
          .multiply(
            mat4(
              cx + this.rr(-0.1, 0.1),
              by,
              -0.05,
              0,
              0,
              this.rr(-0.07, 0.07),
            ),
          );
        const du = this.R() * 2,
          dv = this.R() * 2;
        this.quad(
          planks,
          V(-bw / 2, -bh / 2, 0),
          V(bw / 2, -bh / 2, 0),
          V(bw / 2, bh / 2, 0),
          V(-bw / 2, bh / 2, 0),
          V(0, 0, 1),
          {
            m,
            uv: [
              [du, dv],
              [du + bw, dv],
              [du + bw, dv + bh],
              [du, dv + bh],
            ],
          },
        );
      }
    }
    if (o.sill !== false) {
      const sill = this.M.concrete;
      this.box(sill, r.x1 - r.x0 + 0.2, 0.07, 0.32, cx, r.y0 - 0.025, 0.02, {
        m: f.m,
        faces: ['+y', '+z'],
        rot: [0.05, 0, 0],
      });
    }
    if (o.soot) this.sootAbove(f, r);
  }

  /** Копоть над проёмом: сетка 3×2 с альфой, сильнее у центра низа. */
  sootAbove(f: Facade, r: Rect) {
    const w = r.x1 - r.x0,
      h = r.y1 - r.y0;
    const x0 = r.x0 - w * 0.35,
      x1 = r.x1 + w * 0.35,
      y0 = r.y1 - 0.05,
      y1 = r.y1 + h * this.rr(0.9, 1.4);
    const nx = 3,
      ny = 2;
    const pos: number[] = [],
      col: number[] = [],
      nor: number[] = [],
      uvs: number[] = [];
    const vert = (i: number, j: number) => {
      const u = i / nx,
        v = j / ny;
      pos.push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, 0.012);
      nor.push(0, 0, 1);
      uvs.push(u, v);
      const a =
        Math.pow(1 - v, 1.6) *
        Math.pow(Math.max(0, 1 - Math.abs(u - 0.5) * 2), 0.6) *
        0.9;
      col.push(1, 1, 1, a);
    };
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        vert(i, j);
        vert(i + 1, j);
        vert(i + 1, j + 1);
        vert(i, j);
        vert(i + 1, j + 1);
        vert(i, j + 1);
      }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 4));
    this.acc.add(this.soot(), g, f.m, { uv: 'keep' });
  }

  /** Металлическая дверь, приоткрытая; `r` — проём. */
  door(f: Facade, r: Rect, open = this.rr(-0.6, -0.2)) {
    const frame = this.M.steel;
    const ft = 0.08;
    this.rectZ(
      frame,
      { x0: r.x0, y0: r.y0, x1: r.x0 + ft, y1: r.y1 },
      -REVEAL,
      f.m,
    );
    this.rectZ(
      frame,
      { x0: r.x1 - ft, y0: r.y0, x1: r.x1, y1: r.y1 },
      -REVEAL,
      f.m,
    );
    this.rectZ(
      frame,
      { x0: r.x0 + ft, y0: r.y1 - ft, x1: r.x1 - ft, y1: r.y1 },
      -REVEAL,
      f.m,
    );
    this.rectZ(this.M.dark, r, -WT + 0.02, f.m);
    const leaf = this.M.rust;
    const w = r.x1 - r.x0 - 2 * ft,
      h = r.y1 - r.y0 - ft;
    const m = f.m.clone().multiply(mat4(r.x0 + ft, r.y0, -REVEAL, 0, open, 0));
    this.quad(
      leaf,
      V(0, 0, 0),
      V(w, 0, 0),
      V(w, h, 0),
      V(0, h, 0),
      V(0, 0, 1),
      {
        m,
        uv: [
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
        ],
      },
    );
  }

  // ---------------------------------------------------------------- планировка
  /** Оси окон вдоль фасада: отступ от углов и равный шаг около `pitch`. */
  bays(L: number, pitch: number, edge: number) {
    const usable = L - 2 * edge;
    const n = Math.max(1, Math.round(usable / pitch));
    const step = usable / n;
    return Array.from({ length: n }, (_, i) => -usable / 2 + step * (i + 0.5));
  }

  /**
   * Контур фасада: прямоугольник до `top`, у руины — с разломом угла (+x,+z) на
   * фронтальном (правый край) и правом (левый край, локальный x = −z мира) фасадах.
   * С `ridge` — фронтон: верх поднимается к коньку посередине.
   */
  outline(f: Facade, top: number, ridge?: number): Vec2[] {
    const L2 = f.L / 2;
    const peak: Vec2[] = ridge ? [[0, ridge]] : [];
    if (this.cut && f.side === 'front')
      return [[-L2, 0], [L2, 0], ...this.cut.front, ...peak, [-L2, top]];
    if (this.cut && f.side === 'right')
      return [[-L2, 0], [L2, 0], [L2, top], ...peak, ...this.cut.right];
    return [[-L2, 0], [L2, 0], [L2, top], ...peak, [-L2, top]];
  }

  /** Проём не должен попадать в разлом: проверка по полосе высот. */
  clear(f: Facade, r: Rect) {
    if (!this.cut) return true;
    if (f.side === 'front')
      return r.x1 < polyMinX(this.cut.front, r.y0, r.y1) - 0.35;
    if (f.side === 'right')
      return (
        r.x0 >
        -polyMinX(
          this.cut.right.map(([x, y]) => [-x, y]),
          r.y0,
          r.y1,
        ) +
          0.35
      );
    return true;
  }

  pickKind(floor: number): WinKind {
    const r = this.R();
    if (this.ruin) return r < 0.3 ? 'boarded' : r < 0.8 ? 'broken' : 'intact';
    if (floor === 0)
      return r < 0.4 ? 'boarded' : r < 0.65 ? 'broken' : 'intact';
    return r < 0.12 ? 'boarded' : r < 0.32 ? 'broken' : 'intact';
  }

  /** Разлом угла руины: ломаные от земли к крыше на двух фасадах. */
  makeCut() {
    const { W2, D2, H0 } = this;
    const cw = Math.min(W2 * 0.45, 2.5 + this.floors * 0.35);
    const cd = Math.min(D2 * 0.5, 1.5 + this.floors * 0.3);
    const line = (x0: number, y0: number, x1: number, y1: number): Vec2[] => {
      const out: Vec2[] = [[x0, y0]];
      const n = Math.max(3, Math.round((y1 - y0) / 0.9));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        out.push([
          x0 + (x1 - x0) * Math.pow(t, 0.8) + this.rr(-0.35, 0.35),
          y0 + (y1 - y0) * t + this.rr(-0.2, 0.2),
        ]);
      }
      out.push([x1, y1]);
      return out;
    };
    // Фронт: от правого края у земли влево-вверх. Правый фасад: локальный x = −z мира,
    // угол в x = −D2; разлом идёт от угла вправо-вверх, точки — сверху вниз (контур CCW).
    const front = line(W2, this.rr(0.5, 1.2), W2 - cw, H0 + 0.001);
    const right = line(-D2, this.rr(1.5, 3), -D2 + cd, H0 + 0.001).reverse();
    this.cut = { front, right, cw, cd };
  }
}

// ---------------------------------------------------------------- стили
type WallSets = { face: string; core: string; set: string };

function wallSets(b: Build): WallSets {
  const core = b.M.brick;
  switch (b.base) {
    case 'apt': {
      const set = b.pick([
        'plaster007',
        'paintedbricks001',
        'bricks097',
        'brick_wall_02',
        'proc-plaster',
        'proc-brick',
        'concrete016',
      ] as const);
      const tint = {
        plaster007: b.pick([0xe9e2d2, 0xd9cfb6, 0xcfd3c4, 0xe4d6c0]),
        paintedbricks001: b.pick([0xb8c4c8, 0xc9c2a6, 0xd0b7a0]),
        'proc-plaster': b.pick([0xf0e9da, 0xd6c9ad, 0xc9d1c2]),
        concrete016: 0xd6d3cc,
      } as Record<string, number>;
      return { face: b.pbr(set, { color: tint[set] ?? 0xffffff }), core, set };
    }
    case 'office': {
      const set = b.pick([
        'concrete_wall_006',
        'concrete016',
        'concrete034',
        'proc-concrete',
      ] as const);
      return {
        face: b.pbr(set, { color: b.pick([0xffffff, 0xd8d4cc, 0xc7c9c9]) }),
        core,
        set,
      };
    }
    case 'house': {
      const set = b.pick([
        'plaster007',
        'paintedbricks001',
        'bricks097',
        'planks023a',
        'proc-plaster',
      ] as const);
      const tint = {
        plaster007: b.pick([0xf1e6cf, 0xe3d2b5, 0xd4ddc8, 0xe8c9b0]),
        paintedbricks001: b.pick([0xc6cfd0, 0xd6c9a8, 0xe0e0e0]),
        planks023a: b.pick([0xb9ad9a, 0x8f8878, 0xc4c0b4]),
        'proc-plaster': b.pick([0xf4ecd8, 0xdfd1b4]),
      } as Record<string, number>;
      return { face: b.pbr(set, { color: tint[set] ?? 0xffffff }), core, set };
    }
    case 'industrial': {
      const set = 'corrugatedsteel005';
      return {
        face: b.pbr(set, {
          color: b.pick([0x9ea4a2, 0x8c9a8e, 0x9fa6b0, 0xb0a99a]),
          roughness: 0.75,
          metalness: 0.35,
        }),
        core,
        set,
      };
    }
  }
}

/** Жилой дом: плинтус, пояса, окна в нишах, подъезд, балконы, парапет, крыша с хозяйством. */
function buildApt(b: Build, ws: WallSets) {
  const { H0 } = b;
  const concrete = b.M.concrete;
  const sillUp = [1.1, 0.9];
  const broken: { f: Facade; r: Rect }[] = [];
  const hasBands =
    ws.set !== 'bricks097' &&
    ws.set !== 'brick_wall_02' &&
    ws.set !== 'proc-brick';
  const entranceBay = (bays: number[]) =>
    bays.length >= 3
      ? Math.floor(bays.length / 2) - (bays.length % 2 === 0 ? 1 : 0)
      : -1;

  for (const f of b.facades) {
    const long = f.side === 'front' || f.side === 'back';
    const bays = b.bays(f.L, long ? 3.3 : 3.6, long ? 1.3 : 1.5);
    const ent = f.side === 'front' ? entranceBay(bays) : -1;
    // Балконы столбиком через пролёт на уличном фасаде, у половины домов — и на дворовом.
    const balcBays = new Set<number>();
    const backBalc = b.R() < 0.5;
    if (f.side === 'front' || (f.side === 'back' && backBalc))
      bays.forEach((_, i) => {
        if (
          i !== ent &&
          (i + (f.side === 'back' ? 1 : 0)) % 2 === 0 &&
          b.R() < 0.85
        )
          balcBays.add(i);
      });
    const holes: Rect[] = [];
    const units: (() => void)[] = [];
    for (let k = 0; k < b.floors; k++) {
      const fl = k * FLOOR_H;
      bays.forEach((bx, i) => {
        if (i === ent) {
          if (k === 0) {
            const r = { x0: bx - 0.75, y0: 0, x1: bx + 0.75, y1: 2.4 };
            holes.push(r);
            units.push(() => b.door(f, r));
          } else {
            // Лестничная клетка: узкое окно между этажами.
            const r = {
              x0: bx - 0.45,
              y0: fl + 1.7,
              x1: bx + 0.45,
              y1: fl + 2.6,
            };
            if (!b.clear(f, r)) return;
            holes.push(r);
            const kind = b.pickKind(k);
            units.push(() => b.window(f, r, kind, { cross: false }));
          }
          return;
        }
        if (balcBays.has(i) && k >= 1) {
          const d = { x0: bx - 1.0, y0: fl, x1: bx - 0.2, y1: fl + 2.15 };
          const w = {
            x0: bx - 0.05,
            y0: fl + 0.9,
            x1: bx + 1.1,
            y1: fl + 2.15,
          };
          if (!b.clear(f, { x0: bx - 1.3, y0: fl, x1: bx + 1.3, y1: fl + 2.3 }))
            return;
          holes.push(d, w);
          const kind = b.pickKind(k);
          units.push(() => {
            b.window(f, d, kind === 'intact' ? 'intact' : 'broken', {
              sill: false,
              cross: false,
            });
            b.window(f, w, kind, { sill: false });
            if (kind === 'broken') broken.push({ f, r: w });
          });
          units.push(() => balcony(b, f, bx, fl, b.ruin && b.R() < 0.4));
          return;
        }
        const r: Rect = {
          x0: bx - WIN_W / 2,
          y0: fl + sillUp[k ? 1 : 0],
          x1: bx + WIN_W / 2,
          y1: fl + sillUp[k ? 1 : 0] + WIN_H,
          sill: true,
        };
        if (!b.clear(f, r)) return;
        holes.push(r);
        const kind = b.pickKind(k);
        units.push(() => {
          b.window(f, r, kind);
          if (kind === 'broken') broken.push({ f, r });
        });
      });
    }
    b.wall(f, b.outline(f, H0), holes, ws.face, ws.core);
    for (const u of units) u();
    // Цоколь, пояса этажей, парапет — коробки вдоль фасада в его локальной системе.
    const L2 = f.L / 2;
    const span = (y0: number, y1: number) => {
      // На разломе руины пояс обрывается у края стены.
      let x1 = L2;
      if (b.cut && f.side === 'front')
        x1 = Math.min(L2, polyMinX(b.cut.front, y0, y1) - 0.1);
      let x0 = -L2;
      if (b.cut && f.side === 'right')
        x0 = Math.max(
          -L2,
          -polyMinX(
            b.cut.right.map(([x, y]) => [-x, y]),
            y0,
            y1,
          ) + 0.1,
        );
      return [x0, x1] as const;
    };
    {
      const [x0, x1] = span(0, PLINTH_H);
      b.box(
        b.M.raw,
        x1 - x0 + 0.12,
        PLINTH_H,
        0.06,
        (x0 + x1) / 2,
        PLINTH_H / 2,
        0.03,
        { m: f.m, faces: ['+z', '+y', '+x', '-x'], color: DARK },
      );
    }
    if (hasBands)
      for (let k = 1; k < b.floors; k++) {
        const y = k * FLOOR_H;
        const [x0, x1] = span(y - 0.2, y + 0.12);
        if (x1 - x0 < 0.5) continue;
        b.box(
          concrete,
          x1 - x0 + 0.16,
          0.32,
          0.08,
          (x0 + x1) / 2,
          y - 0.04,
          0.04,
          { m: f.m, faces: ['+z', '+y', '-y', '+x', '-x'] },
        );
      }
    if (f.side === 'front' && ent >= 0) entrance(b, f, bays[ent]);
    // Кондиционеры и тарелки на верхних этажах.
    const nAc = Math.round(bays.length * b.floors * 0.08 * b.R());
    for (let i = 0; i < nAc; i++) {
      const k = 1 + Math.floor(b.R() * Math.max(1, b.floors - 1));
      const bx = b.pick(bays) + b.rr(0.9, 1.3) * (b.R() < 0.5 ? -1 : 1);
      if (
        Math.abs(bx) > L2 - 0.6 ||
        !b.clear(f, {
          x0: bx - 0.5,
          y0: k * FLOOR_H + 0.5,
          x1: bx + 0.5,
          y1: k * FLOOR_H + 1.6,
        })
      )
        continue;
      acUnit(b, f, bx, k * FLOOR_H + b.rr(0.8, 1.6));
    }
    // Водосточная труба у левого края фасада.
    if (b.R() < 0.75) drainpipe(b, f, -L2 + 0.25);
  }
  for (const w of broken)
    if (b.R() < (b.ruin ? 0.45 : 0.12)) b.sootAbove(w.f, w.r);

  parapetAndRoof(b, 0.7, 0.25, b.M.roof, concrete);
  rooftopApt(b, ws);
  if (b.ruin) collapse(b, ws);
}

/** Балкон: плита, ограждение из ржавого листа, перила. */
function balcony(b: Build, f: Facade, cx: number, y: number, damaged: boolean) {
  const slab = b.M.concrete;
  const steel = b.M.steel;
  const panel = b.M.corr;
  const tint = rgb(b.pick([0xd5d8d0, 0xbfc8bc, 0xd7c9b4]));
  const w = 2.6,
    dpt = 1.1,
    st = 0.16,
    rh = 1.05;
  b.box(slab, w, st, dpt + 0.05, cx, y - st / 2, dpt / 2 - 0.02, {
    m: f.m,
    faces: ['+y', '-y', '+z', '+x', '-x'],
  });
  // Ограждение: лист спереди и с боков, поручень, стойки по углам.
  const z1 = dpt - 0.06;
  const ph = 0.8;
  if (damaged) {
    const m = f.m.clone().multiply(mat4(cx + 0.5, y + 0.35, z1, 0.5, 0, 0.35));
    b.quad(
      panel,
      V(-0.55, -ph / 2, 0),
      V(0.55, -ph / 2, 0),
      V(0.55, ph / 2, 0),
      V(-0.55, ph / 2, 0),
      V(0, 0, 1),
      {
        m,
        uv: [
          [0, 0],
          [1.1, 0],
          [1.1, ph],
          [0, ph],
        ],
        color: tint,
      },
    );
  } else {
    b.rectZ(
      panel,
      { x0: cx - w / 2, y0: y + 0.12, x1: cx + w / 2, y1: y + 0.12 + ph },
      z1,
      f.m,
      true,
      [b.R() * 3, 0],
      tint,
    );
  }
  for (const sx of [-1, 1]) {
    const x = cx + (sx * w) / 2;
    b.quad(
      panel,
      V(x, y + 0.12, 0.05),
      V(x, y + 0.12, z1),
      V(x, y + 0.12 + ph, z1),
      V(x, y + 0.12 + ph, 0.05),
      V(sx, 0, 0),
      {
        m: f.m,
        uv: [
          [0, 0],
          [dpt, 0],
          [dpt, ph],
          [0, ph],
        ],
        color: tint,
      },
    );
    b.box(steel, 0.05, rh, 0.05, x, y + rh / 2, z1, {
      m: f.m,
      faces: ['+x', '-x', '+z'],
    });
  }
  b.box(steel, w, 0.05, 0.05, cx, y + rh, z1, {
    m: f.m,
    faces: ['+y', '+z', '-z'],
  });
}

/** Подъезд: площадка, ступени, козырёк на двух стойках. */
function entrance(b: Build, f: Facade, cx: number) {
  const concrete = b.M.concrete;
  const raw = b.M.raw;
  const steel = b.M.rust;
  b.box(concrete, 3.2, 0.42, 1.6, cx, 0.21, 0.8, {
    m: f.m,
    faces: ['+y', '+z', '+x', '-x'],
  });
  b.box(concrete, 3.2, 0.28, 0.34, cx, 0.14, 1.6 + 0.17, {
    m: f.m,
    faces: ['+y', '+z', '+x', '-x'],
  });
  b.box(concrete, 3.2, 0.14, 0.34, cx, 0.07, 1.94 + 0.17, {
    m: f.m,
    faces: ['+y', '+z', '+x', '-x'],
  });
  const cy = 2.9,
    cd = 1.6;
  b.box(raw, 3.4, 0.16, cd, cx, cy, cd / 2 - 0.05, {
    m: f.m,
    faces: ['+y', '-y', '+z', '+x', '-x'],
  });
  for (const px of [-1.4, 1.4])
    b.cyl(
      steel,
      0.045,
      0.045,
      cy - 0.5,
      8,
      cx + px,
      0.42 + (cy - 0.5) / 2,
      cd - 0.3,
      { m: f.m, open: true },
    );
}

/** Парапет по периметру крыши (у руины — до разлома) и сама кровля. */
function parapetAndRoof(
  b: Build,
  ph: number,
  pt: number,
  roofKey: string,
  concrete: string,
) {
  const { W2, D2, H0 } = b;
  const coping = b.M.raw;
  const py = H0 + ph / 2;
  // Пределы разлома на крыше: по верхней полосе контуров.
  const fx1 = b.cut ? polyMinX(b.cut.front, H0 - 0.6, H0) - 0.2 : W2;
  const sz0 = b.cut
    ? -polyMinX(
        b.cut.right.map(([x, y]) => [-x, y]),
        H0 - 0.6,
        H0,
      ) + 0.2
    : -D2;
  // Фронтальный парапет (z = +D2) от −W2 до fx1, правый (x = +W2) от sz0 до D2... у руины
  // правый парапет уцелел от −D2 до sz0 (локальный x правого фасада = −z мира).
  const segs: [number, number, number, number][] = [
    [-W2, D2 - pt / 2, fx1, D2 - pt / 2],
    [-W2, -D2 + pt / 2, W2, -D2 + pt / 2],
    [W2 - pt / 2, -D2, W2 - pt / 2, b.cut ? -sz0 : D2],
    [-W2 + pt / 2, -D2, -W2 + pt / 2, D2],
  ];
  for (const [x0, z0, x1, z1] of segs) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.3) continue;
    const yaw = -Math.atan2(z1 - z0, x1 - x0);
    b.box(concrete, len, ph, pt, (x0 + x1) / 2, py, (z0 + z1) / 2, {
      rot: [0, yaw, 0],
      faces: ['+z', '-z', '+x', '-x'],
    });
    b.box(
      coping,
      len + 0.08,
      0.08,
      pt + 0.12,
      (x0 + x1) / 2,
      H0 + ph + 0.04,
      (z0 + z1) / 2,
      { rot: [0, yaw, 0] },
    );
  }
  // Кровля: у руины — с отломанным углом.
  if (b.cut) {
    const [xa, zb] = [fx1 + 0.3, -sz0 - 0.3];
    const pts: Vec2[] = [
      [-W2 + 0.1, -D2 + 0.1],
      [W2 - 0.1, -D2 + 0.1],
      [W2 - 0.1, zb],
    ];
    const n = 7;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push([
        W2 - 0.1 + (xa - W2 + 0.1) * t + b.rr(-0.25, 0.25),
        zb + (D2 - 0.1 - zb) * t + b.rr(-0.25, 0.25),
      ]);
    }
    pts.push([xa, D2 - 0.1], [-W2 + 0.1, D2 - 0.1]);
    b.plan(roofKey, pts, H0 + 0.02);
    b.plan(b.M.raw, pts, H0, 0.28);
  } else {
    b.plan(
      roofKey,
      [
        [-W2 + 0.1, -D2 + 0.1],
        [W2 - 0.1, -D2 + 0.1],
        [W2 - 0.1, D2 - 0.1],
        [-W2 + 0.1, D2 - 0.1],
      ],
      H0 + 0.02,
    );
  }
}

/** Крыша жилого дома: выход на крышу, бак, кондиционеры, вентиляция, антенна. */
function rooftopApt(b: Build, ws: WallSets) {
  const { W2, D2, H0 } = b;
  const raw = b.M.raw;
  const steel = b.M.steel;
  const rust = b.M.rust;
  const metal = b.M.metal;
  // Выход на крышу — у левой половины, подальше от разлома.
  const bw = Math.min(3.4, b.W * 0.3),
    bd = Math.min(2.6, b.D * 0.35),
    bh = 2.6;
  const bx = -W2 + 1.2 + bw / 2,
    bz = b.rr(-D2 + 1 + bd / 2, D2 - 1 - bd / 2);
  b.box(ws.face, bw, bh, bd, bx, H0 + bh / 2, bz, {
    faces: ['+x', '-x', '+z', '-z'],
  });
  b.box(raw, bw + 0.3, 0.12, bd + 0.3, bx, H0 + bh + 0.06, bz);
  const doorM = mat4(bx + bw / 2 + 0.01, H0 + 1.0, bz, 0, Math.PI / 2);
  b.quad(
    rust,
    V(-0.45, -1, 0),
    V(0.45, -1, 0),
    V(0.45, 1, 0),
    V(-0.45, 1, 0),
    V(0, 0, 1),
    {
      m: doorM,
      uv: [
        [0, 0],
        [0.9, 0],
        [0.9, 2],
        [0, 2],
      ],
    },
  );
  // Бак на раме — если крыша достаточно большая.
  if (b.W >= 12 && b.D >= 9 && b.R() < 0.7) {
    const tx = b.rr(0.5, W2 - 2.2),
      tz = b.rr(-D2 + 2, 0),
      legH = 1.8,
      tr = 1.0,
      th = 2.0;
    for (const [lx, lz] of [
      [-0.75, -0.75],
      [0.75, -0.75],
      [-0.75, 0.75],
      [0.75, 0.75],
    ])
      b.box(steel, 0.09, legH, 0.09, tx + lx, H0 + legH / 2, tz + lz, {
        faces: ['+x', '-x', '+z', '-z'],
      });
    for (const [a, c] of [
      [
        [-0.75, -0.75],
        [0.75, -0.75],
      ],
      [
        [-0.75, 0.75],
        [0.75, 0.75],
      ],
      [
        [-0.75, -0.75],
        [-0.75, 0.75],
      ],
      [
        [0.75, -0.75],
        [0.75, 0.75],
      ],
    ]) {
      const ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
      b.box(
        steel,
        1.6,
        0.08,
        0.08,
        tx + (a[0] + c[0]) / 2,
        H0 + legH - 0.04,
        tz + (a[1] + c[1]) / 2,
        { rot: [0, -ang, 0] },
      );
    }
    b.cyl(rust, tr, tr, th, 14, tx, H0 + legH + th / 2, tz);
    b.cyl(rust, 0.2, tr + 0.04, 0.3, 14, tx, H0 + legH + th + 0.15, tz, {
      open: true,
    });
  }
  // Кондиционеры, вентиляционные трубы, антенна.
  const nAc = 1 + Math.floor(b.R() * 3);
  for (let i = 0; i < nAc; i++) {
    const x = b.rr(-W2 + 1.5, W2 - 2.5),
      z = b.rr(-D2 + 1.2, D2 - 1.5);
    if (Math.abs(x - bx) < bw / 2 + 0.8 && Math.abs(z - bz) < bd / 2 + 0.8)
      continue;
    const m = mat4(x, H0 + 0.4, z, 0, b.R() * Math.PI, 0);
    b.box(metal, 0.9, 0.72, 0.36, 0, 0, 0, {
      m,
      faces: ['+x', '-x', '+y', '+z', '-z'],
      keep: true,
    });
    b.cyl(b.M.dark, 0.28, 0.28, 0.02, 12, 0, 0.02, 0.19, {
      m,
      rot: [Math.PI / 2, 0, 0],
    });
  }
  for (let i = 0; i < 2; i++)
    b.cyl(
      rust,
      0.12,
      0.12,
      0.8,
      8,
      b.rr(-W2 + 1, W2 - 1.5),
      H0 + 0.4,
      b.rr(-D2 + 1, D2 - 1),
      { open: true },
    );
  const ax = -W2 + 0.8,
    az = D2 - 0.8;
  b.cyl(steel, 0.02, 0.025, 4.0, 6, ax, H0 + 2.0, az, { open: true });
  for (let i = 0; i < 3; i++)
    b.box(steel, 1.2 - i * 0.25, 0.02, 0.02, ax, H0 + 3.8 - i * 0.3, az, {
      rot: [0, 0.4, 0],
    });
}

/** Настенный кондиционер (локальные координаты фасада, висит снаружи на кронштейнах). */
function acUnit(b: Build, f: Facade, x: number, y: number) {
  const metal = b.M.metal;
  const steel = b.M.steel;
  const m = f.m.clone().multiply(mat4(x, y, 0.2));
  b.box(metal, 0.85, 0.6, 0.3, 0, 0, 0, {
    m,
    faces: ['+x', '-x', '+y', '-y', '+z'],
    keep: true,
  });
  b.cyl(b.M.dark, 0.24, 0.24, 0.02, 12, 0, 0.02, 0.16, {
    m,
    rot: [Math.PI / 2, 0, 0],
  });
  for (const bx of [-0.3, 0.3]) {
    b.box(steel, 0.05, 0.05, 0.4, bx, -0.33, -0.05, {
      m,
      faces: ['+x', '-x', '-y'],
    });
    b.box(steel, 0.05, 0.4, 0.05, bx, -0.5, -0.18, {
      m,
      faces: ['+x', '-x', '+z'],
    });
  }
}

function drainpipe(b: Build, f: Facade, x: number) {
  const rust = b.M.rust;
  const h = b.H0 - 0.25;
  b.cyl(rust, 0.055, 0.055, h, 6, x, 0.25 + h / 2, 0.12, {
    m: f.m,
    open: true,
  });
  b.cyl(rust, 0.05, 0.06, 0.45, 6, x, 0.22, 0.28, {
    m: f.m,
    open: true,
    rot: [0.6, 0, 0],
  });
}

/** Офис: бетонные пояса между этажами и ленточное остекление с импостами. */
function buildOffice(b: Build, ws: WallSets) {
  const { H0 } = b;
  const spandrel = ws.face;
  const mullion = b.M.steel;
  const dark = b.M.dark;
  const glass = b.glass();
  const broken: { f: Facade; r: Rect }[] = [];
  for (const f of b.facades) {
    const L2 = f.L / 2;
    const pier = 1.0;
    const nSeg = Math.max(1, Math.round((f.L - 2 * pier) / 10));
    const segW = (f.L - 2 * pier - (nSeg - 1) * pier) / nSeg;
    const holes: Rect[] = [];
    const units: (() => void)[] = [];
    const entBay = f.side === 'front' ? Math.floor(nSeg / 2) : -1;
    for (let k = 0; k < b.floors; k++) {
      const fl = k * FLOOR_H;
      for (let s = 0; s < nSeg; s++) {
        const x0 = -L2 + pier + s * (segW + pier),
          x1 = x0 + segW;
        if (k === 0 && s === entBay) {
          // Вход: стеклянный тамбур и козырёк вместо куска ленты.
          const cx = (x0 + x1) / 2;
          const dw = Math.min(2.4, segW - 1);
          const dr = { x0: cx - dw / 2, y0: 0, x1: cx + dw / 2, y1: 2.6 };
          holes.push(dr);
          units.push(() => {
            b.rectZ(dark, dr, -WT + 0.02, f.m);
            b.rectZ(glass, dr, -0.12, f.m);
            b.rectZ(
              mullion,
              { x0: cx - 0.04, y0: 0, x1: cx + 0.04, y1: 2.6 },
              -0.1,
              f.m,
            );
            b.box(b.M.raw, dw + 1.6, 0.18, 1.6, cx, 2.95, 0.75, {
              m: f.m,
              faces: ['+y', '-y', '+z', '+x', '-x'],
            });
          });
          const sides: Rect[] = [];
          if (dr.x0 - x0 > 1.2)
            sides.push({ x0, y0: 0.4, x1: dr.x0 - 0.3, y1: 2.6 });
          if (x1 - dr.x1 > 1.2)
            sides.push({ x0: dr.x1 + 0.3, y0: 0.4, x1, y1: 2.6 });
          for (const r of sides) {
            holes.push(r);
            units.push(() => ribbon(b, f, r, glass, mullion, dark, broken));
          }
          continue;
        }
        const r = {
          x0,
          y0: fl + (k === 0 ? 0.9 : 1.0),
          x1,
          y1: fl + FLOOR_H - 0.25,
        };
        if (b.cut) {
          // Лента в разломе укорачивается до его края.
          if (f.side === 'front')
            r.x1 = Math.min(r.x1, polyMinX(b.cut.front, r.y0, r.y1) - 0.5);
          if (f.side === 'right')
            r.x0 = Math.max(
              r.x0,
              -polyMinX(
                b.cut.right.map(([x, y]) => [-x, y]),
                r.y0,
                r.y1,
              ) + 0.5,
            );
          if (r.x1 - r.x0 < 1.2) continue;
        }
        holes.push(r);
        units.push(() => ribbon(b, f, r, glass, mullion, dark, broken));
      }
    }
    b.wall(f, b.outline(f, H0), holes, spandrel, ws.core);
    for (const u of units) u();
    // Цоколь из тёмного бетона.
    b.box(b.M.raw, f.L + 0.1, 0.5, 0.05, 0, 0.25, 0.025, {
      m: f.m,
      faces: ['+z', '+y', '+x', '-x'],
      color: DARK,
    });
  }
  for (const w of broken)
    if (b.R() < (b.ruin ? 0.4 : 0.1)) b.sootAbove(w.f, w.r);
  parapetAndRoof(b, 0.6, 0.25, b.M.roof, b.M.concrete);
  rooftopOffice(b);
  if (b.ruin) collapse(b, ws);
}

/** Лента остекления: стёкла между импостами, часть выбита. */
function ribbon(
  b: Build,
  f: Facade,
  r: Rect,
  glass: string,
  mullion: string,
  dark: string,
  broken: { f: Facade; r: Rect }[],
) {
  const n = Math.max(1, Math.round((r.x1 - r.x0) / 1.5));
  const pw = (r.x1 - r.x0) / n;
  b.rectZ(dark, r, -WT + 0.02, f.m);
  for (let i = 0; i <= n; i++) {
    const x = r.x0 + pw * i;
    b.rectZ(
      mullion,
      { x0: x - 0.04, y0: r.y0, x1: x + 0.04, y1: r.y1 },
      -0.1,
      f.m,
    );
  }
  b.rectZ(
    mullion,
    { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y0 + 0.06 },
    -0.1,
    f.m,
  );
  b.rectZ(
    mullion,
    { x0: r.x0, y0: r.y1 - 0.06, x1: r.x1, y1: r.y1 },
    -0.1,
    f.m,
  );
  for (let i = 0; i < n; i++) {
    const pr = {
      x0: r.x0 + pw * i + 0.04,
      y0: r.y0 + 0.06,
      x1: r.x0 + pw * (i + 1) - 0.04,
      y1: r.y1 - 0.06,
    };
    const rnd = b.R();
    if (rnd < (b.ruin ? 0.45 : 0.1)) {
      broken.push({ f, r: pr });
      continue;
    }
    b.rectZ(glass, pr, -0.12, f.m);
  }
}

function rooftopOffice(b: Build) {
  const { W2, D2, H0 } = b;
  const metal = b.M.metal;
  const steel = b.M.steel;
  const n = 1 + Math.floor(b.R() * 3);
  for (let i = 0; i < n; i++) {
    const sx = b.rr(1.6, 2.8),
      sz = b.rr(1.2, 2.0),
      sy = b.rr(1.0, 1.6);
    const x = b.rr(-W2 + 1.5 + sx / 2, W2 - 2.5 - sx / 2),
      z = b.rr(-D2 + 1.2 + sz / 2, 0);
    b.box(metal, sx, sy, sz, x, H0 + sy / 2, z, {
      faces: ['+x', '-x', '+y', '+z', '-z'],
    });
    b.box(steel, sx * 0.6, 0.15, 0.6, x, H0 + sy + 0.07, z, {
      faces: ['+x', '-x', '+y', '+z', '-z'],
    });
  }
  // Машинное помещение лифта.
  if (b.W >= 12) {
    const bw = 3.0,
      bd = 2.6,
      bh = 2.8;
    const bx = -W2 + 1.5 + bw / 2,
      bz = D2 - 1.5 - bd / 2;
    b.box(b.M.raw, bw, bh, bd, bx, H0 + bh / 2, bz, {
      faces: ['+x', '-x', '+z', '-z'],
      color: LIGHT,
    });
    b.box(b.M.concrete, bw + 0.3, 0.12, bd + 0.3, bx, H0 + bh + 0.06, bz);
  }
  b.cyl(steel, 0.02, 0.025, 3.5, 6, W2 - 1.2, H0 + 1.75, -D2 + 1.2, {
    open: true,
  });
}

/** Частный дом: окна, дверь с крыльцом, двускатная крыша с трубой. */
function buildHouse(b: Build, ws: WallSets) {
  const { W2, D2, H0, W, D } = b;
  const broken: { f: Facade; r: Rect }[] = [];
  const alongX = W >= D;
  const roofSet = b.pick([
    'roofingtiles012a',
    'roofingtiles012a',
    'corrugatedsteel005',
  ] as const);
  const roof = b.pbr(
    roofSet,
    roofSet === 'corrugatedsteel005'
      ? {
          color: b.pick([0x6f7572, 0x7d6c5c, 0x5f6a66]),
          roughness: 0.7,
          metalness: 0.35,
        }
      : { color: b.pick([0xffffff, 0xb9a89a, 0x8c7f78]) },
  );
  const trim = b.M.planks;
  const ridge = H0 + ROOF_H.house,
    over = 0.45;
  for (const f of b.facades) {
    const bays = b.bays(f.L, 3.0, 1.2);
    const doorBay = f.side === 'front' ? Math.floor(bays.length / 2) : -1;
    const holes: Rect[] = [];
    const units: (() => void)[] = [];
    for (let k = 0; k < b.floors; k++) {
      const fl = k * FLOOR_H;
      bays.forEach((bx, i) => {
        if (i === doorBay && k === 0) {
          const r = { x0: bx - 0.5, y0: 0, x1: bx + 0.5, y1: 2.2 };
          holes.push(r);
          units.push(() => {
            b.door(f, r);
            porch(b, f, bx);
          });
          return;
        }
        if (b.R() < 0.12) return;
        const r: Rect = {
          x0: bx - WIN_W / 2,
          y0: fl + 0.9,
          x1: bx + WIN_W / 2,
          y1: fl + 0.9 + WIN_H,
          sill: true,
        };
        if (!b.clear(f, r)) return;
        holes.push(r);
        const kind = b.pickKind(k);
        units.push(() => {
          b.window(f, r, kind);
          if (kind === 'broken') broken.push({ f, r });
        });
      });
    }
    // Фронтон — на торцах (перпендикулярно коньку), стена доходит до конька.
    const gable = alongX
      ? f.side === 'right' || f.side === 'left'
      : f.side === 'front' || f.side === 'back';
    b.wall(
      f,
      b.outline(f, H0, gable ? ridge : undefined),
      holes,
      ws.face,
      ws.core,
    );
    for (const u of units) u();
    b.box(b.M.raw, f.L + 0.1, 0.45, 0.05, 0, 0.225, 0.025, {
      m: f.m,
      faces: ['+z', '+y', '+x', '-x'],
      color: DARK,
    });
  }
  for (const w of broken)
    if (b.R() < (b.ruin ? 0.4 : 0.1)) b.sootAbove(w.f, w.r);
  gableRoof(b, {
    ridge,
    over,
    roof,
    under: b.M.under,
    fascia: trim,
    ridgeKey: b.M.under,
    ridgeW: 0.26,
  });
  // Труба.
  const cx = alongX ? b.rr(-W2 + 1.5, b.cut ? 0 : W2 - 1.5) : b.rr(-0.6, 0.6),
    cz = alongX ? b.rr(-0.6, 0.6) : b.rr(-D2 + 1.5, D2 - 1.5);
  b.box(b.M.brick, 0.6, 1.6, 0.6, cx, ridge - 0.2, cz, {
    faces: ['+x', '-x', '+z', '-z'],
    color: LIGHT,
  });
  b.box(b.M.concrete, 0.7, 0.08, 0.7, cx, ridge + 0.64, cz);
  if (b.ruin) collapse(b, ws);
}

/**
 * Двускатная крыша: конёк вдоль длинной стороны, два ската с UV в метрах по скату,
 * подшивка снизу и лобовая доска. У руины скат над обрушенным углом (+x,+z) укорочен.
 */
function gableRoof(
  b: Build,
  o: {
    ridge: number;
    over: number;
    roof: string;
    under: string;
    fascia?: string;
    ridgeKey: string;
    ridgeW: number;
  },
) {
  const { W2, D2, H0 } = b;
  const alongX = b.W >= b.D;
  // Локальная система: x вдоль конька, z поперёк; при коньке вдоль z поворот на π/2
  // отображает локальный x в мировой −z, локальный z — в мировой +x.
  const m = alongX ? mat4(0, 0, 0) : mat4(0, 0, 0, 0, Math.PI / 2);
  const half = alongX ? D2 : W2;
  const len = (alongX ? W2 : D2) + o.over;
  const eaveY = H0 - 0.05;
  const slopeLen = Math.hypot(half + o.over, o.ridge - eaveY);
  let rx0 = -len,
    rx1 = len;
  for (const sign of [1, -1]) {
    let x0 = -len,
      x1 = len;
    if (b.cut) {
      // Мировой угол +x,+z: при коньке вдоль x это конец +x ската +z (локальный sign > 0);
      // при коньке вдоль z — начало −x (мировой +z) ската локального +z (мировой +x).
      const keep = alongX ? b.W2 - b.cut.cw * 0.8 : b.D2 - b.cut.cd * 0.8;
      if (sign > 0) {
        if (alongX) x1 = keep;
        else x0 = -keep;
        rx0 = x0;
        rx1 = x1;
        // Над провалом остались голые стропила.
        const th = Math.atan2(o.ridge - eaveY, sign * (half + o.over));
        for (
          let x = alongX ? x1 + 0.5 : x0 - 0.5;
          alongX ? x < len - 0.3 : x > -len + 0.3;
          x += alongX ? 0.9 : -0.9
        )
          b.box(
            b.M.planks,
            0.08,
            0.16,
            slopeLen - 0.1,
            x,
            (eaveY + o.ridge) / 2,
            (sign * (half + o.over)) / 2,
            { m, rot: [th, 0, 0], color: DARK },
          );
      }
    }
    const zo = sign * (half + o.over);
    const a = V(x0, eaveY, zo),
      c = V(x1, eaveY, zo),
      d = V(x1, o.ridge, 0),
      e = V(x0, o.ridge, 0);
    const uv: [Vec2, Vec2, Vec2, Vec2] = [
      [x0, 0],
      [x1, 0],
      [x1, slopeLen],
      [x0, slopeLen],
    ];
    b.quad(o.roof, a, c, d, e, V(0, 1, sign), { m, uv });
    b.quad(o.under, a, c, d, e, V(0, -1, -sign), { m, uv });
    if (o.fascia)
      b.box(
        o.fascia,
        x1 - x0,
        0.2,
        0.04,
        (x0 + x1) / 2,
        eaveY - 0.02,
        zo + sign * 0.02,
        { m, keep: true, faces: [sign > 0 ? '+z' : '-z', '-y'] },
      );
  }
  b.box(
    o.ridgeKey,
    rx1 - rx0,
    0.1,
    o.ridgeW,
    (rx0 + rx1) / 2,
    o.ridge + 0.03,
    0,
    { m },
  );
}

/** Крыльцо: ступени и козырёк на двух столбиках. */
function porch(b: Build, f: Facade, cx: number) {
  const concrete = b.M.concrete;
  const wood = b.M.planks;
  b.box(concrete, 2.2, 0.3, 1.2, cx, 0.15, 0.6, {
    m: f.m,
    faces: ['+y', '+z', '+x', '-x'],
  });
  b.box(concrete, 2.2, 0.15, 0.34, cx, 0.075, 1.2 + 0.17, {
    m: f.m,
    faces: ['+y', '+z', '+x', '-x'],
  });
  const cy = 2.5,
    cd = 1.4;
  const m = f.m.clone().multiply(mat4(cx, cy, cd / 2 - 0.05, -0.2, 0, 0));
  b.box(wood, 2.6, 0.08, cd, 0, 0, 0, { m, keep: true });
  for (const px of [-1.1, 1.1])
    b.box(wood, 0.12, cy - 0.3, 0.12, cx + px, 0.3 + (cy - 0.3) / 2, cd - 0.3, {
      m: f.m,
      faces: ['+x', '-x', '+z', '-z'],
    });
}

/** Ангар: профнастил на бетонном цоколе, пилястры, ворота, верхние окна, пологий скат. */
function buildIndustrial(b: Build, ws: WallSets) {
  const { W2, D2, H0, W, D } = b;
  const concrete = b.M.raw;
  const pil = b.M.concrete;
  const metal = b.M.metal;
  const steel = b.M.steel;
  const broken: { f: Facade; r: Rect }[] = [];
  const alongX = W >= D;
  const ridge = H0 + ROOF_H.industrial;
  const plinthH = 1.2;
  for (const f of b.facades) {
    const L2 = f.L / 2;
    const holes: Rect[] = [];
    const units: (() => void)[] = [];
    const bays = b.bays(f.L, 3.4, 1.4);
    // Верхние окна под карнизом.
    const wy = H0 - 1.9;
    for (const bx of bays) {
      const r = { x0: bx - 0.8, y0: wy, x1: bx + 0.8, y1: wy + 0.95 };
      if (!b.clear(f, r) || b.R() < 0.15) continue;
      holes.push(r);
      const kind = b.pickKind(1);
      units.push(() => {
        b.window(f, r, kind, { sill: false, cross: false });
        if (kind === 'broken') broken.push({ f, r });
      });
    }
    if (f.side === 'front') {
      // Ворота и калитка рядом.
      const gw = Math.min(4.2, f.L * 0.35),
        gh = Math.min(4.0, H0 - 0.6);
      const gx =
        -L2 + 1.2 + gw / 2 + (f.L > 12 ? b.rr(0, f.L - 2.4 - gw - 2) : 0);
      const g = { x0: gx - gw / 2, y0: 0, x1: gx + gw / 2, y1: gh };
      holes.push(g);
      units.push(() => {
        const lift = b.ruin || b.R() < 0.4 ? b.rr(0.4, 1.8) : 0;
        b.rectZ(b.M.dark, g, -WT + 0.02, f.m);
        if (lift < gh - 0.3)
          b.rectZ(
            b.M.corr,
            { x0: g.x0, y0: g.y0 + lift, x1: g.x1, y1: g.y1 },
            -0.12,
            f.m,
            true,
            [0, 0.3],
          );
        b.box(steel, gw + 0.3, 0.3, 0.2, gx, gh + 0.15, -0.05, {
          m: f.m,
          faces: ['+z', '-y', '+x', '-x'],
        });
      });
      const dx = g.x1 + 1.2;
      if (dx + 0.5 < L2 - 0.6) {
        const dr = { x0: dx - 0.5, y0: 0, x1: dx + 0.5, y1: 2.2 };
        holes.push(dr);
        units.push(() => b.door(f, dr));
      }
    }
    // Фронтоны у торцов под пологим скатом.
    const gable = alongX
      ? f.side === 'right' || f.side === 'left'
      : f.side === 'front' || f.side === 'back';
    b.wall(
      f,
      b.outline(f, H0, gable ? ridge : undefined),
      holes,
      ws.face,
      ws.core,
    );
    for (const u of units) u();
    b.box(concrete, f.L + 0.16, plinthH, 0.08, 0, plinthH / 2, 0.04, {
      m: f.m,
      faces: ['+z', '+y', '+x', '-x'],
    });
    // Пилястры между окнами.
    const nP = Math.max(2, Math.round(f.L / 5.5));
    for (let i = 0; i <= nP; i++) {
      const x = -L2 + (f.L * i) / nP;
      if (b.cut && f.side === 'front' && x > polyMinX(b.cut.front, 0, H0) - 0.4)
        continue;
      if (
        b.cut &&
        f.side === 'right' &&
        x <
          -polyMinX(
            b.cut.right.map(([px, py]) => [-px, py]),
            0,
            H0,
          ) +
            0.4
      )
        continue;
      b.box(
        pil,
        0.45,
        H0 - 0.1,
        0.22,
        Math.max(-L2 + 0.25, Math.min(L2 - 0.25, x)),
        (H0 - 0.1) / 2,
        0.11,
        { m: f.m, faces: ['+z', '+x', '-x'] },
      );
    }
  }
  for (const w of broken) if (b.R() < 0.3) b.sootAbove(w.f, w.r);
  // Пологая кровля из профнастила с небольшим свесом.
  gableRoof(b, {
    ridge,
    over: 0.3,
    roof: b.M.corr,
    under: b.M.under,
    ridgeKey: steel,
    ridgeW: 0.3,
  });
  for (let i = 0; i < 3; i++)
    b.cyl(
      metal,
      0.25,
      0.25,
      0.9,
      8,
      b.rr(-W2 + 2, b.cut ? 0 : W2 - 2),
      H0 + 0.9,
      b.rr(-D2 + 2, D2 - 2),
      { open: true },
    );
  if (b.ruin) collapse(b, ws);
}

/** Обрушенный угол (+x,+z): перекрытия с рваным краем, комнаты, арматура, щебень. */
function collapse(b: Build, ws: WallSets) {
  const { W2, D2, H0 } = b;
  if (!b.cut) return;
  const { cw, cd } = b.cut;
  const raw = b.M.raw;
  const rebar = b.M.rust;
  const chunk = b.M.chunk;
  const brickChunk = b.M.brick;
  const paints = [0x8e8878, 0x93a688, 0xb7a87e, 0x8a97a6].map(rgb);
  const dark = b.M.dark;
  const grey = (): [number, number, number] => {
    const g = b.rr(0.65, 1);
    return [g, g, g];
  };
  // Обнажённая зона: чуть глубже самого разлома, чтобы перекрытия были видны сквозь него.
  const x0 = Math.max(-W2 + 1, W2 - cw - 2.0),
    z0 = Math.max(-D2 + 1, D2 - cd - 2.5);
  const x1 = W2 - 0.05,
    z1 = D2 - 0.05;
  const slabT = 0.24;
  const slabPlans: { pts: Vec2[]; y: number }[] = [];
  // У ангара перекрытий нет — только пол; у дома верхняя плита — чердачный пол.
  const floorsExposed = b.base === 'industrial' ? 0 : b.floors;
  for (let k = 1; k <= floorsExposed; k++) {
    const y = k * FLOOR_H;
    const t = k / b.floors;
    const ca = cw * (0.25 + 0.6 * t),
      cb = cd * (0.25 + 0.6 * t);
    const pts: Vec2[] = [
      [x0, z0],
      [x1, z0],
      [x1, z1 - cb],
    ];
    const n = 6;
    for (let i = 1; i < n; i++) {
      const s = i / n;
      pts.push([
        x1 + (x1 - ca - x1) * s + b.rr(-0.25, 0.25),
        z1 - cb + cb * s + b.rr(-0.25, 0.25),
      ]);
    }
    pts.push([x1 - ca, z1], [x0, z1]);
    if (k === b.floors && b.base !== 'house' && b.base !== 'industrial')
      continue; // крышу режет parapetAndRoof
    b.plan(raw, pts, y, slabT);
    slabPlans.push({ pts, y });
  }
  // Арматура и обломки на рваных краях.
  for (const s of slabPlans) {
    const cut = s.pts.filter(
      ([x, z]) => x > x1 - cw - 0.5 && z > z1 - cd - 0.5,
    );
    for (let i = 0; i < cut.length - 1; i++) {
      const [ax, az] = cut[i],
        [bx, bz] = cut[i + 1];
      if (b.R() < 0.5) continue;
      const t = b.R(),
        px = ax + (bx - ax) * t,
        pz = az + (bz - az) * t;
      const dir = Math.atan2(pz - (z1 - cd), px - (x1 - cw)) + b.rr(-0.5, 0.5);
      b.box(
        rebar,
        0.9,
        0.026,
        0.026,
        px + Math.cos(dir) * 0.3,
        s.y - 0.1,
        pz + Math.sin(dir) * 0.3,
        {
          rot: [0, -dir, b.rr(-0.6, -0.2)],
          faces: ['+x', '+y', '-y', '+z', '-z'],
        },
      );
      if (b.R() < 0.5)
        b.box(
          b.R() < 0.6 ? chunk : brickChunk,
          b.rr(0.2, 0.5),
          b.rr(0.1, 0.25),
          b.rr(0.2, 0.45),
          px - Math.cos(dir) * 0.3,
          s.y + 0.08,
          pz - Math.sin(dir) * 0.3,
          {
            rot: [b.rr(-0.3, 0.3), b.R() * 6.28, b.rr(-0.3, 0.3)],
            jitter: true,
            color: grey(),
          },
        );
    }
  }
  // Комнаты: перегородки с разной краской по этажам, тёмный дверной проём, обломки на полу.
  for (let k = 0; k < (b.base === 'industrial' ? 1 : b.floors); k++) {
    const y0 = k * FLOOR_H,
      y1 = b.base === 'industrial' ? H0 - 0.1 : (k + 1) * FLOOR_H - slabT,
      h = y1 - y0,
      yc = (y0 + y1) / 2;
    const paint = paints[k % 4];
    b.box(b.M.paint, x1 - x0, h, 0.16, (x0 + x1) / 2, yc, z0 + 0.08, {
      faces: ['+z', '-z', '+x'],
      color: paint,
    });
    b.box(b.M.paint, 0.16, h, z1 - z0, x0 + 0.08, yc, (z0 + z1) / 2, {
      faces: ['+x', '-x', '+z'],
      color: paint,
    });
    b.quad(
      dark,
      V(x0 + 1.2, y0, z0 + 0.165),
      V(x0 + 2.1, y0, z0 + 0.165),
      V(x0 + 2.1, y0 + 2.05, z0 + 0.165),
      V(x0 + 1.2, y0 + 2.05, z0 + 0.165),
      V(0, 0, 1),
    );
    if (k >= 1 && x1 - x0 > 3)
      b.box(
        b.M.paint,
        0.12,
        h,
        Math.min(2.2, z1 - z0 - 1),
        x0 + Math.min(3.5, (x1 - x0) * 0.6),
        yc,
        z0 + 1.2,
        { faces: ['+x', '-x', '+z'], color: paints[(k + 1) % 4] },
      );
    for (let i = 0; i < 3; i++) {
      const sx = b.rr(0.15, 0.5),
        sy = b.rr(0.06, 0.2),
        sz = b.rr(0.15, 0.45);
      b.box(
        b.R() < 0.6 ? chunk : brickChunk,
        sx,
        sy,
        sz,
        b.rr(x0 + 0.5, x1 - 0.3),
        y0 + sy / 2,
        b.rr(z0 + 0.5, z1 - 0.3),
        { rot: [0, b.R() * 6.28, 0], jitter: true, color: grey() },
      );
    }
  }
  // Щебень: холм у угла по шуму и обломки на нём.
  const rx = cw + 1.6 + b.floors * 0.1,
    rz = cd + 1.8 + b.floors * 0.1;
  const cx = W2 + 0.3,
    cz = D2 + 0.5;
  const hash = (ix: number, iy: number) => {
    let h = (ix * 374761393 + iy * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  const vn = (x: number, y: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      tx = fade(x - ix),
      ty = fade(y - iy);
    const a = hash(ix, iy),
      c = hash(ix + 1, iy),
      d = hash(ix, iy + 1),
      e = hash(ix + 1, iy + 1);
    return (a + (c - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
  };
  const fbm = (x: number, y: number, o: number) => {
    let s = 0,
      a = 1,
      n = 0;
    for (let i = 0; i < o; i++) {
      s += a * vn(x, y);
      n += a;
      a *= 0.5;
      x = x * 2 + 17.3;
      y = y * 2 + 9.1;
    }
    return s / n;
  };
  const seedOff = (b.p.seed % 97) * 3.1;
  const mound = (x: number, z: number) => {
    const dx = (x - cx) / rx,
      dz = (z - cz) / rz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= 1) return 0;
    const dome = Math.pow(1 - d2, 1.1) * Math.min(2.2, 1.0 + b.floors * 0.25);
    const n = fbm(x * 0.5 + 3 + seedOff, z * 0.5 + 7, 3) - 0.5;
    const fine = fbm(x * 2.4 + seedOff, z * 2.4, 2) - 0.5;
    return Math.max(0, dome * (0.8 + 0.7 * n) + 0.3 * fine * Math.min(1, dome));
  };
  {
    const N = 14;
    const g = new T.PlaneGeometry(2 * rx, 2 * rz, N, N);
    g.rotateX(-Math.PI / 2);
    g.translate(cx, 0, cz);
    const p = g.attributes.position,
      uv = g.attributes.uv;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i);
      p.setY(i, mound(x, z) - 0.03);
      uv.setXY(i, x, z);
      // Внизу холм темнее и землистее (пыль и грунт), наверху — светлый бетонный лом.
      const h = Math.min(1, mound(x, z) / 1.2);
      const c = (0.45 + 0.5 * h) * (0.8 + 0.4 * fbm(x * 1.7, z * 1.7, 2));
      col.set([c, c * (0.9 + 0.08 * h), c * (0.82 + 0.14 * h)], i * 3);
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.computeVertexNormals();
    b.acc.add(b.M.chunk, g, undefined, { uv: 'keep' });
  }
  const nChunks = 40 + b.floors * 5;
  for (let i = 0; i < nChunks; i++) {
    const a = b.R() * Math.PI * 2,
      rad = Math.sqrt(b.R());
    const x = cx + Math.cos(a) * rad * rx,
      z = cz + Math.sin(a) * rad * rz;
    const big = b.R() < 0.15;
    const sx = big ? b.rr(0.8, 1.6) : b.rr(0.18, 0.7),
      sy = big ? b.rr(0.18, 0.3) : b.rr(0.1, 0.35),
      sz = big ? b.rr(0.6, 1.2) : b.rr(0.18, 0.6);
    const h = mound(x, z);
    const r = b.R();
    const key = r < 0.5 ? chunk : r < 0.8 ? brickChunk : ws.face;
    b.box(key, sx, sy, sz, x, h + sy * 0.25, z, {
      rot: [b.rr(-0.5, 0.5), b.R() * 6.28, b.rr(-0.5, 0.5)],
      jitter: true,
      color: grey(),
    });
  }
  for (let i = 0; i < 8; i++) {
    const a = b.R() * Math.PI * 2,
      rad = Math.sqrt(b.R()) * 0.9;
    const x = cx + Math.cos(a) * rad * rx,
      z = cz + Math.sin(a) * rad * rz;
    b.box(rebar, b.rr(0.6, 1.3), 0.026, 0.026, x, mound(x, z) + 0.1, z, {
      rot: [0, b.R() * 6.28, b.rr(-0.9, -0.2)],
      faces: ['+x', '+y', '-y', '+z', '-z'],
    });
  }
}

/**
 * Геометрия здания по id: части в метрах (центр x/z = 0, низ y = 0), по одной
 * слитой геометрии на материал. Неизвестный id → undefined.
 */
export function buildProcBuilding(
  id: string,
  textures: TextureSetLoader,
):
  | { geometries: { geometry: T.BufferGeometry; material: T.Material }[] }
  | undefined {
  const p = parseProcBuilding(id);
  if (!p) return undefined;
  const b = new Build(p, textures);
  if (b.ruin) b.makeCut();
  const ws = wallSets(b);
  switch (b.base) {
    case 'apt':
      buildApt(b, ws);
      break;
    case 'office':
      buildOffice(b, ws);
      break;
    case 'house':
      buildHouse(b, ws);
      break;
    case 'industrial':
      buildIndustrial(b, ws);
      break;
  }
  return { geometries: b.acc.finish() };
}
