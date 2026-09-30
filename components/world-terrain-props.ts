import * as T from 'three';
import type { ArenaDef, MapProp, MapTerrain } from '@/lib/maps/types';

/*
 * Рельеф и готовые модели огромной карты (lib/maps/outbreak.ts). Обычные арены сливают
 * всю геометрию в несколько мешей — на карте 2 × 2 км так нельзя: вся она не видна
 * никогда, а слитый меш не отсекается камерой. Поэтому и земля, и модели разложены по
 * квадратам (чанкам): что вне поля зрения или дальше дальности камеры — не рисуется.
 */

/** Квадратов рельефа на сторону чанка (при шаге 5 м — 160 м). */
const TERRAIN_CHUNK = 32;
/** Сторона чанка моделей, м. */
const PROP_CHUNK = 250;
/** Мелочь (трава, цветы, грибы) — своими чанками поменьше и видна только вблизи. */
const SMALL_CHUNK = 125;
const SMALL_VIEW = 150;
const SMALL_HEIGHT = 1.6;

/** Лёгкий разброс яркости земли, чтобы большие поля одного вида не были плоской заливкой. */
const tint = (x: number, z: number) =>
  0.92 +
  0.08 *
    Math.sin(x * 0.043 + Math.sin(z * 0.031) * 2) *
    Math.cos(z * 0.037 - x * 0.011);

export function createTerrainMeshes(t: MapTerrain, material: T.Material) {
  const group = new T.Group();
  group.name = 'terrain';
  const palette = (t.palette ?? [{ color: '#6d8f4a', name: '' }]).map(
    (p) => new T.Color(p.color),
  );
  const h = t.heights;
  const at = (c: number, r: number) =>
    h[
      Math.max(0, Math.min(t.rows - 1, r)) * t.cols +
        Math.max(0, Math.min(t.cols - 1, c))
    ];
  const repeat = 2.5;
  for (let r0 = 0; r0 < t.rows - 1; r0 += TERRAIN_CHUNK)
    for (let c0 = 0; c0 < t.cols - 1; c0 += TERRAIN_CHUNK) {
      const nc = Math.min(TERRAIN_CHUNK, t.cols - 1 - c0) + 1,
        nr = Math.min(TERRAIN_CHUNK, t.rows - 1 - r0) + 1;
      const positions = new Float32Array(nc * nr * 3),
        normals = new Float32Array(nc * nr * 3),
        colors = new Float32Array(nc * nr * 3),
        uvs = new Float32Array(nc * nr * 2);
      const n = new T.Vector3();
      for (let j = 0; j < nr; j++)
        for (let i = 0; i < nc; i++) {
          const c = c0 + i,
            r = r0 + j,
            k = j * nc + i;
          const x = t.minX + c * t.cell,
            z = t.minZ + r * t.cell;
          positions.set([x, at(c, r), z], k * 3);
          // Нормаль по соседям всей сетки: на стыках чанков нет шва освещения.
          n.set(
            at(c - 1, r) - at(c + 1, r),
            2 * t.cell,
            at(c, r - 1) - at(c, r + 1),
          ).normalize();
          normals.set([n.x, n.y, n.z], k * 3);
          const kind = t.kinds ? t.kinds[r * t.cols + c] : 0;
          const base = palette[kind] ?? palette[0];
          const f = tint(x, z);
          colors.set([base.r * f, base.g * f, base.b * f], k * 3);
          uvs.set([x / repeat, z / repeat], k * 2);
        }
      const index: number[] = [];
      for (let j = 0; j < nr - 1; j++)
        for (let i = 0; i < nc - 1; i++) {
          const a = j * nc + i,
            b = a + 1,
            c = a + nc,
            d = c + 1;
          index.push(a, c, b, b, c, d);
        }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(positions, 3));
      geo.setAttribute('normal', new T.BufferAttribute(normals, 3));
      geo.setAttribute('color', new T.BufferAttribute(colors, 3));
      geo.setAttribute('uv', new T.BufferAttribute(uvs, 2));
      geo.setIndex(index);
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new T.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      group.add(mesh);
    }
  return group;
}

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

type PropBucket = {
  model: string;
  small: boolean;
  items: MapProp[];
  cx: number;
  cz: number;
};

/**
 * Модели карты: один .glb с узлами `prop:<id>`, у всех моделей общий материал с цветами
 * вершин. Копии одной модели в одном чанке — один InstancedMesh.
 */
