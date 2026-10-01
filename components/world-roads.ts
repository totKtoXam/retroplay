import * as T from 'three';
import type { ArenaDef, MapRoad, MapTerrain } from '@/lib/maps/types';
import type { TextureSetLoader } from './world-pbr-textures';

/*
 * Дороги (`ArenaDef.roads`): асфальтовые ленты поверх рельефа. Лента идёт по осевой
 * ломаной, повторяет землю и чуть приподнята над ней; стыки сегментов — митры (по
 * биссектрисе угла), чтобы на изломах не было ни щелей, ни нахлёстов. Разметка и
 * потемневшие кромки — в шейдере, без отдельных текстур.
 */

/** Над землёй, м: ниже — асфальт мерцает сквозь рельеф, выше — видна ступенька. */
const LIFT = 0.06;
/** Каждая следующая дорога ещё чуть выше: на перекрёстке ленты не дерутся за глубину. */
const LIFT_STEP = 0.005;
/** Шаг точек вдоль дороги, м: рельеф идёт квадратами по 5 м, лента должна гнуться вместе с ним. */
const STEP = 2;
/** Узлов поперёк ленты: середина широкой дороги тоже ложится на землю. */
const ACROSS = 5;
/** Один повтор текстуры асфальта — 6 м. */
const TEXTURE_METERS = 6;

/**
 * Высота рельефа ровно такая, как у его меша: квадрат сетки разрезан диагональю
 * (c + 1, r) — (c, r + 1) на два треугольника (components/world-terrain-material.ts).
 * Билинейная высота (`terrainHeightAt`) посреди квадрата от неё отличается, и на
 * выпуклом месте асфальт ушёл бы под землю.
 */
export function terrainMeshHeight(t: MapTerrain, x: number, z: number) {
  const fx = Math.max(0, Math.min(t.cols - 1.0001, (x - t.minX) / t.cell)),
    fz = Math.max(0, Math.min(t.rows - 1.0001, (z - t.minZ) / t.cell));
  const c = Math.floor(fx),
    r = Math.floor(fz);
  const ax = fx - c,
    az = fz - r;
  const i = r * t.cols + c,
    h = t.heights;
  const ha = h[i],
    hb = h[i + 1],
    hc = h[i + t.cols],
    hd = h[i + t.cols + 1];
  return ax + az <= 1
    ? ha + (hb - ha) * ax + (hc - ha) * az
    : hd + (hc - hd) * (1 - ax) + (hb - hd) * (1 - az);
}

/**
 * Точки осевой с шагом не больше STEP; углы ломаной сохраняются (на них митры). У угла
 * точки сегмента ближе `trim[i]` к нему пропускаются: внутренняя кромка там уже позади
 * митры, и лента сложилась бы внутрь себя чёрным треугольником.
 */
function resample(points: [number, number][], trim: number[]) {
  const out: { x: number; z: number; corner: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i],
      [x1, z1] = points[i + 1];
    const length = Math.hypot(x1 - x0, z1 - z0);
    out.push({ x: x0, z: z0, corner: i });
    const from = Math.min(trim[i], length / 2),
      to = Math.max(length - trim[i + 1], length / 2);
    const n = Math.max(1, Math.ceil((to - from) / STEP));
    let previous = 0;
    for (let k = trim[i] > 0 ? 0 : 1; k <= n; k++) {
      const d = from + ((to - from) * k) / n;
      if (d - previous <= 1e-3 || d >= length - 1e-3) continue;
      previous = d;
      out.push({
        x: x0 + ((x1 - x0) * d) / length,
        z: z0 + ((z1 - z0) * d) / length,
        corner: -1,
      });
    }
  }
  const last = points[points.length - 1];
  out.push({ x: last[0], z: last[1], corner: points.length - 1 });
  return out;
}

