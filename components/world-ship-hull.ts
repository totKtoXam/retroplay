import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HullModule, MapBox, MapDecor } from '@/lib/maps/types';
import { hullTexture } from './world-interior-textures.ts';
import { SPACE_SUN } from './world-space.ts';

/*
 * Внешний корпус корабля (карта «Корабль», режим «Предатель»). Корабль — станция из модулей:
 * каждый отсек и коридор (`ArenaDef.hull`) снаружи обшит бронёй — стены, крыша, днище, — а
 * иллюминаторы сквозные. Из окна видны соседние отсеки, переходы между ними, двигатели,
 * антенны и купола, и всё это честно смещается, когда идёшь вдоль окна.
 *
 * Корпус освещает только солнце за бортом (SPACE_SUN — то же, что светит в окна), лампы
 * отсеков и общий свет корабля на него не действуют: снаружи — космос, теневая сторона почти
 * чёрная. Шейдер свой и простой: освещённость по солнцу, блик, слабый отсвет газового гиганта.
 * Корпус — только картинка: не сталкивается, не держит камеру, пакеты ресурсов его не трогают.
 */

const WALL_H = 3.2;
const WALL_T = 0.3;
/** Обшивка на 2 см снаружи стены: не спорит с ней за глубину. */
const SKIN = WALL_T / 2 + 0.02;
/** Толщина крыши и днища отсека; у коридоров тоньше — переходы ниже отсеков. */
const SLAB = { room: 0.55, corridor: 0.32 };
const TILE = 4;
const CELL = 0.5;

type Glow = 'engine' | 'red' | 'green' | 'white' | 'cyan';

const HULL_VERTEX = /* glsl */ `
#include <fog_pars_vertex>
attribute vec3 color;
varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vColor = color;
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const HULL_FRAGMENT = /* glsl */ `
#include <fog_pars_fragment>
uniform sampler2D map;
uniform vec3 uSun;
varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec3 albedo = texture2D(map, vUv).rgb * vColor;
  vec3 n = normalize(vNormalW);
  float ndl = max(dot(n, uSun), 0.0);
  vec3 view = normalize(cameraPosition - vWorld);
  vec3 h = normalize(uSun + view);
  float spec = pow(max(dot(n, h), 0.0), 48.0) * 0.45 * ndl;
  // Без солнца броня не чёрная дыра: слабый свет звёзд и тёплый отсвет газового гиганта с юга.
  vec3 ambient = vec3(0.03, 0.035, 0.05) + vec3(0.07, 0.05, 0.03) * max(dot(n, normalize(vec3(-0.28, -0.04, 0.96))), 0.0);
  vec3 col = albedo * (ambient + vec3(2.1, 1.95, 1.75) * ndl) + spec * vec3(1.0, 0.95, 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function hullMaterial(map: T.Texture) {
  const material = new T.ShaderMaterial({
    uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { map: { value: null }, uSun: { value: SPACE_SUN.clone() } }]),
    vertexShader: HULL_VERTEX,
    fragmentShader: HULL_FRAGMENT,
    fog: true,
    // Раструбы двигателей открыты: изнутри их тоже видно.
    side: T.DoubleSide,
  });
  material.uniforms.map.value = map;
  material.name = 'ship-hull';
  return material;
}

/** UV по мировым координатам: листы обшивки идут без швов через все детали. */
function worldUv(g: T.BufferGeometry) {
  const p = g.getAttribute('position'),
    n = g.getAttribute('normal'),
    uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)),
      ny = Math.abs(n.getY(i));
    const u = ny > 0.5 ? p.getX(i) : nx > 0.5 ? p.getZ(i) : p.getX(i);
    const v = ny > 0.5 ? p.getZ(i) : p.getY(i);
    uv[i * 2] = u / TILE;
    uv[i * 2 + 1] = v / TILE;
  }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
}

