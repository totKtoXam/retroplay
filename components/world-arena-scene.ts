import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RoomState } from '@/lib/model';
import type { ArenaDef, GameMap, MapFountain, SurfaceMaterial } from '@/lib/maps/types';
import { createAvatar, setAvatarStyle } from './world-avatar';
import { createInterior, interiorDraws } from './world-interior';
import { createSurfaceLibrary } from './world-cinematic';
import { createArenaMaterials } from './world-arena-materials';
import type { WorldKit } from './world-map-scene';
import { mixValue, type DayMix, type TimeOfDay } from '@/lib/day-cycle';
import { seasonColor } from '@/lib/season-colors';

/** Те же значения, что стояли в прежних условиях по `s.time`, но по фазам. */
const ARENA_SKY_TOP: Record<TimeOfDay, string> = { dawn: '#999dcc', day: '#79b8ed', sunset: '#707cc0', night: '#111832' };
const ARENA_SKY_BOTTOM: Record<TimeOfDay, string> = { dawn: '#efcbd4', day: '#d2dfef', sunset: '#edb6a9', night: '#3a3b69' };
const ARENA_FOG: Record<TimeOfDay, string> = { dawn: '#9fb6c2', day: '#9fb6c2', sunset: '#b5a18c', night: '#18242d' };
const ARENA_HEMI: Record<TimeOfDay, number> = { dawn: 0.7, day: 0.7, sunset: 0.7, night: 0.35 };
const ARENA_HEMI_COLOR: Record<TimeOfDay, string> = { dawn: '#e6edff', day: '#e6edff', sunset: '#e6edff', night: '#98b6ff' };
const ARENA_SUNLIGHT: Record<TimeOfDay, number> = { dawn: 2.8, day: 2.8, sunset: 2.2, night: 0.5 };
const ARENA_SUNLIGHT_COLOR: Record<TimeOfDay, string> = { dawn: '#ffedce', day: '#ffedce', sunset: '#ffb687', night: '#98acff' };
const ARENA_SUN_HEIGHT: Record<TimeOfDay, number> = { dawn: 36, day: 36, sunset: 10, night: 20 };

/**
 * Scene for a team-battle map described by an ArenaDef (lib/maps). Everything static is
 * built from the same boxes, ramps and cylinders that the collision uses, then merged by
 * material to keep draw calls low.
 */