export function createPropLayer(def: ArenaDef) {
  const group = new T.Group();
  group.name = 'props';
  const kit = def.propKit;
  const props = def.props ?? [];
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
  });
  const smallMeshes: T.InstancedMesh[] = [];
  const meshes: T.InstancedMesh[] = [];
  let disposed = false;

  const buckets = new Map<string, PropBucket>();
  if (kit)
    for (const p of props) {
      const info = kit.models[p.m];
      if (!info) continue;
      const small =
        info.hit === 'none' &&
        (info.max[1] - info.min[1]) * (p.s ?? 1) < SMALL_HEIGHT;
      const size = small ? SMALL_CHUNK : PROP_CHUNK;
      const cx = Math.floor(p.x / size),
        cz = Math.floor(p.z / size);
      const key = `${p.m}|${small ? 's' : 'b'}|${cx}|${cz}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          model: p.m,
          small,
          items: [],
          cx: (cx + 0.5) * size,
          cz: (cz + 0.5) * size,
        };
        buckets.set(key, b);
      }
      b.items.push(p);
    }

  const ready = !kit
    ? Promise.resolve()
    : Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/libs/meshopt_decoder.module.js'),
      ])
        .then(([{ GLTFLoader }, { MeshoptDecoder }]) =>
          new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(kit.url),
        )
        .then((gltf) => {
          if (disposed) return;
          gltf.scene.updateMatrixWorld(true);
          const sources = new Map<
            string,
            { geometry: T.BufferGeometry; matrix: T.Matrix4 }
          >();
          const source = (id: string) => {
            let s = sources.get(id);
            if (s) return s;
            // GLTFLoader убирает из имён узлов «:» и «/» (PropertyBinding.sanitizeNodeName).
            const node = gltf.scene.getObjectByName(
              T.PropertyBinding.sanitizeNodeName(`prop:${id}`),
            );
            let mesh: T.Mesh | undefined;
            node?.traverse((o) => {
              if (!mesh && o instanceof T.Mesh) mesh = o;
            });
            if (!mesh) return undefined;
            // Матрица узла — распаковка сжатых вершин (quantize при сборке): её умножаем в каждую копию.
            s = { geometry: mesh.geometry, matrix: mesh.matrixWorld.clone() };
            sources.set(id, s);
            return s;
          };
          const m = new T.Matrix4(),
            q = new T.Quaternion(),
            pos = new T.Vector3(),
            scale = new T.Vector3(),
            up = new T.Vector3(0, 1, 0);
          for (const b of buckets.values()) {
            const src = source(b.model);
            if (!src) continue;
            const mesh = new T.InstancedMesh(
              src.geometry,
              material,
              b.items.length,
            );
            if (!src.geometry.boundingSphere)
              src.geometry.computeBoundingSphere();
            const spheres = new Float32Array(b.items.length * 4);
            b.items.forEach((p, i) => {
              q.setFromAxisAngle(up, p.yaw ?? 0);
              pos.set(p.x, p.y, p.z);
              scale.setScalar(p.s ?? 1);
              m.compose(pos, q, scale).multiply(src.matrix);
              mesh.setMatrixAt(i, m);
              // Слой моделей стоит в начале координат: матрица копии — это и есть её место в мире.
              const sphere = rayScratch.sphere
                .copy(src.geometry.boundingSphere!)
                .applyMatrix4(m);
              spheres.set(
                [
                  sphere.center.x,
                  sphere.center.y,
                  sphere.center.z,
                  sphere.radius,
                ],
                i * 4,
              );
            });
            fastInstanceRaycast(mesh, spheres);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.receiveShadow = true;
            mesh.castShadow = !b.small;
            mesh.userData.chunk = { x: b.cx, z: b.cz };
            if (b.small) {
              // Трава и цветы не мешают камере и не мишень для краски.
              mesh.userData.noCameraCollision = true;
              smallMeshes.push(mesh);
            }
            meshes.push(mesh);
            group.add(mesh);
          }
        })
        .catch((error) => console.warn('Модели карты не загрузились', error));

  let lastCull = -Infinity;
  return {
    group,
    ready,
    /** Мелочь дальше SMALL_VIEW не рисуется: проверка раз в полсекунды, по центру чанка. */
    view(eye: T.Vector3, seconds: number) {
      if (seconds - lastCull < 0.5) return;
      lastCull = seconds;
      const reach = SMALL_VIEW + SMALL_CHUNK * 0.71;
      for (const mesh of smallMeshes) {
        const c = mesh.userData.chunk as { x: number; z: number };
        mesh.visible = Math.hypot(c.x - eye.x, c.z - eye.z) < reach;
      }
    },
    dispose() {
      disposed = true;
      // Геометрия общая у всех копий модели и принадлежит загруженному файлу.
      const geometries = new Set(meshes.map((mesh) => mesh.geometry));
      meshes.forEach((mesh) => mesh.dispose());
      geometries.forEach((g) => g.dispose());
      material.dispose();
    },
  };
}