export function createShipHull(modules: HullModule[], walls: MapBox[], windows: MapDecor[]) {
  const texture = hullTexture();
  const armor = hullMaterial(texture);
  const glows: Record<Glow, T.MeshBasicMaterial> = {
    engine: new T.MeshBasicMaterial({ color: new T.Color('#7fd8ff').multiplyScalar(2.2) }),
    red: new T.MeshBasicMaterial({ color: new T.Color('#ff3b3b').multiplyScalar(2.5) }),
    green: new T.MeshBasicMaterial({ color: new T.Color('#3bff7a').multiplyScalar(2.5) }),
    white: new T.MeshBasicMaterial({ color: new T.Color('#ffffff').multiplyScalar(2.5) }),
    cyan: new T.MeshBasicMaterial({ color: new T.Color('#5ef2ff').multiplyScalar(1.8), transparent: true, opacity: 0.85 }),
  };
  const armorParts: T.BufferGeometry[] = [];
  const glowParts = new Map<Glow, T.BufferGeometry[]>();
  const color = new T.Color();

  /** Деталь брони: в мировых координатах, с оттенком `tint` (множитель текстуры). */
  const plate = (geo: T.BufferGeometry, matrix: T.Matrix4, tint = '#ffffff') => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    color.set(tint);
    const c = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < c.length; i += 3) c.set([color.r, color.g, color.b], i);
    g.setAttribute('color', new T.BufferAttribute(c, 3));
    worldUv(g);
    armorParts.push(g);
  };
  const light = (geo: T.BufferGeometry, matrix: T.Matrix4, kind: Glow) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    const list = glowParts.get(kind) ?? [];
    list.push(g);
    glowParts.set(kind, list);
  };
  const m = new T.Matrix4(),
    q = new T.Quaternion(),
    e = new T.Euler(),
    one = new T.Vector3(1, 1, 1);
  const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = one) =>
    m.clone().compose(new T.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, tint?: string) =>
    plate(new T.BoxGeometry(w, h, d), at(x, y, z), tint);

  const inside = (x: number, z: number) => modules.find((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
  const slab = (r: HullModule | undefined) => (r?.kind === 'corridor' ? SLAB.corridor : SLAB.room);

  // --- Стены снаружи: обшивка с проёмами окон ---
  const up = new T.Vector3(0, 1, 0);
  for (const b of walls) {
    const alongX = b.w >= b.d;
    const lo = alongX ? b.x - b.w / 2 : b.z - b.d / 2,
      hi = alongX ? b.x + b.w / 2 : b.z + b.d / 2;
    const point = (a: number) => (alongX ? new T.Vector3(a, 0, b.z) : new T.Vector3(b.x, 0, a));
    // Снаружи — та сторона стены, где нет пола. Длинная стена может менять сторону по пути
    // (коридор примыкает к отсеку со сдвигом), поэтому решаем по клеткам вдоль неё.
    type Run = { a0: number; a1: number; sign: number; owner: HullModule | undefined };
    const runs: Run[] = [];
    for (let a = lo; a < hi - 1e-6; a += CELL) {
      const mid = Math.min(a + CELL / 2, hi);
      const p = point(mid);
      const probe = (s: number) => (alongX ? inside(p.x, p.z + s * 0.4) : inside(p.x + s * 0.4, p.z));
      const plus = probe(1),
        minus = probe(-1);
      const sign = plus && !minus ? -1 : minus && !plus ? 1 : 0;
      if (!sign) continue;
      const owner = plus ?? minus;
      const last = runs[runs.length - 1];
      if (last && last.sign === sign && Math.abs(last.a1 - a) < 1e-6 && last.owner?.kind === owner?.kind) last.a1 = Math.min(a + CELL, hi);
      else runs.push({ a0: a, a1: Math.min(a + CELL, hi), sign, owner });
    }
    for (const run of runs) {
      const n = alongX ? new T.Vector3(0, 0, run.sign) : new T.Vector3(run.sign, 0, 0);
      const right = new T.Vector3().crossVectors(up, n);
      const origin = point((run.a0 + run.a1) / 2).addScaledVector(n, SKIN);
      const basis = new T.Matrix4().makeBasis(right, up, n).setPosition(origin);
      const half = (run.a1 - run.a0) / 2 + (run.a0 <= lo + 1e-6 || run.a1 >= hi - 1e-6 ? 0.03 : 0);
      const top = WALL_H + slab(run.owner),
        bottom = -slab(run.owner);
      const shape = new T.Shape();
      shape.moveTo(-half, bottom);
      shape.lineTo(half, bottom);
      shape.lineTo(half, top);
      shape.lineTo(-half, top);
      shape.closePath();
      for (const w of windows) {
        const onWall = Math.abs(w.x - b.x) <= b.w / 2 + 1e-3 && Math.abs(w.z - b.z) <= b.d / 2 + 1e-3;
        if (!onWall) continue;
        const u = new T.Vector3(w.x, 0, w.z).sub(origin).dot(right);
        if (u - w.w / 2 < -half || u + w.w / 2 > half) continue;
        const hole = new T.Path();
        hole.moveTo(u - w.w / 2, w.y - w.h / 2);
        hole.lineTo(u - w.w / 2, w.y + w.h / 2);
        hole.lineTo(u + w.w / 2, w.y + w.h / 2);
        hole.lineTo(u + w.w / 2, w.y - w.h / 2);
        hole.closePath();
        shape.holes.push(hole);
        // Рама иллюминатора снаружи — толстое кольцо брони вокруг стекла.
        const frame = (fw: number, fh: number, fu: number, fy: number) =>
          plate(new T.BoxGeometry(fw, fh, 0.14), basis.clone().multiply(at(fu, fy, 0.07)), '#c3cad4');
        frame(w.w + 0.36, 0.18, u, w.y + w.h / 2 + 0.09);
        frame(w.w + 0.36, 0.18, u, w.y - w.h / 2 - 0.09);
        frame(0.18, w.h, u - w.w / 2 - 0.09, w.y);
        frame(0.18, w.h, u + w.w / 2 + 0.09, w.y);
      }
      plate(new T.ShapeGeometry(shape), basis);
    }
  }

  // --- Крыши, днища и то, что снаружи на отсеках ---
  for (const r of modules) {
    const t = slab(r);
    const w = r.maxX - r.minX + 2 * (SKIN - 0.01),
      d = r.maxZ - r.minZ + 2 * (SKIN - 0.01);
    const cx = (r.minX + r.maxX) / 2,
      cz = (r.minZ + r.maxZ) / 2;
    const corridor = r.kind === 'corridor';
    // Крыша чуть выше потолка и днище чуть ниже пола: не спорят с ними за глубину.
    box(w, t, d, cx, WALL_H + 0.01 + t / 2, cz, corridor ? '#a9b0ba' : '#ffffff');
    box(w, t, d, cx, -0.01 - t / 2, cz, '#8d949e');
    if (corridor) {
      // Рёбра жёсткости поперёк перехода.
      const alongX = r.maxX - r.minX > r.maxZ - r.minZ;
      const len = alongX ? r.maxX - r.minX : r.maxZ - r.minZ;
      const span = (alongX ? d : w) + 0.16;
      for (let s = 1.2; s < len - 1.1; s += 2.4) {
        const x = alongX ? r.minX + s : cx,
          z = alongX ? cz : r.minZ + s;
        const hgt = WALL_H + 2 * t + 0.1;
        const rib = (rw: number, rh: number, rd: number, y: number) => box(rw, rh, rd, x, y, z, '#6f7680');
        if (alongX) {
          rib(0.22, 0.12, span, WALL_H + t + 0.07);
          rib(0.22, 0.12, span, -t - 0.07);
          for (const sz of [-1, 1]) box(0.22, hgt, 0.12, x, WALL_H / 2, z + (sz * span) / 2, '#6f7680');
        } else {
          rib(span, 0.12, 0.22, WALL_H + t + 0.07);
          rib(span, 0.12, 0.22, -t - 0.07);
          for (const sx of [-1, 1]) box(0.12, hgt, 0.22, x + (sx * span) / 2, WALL_H / 2, z, '#6f7680');
        }
      }
      continue;
    }
    const roof = WALL_H + t;
    // Ходовые огни по углам крыши: красные слева по борту, зелёные справа, белые — на носу и корме.
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const kind: Glow = sx < 0 ? 'red' : 'green';
      light(new T.SphereGeometry(0.09, 10, 8), at(cx + (sx * w) / 2 - sx * 0.25, roof + 0.12, cz + (sz * d) / 2 - sz * 0.25), kind);
      box(0.18, 0.1, 0.18, cx + (sx * w) / 2 - sx * 0.25, roof + 0.05, cz + (sz * d) / 2 - sz * 0.25, '#50565e');
    }
    // Рёбра по краю крыши: силуэт отсека читается и в тени.
    box(w + 0.1, 0.14, 0.14, cx, roof + 0.07, r.minZ - SKIN + 0.07, '#9aa2ad');
    box(w + 0.1, 0.14, 0.14, cx, roof + 0.07, r.maxZ + SKIN - 0.07, '#9aa2ad');
    box(0.14, 0.14, d + 0.1, r.minX - SKIN + 0.07, roof + 0.07, cz, '#9aa2ad');
    box(0.14, 0.14, d + 0.1, r.maxX + SKIN - 0.07, roof + 0.07, cz, '#9aa2ad');
    decorate(r, { cx, cz, w, d, roof });
  }

  /** Что пристроено снаружи к отсеку — по его назначению. */
  function decorate(r: HullModule, s: { cx: number; cz: number; w: number; d: number; roof: number }) {
    const { cx, cz, w, d, roof } = s;
    switch (r.kind) {
      case 'upper-engine':
      case 'lower-engine': {
        // Два маршевых двигателя на корме (запад): кожух, раструб и голубое свечение сопла.
        for (const dz of [-2.8, 2.8]) {
          const z = cz + dz,
            x0 = r.minX - SKIN;
          plate(new T.CylinderGeometry(1.15, 1.15, 1.4, 28), at(x0 - 0.7, 1.6, z, 0, 0, Math.PI / 2), '#8a929c');
          plate(new T.CylinderGeometry(1.0, 1.6, 2.4, 28, 1, true), at(x0 - 2.6, 1.6, z, 0, 0, -Math.PI / 2), '#5d636b');
          light(new T.CircleGeometry(0.95, 28), at(x0 - 1.45, 1.6, z, 0, -Math.PI / 2, 0), 'engine');
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            box(1.4, 0.12, 0.12, x0 - 0.7, 1.6 + Math.sin(a) * 1.17, z + Math.cos(a) * 1.17, '#b7bec8');
          }
        }
        break;
      }
      case 'reactor': {
        // Радиаторы реактора: рёбра на корме, на крыше — купол защиты.
        for (let i = 0; i < 7; i++) box(1.6, 2.6, 0.08, r.minX - SKIN - 0.8, 1.6, r.minZ + 2 + i * ((r.maxZ - r.minZ - 4) / 6), '#7c848f');
        plate(new T.SphereGeometry(2.4, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), at(cx, roof, cz), '#9098a3');
        break;
      }
      case 'comms': {
        // Мачта с тарелкой связи и маячком на верхушке.
        box(0.9, 0.3, 0.9, cx, roof + 0.15, cz, '#6d747e');
        plate(new T.CylinderGeometry(0.09, 0.12, 3.2, 10), at(cx, roof + 1.9, cz), '#b8bfc9');
        plate(new T.SphereGeometry(1.6, 28, 10, 0, Math.PI * 2, 0, 0.9), at(cx, roof + 3.1, cz, -0.9, 0.6, 0), '#d7dde5');
        plate(new T.SphereGeometry(1.58, 28, 10, 0, Math.PI * 2, 0, 0.9), at(cx, roof + 3.09, cz, Math.PI - 0.9, 0.6, 0), '#6d747e');
        light(new T.SphereGeometry(0.1, 10, 8), at(cx, roof + 3.6, cz), 'white');
        break;
      }
      case 'navigation': {
        // Нос корабля (восток): обтекатель с датчиками и штыри антенн.
        plate(new T.SphereGeometry(3.2, 32, 16, 0, Math.PI), at(r.maxX + SKIN - 0.2, 1.6, cz, 0, Math.PI / 2, 0, new T.Vector3(0.75, 0.62, 1)), '#b4bcc6');
        light(new T.SphereGeometry(0.16, 10, 8), at(r.maxX + SKIN + 2.2, 1.6, cz), 'white');
        for (const dz of [-3, 3]) plate(new T.CylinderGeometry(0.05, 0.05, 2.4, 8), at(cx + 2, roof + 1.2, cz + dz), '#c9cfd8');
        break;
      }
      case 'shields': {
        // Излучатели щита: шары на крыше в светящихся кольцах.
        for (const dx of [-3, 3]) {
          plate(new T.CylinderGeometry(0.5, 0.7, 0.6, 18), at(cx + dx, roof + 0.3, cz), '#6d747e');
          plate(new T.SphereGeometry(0.75, 24, 16), at(cx + dx, roof + 1.25, cz), '#dfe5ee');
          light(new T.TorusGeometry(1.05, 0.05, 8, 40), at(cx + dx, roof + 1.25, cz, Math.PI / 2, 0, 0), 'cyan');
        }
        break;
      }
      case 'weapons': {
        // Орудийная башня на крыше.
        plate(new T.CylinderGeometry(1.4, 1.6, 0.7, 24), at(cx, roof + 0.35, cz), '#6d747e');
        box(2.2, 1.0, 1.8, cx, roof + 1.2, cz, '#9aa2ad');
        for (const dx of [-0.45, 0.45]) plate(new T.CylinderGeometry(0.12, 0.14, 3.2, 12), at(cx + dx, roof + 1.3, cz - 2.2, Math.PI / 2 - 0.2, 0, 0), '#50565e');
        break;
      }
      case 'o2': {
        // Баллоны с кислородом на крыше.
        for (let i = 0; i < 3; i++) {
          const z = cz - 2 + i * 2;
          plate(new T.CapsuleGeometry(0.6, 4.2, 6, 18), at(cx, roof + 0.7, z, 0, 0, Math.PI / 2), i === 1 ? '#d7dde5' : '#8ec3b8');
        }
        break;
      }
      case 'cafeteria':
      case 'storage': {
        // Панели солнечных батарей на фермах.
        for (const side of [-1, 1]) {
          const x = cx + side * (w / 4);
          plate(new T.CylinderGeometry(0.1, 0.1, 1.4, 8), at(x, roof + 0.7, cz), '#b8bfc9');
          plate(new T.BoxGeometry(w / 2 - 1.2, 0.06, d - 3), at(x, roof + 1.45, cz, 0.25, 0, 0), '#233a6b');
          box(w / 2 - 1.1, 0.08, 0.12, x, roof + 1.45, cz, '#c9cfd8');
        }
        break;
      }
      default: {
        // Малые отсеки: антенна-штырь и короб теплообменника.
        box(Math.min(3, w / 2), 0.5, Math.min(2, d / 2), cx - w / 5, roof + 0.25, cz, '#7c848f');
        plate(new T.CylinderGeometry(0.04, 0.04, 2.2, 8), at(cx + w / 4, roof + 1.1, cz + d / 5), '#c9cfd8');
        light(new T.SphereGeometry(0.07, 8, 6), at(cx + w / 4, roof + 2.25, cz + d / 5), 'red');
      }
    }
  }

  const group = new T.Group();
  group.name = 'ship-hull';
  const merged = mergeGeometries(armorParts);
  armorParts.forEach((g) => g.dispose());
  if (merged) group.add(new T.Mesh(merged, armor));
  for (const [kind, list] of glowParts) {
    const g = mergeGeometries(list);
    list.forEach((x) => x.dispose());
    if (!g) continue;
    group.add(new T.Mesh(g, glows[kind]));
  }
  group.traverse((o) => {
    // Только картинка: пакеты ресурсов не перекрашивают, камера и выстрелы сквозь неё.
    o.userData.presentationOnly = true;
    o.userData.noCameraCollision = true;
    o.userData.projectileCollision = 'ignore';
    if (o instanceof T.Mesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.raycast = () => {};
    }
  });
  const base = new Map(Object.entries(glows).map(([k, mat]) => [k, mat.color.clone()]));

  return {
    group,
    /** Ходовые огни мигают: красные и зелёные вразнобой, белые — короткой вспышкой. */
    animate(seconds: number) {
      const pulse = (period: number, phase: number, duty: number) => ((seconds + phase) % period) / period < duty;
      glows.red.color.copy(base.get('red')!).multiplyScalar(pulse(1.6, 0, 0.5) ? 1 : 0.15);
      glows.green.color.copy(base.get('green')!).multiplyScalar(pulse(1.6, 0.8, 0.5) ? 1 : 0.15);
      glows.white.color.copy(base.get('white')!).multiplyScalar(pulse(1.1, 0.3, 0.12) ? 1.4 : 0.1);
      glows.engine.color.copy(base.get('engine')!).multiplyScalar(0.9 + Math.sin(seconds * 9) * 0.05 + Math.sin(seconds * 23) * 0.04);
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      armor.dispose();
      Object.values(glows).forEach((mat) => mat.dispose());
      texture.dispose();
    },
  };
}