function roadGeometry(
  road: MapRoad,
  height: (x: number, z: number) => number,
  lift: number,
) {
  // Совпадающие соседние точки дали бы нулевое направление.
  const points = road.points.filter(
    (p, i, all) =>
      i === 0 || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 1e-3,
  );
  if (points.length < 2) return undefined;
  const hw = road.width / 2;
  /** Единичная нормаль (влево) сегмента i. */
  const side = (i: number) => {
    const dx = points[i + 1][0] - points[i][0],
      dz = points[i + 1][1] - points[i][1];
    const l = Math.hypot(dx, dz);
    return [-dz / l, dx / l] as const;
  };
  // Сколько отступить от угла: половина ширины × tg половины угла поворота (с запасом).
  const trim = points.map((_, i) => {
    if (i === 0 || i === points.length - 1) return 0;
    const [ax, az] = side(i - 1),
      [bx, bz] = side(i);
    const turn = Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz)));
    return hw * Math.tan(Math.min(turn, 2.2) / 2) * 1.15;
  });
  const samples = resample(points, trim);
  const positions: number[] = [],
    uvs: number[] = [],
    road3: number[] = [];
  let along = 0;
  let segment = 0;
  samples.forEach((s, j) => {
    if (j > 0)
      along += Math.hypot(s.x - samples[j - 1].x, s.z - samples[j - 1].z);
    if (s.corner >= 0) segment = Math.min(s.corner, points.length - 2);
    let [nx, nz] = side(segment);
    let scale = 1;
    if (s.corner > 0 && s.corner < points.length - 1) {
      // Митра: смещение по биссектрисе, длиннее в 1 / cos(половины угла), чтобы ширина
      // поперёк обоих сегментов осталась прежней. На очень остром углу — не дальше 2,5 ширины.
      const [ax, az] = side(s.corner - 1);
      const mx = ax + nx,
        mz = az + nz;
      const ml = Math.hypot(mx, mz);
      if (ml > 1e-4) {
        const cos = (mx / ml) * nx + (mz / ml) * nz;
        nx = mx / ml;
        nz = mz / ml;
        scale = Math.min(2.5, 1 / Math.max(0.2, cos));
      }
    }
    for (let k = 0; k < ACROSS; k++) {
      const across = (k / (ACROSS - 1)) * 2 - 1;
      const x = s.x + nx * hw * across * scale,
        z = s.z + nz * hw * across * scale;
      positions.push(x, height(x, z) + lift, z);
      // Трещины текстуры, идущие вдоль v, повторялись бы каждые 6 м в одну бесконечную
      // линию; медленный сдвиг u по длине их разводит.
      const wobble =
        0.25 * Math.sin(along / 13) + 0.15 * Math.sin(along / 5.3 + 1.7);
      uvs.push((across * hw) / TEXTURE_METERS + wobble, along / TEXTURE_METERS);
      road3.push(across * hw, along, hw);
    }
  });
  const index: number[] = [];
  for (let j = 0; j < samples.length - 1; j++)
    for (let k = 0; k < ACROSS - 1; k++) {
      const a = j * ACROSS + k,
        b = a + 1,
        c = a + ACROSS,
        d = c + 1;
      // Обход против часовой при взгляде сверху: лицевая сторона смотрит в небо.
      index.push(a, b, c, b, d, c);
    }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aRoad', new T.Float32BufferAttribute(road3, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Разметка и кромки. `vRoad` = (поперёк от оси м, вдоль м, полуширина м).
 *   - Осевая — прерывистая белая (штрих 3 м, пробел 6 м), стёртая пятнами: дорогу годами
 *     никто не красил.
 *   - Кромки темнее и буровато-грязные: туда сносит грязь и листья.
 *   - Край рваный: асфальт по бокам выкрошился.
 */
const ROAD_COMMON = /* glsl */ `
varying vec3 vRoad;
float roadHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
float roadNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(roadHash(i), roadHash(i + vec2(1.0, 0.0)), f.x), mix(roadHash(i + vec2(0.0, 1.0)), roadHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;
const ROAD_MAP = /* glsl */ `
#include <map_fragment>
{
  float across = abs(vRoad.x);
  float hw = vRoad.z;
  float side = vRoad.x > 0.0 ? 7.0 : 19.0;
  float ragged = 0.6 * roadNoise(vec2(vRoad.y * 2.3, side)) + 0.4 * roadNoise(vec2(vRoad.y * 9.0, side + 5.0));
  if (across > hw - 0.28 * ragged) discard;
  float dash = step(fract(vRoad.y / 9.0), 0.333);
  float line = (1.0 - smoothstep(0.06, 0.1, across)) * dash;
  float wear = smoothstep(0.3, 0.8, roadNoise(vec2(vRoad.x * 4.0, vRoad.y * 0.6)));
  line *= 0.12 + 0.5 * wear;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.71, 0.66), line);
  float edge = smoothstep(hw - 1.2, hw - 0.1, across + (roadNoise(vec2(vRoad.y * 0.7, 3.0)) - 0.5) * 0.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.58, 0.52, 0.45), edge * 0.8);
}
`;

function roadMaterial(maps: ReturnType<TextureSetLoader['get']>) {
  const material = new T.MeshStandardMaterial({
    ...maps,
    roughness: 1,
    metalness: 0,
    // Лента лежит в сантиметрах над землёй: вдали без смещения глубины проступал бы рельеф.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;',
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = aRoad;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROAD_COMMON}`)
      .replace('#include <map_fragment>', ROAD_MAP);
  };
  material.customProgramCacheKey = () => 'outbreak-road';
  return material;
}

/** Дороги карты: меш на дорогу, материал на PBR-набор (`road.texture`, по умолчанию asphalt_02). */
export function createRoads(def: ArenaDef, textures: TextureSetLoader) {
  const group = new T.Group();
  group.name = 'roads';
  // Асфальт — та же земля: камеру держит рельеф под ним.
  group.userData.noCameraCollision = true;
  const terrain = def.terrain;
  const height = terrain
    ? (x: number, z: number) => terrainMeshHeight(terrain, x, z)
    : () => 0;
  const materials = new Map<string, T.MeshStandardMaterial>();
  (def.roads ?? []).forEach((road, i) => {
    const geo = roadGeometry(road, height, LIFT + (i % 8) * LIFT_STEP);
    if (!geo) return;
    const set = road.texture ?? 'asphalt_02';
    let material = materials.get(set);
    if (!material) {
      material = roadMaterial(textures.get(set));
      materials.set(set, material);
    }
    const mesh = new T.Mesh(geo, material);
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return {
    group,
    dispose() {
      group.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      // Текстуры принадлежат загрузчику наборов.
      materials.forEach((m) => m.dispose());
    },
  };
}
