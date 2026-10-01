import * as T from 'three';
import { decalTextures, isGoreDecal } from '@/lib/maps/decals';
import {
  isProcModel,
  propModelInfo,
  terrainHeightAt,
  type ArenaDef,
  type MapDecal,
  type MapProp,
} from '@/lib/maps/types';
import {
  createTextureSetLoader,
  type TextureSetLoader,
} from './world-pbr-textures';

/*
 * Рельеф и готовые модели огромной карты (lib/maps/outbreak.ts). Обычные арены сливают
 * всю геометрию в несколько мешей — на карте 2 × 2 км так нельзя: вся она не видна
 * никогда, а слитый меш не отсекается камерой. Поэтому и земля, и модели разложены по
 * квадратам (чанкам): что вне поля зрения или дальше дальности камеры — не рисуется.
 */

/** Сторона чанка моделей, м. */
const PROP_CHUNK = 250;
/** Мелочь (трава, цветы, грибы) — своими чанками поменьше и видна только вблизи. */
const SMALL_CHUNK = 125;
const SMALL_VIEW = 150;
const SMALL_HEIGHT = 1.6;
/** Тяжёлые сканы (больше HEAVY_TRIS треугольников) не рисуются дальше HEAVY_VIEW м. */
const HEAVY_TRIS = 20000;
const HEAVY_VIEW = 220;
/** Дальность без `def.viewDistance` — как туман огромной карты. */
const DEFAULT_VIEW = 320;
/** Сколько файлов моделей грузится разом. */
const LOAD_PARALLEL = 6;

// Рельеф переехал в components/world-terrain-material.ts (сплат PBR-наборов); имя оставлено для старых импортов.
export { createTerrainMeshes } from './world-terrain-material';

/**
 * Луч по копиям модели. Стандартный InstancedMesh.raycast на каждую копию перемножает
 * матрицы и проверяет её рамку — на длинном выстреле через лес это десятки тысяч копий.
 * Здесь у каждой копии заранее посчитана сфера в мире: луч сначала проверяется по ней
 * одной операцией, и только задетые копии проверяются по треугольникам.
 */
const rayScratch = {
  sphere: new T.Sphere(),
  mesh: new T.Mesh(),
  local: new T.Matrix4(),
  hits: [] as T.Intersection[],
};
function fastInstanceRaycast(mesh: T.InstancedMesh, spheres: Float32Array) {
  mesh.raycast = (raycaster, intersects) => {
    const { sphere, mesh: probe, local, hits } = rayScratch;
    if (!mesh.boundingSphere) mesh.computeBoundingSphere();
    if (!raycaster.ray.intersectsSphere(mesh.boundingSphere!)) return;
    probe.geometry = mesh.geometry;
    probe.material = mesh.material;
    for (let i = 0; i < mesh.count; i++) {
      sphere.center.set(spheres[i * 4], spheres[i * 4 + 1], spheres[i * 4 + 2]);
      sphere.radius = spheres[i * 4 + 3];
      if (!raycaster.ray.intersectsSphere(sphere)) continue;
      mesh.getMatrixAt(i, local);
      probe.matrixWorld.multiplyMatrices(mesh.matrixWorld, local);
      probe.raycast(raycaster, hits);
      for (const hit of hits) {
        hit.instanceId = i;
        hit.object = mesh;
        intersects.push(hit);
      }
      hits.length = 0;
    }
  };
}

/**
 * Насколько мрачнеет модель (`ArenaDef.mood = 'grim'`): `fade` — доля пути к серому,
 * `darken` — общий множитель яркости, `dirt` — сила бурой грязи у земли на высоте до
 * `dirtHeight` м над основанием копии, `soot` — сила пятен копоти.
 */
export type GrimLook = {
  fade: number;
  darken: number;
  dirtHeight: number;
  dirt: number;
  soot: number;
};
/**
 * Сканы и так грязные и выцветшие: им — лёгкая рука, иначе всё сливается в бурую кашу.
 */
