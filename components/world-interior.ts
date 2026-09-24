import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ArenaDef, MapBox, MapCylinder, MapDecor } from '@/lib/maps/types';
import {
  breakerTexture,
  ceilingGlowTexture,
  ceilingTexture,
  crateTexture,
  fabricTexture,
  FLOOR_TILE,
  floorTexture,
  glowTexture,
  grilleTexture,
  hazardTexture,
  holoMapTexture,
  metalTexture,
  monitorTexture,
  rackTexture,
  scannerTexture,
  screenTexture,
  signTexture,
  starfieldTexture,
  vendingTexture,
  wallGlowTexture,
  wallTexture,
  type FloorKind,
} from './world-interior-textures';
import {
  animateSpace,
  createSpaceWindowMaterial,
  createSunPatchMaterial,
  createSunShaftMaterial,
  sunbeamGeometry,
} from './world-space';

/**
 * Интерьер помещений по меткам `art` из ArenaDef: вместо цветной коробки или цилиндра
 * рисуется модель с текстурами в тех же габаритах (коллизия остаётся за коробкой), плюс
 * декор без коллизии — двери, окна, трубы, щитки. Детали склеиваются по материалам,
 * так что на весь корабль выходит несколько десятков вызовов отрисовки.
 */

const WALL_TILE = 2.4;
const CEILING_TILE = 4;
const WALL_HEIGHT = 3.2;
const FLOORS = new Set(Object.keys(FLOOR_TILE));
const BOX_MODELS = new Set(['wall', 'floor', 'console', 'panel', 'vent', 'crate', 'shelf', 'holo-table', 'bed', 'cannon', 'rack', 'security-desk', 'vending', 'planter']);
const CYLINDER_MODELS = new Set(['meeting-table', 'emergency-button', 'cafe-table', 'engine', 'reactor-core', 'scanner']);

const family = (art?: string) => art?.split(':')[0] ?? '';

/** Рисует ли интерьер эту коробку или цилиндр сам (тогда сцена пропускает простую фигуру). */
export const interiorDraws = (shape: MapBox | MapCylinder) =>
  'w' in shape ? BOX_MODELS.has(family(shape.art)) : CYLINDER_MODELS.has(family(shape.art));