export function createArenaScene(map: GameMap & { arena: ArenaDef }): WorldKit {
  const def = map.arena;
  const surfaces = createSurfaceLibrary();
  const arenaMaterials = createArenaMaterials();
  const scene = new T.Scene();
  const statics = new T.Group();
  scene.add(statics);
  // Мелкие детали (ножки, подушки, рамы, люстры) камеру не отодвигают: иначе вид от третьего
  // лица дёргался бы о каждый стул.
  const decor = new T.Group();
  decor.userData.noCameraCollision = true;
  scene.add(decor);
  /** Материал по цвету и виду поверхности; `color` хранится отдельно для сезонной перекраски. */
  const mats = new Map<string, { color: string; kind?: SurfaceMaterial; material: T.MeshStandardMaterial }>();
  const kindOf = new Map<T.Material, SurfaceMaterial | undefined>();
  const material = (color: string, kind?: SurfaceMaterial) => {
    const key = `${color}|${kind ?? ''}`;
    let m = mats.get(key);
    if (!m) {
      m = { color, kind, material: kind ? arenaMaterials.material(color, kind) : surfaces.material(color) };
      mats.set(key, m);
      kindOf.set(m.material, kind);
    }
    return m.material;
  };
  const add = (
    geo: T.BufferGeometry,
    color: string,
    x: number,
    y: number,
    z: number,
    kind?: SurfaceMaterial,
    group: T.Group = statics,
  ) => {
    const m = new T.Mesh(geo, material(color, kind));
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  const { minX, maxX, minZ, maxZ } = def.bounds;
  const cx = (minX + maxX) / 2,
    cz = (minZ + maxZ) / 2,
    span = Math.max(maxX - minX, maxZ - minZ);

  const hemi = new T.HemisphereLight('#e1edff', '#6c6483', 0.7);
  scene.add(hemi);
  const sunlight = new T.DirectionalLight('#ffedce', 2.8);
  sunlight.position.set(cx - 30, 36, cz - 24);
  sunlight.target.position.set(cx, 0, cz);
  scene.add(sunlight.target);
  sunlight.castShadow = true;
  // Один и тот же бюджет тени растянут на вдвое большую карту размывает её, поэтому
  // на больших аренах берём вчетверо больше текселей.
  const shadowRes = span > 80 ? 2048 : 1024;
  sunlight.shadow.mapSize.set(shadowRes, shadowRes);
  const half = span / 2 + 6;
  sunlight.shadow.camera.left = -half;
  sunlight.shadow.camera.right = half;
  sunlight.shadow.camera.top = half;
  sunlight.shadow.camera.bottom = -half;
  sunlight.shadow.camera.near = 1;
  sunlight.shadow.camera.far = half * 2 + 40;
  sunlight.shadow.bias = -0.0005;
  sunlight.shadow.normalBias = 0.035;
  scene.add(sunlight);
  const skyMaterial = new T.ShaderMaterial({
    uniforms: { top: { value: new T.Color('#76b6ed') }, bottom: { value: new T.Color('#e0dff4') } },
    vertexShader:
      'varying vec3 vWorld; void main(){vWorld=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:
      'uniform vec3 top;uniform vec3 bottom;varying vec3 vWorld;void main(){float h=clamp((normalize(vWorld).y+0.04)*1.5,0.0,1.0);gl_FragColor=vec4(mix(bottom,top,pow(h,0.7)),1.0);}',
    side: T.BackSide,
    depthWrite: false,
  });
  scene.add(new T.Mesh(new T.SphereGeometry(Math.max(180, span * 2), 24, 16), skyMaterial));

  // Ground inside the walls and a wider backdrop outside them.
  add(new T.BoxGeometry(maxX - minX, 0.2, maxZ - minZ), def.groundColor, cx, -0.1, cz);
  add(new T.BoxGeometry(span + 200, 0.2, span + 200), def.outsideColor ?? '#6f7f63', cx, -0.14, cz);
  // Коробки и цилиндры с меткой `art` рисует интерьер (текстуры и модели), остальные — сцена,
  // с материалом поверхности, если он задан.
  const interior = def.boxes.some((b) => b.art) || def.decor?.length ? createInterior(def) : undefined;
  if (interior) scene.add(interior.group);
  for (const b of def.boxes)
    if (!interiorDraws(b)) add(new T.BoxGeometry(b.w, b.h, b.d), b.color, b.x, b.y, b.z, b.material);
  for (const b of def.furnishings ?? [])
    add(new T.BoxGeometry(b.w, b.h, b.d), b.color, b.x, b.y, b.z, b.material, decor);
  for (const c of def.furnishingCylinders ?? [])
    add(new T.CylinderGeometry(c.r, c.r, c.h, c.sides ?? 16), c.color, c.x, c.y, c.z, c.material, decor);
  for (const r of def.ramps ?? []) {
    const run = r.to - r.from,
      rise = r.y1 - r.y0,
      slope = Math.hypot(run, rise);
    if (r.axis === 'z') {
      const m = add(new T.BoxGeometry(r.maxX - r.minX, 0.2, slope), r.color, (r.minX + r.maxX) / 2, (r.y0 + r.y1) / 2 - 0.1, (r.from + r.to) / 2);
      m.rotation.x = -Math.atan2(rise, run);
    } else {
      const m = add(new T.BoxGeometry(slope, 0.2, r.maxZ - r.minZ), r.color, (r.from + r.to) / 2, (r.y0 + r.y1) / 2 - 0.1, (r.minZ + r.maxZ) / 2);
      m.rotation.z = Math.atan2(rise, run);
    }
  }
  for (const c of def.cylinders ?? [])
    if (!interiorDraws(c))
      add(new T.CylinderGeometry(c.r, c.r, c.h, c.sides ?? 16), c.color, c.x, c.y, c.z, c.material);
  for (const s of def.spheres ?? []) add(new T.IcosahedronGeometry(s.r, 1), s.color, s.x, s.y, s.z);
  const waters: T.Mesh[] = [];
  for (const w of def.water ?? []) {
    const plane = w.round
      ? new T.CircleGeometry(Math.min(w.maxX - w.minX, w.maxZ - w.minZ) / 2, 40)
      : new T.PlaneGeometry(w.maxX - w.minX, w.maxZ - w.minZ);
    // Рябь в метрах мира: на большом пруду и в маленькой чаше волны одного размера.
    const uv = plane.getAttribute('uv');
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, (uv.getX(i) * (w.maxX - w.minX)) / 3, (uv.getY(i) * (w.maxZ - w.minZ)) / 3);
    const water = new T.Mesh(plane, arenaMaterials.water(w.color ?? '#3f7f96'));
    water.renderOrder = 1;
    water.rotation.x = -Math.PI / 2;
    water.position.set((w.minX + w.maxX) / 2, w.y, (w.minZ + w.maxZ) / 2);
    water.receiveShadow = true;
    scene.add(water);
    waters.push(water);
  }
  for (const l of def.lights ?? []) {
    const light = new T.PointLight(l.color, l.intensity, l.distance);
    light.position.set(l.x, l.y, l.z);
    scene.add(light);
  }

  const fountains = (def.fountains ?? []).map((f) => createFountainSpray(f));
  fountains.forEach((f) => scene.add(f.points));

  // Merge static meshes by material, separately for solid geometry and decor.
  const mergeGroup = (group: T.Group) => {
    group.updateMatrixWorld(true);
    const buckets = new Map<T.Material, T.BufferGeometry[]>();
    // A copy: meshes are removed from the group while iterating.
    for (const o of group.children.slice()) {
      if (!(o instanceof T.Mesh) || Array.isArray(o.material)) continue;
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
      const list = buckets.get(o.material) ?? [];
      list.push(geo);
      buckets.set(o.material, list);
      o.removeFromParent();
      o.geometry.dispose();
    }
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const kind = kindOf.get(mat);
      if (kind) arenaMaterials.projectUV(merged, kind);
      else surfaces.projectUV(merged);
      const mesh = new T.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  };
  mergeGroup(statics);
  mergeGroup(decor);

  // Боевая карта живёт по тем же суткам, что и хаб: свет строится смесью двух
  // соседних фаз, чтобы ночь наступала плавно, а не рывком (lib/day-cycle.ts).
  const scratch = new T.Color();
  // Прежние 45 и 170 — это 0,8 и 3 пролёта «Горного лагеря»; так дальний край любой
  // карты тонет в дымке одинаково, а не пропадает целиком на большой.
  const fog = new T.Fog('#9fb6c2', span * 0.8, Math.min(span * 3, 330));
  const mixInto = (
    target: T.Color,
    table: Record<TimeOfDay, string>,
    m: DayMix,
  ) => target.set(table[m.from]).lerp(scratch.set(table[m.to]), m.blend);
  const setDayMix = (m: DayMix) => {
    if (def.indoor) {
      // В помещении (корабль) за стенами — тёмный космос при любом времени суток.
      (skyMaterial.uniforms.top.value as T.Color).set('#03050a');
      (skyMaterial.uniforms.bottom.value as T.Color).set('#0b1020');
      fog.color.set('#05070d');
    } else {
      mixInto(skyMaterial.uniforms.top.value as T.Color, ARENA_SKY_TOP, m);
      mixInto(skyMaterial.uniforms.bottom.value as T.Color, ARENA_SKY_BOTTOM, m);
      mixInto(fog.color, ARENA_FOG, m);
    }
    scene.fog = fog;
    hemi.intensity = mixValue(ARENA_HEMI, m);
    mixInto(hemi.color, ARENA_HEMI_COLOR, m);
    sunlight.intensity = mixValue(ARENA_SUNLIGHT, m);
    mixInto(sunlight.color, ARENA_SUNLIGHT_COLOR, m);
    sunlight.position.set(cx - 30, mixValue(ARENA_SUN_HEIGHT, m), cz - 24);
    sunlight.shadow.needsUpdate = true;
  };
  // Времена года: карта нарисована в своём сезоне (`def.season`, по умолчанию
  // лето), остальные сезоны перекрашивают её материалы от исходных цветов.
  // Раньше арена сезон просто игнорировала, и переключатель работал только в хабе.
  const groundColors = new Set([def.groundColor, def.outsideColor ?? '#6f7f63']);
  let appliedSeason = '';
  const applySeason = (season: string) => {
    if (season === appliedSeason) return;
    appliedSeason = season;
    const native = def.season ?? 'summer';
    for (const { color, material: m } of mats.values())
      m.color.set(seasonColor(color, season, native, groundColors.has(color) ? 'ground' : 'surface'));
    // Зимой вода на летней карте — лёд: матовый и неподвижный. Кроме фонтана: его вода
    // проточная и бьёт в любой сезон — замёрзший бассейн выглядел как сломанная анимация.
    const winter = season === 'winter' && native !== 'winter';
    (def.water ?? []).forEach((w, i) => {
      const m = waters[i]?.material as T.MeshStandardMaterial | undefined;
      if (!m) return;
      const running = (def.fountains ?? []).some((f) => f.x >= w.minX && f.x <= w.maxX && f.z >= w.minZ && f.z <= w.maxZ);
      const frozen = winter && !running;
      m.color.set(frozen ? seasonColor(w.color ?? '#3f7f96', season, native, 'water') : (w.color ?? '#3f7f96'));
      arenaMaterials.setFrozen(m, frozen);
    });
  };
  const update = (s: RoomState, m: DayMix) => {
    applySeason(s.season);
    setDayMix(m);
  };
  const avatarFactory = (color: string) => {
    const avatar = createAvatar(color);
    avatar.name = 'player-avatar';
    setAvatarStyle(avatar, false);
    return avatar;
  };
  return {
    scene,
    boards: [],
    colliders: map.colliders,
    stations: [],
    avatarFactory,
    update,
    setDayMix,
    setNotes: () => {},
    clouds: new T.Group(),
    sunlight,
    animate: (seconds: number) => {
      interior?.animate(seconds);
      arenaMaterials.animate(seconds);
      fountains.forEach((f) => f.animate(seconds));
    },
    dispose: () => {
      surfaces.dispose();
      interior?.dispose();
      arenaMaterials.dispose();
      waters.forEach((w) => w.geometry.dispose());
      fountains.forEach((f) => f.dispose());
    },
  };
}