export const SCAN_GRIM: GrimLook = {
  fade: 0.25,
  darken: 0.94,
  dirtHeight: 1.6,
  dirt: 0.38,
  soot: 0.16,
};
/** Старые яркие модели с цветами вершин (props.glb) — как было. */
const LEGACY_GRIM: GrimLook = {
  fade: 0.42,
  darken: 0.84,
  dirtHeight: 2.2,
  dirt: 0.65,
  soot: 0.35,
};

const glsl = (n: number) => n.toFixed(3);

/**
 * Мрачный вид любого материала со стандартными чанками three.js (Standard, Physical,
 * Basic): шейдер правится через onBeforeCompile, текстуры не нужны.
 *   - выцветание — цвет (уже с текстурой и оттенком копии) частью к серому и темнее;
 *   - грязь снизу — у земли (по высоте над основанием копии) бурее и темнее, как
 *     налипшая грязь и потёки;
 *   - пятна копоти — крупный шум по мировым координатам, у соседних домов разный.
 * Высота основания копии — атрибут `aBase` (y её места в мире); у меша без него
 * WebGL подставляет 0.
 */
const grimmed = new WeakSet<T.Material>();
export function applyGrim(material: T.Material, look: GrimLook = SCAN_GRIM) {
  // Общий материал многих моделей правится один раз: повторная правка задвоила бы объявления.
  if (grimmed.has(material)) return material;
  grimmed.add(material);
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aBase;\nvarying vec3 vGrimWorld;\nvarying float vGrimBase;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
        vGrimWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
        vGrimWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif
        vGrimBase = aBase;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vGrimWorld;\nvarying float vGrimBase;\nfloat grimHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float grimLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grimLum), ${glsl(look.fade)}) * ${glsl(look.darken)};
        float grimLow = 1.0 - smoothstep(0.0, ${glsl(look.dirtHeight)}, vGrimWorld.y - vGrimBase);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.52, 0.45, 0.38), grimLow * ${glsl(look.dirt)});
        vec2 grimCell = floor(vGrimWorld.xz * 0.35 + vec2(0.0, vGrimWorld.y * 0.2));
        float grimSoot = smoothstep(0.62, 1.0, grimHash(grimCell));
        diffuseColor.rgb *= 1.0 - grimSoot * ${glsl(look.soot)};`,
      );
  };
  const key = `grim-${look.fade}-${look.darken}-${look.dirtHeight}-${look.dirt}-${look.soot}`;
  material.customProgramCacheKey = () => key;
  return material;
}

/** Часть модели: один примитив .glb со своим материалом и матрицей узла в модели. */
type Part = {
  geometry: T.BufferGeometry;
  material: T.Material | T.Material[];
  matrix: T.Matrix4;
};

type PropBucket = {
  model: string;
  small: boolean;
  gore: boolean;
  /** Дальше этого расстояния от камеры до центра чанка копии не рисуются. */
  reach: number;
  /** Наибольший полуразмах копии по x/z: длинная модель видна, пока виден её край. */
  extent: number;
  items: MapProp[];
  cx: number;
  cz: number;
};

type Cull = { x: number; z: number; reach: number; gore: boolean };

/** Не больше `n` загрузок разом: 150 файлов одновременно забили бы сеть и декодер. */
function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return <R>(job: () => Promise<R>) =>
    new Promise<R>((resolve, reject) => {
      const run = () => {
        active++;
        job()
          .then(resolve, reject)
          .finally(() => {
            active--;
            queue.shift()?.();
          });
      };
      if (active < n) run();
      else queue.push(run);
    });
}

/** Листва, трава, сетка — вырезаются по альфе текстуры и видны с обеих сторон. */
const CUTOUT_NAME =
  /leaf|leaves|foliage|grass|branch|bush|tree|twig|ivy|plant|fern|weed|fence|net|chain|mesh|wire|hair/i;

/** Все текстуры материала — чтобы освободить их вместе с ним. */
function materialTextures(material: T.Material) {
  return Object.values(material).filter(
    (v): v is T.Texture => v instanceof T.Texture,
  );
}

/**
 * Готовые модели карты. Модель с `file` — свой .glb (сканы: свои материалы и текстуры,
 * часто несколько мешей), без него — узел `prop:<id>` общего `propKit.url` с цветами
 * вершин, `proc/building:…` — процедурное здание (components/world-proc-buildings.ts).
 * Копии одной модели в одном чанке — по InstancedMesh на каждый её примитив. Все файлы
 * грузятся при старте (не больше LOAD_PARALLEL разом), модели встают в сцену по мере
 * загрузки. Дальние чанки не рисуются: мелочь — дальше SMALL_VIEW, тяжёлые сканы —
 * дальше HEAVY_VIEW, остальное — за туманом.
 */
export function createPropLayer(def: ArenaDef) {
  const group = new T.Group();
  group.name = 'props';
  const kit = def.propKit;
  const props = def.props ?? [];
  const grim = def.mood === 'grim';
  const viewDistance = def.viewDistance ?? DEFAULT_VIEW;
  const meshes: T.InstancedMesh[] = [];
  const ownMaterials: T.Material[] = [];
  const gltfScenes: T.Object3D[] = [];
  const procGeometries: T.BufferGeometry[] = [];
  let goreOn = true;
  let disposed = false;
  let lastCull = -Infinity;
  let filesTotal = 0,
    filesDone = 0;

  // Старый общий props.glb: один материал с цветами вершин на все модели.
  let legacyMaterial: T.MeshStandardMaterial | undefined;
  let legacyBlood: T.MeshStandardMaterial | undefined;
  const legacyMaterials = () => {
    if (!legacyMaterial) {
      legacyMaterial = new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0,
      });
      if (grim) applyGrim(legacyMaterial, LEGACY_GRIM);
      // Кровь — влажная, с бликом, и не выцветает: иначе на мрачной карте она бурая, как грязь.
      legacyBlood = new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.28,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      ownMaterials.push(legacyMaterial, legacyBlood);
    }
    return { plain: legacyMaterial, blood: legacyBlood! };
  };

  // Копии по чанкам; ключ источника — файл модели, общий props.glb или id процедурного здания.
  const buckets = new Map<string, PropBucket>();
  const bySource = new Map<string, PropBucket[]>();
  for (const p of props) {
    const info = propModelInfo(kit, p.m);
    if (!info) continue;
    const s = p.s ?? 1;
    const small =
      info.hit === 'none' && (info.max[1] - info.min[1]) * s < SMALL_HEIGHT;
    const size = small ? SMALL_CHUNK : PROP_CHUNK;
    const cx = Math.floor(p.x / size),
      cz = Math.floor(p.z / size);
    const key = `${p.m}|${small ? 's' : 'b'}|${cx}|${cz}`;
    const extent =
      Math.max(
        Math.abs(info.min[0]),
        Math.abs(info.max[0]),
        Math.abs(info.min[2]),
        Math.abs(info.max[2]),
      ) * s;
    let b = buckets.get(key);
    if (!b) {
      const view = small
        ? SMALL_VIEW
        : (info.tris ?? 0) > HEAVY_TRIS
          ? Math.min(HEAVY_VIEW, viewDistance)
          : viewDistance;
      b = {
        model: p.m,
        small,
        gore: !!info.gore,
        reach: view + size * 0.71,
        extent: 0,
        items: [],
        cx: (cx + 0.5) * size,
        cz: (cz + 0.5) * size,
      };
      buckets.set(key, b);
      const source = isProcModel(p.m)
        ? `proc|${p.m}`
        : info.file
          ? `file|${info.file}`
          : 'legacy';
      bySource.set(source, [...(bySource.get(source) ?? []), b]);
    }
    b.extent = Math.max(b.extent, extent);
    b.items.push(p);
  }

  const m = new T.Matrix4(),
    q = new T.Quaternion(),
    pos = new T.Vector3(),
    scale = new T.Vector3(),
    up = new T.Vector3(0, 1, 0),
    tintColor = new T.Color();

  /** Копии корзины по частям модели: свой InstancedMesh на каждую часть. */
  const placeBucket = (b: PropBucket, parts: Part[]) => {
    const tinted = b.items.some((it) => it.tint);
    const placements = b.items.map((p) => {
      q.setFromAxisAngle(up, p.yaw ?? 0);
      pos.set(p.x, p.y, p.z);
      scale.setScalar(p.s ?? 1);
      return new T.Matrix4().compose(pos, q, scale);
    });
    // Высота основания — одна на все части копии: атрибут общий у их геометрий.
    const bases = new T.InstancedBufferAttribute(
      Float32Array.from(b.items, (p) => p.y),
      1,
    );
    for (const part of parts) {
      // Своя геометрия на меш — только ради атрибута копий `aBase`; вершины и
      // индексы общие с исходной моделью (те же буферы на видеокарте).
      const src = part.geometry;
      const geometry = new T.BufferGeometry();
      for (const [name, attr] of Object.entries(src.attributes))
        geometry.setAttribute(name, attr);
      geometry.setIndex(src.index);
      for (const g of src.groups)
        geometry.addGroup(g.start, g.count, g.materialIndex);
      if (!src.boundingSphere) src.computeBoundingSphere();
      if (!src.boundingBox) src.computeBoundingBox();
      geometry.boundingSphere = src.boundingSphere;
      geometry.boundingBox = src.boundingBox;
      geometry.setAttribute('aBase', bases);
      const mesh = new T.InstancedMesh(geometry, part.material, b.items.length);
      const spheres = new Float32Array(b.items.length * 4);
      placements.forEach((place, i) => {
        // Матрица узла — место примитива в модели и распаковка сжатых вершин (quantize).
        m.multiplyMatrices(place, part.matrix);
        mesh.setMatrixAt(i, m);
        if (tinted)
          mesh.setColorAt(i, tintColor.set(b.items[i].tint ?? '#ffffff'));
        // Слой моделей стоит в начале координат: матрица копии — это и есть её место в мире.
        const sphere = rayScratch.sphere
          .copy(src.boundingSphere!)
          .applyMatrix4(m);
        spheres.set(
          [sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius],
          i * 4,
        );
      });
      fastInstanceRaycast(mesh, spheres);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      mesh.castShadow = !b.small;
      mesh.userData.cull = {
        x: b.cx,
        z: b.cz,
        reach: b.reach + b.extent,
        gore: b.gore,
      } satisfies Cull;
      if (b.gore) {
        // Кровь и тела не мишень и не стена: краска и камера их не замечают.
        mesh.userData.noCameraCollision = true;
        mesh.userData.projectileCollision = 'ignore';
        mesh.visible = goreOn;
      }
      // Трава и цветы не мешают камере и не мишень для краски.
      if (b.small) mesh.userData.noCameraCollision = true;
      meshes.push(mesh);
      group.add(mesh);
    }
    // Новые меши сразу проходят отсечение по дальности при следующем view().
    lastCull = -Infinity;
  };

  /** Материалы скана: листва и сетка — вырезом по альфе, мрачный вид — всем непрозрачным. */
  const prepared = new Set<T.Material>();
  const prepareMaterial = (material: T.Material, hint: string) => {
    if (prepared.has(material)) return;
    prepared.add(material);
    const map = (material as T.MeshStandardMaterial).map;
    const cutout =
      material.alphaTest > 0 ||
      (material.transparent &&
        !!map &&
        CUTOUT_NAME.test(`${hint} ${material.name}`));
    if (cutout) {
      // Прозрачные копии InstancedMesh сортируются только целым мешем — листва в смеси
      // мерцала бы. Вырез по альфе пишет глубину, как непрозрачное.
      material.transparent = false;
      material.depthWrite = true;
      material.alphaTest = Math.max(material.alphaTest, 0.45);
      material.side = T.DoubleSide;
    } else if (material.transparent && map) {
      // Полупрозрачное с текстурой (стёкла, грязные плёнки): совсем пустое не рисуем.
      material.alphaTest = Math.max(material.alphaTest, 0.04);
    }
    if (grim && !material.transparent && 'color' in material)
      applyGrim(material, SCAN_GRIM);
  };

  const partsOf = (root: T.Object3D, hint: string) => {
    root.updateMatrixWorld(true);
    const parts: Part[] = [];
    root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of materials) prepareMaterial(mat, `${hint} ${o.name}`);
      parts.push({
        geometry: o.geometry,
        material: o.material,
        matrix: o.matrixWorld.clone(),
      });
    });
    return parts;
  };

  const loader = Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]).then(([{ GLTFLoader }, { MeshoptDecoder }]) =>
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),
  );
  const queue = limiter(LOAD_PARALLEL);
  let textures: TextureSetLoader | undefined;

  const loadSource = async (source: string, list: PropBucket[]) => {
    const bar = source.indexOf('|');
    const kind = source.slice(0, Math.max(0, bar)),
      ref = source.slice(bar + 1);
    if (source === 'legacy') {
      if (!kit?.url) return;
      const gltf = await queue(async () => (await loader).loadAsync(kit.url!));
      if (disposed) {
        disposeScene(gltf.scene);
        return;
      }
      gltfScenes.push(gltf.scene);
      gltf.scene.updateMatrixWorld(true);
      const { plain, blood } = legacyMaterials();
      for (const b of list) {
        // GLTFLoader убирает из имён узлов «:» и «/» (PropertyBinding.sanitizeNodeName).
        const node = gltf.scene.getObjectByName(
          T.PropertyBinding.sanitizeNodeName(`prop:${b.model}`),
        );
        if (!node) continue;
        const parts: Part[] = [];
        node.traverse((o) => {
          if (o instanceof T.Mesh)
            parts.push({
              geometry: o.geometry,
              material: b.model.startsWith('zk/blood') ? blood : plain,
              matrix: o.matrixWorld.clone(),
            });
        });
        placeBucket(b, parts);
      }
      return;
    }
    if (kind === 'proc') {
      const { buildProcBuilding } = await import('./world-proc-buildings');
      textures ??= createTextureSetLoader();
      const built = buildProcBuilding(ref, textures);
      if (!built || disposed) return;
      const parts = built.geometries.map(({ geometry, material }) => {
        procGeometries.push(geometry);
        ownMaterials.push(material);
        if (grim && !material.transparent) applyGrim(material, SCAN_GRIM);
        return { geometry, material, matrix: new T.Matrix4() };
      });
      for (const b of list) placeBucket(b, parts);
      return;
    }
    const gltf = await queue(async () => (await loader).loadAsync(ref));
    if (disposed) {
      disposeScene(gltf.scene);
      return;
    }
    gltfScenes.push(gltf.scene);
    const parts = partsOf(gltf.scene, list[0].model);
    for (const b of list) placeBucket(b, parts);
  };

  const disposeScene = (root: T.Object3D) =>
    root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      o.geometry.dispose();
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        materialTextures(mat).forEach((t) => t.dispose());
        mat.dispose();
      }
    });

  filesTotal = bySource.size;
  const ready = Promise.all(
    [...bySource].map(([source, list]) =>
      loadSource(source, list)
        .catch((error) =>
          console.warn('Модель карты не загрузилась', source, error),
        )
        .finally(() => filesDone++),
    ),
  ).then(() => undefined);

  const decals = createDecalLayer(def);
  group.add(decals.group);

  return {
    group,
    ready: Promise.all([ready, decals.ready]).then(() => undefined),
    /** Доля загруженных файлов моделей, 0…1. */
    progress: () => (filesTotal ? filesDone / filesTotal : 1),
    /** Дальние чанки не рисуются: проверка раз в полсекунды, по центру чанка. */
    view(eye: T.Vector3, seconds: number) {
      if (seconds - lastCull < 0.5) return;
      lastCull = seconds;
      for (const mesh of meshes) {
        const c = mesh.userData.cull as Cull;
        mesh.visible =
          (goreOn || !c.gore) && Math.hypot(c.x - eye.x, c.z - eye.z) < c.reach;
      }
      decals.view(eye);
    },
    /** Настройка «Кровь и жестокость»: кровь и тела видны или спрятаны целиком. */
    setGore(on: boolean) {
      goreOn = on;
      for (const mesh of meshes)
        if ((mesh.userData.cull as Cull).gore) mesh.visible = on;
      decals.setGore(on);
      lastCull = -Infinity;
    },
    dispose() {
      disposed = true;
      // Обёртки геометрии делят вершины с исходными моделями: освобождение любой из них
      // отпускает и общие буферы, поэтому ниже освобождается всё разом.
      meshes.forEach((mesh) => {
        mesh.geometry.dispose();
        mesh.dispose();
      });
      gltfScenes.forEach(disposeScene);
      procGeometries.forEach((g) => g.dispose());
      ownMaterials.forEach((mat) => mat.dispose());
      textures?.dispose();
      decals.dispose();
    },
  };
}

/** Сторона чанка декалей, м, и дальше какого расстояния их не видно. */
const DECAL_CHUNK = 125;
const DECAL_VIEW = 150;
/** Над землёй декаль приподнята на столько: иначе она тонет в ней на неровностях. */
const DECAL_LIFT = 0.025;

/**
 * Пятна на земле (`def.decals`): квадраты с альфой, по InstancedMesh на текстуру и чанк.
 * Глубину не пишут и смещены к камере (polygonOffset) — не мерцают на земле и асфальте.
 * На склоне ложатся по нормали рельефа.
 */
function createDecalLayer(def: ArenaDef) {
  const group = new T.Group();
  group.name = 'decals';
  const list = def.decals ?? [];
  const meshes: T.InstancedMesh[] = [];
  const materials: T.Material[] = [];
  const textures = new Map<string, Promise<T.Texture | undefined>>();
  const geometry = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  let goreOn = true;
  let disposed = false;
  const loader = new T.TextureLoader();
  const texture = (url: string, color: boolean) => {
    const key = `${url}|${color}`;
    let t = textures.get(key);
    if (!t) {
      t = loader.loadAsync(url).then(
        (tex) => {
          tex.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
          tex.anisotropy = 8;
          return tex;
        },
        () => {
          console.warn('Декаль не загрузилась', url);
          return undefined;
        },
      );
      textures.set(key, t);
    }
    return t;
  };

  const buckets = new Map<
    string,
    { texture: string; items: MapDecal[]; cx: number; cz: number }
  >();
  for (const d of list) {
    const cx = Math.floor(d.x / DECAL_CHUNK),
      cz = Math.floor(d.z / DECAL_CHUNK);
    const key = `${d.texture}|${cx}|${cz}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        texture: d.texture,
        items: [],
        cx: (cx + 0.5) * DECAL_CHUNK,
        cz: (cz + 0.5) * DECAL_CHUNK,
      };
      buckets.set(key, b);
    }
    b.items.push(d);
  }

  const materialFor = new Map<string, Promise<T.Material | undefined>>();
  const material = (id: string) => {
    let p = materialFor.get(id);
    if (p) return p;
    const spec = decalTextures(id);
    p = Promise.all([
      spec.map ? texture(spec.map, true) : undefined,
      spec.alphaMap ? texture(spec.alphaMap, false) : undefined,
      spec.normalMap ? texture(spec.normalMap, false) : undefined,
    ]).then(([map, alphaMap, normalMap]) => {
      if (!map && !alphaMap) return undefined;
      // Кадр атласа — копия текстуры со сдвигом: картинка в памяти одна.
      const frame = (t: T.Texture | undefined) => {
        if (!t || !spec.frame) return t;
        const { cols, rows, index } = spec.frame;
        const c = t.clone();
        c.repeat.set(1 / cols, 1 / rows);
        c.offset.set(
          (index % cols) / cols,
          1 - (Math.floor(index / cols) + 1) / rows,
        );
        return c;
      };
      const mat = new T.MeshStandardMaterial({
        map: frame(map) ?? null,
        alphaMap: frame(alphaMap) ?? null,
        normalMap: normalMap ?? null,
        color: spec.color ?? '#ffffff',
        roughness: spec.roughness,
        metalness: 0,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      materials.push(mat);
      return mat;
    });
    materialFor.set(id, p);
    return p;
  };

  const terrain = def.terrain;
  const ground = (x: number, z: number) =>
    terrain ? terrainHeightAt(terrain, x, z) : 0;
  const m = new T.Matrix4(),
    q = new T.Quaternion(),
    tilt = new T.Quaternion(),
    pos = new T.Vector3(),
    scale = new T.Vector3(),
    up = new T.Vector3(0, 1, 0),
    normal = new T.Vector3();

  const ready = Promise.all(
    [...buckets.values()].map(async (b) => {
      const mat = await material(b.texture);
      if (!mat || disposed) return;
      const mesh = new T.InstancedMesh(geometry, mat, b.items.length);
      b.items.forEach((d, i) => {
        const floor = ground(d.x, d.z);
        const y = d.y ?? floor;
        q.setFromAxisAngle(up, d.yaw ?? 0);
        // На рельефе (не на крыше и не на асфальте выше него) — по склону.
        if (terrain && Math.abs(y - floor) < 0.3) {
          normal
            .set(
              ground(d.x - 0.5, d.z) - ground(d.x + 0.5, d.z),
              1,
              ground(d.x, d.z - 0.5) - ground(d.x, d.z + 0.5),
            )
            .normalize();
          q.premultiply(tilt.setFromUnitVectors(up, normal));
        }
        pos.set(d.x, y + DECAL_LIFT, d.z);
        const s = d.s ?? 1;
        scale.set(s, 1, s);
        mesh.setMatrixAt(i, m.compose(pos, q, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      // Краска на земле: не мишень, не стена для камеры, лучом не проверяется вовсе.
      mesh.raycast = () => {};
      mesh.userData.noCameraCollision = true;
      mesh.userData.projectileCollision = 'ignore';
      const gore = isGoreDecal(b.texture);
      mesh.userData.cull = {
        x: b.cx,
        z: b.cz,
        reach: DECAL_VIEW + DECAL_CHUNK * 0.71,
        gore,
      } satisfies Cull;
      mesh.visible = goreOn || !gore;
      meshes.push(mesh);
      group.add(mesh);
    }),
  ).then(() => undefined);

  return {
    group,
    ready,
    view(eye: T.Vector3) {
      for (const mesh of meshes) {
        const c = mesh.userData.cull as Cull;
        mesh.visible =
          (goreOn || !c.gore) && Math.hypot(c.x - eye.x, c.z - eye.z) < c.reach;
      }
    },
    setGore(on: boolean) {
      goreOn = on;
      for (const mesh of meshes)
        if ((mesh.userData.cull as Cull).gore) mesh.visible = on;
    },
    dispose() {
      disposed = true;
      meshes.forEach((mesh) => mesh.dispose());
      geometry.dispose();
      materials.forEach((mat) => {
        materialTextures(mat).forEach((t) => t.dispose());
        mat.dispose();
      });
      for (const t of textures.values()) void t.then((tex) => tex?.dispose());
    },
  };
}
