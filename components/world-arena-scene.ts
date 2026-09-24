import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RoomState } from '@/lib/model';
import type { ArenaDef, GameMap, MapFountain, MapRamp, MapRoof, SurfaceMaterial } from '@/lib/maps/types';
import { createAvatar, setAvatarStyle } from './world-avatar';
import { createInterior, interiorDraws } from './world-interior';
import { createSurfaceLibrary } from './world-cinematic';
import { createArenaMaterials } from './world-arena-materials';
import type { MapSceneOptions, WorldKit } from './world-map-scene';
import { createLampLights } from './world-lamp-lights';
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
export function createArenaScene(map: GameMap & { arena: ArenaDef }, options: MapSceneOptions = {}): WorldKit {
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
  // Внутри корабля суточного солнца нет: потолок тени не бросает, и «дневной» свет с резкими
  // тенями от стен заливал бы отсеки, будто крыши нет. Настоящее солнце — за иллюминаторами
  // (components/world-space.ts), его свет входит в окна лучами.
  if (def.indoor) sunlight.castShadow = false;
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
  add(new T.BoxGeometry(maxX - minX, 0.2, maxZ - minZ), def.groundColor, cx, -0.1, cz, def.groundMaterial);
  add(new T.BoxGeometry(span + 200, 0.2, span + 200), def.outsideColor ?? '#6f7f63', cx, -0.14, cz);
  // Коробки и цилиндры с меткой `art` рисует интерьер (текстуры и модели), остальные — сцена,
  // с материалом поверхности, если он задан.
  const interior = def.boxes.some((b) => b.art) || def.decor?.length ? createInterior(def) : undefined;
  if (interior) scene.add(interior.group);
  // Листва (кусты, кроны) рисуется неровной скруглённой массой, а не гладким бруском.
  const boxGeometry = (b: { w: number; h: number; d: number; material?: SurfaceMaterial }) =>
    b.material === 'foliage' ? bushGeometry(b.w, b.h, b.d) : new T.BoxGeometry(b.w, b.h, b.d);
  for (const b of def.boxes)
    if (!interiorDraws(b)) {
      const m = add(boxGeometry(b), b.color, b.x, b.y, b.z, b.material);
      if (b.rot) m.rotation.set(...b.rot);
    }
  for (const b of def.furnishings ?? []) {
    const m = add(boxGeometry(b), b.color, b.x, b.y, b.z, b.material, decor);
    if (b.rot) m.rotation.set(...b.rot);
  }
  for (const c of def.furnishingCylinders ?? []) {
    const m = add(new T.CylinderGeometry(c.r, c.r, c.h, c.sides ?? 16), c.color, c.x, c.y, c.z, c.material, decor);
    if (c.axis === 'x') m.rotation.z = Math.PI / 2;
    if (c.axis === 'z') m.rotation.x = Math.PI / 2;
  }
  for (const r of def.roofs ?? []) addRoof(r, (geo, color, kind) => add(geo, color, 0, 0, 0, kind, decor));
  for (const r of def.ramps ?? []) {
    if (r.steps) {
      for (const step of flightOfSteps(r)) add(step.geo, r.color, step.x, step.y, step.z, r.material);
      continue;
    }
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
  for (const s of def.spheres ?? [])
    add(s.material === 'foliage' ? crownGeometry(s.r) : new T.IcosahedronGeometry(s.r, 1), s.color, s.x, s.y, s.z, s.material);
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
    water.rotation.x = -Math.PI / 2;
    water.position.set((w.minX + w.maxX) / 2, w.y, (w.minZ + w.maxZ) / 2);
    water.receiveShadow = true;
    // Ресурс-паки и аниме-стиль перекрашивают непрозрачные материалы без текстуры — вода
    // потеряла бы рябь. Её вид карта задаёт сама.
    water.userData.presentationOnly = true;
    scene.add(water);
    waters.push(water);
  }
  const lampLights = createLampLights(scene, def.lights ?? [], options.lampLights ?? 4);

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
      // В помещении (корабль) за стенами — тёмный космос, и сутки здесь ни при чём: свет отсеков
      // одинаков всегда, а солнце светит только через иллюминаторы.
      (skyMaterial.uniforms.top.value as T.Color).set('#03050a');
      (skyMaterial.uniforms.bottom.value as T.Color).set('#0b1020');
      fog.color.set('#05070d');
      scene.fog = fog;
      hemi.intensity = 0.95;
      hemi.color.set('#dfe8ff');
      hemi.groundColor.set('#3a3550');
      sunlight.intensity = 0;
      return;
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
    view: (eye: T.Vector3, dt: number) => lampLights.update(eye, dt),
    animate: (seconds: number) => {
      interior?.animate(seconds);
      arenaMaterials.animate(seconds);
      fountains.forEach((f) => f.animate(seconds));
    },
    dispose: () => {
      surfaces.dispose();
      lampLights.dispose();
      interior?.dispose();
      arenaMaterials.dispose();
      waters.forEach((w) => w.geometry.dispose());
      fountains.forEach((f) => f.dispose());
    },
  };
}