export function createInterior(def: ArenaDef) {
  const textures: T.Texture[] = [];
  const keep = <X extends T.Texture>(t: X) => {
    textures.push(t);
    return t;
  };
  const cache = new Map<string, T.MeshStandardMaterial>();
  const material = (key: string, make: () => T.MeshStandardMaterial) => {
    let m = cache.get(key);
    if (!m) {
      m = make();
      cache.set(key, m);
    }
    return m;
  };
  const once = new Map<string, T.Texture>();
  const tex = (key: string, make: () => T.Texture) => {
    let t = once.get(key);
    if (!t) {
      t = keep(make());
      once.set(key, t);
    }
    return t;
  };

  // --- Материалы ---
  const metal = (color: string, roughness = 0.45, metalness = 0.55) =>
    material(`metal:${color}:${roughness}`, () =>
      new T.MeshStandardMaterial({ color, map: tex('metal', metalTexture), roughness, metalness }),
    );
  const dark = () => metal('#3a414b', 0.55, 0.5);
  const steel = () => metal('#9ba4ae', 0.38, 0.65);
  const plain = (color: string, roughness = 0.8) =>
    material(`plain:${color}:${roughness}`, () => new T.MeshStandardMaterial({ color, roughness }));
  const glow = (color: string, intensity = 1.6) =>
    material(`glow:${color}`, () => new T.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: intensity }));
  /** Экран: картинка светится сама, освещение на неё почти не влияет. */
  const screen = (key: string, make: () => T.Texture, intensity = 1.1) =>
    material(`screen:${key}`, () => {
      const map = tex(`screen:${key}`, make);
      return new T.MeshStandardMaterial({ color: '#222222', map, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: intensity, roughness: 0.25, metalness: 0.1 });
    });
  const crate = () =>
    material('crate', () => new T.MeshStandardMaterial({ map: tex('crate', crateTexture), roughness: 0.85 }));
  const sheet = () =>
    material('sheet', () => new T.MeshStandardMaterial({ map: tex('sheet', () => fabricTexture('#eef2f3')), roughness: 0.95 }));
  const hazard = () =>
    material('hazard', () => new T.MeshStandardMaterial({ map: tex('hazard', hazardTexture), roughness: 0.7 }));
  const wall = material('wall', () => {
    const map = keep(wallTexture());
    return new T.MeshStandardMaterial({
      map,
      bumpMap: map,
      bumpScale: 0.6,
      roughness: 0.62,
      metalness: 0.2,
      emissive: '#cfe8ff',
      emissiveMap: keep(wallGlowTexture()),
      emissiveIntensity: 0.9,
    });
  });
  const ceiling = material('ceiling', () =>
    new T.MeshStandardMaterial({
      map: keep(ceilingTexture()),
      roughness: 0.7,
      metalness: 0.2,
      emissive: '#fff4e0',
      emissiveMap: keep(ceilingGlowTexture()),
      emissiveIntensity: 1.4,
    }),
  );
  const floor = (kind: FloorKind, tint: string) =>
    material(`floor:${kind}:${tint}`, () => {
      const map = tex(`floor:${kind}`, () => floorTexture(kind));
      const shiny = kind === 'tile' || kind === 'medical';
      return new T.MeshStandardMaterial({
        color: new T.Color(tint).lerp(new T.Color('#ffffff'), 0.55),
        map,
        bumpMap: map,
        bumpScale: kind === 'grate' || kind === 'plate' ? 1.2 : 0.15,
        roughness: shiny ? 0.35 : kind === 'carpet' ? 0.95 : 0.6,
        metalness: kind === 'plate' || kind === 'grate' || kind === 'panel' ? 0.45 : 0.05,
      });
    });

  // --- Сборка: детали копятся по материалам и склеиваются в конце ---
  const parts = new Map<T.Material, T.BufferGeometry[]>();
  const worldUV = new Map<T.Material, (g: T.BufferGeometry) => void>();
  const base = new T.Matrix4(),
    local = new T.Matrix4(),
    euler = new T.Euler(),
    quat = new T.Quaternion(),
    one = new T.Vector3(1, 1, 1),
    at = new T.Vector3();
  const place = (x: number, y: number, z: number, yaw = 0) =>
    base.compose(at.set(x, y, z), quat.setFromEuler(euler.set(0, yaw, 0)), one);
  const put = (geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    local.compose(at.set(x, y, z), quat.setFromEuler(euler.set(rx, ry, rz)), one);
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.applyMatrix4(local.premultiply(base));
    const list = parts.get(mat) ?? [];
    list.push(g);
    parts.set(mat, list);
  };
  const box = (mat: T.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    put(new T.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  const cyl = (mat: T.Material, rTop: number, rBottom: number, h: number, x: number, y: number, z: number, sides = 20, rx = 0, rz = 0) =>
    put(new T.CylinderGeometry(rTop, rBottom, h, sides), mat, x, y, z, rx, 0, rz);
  /** Плоскость лицом к +z (поворот `rx` наклоняет её). */
  const plane = (mat: T.Material, w: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0) =>
    put(new T.PlaneGeometry(w, h), mat, x, y, z, rx, ry);

  // --- Стены и полы: UV по мировым координатам, чтобы рисунок шёл без швов ---
  worldUV.set(wall, (g) => {
    const p = g.getAttribute('position'),
      n = g.getAttribute('normal'),
      uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const top = Math.abs(n.getY(i)) > 0.5,
        alongZ = Math.abs(n.getX(i)) > 0.5;
      uv[i * 2] = (alongZ ? p.getZ(i) : p.getX(i)) / WALL_TILE;
      uv[i * 2 + 1] = top ? 0.99 : p.getY(i) / WALL_HEIGHT;
    }
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  });
  const floorUV = (tile: number) => (g: T.BufferGeometry) => {
    const p = g.getAttribute('position'),
      uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = p.getX(i) / tile;
      uv[i * 2 + 1] = -p.getZ(i) / tile;
    }
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  };
  worldUV.set(ceiling, floorUV(CEILING_TILE));

  // --- Модели на месте коробок. Начало координат — пол под центром, перед смотрит в +z ---
  const accent = { console: '#58d0ff', panel: '#ff4040' };
  const buildBox = (b: MapBox) => {
    const [kind, variant] = (b.art ?? '').split(':');
    const yaw = b.yaw ?? 0;
    const turned = Math.abs(Math.sin(yaw)) > 0.5;
    const w = turned ? b.d : b.w,
      d = turned ? b.w : b.d,
      h = b.h;
    place(b.x, b.y - b.h / 2, b.z, yaw);
    switch (kind) {
      case 'wall': {
        place(0, 0, 0);
        box(wall, b.w, b.h, b.d, b.x, b.y, b.z);
        break;
      }
      case 'floor': {
        const surface = (FLOORS.has(variant) ? variant : 'panel') as FloorKind;
        const mat = floor(surface, b.color);
        worldUV.set(mat, floorUV(FLOOR_TILE[surface]));
        place(0, 0, 0);
        box(mat, b.w, b.h, b.d, b.x, b.y, b.z);
        // Потолок смотрит только вниз: сверху (камера над стенами) его не видно.
        if (def.indoor) plane(ceiling, b.w, b.d, b.x, WALL_HEIGHT, b.z, Math.PI / 2);
        break;
      }
      case 'console':
      case 'panel': {
        const sabotage = kind === 'panel';
        const body = metal(b.color, 0.5, 0.45);
        box(body, w, 0.78, d, 0, 0.39, 0);
        box(dark(), w - 0.08, 0.08, d - 0.1, 0, 0.04, 0.02);
        const tilt = 0.5;
        box(body, w, 0.07, d * 0.8, 0, 0.83, 0.02, tilt);
        plane(screen(`${kind}:${variant}`, () => screenTexture(`${kind}:${variant}`)), w * 0.78, d * 0.56, 0, 0.83 + 0.04 * Math.cos(tilt), 0.02 + 0.04 * Math.sin(tilt), -Math.PI / 2 + tilt);
        box(body, w, 0.3, 0.12, 0, 0.95, -d / 2 + 0.06);
        box(glow(sabotage ? accent.panel : accent.console), w * 0.9, 0.035, 0.02, 0, 0.7, d / 2 + 0.005);
        for (let i = 0; i < 4; i++)
          box(glow(['#43f08f', '#ffcf33', '#39b6ff', '#ff5a5a'][(i + variant.length) % 4], 1.2), 0.06, 0.03, 0.06, -w / 2 + 0.2 + i * 0.12, 1.1, -d / 2 + 0.06);
        if (sabotage) box(hazard(), w, 0.12, 0.02, 0, 0.2, d / 2 + 0.01);
        break;
      }
      case 'vent': {
        box(dark(), w, h, d, 0, h / 2, 0);
        plane(material('grille', () => new T.MeshStandardMaterial({ map: tex('grille', grilleTexture), roughness: 0.6, metalness: 0.5 })), w - 0.02, d - 0.02, 0, h + 0.003, 0, -Math.PI / 2);
        break;
      }
      case 'crate': {
        box(crate(), w, h, d, 0, h / 2, 0);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(dark(), 0.07, h + 0.01, 0.07, sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02));
        break;
      }
      case 'shelf': {
        const frame = steel();
        for (const sx of [-1, 1]) box(frame, 0.06, h, d, sx * (w / 2 - 0.03), h / 2, 0);
        box(dark(), w, h, 0.03, 0, h / 2, -d / 2 + 0.015);
        const bins = ['#3d6fb6', '#d9822b', '#6a7480', '#4f9a4a'];
        for (let i = 0; i < 4; i++) {
          const y = 0.1 + i * 0.68;
          box(frame, w, 0.05, d, 0, y, 0);
          if (i === 3) continue;
          for (let k = 0; k < 4; k++) {
            const bw = 0.45 + ((i * 7 + k * 3) % 4) * 0.06,
              bh = 0.3 + ((i + k) % 3) * 0.08;
            const mat = (i + k) % 3 === 0 ? crate() : metal(bins[(i + k * 2) % bins.length], 0.6, 0.2);
            box(mat, bw, bh, d * 0.7, -w / 2 + 0.4 + k * 0.72, y + 0.025 + bh / 2, 0.02);
          }
        }
        break;
      }
      case 'holo-table': {
        box(dark(), w - 0.4, h - 0.12, d - 0.4, 0, (h - 0.12) / 2, 0);
        box(steel(), w, 0.12, d, 0, h - 0.06, 0);
        plane(screen('holo', () => holoMapTexture(def.zones ?? [], def.bounds), 1.4), w - 0.2, d - 0.2, 0, h + 0.004, 0, -Math.PI / 2);
        box(glow('#39b6ff', 1.2), w, 0.03, d, 0, h - 0.14, 0);
        break;
      }
      case 'bed': {
        const frame = steel();
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(dark(), 0.04, 0.04, 0.3, sx * (w / 2 - 0.08), 0.15, sz * (d / 2 - 0.1), 8);
        box(frame, w, 0.12, d, 0, 0.36, 0);
        box(sheet(), w - 0.08, 0.16, d - 0.1, 0, 0.5, 0);
        box(material('blanket', () => new T.MeshStandardMaterial({ map: tex('blanket', () => fabricTexture('#3f8f9c', '#2c6c76')), roughness: 0.95 })), w - 0.02, 0.06, d * 0.58, 0, 0.6, d * 0.2);
        box(sheet(), w - 0.4, 0.1, 0.36, 0, 0.63, -d / 2 + 0.3);
        box(frame, w, 0.75, 0.06, 0, 0.55, -d / 2 + 0.03);
        box(glow('#56ffaa', 1), w * 0.5, 0.04, 0.01, 0, 0.8, -d / 2 + 0.065);
        break;
      }
      case 'cannon': {
        cyl(dark(), 0.85, 0.95, 0.4, 0, 0.2, 0, 24);
        cyl(hazard(), 0.87, 0.87, 0.08, 0, 0.36, 0, 24);
        cyl(steel(), 0.6, 0.7, 0.5, 0, 0.65, 0, 20);
        box(metal('#6f7a88'), 1.2, 0.6, 1.0, 0, 1.15, -0.1);
        for (const sx of [-0.28, 0.28]) {
          cyl(dark(), 0.09, 0.12, 1.3, sx, 1.15, 0.9, 12, Math.PI / 2);
          cyl(glow('#ff7a3d', 1.4), 0.07, 0.07, 0.02, sx, 1.15, 1.56, 12, Math.PI / 2);
        }
        box(glow('#ff4040', 1.2), 0.3, 0.08, 0.02, 0, 1.3, 0.41);
        break;
      }
      case 'rack': {
        box(dark(), w, h, d, 0, h / 2, 0);
        plane(screen('rack', rackTexture, 1.3), w - 0.12, h - 0.16, 0, h / 2, d / 2 + 0.004);
        box(steel(), w + 0.02, 0.05, d + 0.02, 0, h - 0.025, 0);
        break;
      }
      case 'security-desk': {
        box(steel(), w, 0.07, d, 0, h - 0.035, 0);
        for (const sx of [-1, 1]) box(dark(), 0.08, h - 0.07, d - 0.1, sx * (w / 2 - 0.1), (h - 0.07) / 2, 0);
        box(dark(), w - 0.2, 0.55, 0.05, 0, 0.5, -d / 2 + 0.12);
        box(dark(), 0.5, 0.03, 0.18, 0, h + 0.015, 0.22);
        [-0.95, 0, 0.95].forEach((x, i) => {
          const turn = -x * 0.25;
          box(dark(), 0.06, 0.25, 0.06, x, h + 0.12, -0.2);
          box(dark(), 0.82, 0.52, 0.05, x, h + 0.5, -0.18, 0, turn);
          plane(screen(`cam:${i}`, () => monitorTexture(2), 1.2), 0.76, 0.46, x + Math.sin(turn) * 0.03, h + 0.5, -0.18 + Math.cos(turn) * 0.03, 0, turn);
        });
        break;
      }
      case 'vending': {
        const snack = variant === 'snack';
        box(metal(snack ? '#2f5f9e' : '#b3313a', 0.4, 0.3), w, h, d, 0, h / 2, 0);
        plane(screen(snack ? 'vending:snack' : 'vending', () => vendingTexture(snack), 0.55), w - 0.02, h - 0.02, 0, h / 2, d / 2 + 0.004);
        break;
      }
      case 'planter': {
        box(metal('#5d6b5a', 0.6, 0.3), w, 0.5, d, 0, 0.25, 0);
        box(plain('#3b2a1c', 1), w - 0.1, 0.04, d - 0.1, 0, 0.5, 0);
        const leaf = [plain('#4f9a4a', 0.7), plain('#6cbf5a', 0.7), plain('#3f7f3c', 0.7)];
        for (let i = 0; i < 7; i++) {
          const x = -w / 2 + 0.2 + i * ((w - 0.4) / 6),
            z = ((i * 37) % 5) * 0.1 - 0.2,
            s = 0.18 + ((i * 13) % 4) * 0.04;
          cyl(plain('#3d6b2f'), 0.015, 0.02, 0.35, x, 0.65, z, 6);
          put(new T.IcosahedronGeometry(s, 0), leaf[i % 3], x, 0.8 + s * 0.6, z, i, i * 0.7);
        }
        for (const sx of [-1, 1]) box(steel(), 0.04, 1.5, 0.04, sx * (w / 2 - 0.05), 1.25, -d / 2 + 0.05);
        box(dark(), w, 0.06, 0.2, 0, 2, -d / 2 + 0.1);
        box(glow('#d77bff', 1.6), w - 0.1, 0.02, 0.12, 0, 1.965, -d / 2 + 0.1);
        break;
      }
    }
  };

  const buildCylinder = (c: MapCylinder) => {
    const kind = family(c.art);
    place(c.x, c.y - c.h / 2, c.z);
    const { r, h } = c;
    switch (kind) {
      case 'meeting-table': {
        cyl(dark(), 0.45, 0.7, h - 0.1, 0, (h - 0.1) / 2, 0, 20);
        cyl(metal(c.color, 0.35, 0.4), r, r, 0.1, 0, h - 0.05, 0, 40);
        cyl(steel(), r + 0.03, r + 0.03, 0.05, 0, h - 0.11, 0, 40);
        cyl(glow('#58d0ff', 1), r + 0.035, r + 0.035, 0.015, 0, h - 0.09, 0, 40);
        break;
      }
      case 'emergency-button': {
        cyl(dark(), 0.38, 0.42, 0.08, 0, 0.04, 0, 20);
        cyl(hazard(), 0.39, 0.39, 0.02, 0, 0.09, 0, 20);
        cyl(glow('#ff2a2a', 0.9), 0.22, 0.25, 0.1, 0, 0.14, 0, 20);
        put(new T.SphereGeometry(0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), glow('#ff2a2a', 0.9), 0, 0.19, 0);
        put(
          new T.SphereGeometry(0.34, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
          material('glass-dome', () => new T.MeshStandardMaterial({ color: '#cfefff', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false })),
          0,
          0.1,
          0,
        );
        break;
      }
      case 'cafe-table': {
        cyl(dark(), 0.12, 0.35, h - 0.06, 0, (h - 0.06) / 2, 0, 16);
        cyl(metal(c.color, 0.35, 0.35), r * 0.72, r * 0.72, 0.06, 0, h - 0.03, 0, 32);
        cyl(steel(), r * 0.72 + 0.02, r * 0.72 + 0.02, 0.03, 0, h - 0.075, 0, 32);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.3,
            x = Math.sin(a) * (r - 0.22),
            z = Math.cos(a) * (r - 0.22);
          cyl(steel(), 0.03, 0.05, 0.42, x, 0.21, z, 8);
          cyl(metal('#3d7ea6', 0.5, 0.2), 0.2, 0.2, 0.07, x, 0.45, z, 16);
        }
        break;
      }
      case 'engine': {
        box(dark(), r * 1.9, 0.3, r * 1.6, 0, 0.15, 0);
        const body = metal('#8a7466', 0.45, 0.6),
          radius = h / 2 - 0.1;
        cyl(body, radius, radius, r * 1.5, 0.2, h / 2 + 0.05, 0, 28, 0, Math.PI / 2);
        for (let i = 0; i < 4; i++) cyl(steel(), radius + 0.05, radius + 0.05, 0.1, -0.6 + i * 0.55, h / 2 + 0.05, 0, 28, 0, Math.PI / 2);
        const front = 0.2 + r * 0.75;
        cyl(dark(), radius * 0.85, radius * 0.85, 0.08, front + 0.03, h / 2 + 0.05, 0, 28, 0, Math.PI / 2);
        cyl(steel(), radius * 0.4, radius * 0.4, 0.12, front + 0.06, h / 2 + 0.05, 0, 20, 0, Math.PI / 2);
        cyl(glow('#ff8a3d', 1.4), radius * 0.25, radius * 0.25, 0.02, front + 0.13, h / 2 + 0.05, 0, 20, 0, Math.PI / 2);
        cyl(dark(), radius * 0.7, radius, 0.5, -r * 0.75 - 0.05, h / 2 + 0.05, 0, 24, 0, Math.PI / 2);
        cyl(material('engine-glow', () => {
          const map = tex('engine-glow', () => glowTexture('#ffd27a', '#ff5a1f'));
          return new T.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 1.8 });
        }), radius * 0.6, radius * 0.6, 0.02, -r * 0.75 - 0.31, h / 2 + 0.05, 0, 24, 0, Math.PI / 2);
        for (const z of [-0.5, 0.5]) cyl(metal('#9c6b45', 0.4, 0.7), 0.08, 0.08, r * 1.6, 0, h - 0.05, z, 10, 0, Math.PI / 2);
        break;
      }
      case 'reactor-core': {
        cyl(dark(), r, r * 1.05, 0.3, 0, 0.15, 0, 24);
        cyl(dark(), r * 0.9, r, 0.3, 0, h - 0.15, 0, 24);
        cyl(hazard(), r * 1.06, r * 1.06, 0.06, 0, 0.33, 0, 24);
        cyl(reactorGlow, r * 0.42, r * 0.42, h - 0.6, 0, h / 2, 0, 20);
        cyl(material('glass', () => new T.MeshStandardMaterial({ color: '#9fe9ff', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.3, depthWrite: false })), r * 0.7, r * 0.7, h - 0.6, 0, h / 2, 0, 24);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          box(steel(), 0.1, h - 0.6, 0.1, Math.sin(a) * r * 0.82, h / 2, Math.cos(a) * r * 0.82);
        }
        for (const y of [0.9, h - 0.9]) cyl(steel(), r * 0.74, r * 0.74, 0.06, 0, y, 0, 24);
        break;
      }
      case 'scanner': {
        cyl(dark(), r, r + 0.05, h, 0, h / 2, 0, 28);
        put(new T.CircleGeometry(r - 0.06, 32), scannerMat, 0, h + 0.003, 0, -Math.PI / 2);
        break;
      }
    }
  };
  const reactorGlow = material('reactor', () => {
    const map = tex('reactor', () => glowTexture('#9ff4ff', '#1f8fff'));
    return new T.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 1.6 });
  });
  const scannerMat = material('scanner', () => {
    const map = tex('scanner', scannerTexture);
    return new T.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 1.3 });
  });

  // --- Иллюминаторы: стекло с космосом и солнечные лучи сквозь него (components/world-space.ts) ---
  let spaceWindow: T.ShaderMaterial | null = null;
  const shaftMaterial = createSunShaftMaterial();
  const patchMaterials = new Map<number, T.ShaderMaterial>();
  // Лучи и пятна строятся сразу в мировых координатах, поэтому копятся отдельно от `parts`.
  const shafts: T.BufferGeometry[] = [];
  const patches = new Map<number, T.BufferGeometry[]>();

  // --- Декор без коллизии. Начало — на оси стены, перед смотрит от стены ---
  const FACE = 0.15;
  const buildDecor = (dc: MapDecor, index: number) => {
    place(dc.x, dc.y, dc.z, dc.yaw);
    const { w, h } = dc;
    switch (dc.kind) {
      case 'door': {
        const frame = steel();
        box(dark(), w, WALL_HEIGHT - h, 0.36, 0, (WALL_HEIGHT + h) / 2, 0);
        box(hazard(), w - 0.3, 0.12, 0.4, 0, h + 0.06, 0);
        for (const sx of [-1, 1]) {
          box(frame, 0.22, h, 0.44, sx * (w / 2 - 0.04), h / 2, 0);
          box(glow('#43f08f', 1.4), 0.05, 0.22, 0.02, sx * (w / 2 + 0.2), 2.2, FACE + 0.01);
        }
        box(hazard(), w - 0.3, 0.02, 0.3, 0, 0.03, 0);
        if (dc.label) {
          const label = dc.label;
          plane(screen(`sign:${label}`, () => signTexture(label), 0.7), 1.9, 0.36, 0, 2.93, 0.185);
        }
        break;
      }
      case 'window': {
        const frame = steel();
        // Внутри корабля за окном настоящий космос; на других картах окно — прежняя картинка.
        if (def.indoor) {
          spaceWindow ??= createSpaceWindowMaterial();
          plane(spaceWindow, w, h, 0, 0, FACE + 0.012);
        } else plane(screen('stars', starfieldTexture, 0.9), w, h, 0, 0, FACE + 0.012);
        // Толстая скруглённая рама с болтами: большой иллюминатор, а не щель в стене.
        for (const sy of [-1, 1]) box(frame, w + 0.36, 0.18, 0.2, 0, sy * (h / 2 + 0.09), FACE + 0.07);
        for (const sx of [-1, 1]) box(frame, 0.18, h + 0.36, 0.2, sx * (w / 2 + 0.09), 0, FACE + 0.07);
        for (const sx of [-1, 1])
          for (const sy of [-1, 1]) cyl(dark(), 0.06, 0.06, 0.04, sx * (w / 2 + 0.09), sy * (h / 2 + 0.09), FACE + 0.18, 10, Math.PI / 2);
        const bars = Math.max(0, Math.floor(w / 1.8));
        for (let i = 1; i <= bars; i++) box(frame, 0.07, h, 0.1, -w / 2 + (i * w) / (bars + 1), 0, FACE + 0.05);
        box(dark(), w + 0.5, 0.08, 0.32, 0, -h / 2 - 0.2, FACE + 0.14);
        if (def.indoor) {
          const normal = new T.Vector3(Math.sin(dc.yaw ?? 0), 0, Math.cos(dc.yaw ?? 0));
          const right = new T.Vector3(Math.cos(dc.yaw ?? 0), 0, -Math.sin(dc.yaw ?? 0));
          const center = new T.Vector3(dc.x, dc.y, dc.z).addScaledVector(normal, FACE + 0.02);
          const beam = sunbeamGeometry(center, normal, right, w, h, bars);
          if (beam) {
            shafts.push(beam.shaft);
            const list = patches.get(bars) ?? [];
            list.push(beam.patch);
            patches.set(bars, list);
          }
        }
        break;
      }
      case 'pipes': {
        cyl(metal('#9c6b45', 0.4, 0.7), 0.09, 0.09, w, 0, 0, FACE + 0.14, 12, 0, Math.PI / 2);
        cyl(steel(), 0.055, 0.055, w, 0, 0.16, FACE + 0.36, 10, 0, Math.PI / 2);
        for (let x = -w / 2 + 0.5; x < w / 2; x += 2) box(dark(), 0.06, 0.34, 0.46, x, 0.06, FACE + 0.23);
        break;
      }
      case 'breaker': {
        box(dark(), w + 0.06, h + 0.06, 0.1, 0, 0, FACE + 0.05);
        plane(material('breaker', () => new T.MeshStandardMaterial({ map: tex('breaker', breakerTexture), roughness: 0.6, metalness: 0.3 })), w, h, 0, 0, FACE + 0.102);
        break;
      }
      case 'wall-screen': {
        box(dark(), w + 0.1, h + 0.1, 0.08, 0, 0, FACE + 0.04);
        plane(screen(`monitor:${index % 3}`, () => monitorTexture(index % 3), 1.2), w, h, 0, 0, FACE + 0.083);
        break;
      }
    }
  };

  for (const b of def.boxes) if (interiorDraws(b)) buildBox(b);
  for (const c of def.cylinders ?? []) if (interiorDraws(c)) buildCylinder(c);
  (def.decor ?? []).forEach(buildDecor);

  const group = new T.Group();
  group.name = 'interior';
  // Свет солнца: отдельные меши, помеченные как «только картинка» — пакеты ресурсов их не
  // перекрашивают, камера о них не спотыкается, теней они не бросают.
  const sunMesh = (geos: T.BufferGeometry[], mat: T.Material) => {
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    const mesh = new T.Mesh(merged, mat);
    mesh.userData.presentationOnly = true;
    mesh.userData.noCameraCollision = true;
    // После всего мира (иначе пол, нарисованный позже, закрыл бы пятно), но до предмета в руках.
    mesh.renderOrder = 990;
    group.add(mesh);
  };
  if (shafts.length) sunMesh(shafts, shaftMaterial);
  for (const [bars, geos] of patches) {
    const mat = createSunPatchMaterial(bars);
    patchMaterials.set(bars, mat);
    sunMesh(geos, mat);
  }
  for (const [mat, geos] of parts) {
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    worldUV.get(mat)?.(merged);
    const mesh = new T.Mesh(merged, mat);
    const m = mat as T.MeshStandardMaterial;
    if (mat === spaceWindow) {
      // Стекло с космосом светится само: тени ему не нужны, а пакет ресурсов не должен его заменить.
      mesh.userData.presentationOnly = true;
      group.add(mesh);
      continue;
    }
    mesh.castShadow = !m.transparent && m !== wall && m !== ceiling && !(m.emissiveMap && m.color.getHex() === 0);
    mesh.receiveShadow = true;
    // Стекло камеру не держит; потолок и дверные притолоки держат, чтобы камера третьего
    // лица оставалась в отсеке, а не смотрела на табличку из-за стены.
    if (m.transparent) mesh.userData.noCameraCollision = true;
    group.add(mesh);
  }
  const screens = [...cache.entries()].filter(([key]) => key.startsWith('screen:')).map(([, m]) => m);
  const reactorMap = reactorGlow.emissiveMap;

  return {
    group,
    animate(time: number) {
      animateSpace(spaceWindow ? [spaceWindow, shaftMaterial] : [shaftMaterial], time);
      reactorGlow.emissiveIntensity = 1.5 + Math.sin(time * 2.2) * 0.4;
      if (reactorMap) reactorMap.offset.y = (time * 0.25) % 1;
      scannerMat.emissiveIntensity = 1.1 + Math.sin(time * 4) * 0.35;
      const flicker = 1 + Math.sin(time * 13) * Math.sin(time * 7.3) * 0.04;
      for (const m of screens) m.userData.base ??= m.emissiveIntensity;
      for (const m of screens) m.emissiveIntensity = (m.userData.base as number) * flicker;
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      cache.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      spaceWindow?.dispose();
      shaftMaterial.dispose();
      patchMaterials.forEach((m) => m.dispose());
    },
  };
}