/**
 * Струи фонтана — частицы, чей путь целиком считает шейдер: из сопла вверх и дугой в чашу,
 * и завесой с края чаши в бассейн. Каждая частица живёт по кругу со своей фазой, так что поток
 * непрерывен, а на CPU каждый кадр меняется только время.
 */
function createFountainSpray(f: MapFountain) {
  const JET = 600,
    CURTAIN = 2200;
  const count = JET + CURTAIN;
  const seeds = new Float32Array(count * 4);
  let seed = 7331;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    seeds[i * 4] = rand() * Math.PI * 2; // направление
    seeds[i * 4 + 1] = rand(); // разброс скорости
    seeds[i * 4 + 2] = rand(); // фаза
    seeds[i * 4 + 3] = i < JET ? 0 : 1; // струя или завеса
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aSeed', new T.BufferAttribute(seeds, 4));
  // Частицы двигает шейдер: рамка должна покрывать весь фонтан, иначе его отсечёт камера.
  geometry.boundingSphere = new T.Sphere(new T.Vector3(f.x, (f.jetY + f.poolY) / 2 + 0.5, f.z), f.bowlR + 2.5);
  const material = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uOrigin: { value: new T.Vector3(f.x, f.jetY, f.z) },
      uBowl: { value: new T.Vector3(f.bowlY, f.bowlR, f.poolY) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform vec3 uOrigin;
      uniform vec3 uBowl;
      varying float vAlpha;
      const float G = 9.8;
      void main() {
        vec2 dir = vec2(cos(aSeed.x), sin(aSeed.x));
        vec3 p;
        float life;
        if (aSeed.w < 0.5) {
          // Струя: вверх на 0,6–0,9 м и дугой вниз, в 45–85 % радиуса чаши.
          float vy = 3.4 + aSeed.y * 0.8;
          float drop = uOrigin.y - uBowl.x;
          float flight = (vy + sqrt(vy * vy + 2.0 * G * drop)) / G;
          float land = uBowl.y * (0.45 + aSeed.y * 0.4);
          life = fract(uTime / flight + aSeed.z);
          float t = life * flight;
          p = vec3(uOrigin.x + dir.x * land * life, uOrigin.y + vy * t - 0.5 * G * t * t, uOrigin.z + dir.y * land * life);
        } else {
          // Завеса: вода переливается через край чаши и падает в бассейн.
          float flight = sqrt(2.0 * (uBowl.x - uBowl.z) / G);
          life = fract(uTime / flight + aSeed.z);
          float t = life * flight;
          float r = uBowl.y + 0.04 + (0.18 + aSeed.y * 0.22) * t;
          p = vec3(uOrigin.x + dir.x * r, uBowl.x - 0.5 * G * t * t, uOrigin.z + dir.y * r);
        }
        vAlpha = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.85, 1.0, life));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (aSeed.w < 0.5 ? 26.0 : 24.0) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        gl_FragColor = vec4(0.86, 0.94, 1.0, vAlpha * 0.7 * (1.0 - d * 4.0));
      }`,
  });
  const points = new T.Points(geometry, material);
  points.userData.noCameraCollision = true;
  return {
    points,
    animate(seconds: number) {
      material.uniforms.uTime.value = seconds;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
