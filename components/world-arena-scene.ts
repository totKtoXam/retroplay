import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RoomState } from '@/lib/model';
import { waterFrozen, type ArenaDef, type GameMap, type MapBox, type MapCylinder, type MapFountain, type MapRamp, type MapRoof, type SurfaceMaterial } from '@/lib/maps/types';
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
  /**
   * Материал по цвету, виду поверхности и свечению; `color` хранится отдельно для сезонной
   * перекраски. Светящееся (стекло фонаря, угли) — без текстуры и сезоном не перекрашивается.
   */
  const mats = new Map<string, { color: string; kind?: SurfaceMaterial; glow?: number; material: T.MeshStandardMaterial }>();
  const kindOf = new Map<T.Material, SurfaceMaterial | undefined>();
  const material = (color: string, kind?: SurfaceMaterial, glow?: number) => {
    const key = `${color}|${kind ?? ''}|${glow ?? ''}`;
    let m = mats.get(key);
    if (!m) {
      const made = kind
        ? arenaMaterials.material(color, kind)
        : glow
          ? new T.MeshStandardMaterial({ color, roughness: 0.4 })
          : surfaces.material(color);
      if (glow) {
        made.emissive.set(color);
        made.emissiveIntensity = glow;
      }
      m = { color, kind, glow, material: made };
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
    glow?: number,
  ) => {
    const m = new T.Mesh(geo, material(color, kind, glow));
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  /** Цилиндр или конус; кора и прочие виды со своими UV получают их в метрах. */
  const cylinderGeometry = (c: MapCylinder) => {
    const geo = new T.CylinderGeometry(c.rTop ?? c.r, c.r, c.h, c.sides ?? 16);
    if (c.material && arenaMaterials.faceUV(c.material)) {
      const k = arenaMaterials.repeat(c.material);
      scaleUV(geo, (Math.PI * 2 * c.r) / k, c.h / k);
    }
    return geo;
  };
  const addCylinder = (c: MapCylinder, group: T.Group) => {
    const m = add(cylinderGeometry(c), c.color, c.x, c.y, c.z, c.material, group, c.glow);
    if (c.axis === 'x') m.rotation.z = Math.PI / 2;
    if (c.axis === 'z') m.rotation.x = Math.PI / 2;
  };
  /**
   * Коробка, нарисованная формой своего материала: листва — куст, скала и лёд — неровная глыба
   * с плоским верхом (по нему ходят), снег — сугроб, мешок — пухлый мешок, кора — круглое
   * бревно со срезами на торцах. Столкновения у всех по-прежнему по коробке.
   */
  const addBox = (b: MapBox, group: T.Group) => {
    if (b.material === 'bark') {
      addLog(b, group);
      return;
    }
    const m = add(boxGeometry(b), b.color, b.x, b.y, b.z, b.material, group, b.glow);
    if (b.rot) m.rotation.set(...b.rot);
  };
  const addLog = (b: MapBox, group: T.Group) => {
    const alongX = b.w >= b.d;
    const length = alongX ? b.w : b.d,
      r = Math.min(b.h, alongX ? b.d : b.w) / 2;
    const k = arenaMaterials.repeat('bark');
    // Лежит на низу коробки: высокая коробка — это бревно на земле, а не висящее в воздухе.
    const lift = r - b.h / 2;
    const turn = new T.Matrix4().makeRotationFromEuler(new T.Euler(...(b.rot ?? [0, 0, 0])));
    const body = new T.CylinderGeometry(r, r, length, 12, 1, true);
    scaleUV(body, (Math.PI * 2 * r) / k, length / k);
    if (alongX) body.rotateZ(Math.PI / 2);
    else body.rotateX(Math.PI / 2);
    add(body.translate(0, lift, 0).applyMatrix4(turn), b.color, b.x, b.y, b.z, 'bark', group);
    for (const end of [-1, 1]) {
      const cap = new T.CircleGeometry(r * 0.97, 12);
      if (alongX) cap.rotateY((end * Math.PI) / 2).translate((end * length) / 2, lift, 0);
      else cap.rotateY(end < 0 ? Math.PI : 0).translate(0, lift, (end * length) / 2);
      add(cap.applyMatrix4(turn), LOG_END, b.x, b.y, b.z, 'wood', group);
    }
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
  add(new T.BoxGeometry(maxX - minX, 0.2, maxZ - minZ), def.groundColor, cx, -0.1, cz, def.groundMaterial);
  add(new T.BoxGeometry(span + 200, 0.2, span + 200), def.outsideColor ?? '#6f7f63', cx, -0.14, cz, def.groundMaterial);
  // Коробки и цилиндры с меткой `art` рисует интерьер (текстуры и модели), остальные — сцена,
  // с материалом поверхности, если он задан.
  const interior = def.boxes.some((b) => b.art) || def.decor?.length ? createInterior(def) : undefined;
  if (interior) scene.add(interior.group);
  for (const b of def.boxes) if (!interiorDraws(b) && !b.invisible) addBox(b, statics);
  for (const b of def.furnishings ?? []) addBox(b, decor);
  for (const c of def.furnishingCylinders ?? []) addCylinder(c, decor);
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
      const m = add(new T.BoxGeometry(r.maxX - r.minX, 0.2, slope), r.color, (r.minX + r.maxX) / 2, (r.y0 + r.y1) / 2 - 0.1, (r.from + r.to) / 2, r.material);
      m.rotation.x = -Math.atan2(rise, run);
    } else {
      const m = add(new T.BoxGeometry(slope, 0.2, r.maxZ - r.minZ), r.color, (r.from + r.to) / 2, (r.y0 + r.y1) / 2 - 0.1, (r.minZ + r.maxZ) / 2, r.material);
      m.rotation.z = Math.atan2(rise, run);
    }
  }
  for (const c of def.cylinders ?? []) if (!interiorDraws(c)) addCylinder(c, statics);
  for (const s of def.spheres ?? []) add(sphereGeometry(s.r, s.material, s), s.color, s.x, s.y, s.z, s.material, statics, s.glow);
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
    for (const { color, glow, material: m } of mats.values())
      if (!glow) m.color.set(seasonColor(color, season, native, groundColors.has(color) ? 'ground' : 'surface'));
    // Зимой стоячая вода — лёд: матовый и неподвижный, в том числе на заснеженной карте
    // (раньше озёра «Горного лагеря» и «Ледниковой долины» в их же зиму рябили, как летом).
    (def.water ?? []).forEach((w, i) => {
      const m = waters[i]?.material as T.MeshStandardMaterial | undefined;
      if (!m) return;
      const frozen = waterFrozen(def, w, season);
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

/** Цвет спила на торцах брёвен. */
const LOG_END = '#c29a6b';

function scaleUV(geo: T.BufferGeometry, su: number, sv: number) {
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/** Шум для камня: крупные бугры и мелкие сколы, в мировых координатах. */
const rockNoise = (x: number, y: number, z: number) =>
  Math.sin(x * 1.7 + Math.sin(z * 1.3)) * Math.cos(z * 1.9 - y * 1.1) * 0.55 +
  Math.sin(y * 2.9 + x * 1.3 - z * 0.7) * 0.3 +
  Math.cos(x * 5.3 - z * 4.1 + y * 3.7) * 0.15;

/**
 * Коробка со скруглёнными рёбрами и неровными гранями. Шум берётся в мировых координатах
 * (`at` — центр коробки), поэтому одинаковые валуны не выходят одинаковыми, а соседние
 * глыбы одной стены сходятся без ступеньки. Низ остаётся на земле; при `flatTop` по верху
 * почти нет бугров — по скальным плато и полкам ходят.
 *
 * `massive` — для скальных стен, сводов и плато: верхнее ребро не скругляется, а бугры только
 * выпирают наружу. Иначе скругление и впадины у верха стены открыли бы щель под плитой свода,
 * лежащей на ней, и сквозь пещеру светило бы небо.
 */
function lumpyBox(
  w: number,
  h: number,
  d: number,
  at: { x: number; y: number; z: number },
  o: { radius: number; amp: number; flatTop?: boolean; massive?: boolean; seg?: number },
) {
  const segSize = o.seg ?? 0.35;
  const seg = (v: number) => Math.max(2, Math.min(40, Math.ceil(v / segSize)));
  const geo = welded(new T.BoxGeometry(w, h, d, seg(w), seg(h), seg(d)));
  const p = geo.getAttribute('position');
  const r = Math.min(o.radius, w / 2, d / 2, h);
  const hx = w / 2 - r,
    hz = d / 2 - r,
    bottom = -h / 2,
    top = o.massive ? h / 2 : Math.max(bottom, h / 2 - r);
  const v = new T.Vector3(),
    inner = new T.Vector3(),
    dir = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inner.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(bottom, Math.min(top, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    dir.subVectors(v, inner);
    // Точки дна (внутри проекции внутренней коробки) не трогаем: низ плоский.
    if (dir.lengthSq() < 1e-9) continue;
    dir.normalize();
    const n = rockNoise(v.x + at.x, v.y + at.y, v.z + at.z);
    let bump = o.amp * (o.massive ? 0.5 + 0.5 * n : 0.35 + n);
    if (o.flatTop) bump *= 1 - 0.92 * T.MathUtils.smoothstep(dir.y, 0.4, 0.95);
    v.copy(inner).addScaledVector(dir, r + bump);
    v.y = Math.max(bottom, v.y);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return finish(geo);
}

/**
 * Сугроб: только верхняя поверхность, от краёв коробки полого поднимается к её высоте, углы
 * скруглены, по верху — мягкие бугры. Снизу его не видно: он лежит на земле или на крышке.
 */
function driftGeometry(w: number, h: number, d: number, at: { x: number; y: number; z: number }) {
  const seg = (v: number) => Math.max(2, Math.min(48, Math.ceil(v / 0.3)));
  const geo = new T.PlaneGeometry(w, d, seg(w), seg(d));
  geo.rotateX(-Math.PI / 2);
  const p = geo.getAttribute('position');
  // Ширина пологого края: у большого сугроба — метр, у снега на крышке ящика — меньше.
  const m = Math.max(0.05, Math.min(1, w / 2, d / 2));
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i);
    const qx = Math.abs(x) - (w / 2 - m),
      qz = Math.abs(z) - (d / 2 - m);
    const edge = qx > 0 && qz > 0 ? m - Math.hypot(qx, qz) : Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z));
    const rise = T.MathUtils.smoothstep(edge / m, 0, 1);
    const bump = 0.88 + 0.12 * rockNoise((x + at.x) * 0.6, at.y, (z + at.z) * 0.6);
    p.setY(i, -h / 2 + h * rise * bump);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Мешки: короткая коробка — один пухлый мешок, длинная (бруствер из мешков с песком) — ряды
 * мешков вперевязку, каждый ~0,6 × 0,4 м, по высоте слоями ~0,22 м.
 */
function sackGeometry(w: number, h: number, d: number, at: { x: number; y: number; z: number }) {
  if (Math.max(w, d) <= 1) return lumpyBox(w, h, d, at, { radius: 0.2, amp: 0.025, seg: 0.1 });
  const alongX = w >= d;
  const length = alongX ? w : d,
    depth = alongX ? d : w;
  const rows = Math.max(1, Math.round(h / 0.22)),
    across = Math.max(1, Math.round(depth / 0.42)),
    n = Math.max(1, Math.round(length / 0.6));
  const sh = h / rows,
    sd = depth / across,
    sl = length / n;
  const parts: T.BufferGeometry[] = [];
  for (let r = 0; r < rows; r++)
    for (let a = 0; a < across; a++) {
      // Каждый второй слой сдвинут на полмешка; крайние половинки — короткие мешки.
      const shift = r % 2 ? sl / 2 : 0;
      for (let s0 = -length / 2 - shift; s0 < length / 2 - 1e-6; s0 += sl) {
        const lo = Math.max(-length / 2, s0),
          hi = Math.min(length / 2, s0 + sl);
        if (hi - lo < 0.15) continue;
        const cl = (lo + hi) / 2,
          ca = -depth / 2 + (a + 0.5) * sd,
          cy = -h / 2 + (r + 0.5) * sh;
        const [px, pz] = alongX ? [cl, ca] : [ca, cl];
        const [sw, sdd] = alongX ? [hi - lo - 0.02, sd - 0.02] : [sd - 0.02, hi - lo - 0.02];
        const g = lumpyBox(sw, sh, sdd, { x: at.x + px, y: at.y + cy, z: at.z + pz }, { radius: 0.1, amp: 0.02, seg: 0.12 });
        g.translate(px, cy, pz);
        parts.push(g);
      }
    }
  const merged = mergeGeometries(parts) ?? lumpyBox(w, h, d, at, { radius: 0.2, amp: 0.025, seg: 0.1 });
  parts.forEach((g) => g !== merged && g.dispose());
  return merged;
}

/** Отдельная глыба на земле, а не часть стены, свода или плато. */
const isBoulder = (b: MapBox) => b.y - b.h / 2 < 0.05 && b.y + b.h / 2 <= 2.2 && Math.max(b.w, b.d) <= 4.5;

/** Коробка, нарисованная формой своего материала (кроме бревна — его строит `addLog`). */
function boxGeometry(b: MapBox) {
  switch (b.material) {
    case 'foliage':
      return bushGeometry(b.w, b.h, b.d);
    // Валун (невысокий и небольшой) скруглён со всех сторон, скальный массив — только по вертикальным рёбрам.
    case 'rock':
      return isBoulder(b)
        ? lumpyBox(b.w, b.h, b.d, b, { radius: 0.35, amp: 0.1, flatTop: true })
        : lumpyBox(b.w, b.h, b.d, b, { radius: 0.22, amp: 0.12, massive: true });
    case 'ice':
      return isBoulder(b)
        ? lumpyBox(b.w, b.h, b.d, b, { radius: 0.18, amp: 0.05, flatTop: true })
        : lumpyBox(b.w, b.h, b.d, b, { radius: 0.12, amp: 0.05, massive: true });
    case 'snow':
      return driftGeometry(b.w, b.h, b.d, b);
    case 'sack':
      return sackGeometry(b.w, b.h, b.d, b);
    default:
      return new T.BoxGeometry(b.w, b.h, b.d);
  }
}

/** Шар по материалу: крона, снежная шапка (приплюснутая и гладкая), валун или простой шар. */
function sphereGeometry(r: number, material: SurfaceMaterial | undefined, at: { x: number; y: number; z: number }) {
  if (material === 'foliage') return crownGeometry(r);
  if (material !== 'snow' && material !== 'rock') return new T.IcosahedronGeometry(r, 1);
  const geo = welded(new T.IcosahedronGeometry(r, material === 'snow' ? 3 : 2));
  const p = geo.getAttribute('position');
  const v = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = rockNoise(v.x + at.x, v.y + at.y, v.z + at.z);
    if (material === 'snow') v.multiplyScalar(1 + n * 0.04).setY(v.y * 0.62);
    else v.multiplyScalar(1 + n * 0.14).setY(v.y * 0.8);
    p.setXYZ(i, v.x, v.y, v.z);
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