/** Шум для листвы: гладкий, зависит только от точки, поэтому совпадающие вершины сдвигаются одинаково. */
const leafNoise = (x: number, y: number, z: number) =>
  Math.sin(x * 3.1 + Math.sin(z * 2.3)) * Math.cos(z * 2.7 - y * 1.9) * 0.6 +
  Math.sin(y * 4.3 + x * 1.7) * 0.25 +
  Math.cos(x * 7.9 - z * 6.1 + y * 3.3) * 0.15;

/** Геометрия без UV и нормалей, со склеенными вершинами — чтобы сдвиг не рвал рёбра. */
function welded(geo: T.BufferGeometry) {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const out = mergeVertices(geo);
  geo.dispose();
  return out;
}
/** Нормали и пустые UV (настоящие UV потом даёт проекция в метрах мира). */
function finish(geo: T.BufferGeometry) {
  geo.computeVertexNormals();
  geo.setAttribute('uv', new T.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
  return geo;
}

/**
 * Куст живой изгороди: коробка со скруглёнными верхними рёбрами и бугристой поверхностью.
 * Низ остаётся ровным на земле; наружу масса выходит не больше чем на 0,12 м.
 */
function bushGeometry(w: number, h: number, d: number) {
  const seg = (v: number) => Math.max(2, Math.ceil(v / 0.25));
  const geo = welded(new T.BoxGeometry(w, h, d, seg(w), seg(h), seg(d)));
  const p = geo.getAttribute('position');
  const r = Math.min(0.35, w / 2, d / 2, h / 2);
  const hx = w / 2 - r,
    hz = d / 2 - r,
    top = h / 2 - r,
    bottom = -h / 2;
  const v = new T.Vector3(),
    inner = new T.Vector3(),
    dir = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inner.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(bottom, Math.min(top, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    dir.subVectors(v, inner);
    if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
    dir.normalize();
    const bump = 0.07 + leafNoise(v.x * 0.8, v.y * 0.8, v.z * 0.8) * 0.08;
    v.copy(inner).addScaledVector(dir, r + bump);
    v.y = Math.max(bottom, v.y);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return finish(geo);
}

/** Крона дерева или цветущий куст: шар, собранный из бугров. */
function crownGeometry(r: number) {
  const geo = welded(new T.IcosahedronGeometry(r, 3));
  const p = geo.getAttribute('position');
  const v = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + leafNoise(v.x / r * 1.6, v.y / r * 1.6, v.z / r * 1.6) * 0.16;
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y * 0.92, v.z);
  }
  return finish(geo);
}

/**
 * Лестничный марш на месте пандуса: ступени сплошные до пола. Верх ступени — на высоте пандуса
 * в середине проступи, так что ноги, идущие по склону, не проваливаются и не висят больше чем
 * на полступени.
 */
function flightOfSteps(r: MapRamp) {
  const n = r.steps ?? 1;
  const out: { geo: T.BufferGeometry; x: number; y: number; z: number }[] = [];
  const width = r.axis === 'z' ? r.maxX - r.minX : r.maxZ - r.minZ;
  const across = r.axis === 'z' ? (r.minX + r.maxX) / 2 : (r.minZ + r.maxZ) / 2;
  const tread = Math.abs(r.to - r.from) / n,
    dir = Math.sign(r.to - r.from);
  for (let i = 0; i < n; i++) {
    const top = r.y0 + ((i + 0.5) / n) * (r.y1 - r.y0);
    const h = top - Math.min(r.y0, r.y1);
    const along = r.from + dir * (i + 0.5) * tread;
    const y = Math.min(r.y0, r.y1) + h / 2;
    out.push(
      r.axis === 'z'
        ? { geo: new T.BoxGeometry(width, h, tread), x: across, y, z: along }
        : { geo: new T.BoxGeometry(tread, h, width), x: along, y, z: across },
    );
  }
  return out;
}

/**
 * Скатная крыша: чердак — треугольная призма (её торцы и есть фронтоны), поверх — два ската
 * с выносом карниза.
 */
function addRoof(r: MapRoof, add: (geo: T.BufferGeometry, color: string, kind?: SurfaceMaterial) => T.Mesh) {
  const o = r.overhang ?? 0.4,
    t = 0.14;
  const alongX = r.ridge === 'x';
  // Поперечник (ширина под скатами) и длина вдоль конька.
  const a0 = alongX ? r.minZ : r.minX,
    a1 = alongX ? r.maxZ : r.maxX,
    l0 = alongX ? r.minX : r.minZ,
    l1 = alongX ? r.maxX : r.maxZ;
  const half = (a1 - a0) / 2,
    mid = (a0 + a1) / 2,
    length = l1 - l0;
  // Призма чердака: треугольник в плоскости (поперёк, y), вытянутый вдоль конька.
  const shape = new T.Shape([new T.Vector2(-half, 0), new T.Vector2(half, 0), new T.Vector2(0, r.rise)]);
  const attic = new T.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  if (alongX) {
    // Локальная z (вытяжка) идёт вдоль мировой x, локальная x — поперёк, вдоль мировой z.
    attic.rotateY(Math.PI / 2);
    attic.translate(l0, r.y, mid);
  } else attic.translate(mid, r.y, l0);
  add(attic, r.gable, r.gableMaterial);
  // Скаты: доска от карниза до конька, по одной с каждой стороны.
  const slope = Math.atan2(r.rise, half),
    run = Math.hypot(half + o, r.rise + o * Math.tan(slope));
  for (const side of [-1, 1]) {
    const geo = alongX ? new T.BoxGeometry(length + o * 2, t, run) : new T.BoxGeometry(run, t, length + o * 2);
    const m = add(geo, r.color, r.material);
    const cAcross = mid + side * ((half + o) / 2),
      cY = r.y + r.rise / 2 - ((o * Math.tan(slope)) / 2) + t / 2;
    if (alongX) {
      m.position.set((l0 + l1) / 2, cY, cAcross);
      m.rotation.x = side * slope;
    } else {
      m.position.set(cAcross, cY, (l0 + l1) / 2);
      m.rotation.z = -side * slope;
    }
  }
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
  // Непрозрачные капли с отсечением по кругу, а не мягкая прозрачность: прозрачное рисуется
  // после оружия в руках и легло бы поверх ствола (см. `water` в world-arena-materials.ts).
  const material = new T.ShaderMaterial({
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
        // Край капли и её рождение/исчезновение — сужением круга вместо прозрачности.
        if (d > 0.25 * vAlpha) discard;
        gl_FragColor = vec4(mix(vec3(0.86, 0.94, 1.0), vec3(0.62, 0.78, 0.9), d * 4.0), 1.0);
      }`,
  });
  const points = new T.Points(geometry, material);
  points.userData.noCameraCollision = true;
  points.userData.presentationOnly = true;
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
