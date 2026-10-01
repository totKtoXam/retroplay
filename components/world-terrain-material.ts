import * as T from 'three';
import type { MapTerrain } from '@/lib/maps/types';
import { textureSetUrl } from './world-pbr-textures';

/*
 * Рельеф огромной карты (lib/maps/outbreak.ts). Земля разложена по квадратам (чанкам):
 * слитый на 2 × 2 км меш не отсекался бы камерой, а целиком он не виден никогда.
 *
 * Вид земли — сплат PBR-сканов: у каждого вида палитры (`palette[i].texture`) свой набор
 * albedo / normal / roughness, все наборы лежат слоями в массивах текстур (WebGL2), а
 * шейдер в каждой точке смешивает виды четырёх соседних узлов сетки. Виды без текстуры
 * рисуются цветом палитры, как раньше.
 */

/** Квадратов рельефа на сторону чанка (при шаге 5 м — 160 м). */
const TERRAIN_CHUNK = 32;
/** Больше видов шейдер не знает: палитра карты — около десятка. */
const MAX_KINDS = 16;

/** Лёгкий разброс яркости земли, чтобы большие поля одного вида не были плоской заливкой. */
const tint = (x: number, z: number) =>
  0.92 +
  0.08 *
    Math.sin(x * 0.043 + Math.sin(z * 0.031) * 2) *
    Math.cos(z * 0.037 - x * 0.011);

/**
 * Чанки сетки высот. `paint` даёт цвет вершины по виду земли и оттенку `f`. Нормаль — по
 * соседям всей сетки, а не чанка: на стыках чанков нет шва освещения.
 */
function buildChunks(
  t: MapTerrain,
  material: T.Material,
  paint: (kind: number, f: number, out: Float32Array, at: number) => void,
  withUv: boolean,
) {
  const group = new T.Group();
  group.name = 'terrain';
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
        uvs = withUv ? new Float32Array(nc * nr * 2) : undefined;
      const n = new T.Vector3();
      for (let j = 0; j < nr; j++)
        for (let i = 0; i < nc; i++) {
          const c = c0 + i,
            r = r0 + j,
            k = j * nc + i;
          const x = t.minX + c * t.cell,
            z = t.minZ + r * t.cell;
          positions.set([x, at(c, r), z], k * 3);
          n.set(
            at(c - 1, r) - at(c + 1, r),
            2 * t.cell,
            at(c, r - 1) - at(c, r + 1),
          ).normalize();
          normals.set([n.x, n.y, n.z], k * 3);
          paint(
            t.kinds ? t.kinds[r * t.cols + c] : 0,
            tint(x, z),
            colors,
            k * 3,
          );
          uvs?.set([x / repeat, z / repeat], k * 2);
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
      if (uvs) geo.setAttribute('uv', new T.BufferAttribute(uvs, 2));
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

/** Рельеф цветом палитры в вершинах (карты без PBR-наборов): `material` с vertexColors. */
export function createTerrainMeshes(t: MapTerrain, material: T.Material) {
  const palette = (t.palette ?? [{ color: '#6d8f4a', name: '' }]).map(
    (p) => new T.Color(p.color),
  );
  return buildChunks(
    t,
    material,
    (kind, f, out, i) => {
      const base = palette[kind] ?? palette[0];
      out[i] = base.r * f;
      out[i + 1] = base.g * f;
      out[i + 2] = base.b * f;
    },
    true,
  );
}

/** У палитры есть хоть один PBR-набор — рельеф рисуется сплатом (`createTerrainSplat`). */
export const terrainHasTextures = (t: MapTerrain) =>
  !!t.palette?.some((p) => p.texture);

/**
 * Скалы для «отмывки» склонов: вид, чья текстура — камень или обрыв, иначе вид с именем
 * «скалы». Крутой склон (нормаль y < ~0,6) переходит в него, какой бы вид ни стоял в узле:
 * трава на обрыве выглядит натянутой плёнкой.
 */
function rockKind(t: MapTerrain) {
  const palette = t.palette ?? [];
  const byTexture = palette.findIndex((p) =>
    /rock|cliff/i.test(p.texture ?? ''),
  );
  return byTexture >= 0
    ? byTexture
    : palette.findIndex((p) => /скал|rock/i.test(p.name));
}

/** Картинка, или undefined, если файла нет: слой тогда остаётся ровным. */
const loadImage = (url: string) =>
  new T.ImageLoader().loadAsync(url).catch(() => {
    console.warn('Текстура рельефа не загрузилась', url);
    return undefined;
  });

/**
 * Картинка, уменьшенная до `size`² и перевёрнутая по вертикали: в массиве текстур нет
 * flipY, а нормали в соглашении OpenGL ждут верх картинки на v = 1.
 */
function pixels(
  image: HTMLImageElement | ImageBitmap | undefined,
  size: number,
  ctx: CanvasRenderingContext2D,
) {
  if (!image) return undefined;
  ctx.setTransform(1, 0, 0, -1, 0, size);
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

function arrayTexture(
  data: Uint8Array<ArrayBuffer>,
  size: number,
  layers: number,
  srgb: boolean,
) {
  const tex = new T.DataArrayTexture(data, size, size, layers);
  tex.format = T.RGBAFormat;
  tex.type = T.UnsignedByteType;
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.minFilter = T.LinearMipmapLinearFilter;
  tex.magFilter = T.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = T.SRGBColorSpace;
  tex.needsUpdate = true;
  // После загрузки в видеопамять копия в JS не нужна: на 1024² это десятки мегабайт.
  tex.onUpdate = () => {
    (tex.image as { data: Uint8Array | null }).data = null;
  };
  return tex;
}

const SPLAT_COMMON = /* glsl */ `
uniform sampler2D uKinds;
uniform vec3 uGrid;
uniform vec2 uGridSize;
uniform highp sampler2DArray uAlbedo;
uniform highp sampler2DArray uNormalRough;
uniform float uLayerOf[${MAX_KINDS}];
uniform vec3 uKindColor[${MAX_KINDS}];
uniform vec3 uLayerTint[${MAX_KINDS}];
uniform float uRockKind;
uniform float uReady;
varying vec3 vTerrainWorld;
varying vec3 vTerrainNormal;
float terrainHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float terrainNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), f.x),
             mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float terrainKindAt(ivec2 p) { return floor(texelFetch(uKinds, p, 0).r * 255.0 + 0.5); }
`;

/*
 * Смесь видов. Веса — билинейные по четырём узлам квадрата сетки, плюс скалы на крутизне;
 * одинаковые виды складываются, чтобы на однородном поле читать текстуру один раз. Затем
 * смесь «по высоте»: светлые (выпуклые) места вида побеждают раньше, и граница луга с
 * пашней рваная, как в жизни, а не размытая на 5 м.
 * Против плитки — два масштаба одной текстуры: 4 м и повёрнутый 23 м, доля второго
 * меняется крупным шумом и растёт с расстоянием, где повтор 4 м заметнее всего.
 */
const SPLAT_MAP = /* glsl */ `
vec3 tAlbedo = vec3(0.0);
vec2 tTilt = vec2(0.0);
float tRough = 0.0;
{
  // Узлы сетки ищутся по слегка искривлённой точке: граница видов идёт языками, а не
  // ровной линией по квадратам 5 м, заметной издалека.
  vec2 warp = vec2(terrainNoise(vTerrainWorld.xz / 13.0), terrainNoise(vTerrainWorld.zx / 13.0 + 17.0)) - 0.5;
  vec2 g = (vTerrainWorld.xz + warp * 7.0 - uGrid.xy) * uGrid.z;
  vec2 gi = clamp(floor(g), vec2(0.0), uGridSize - 2.0);
  vec2 ga = clamp(g - gi, 0.0, 1.0);
  ivec2 ii = ivec2(gi);
  float kind[5];
  float w[5];
  kind[0] = terrainKindAt(ii);
  kind[1] = terrainKindAt(ii + ivec2(1, 0));
  kind[2] = terrainKindAt(ii + ivec2(0, 1));
  kind[3] = terrainKindAt(ii + ivec2(1, 1));
  // Порог крутизны дрожит крупным шумом: граница травы и скал идёт языками, а не по горизонтали.
  float slopeY = normalize(vTerrainNormal).y + (terrainNoise(vTerrainWorld.xz / 9.0) - 0.5) * 0.16;
  float rock = uRockKind >= 0.0 ? smoothstep(0.8, 0.5, slopeY) : 0.0;
  w[0] = (1.0 - ga.x) * (1.0 - ga.y) * (1.0 - rock);
  w[1] = ga.x * (1.0 - ga.y) * (1.0 - rock);
  w[2] = (1.0 - ga.x) * ga.y * (1.0 - rock);
  w[3] = ga.x * ga.y * (1.0 - rock);
  kind[4] = max(uRockKind, 0.0);
  w[4] = rock;
  for (int i = 1; i < 5; i++)
    for (int j = 0; j < i; j++)
      if (w[i] > 0.0 && w[j] > 0.0 && kind[j] == kind[i]) { w[j] += w[i]; w[i] = 0.0; }
  vec2 uvA = vTerrainWorld.xz / 4.0;
  const mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  vec2 uvB = turn * vTerrainWorld.xz / 23.0;
  float far = smoothstep(20.0, 140.0, distance(vTerrainWorld, cameraPosition));
  float mixB = clamp(mix(0.15 + 0.55 * terrainNoise(vTerrainWorld.xz / 31.0), 0.8, far), 0.0, 1.0);
  vec3 alb[5];
  vec3 nr[5];
  float hgt[5];
  float best = -1.0;
  for (int i = 0; i < 5; i++) {
    alb[i] = vec3(0.0);
    nr[i] = vec3(0.0, 0.0, 0.92);
    hgt[i] = 0.0;
    if (w[i] <= 0.001) continue;
    int k = int(kind[i]);
    float layer = uReady > 0.5 ? uLayerOf[k] : -1.0;
    if (layer < 0.0) {
      alb[i] = uKindColor[k];
      hgt[i] = 0.5;
    } else {
      alb[i] = mix(texture(uAlbedo, vec3(uvA, layer)).rgb, texture(uAlbedo, vec3(uvB, layer)).rgb, mixB) * uLayerTint[int(layer)];
      vec4 a = texture(uNormalRough, vec3(uvA, layer));
      vec4 b = texture(uNormalRough, vec3(uvB, layer));
      // Наклон второго масштаба — обратно из повёрнутых UV в оси мира.
      vec2 tilt = mix(a.xy * 2.0 - 1.0, transpose(turn) * (b.xy * 2.0 - 1.0), mixB);
      nr[i] = vec3(tilt, mix(a.w, b.w, mixB));
      hgt[i] = dot(alb[i], vec3(0.3, 0.59, 0.11));
    }
    best = max(best, w[i] + hgt[i] * 0.35);
  }
  float total = 0.0;
  for (int i = 0; i < 5; i++) {
    if (w[i] <= 0.001) continue;
    float f = max(w[i] + hgt[i] * 0.35 - best + 0.18, 0.0);
    tAlbedo += alb[i] * f;
    tTilt += nr[i].xy * f;
    tRough += nr[i].z * f;
    total += f;
  }
  total = max(total, 1e-4);
  tAlbedo /= total;
  // Вдали рельеф мельче пикселя: наклоны нормалей там только рябят.
  tTilt *= (1.0 - 0.6 * far) / total;
  tRough /= total;
}
diffuseColor.rgb *= tAlbedo;
`;

/** Нормаль: наклон из текстур в базисе склона (u — ось x мира, v — ось z) → вид камеры. */
const SPLAT_NORMAL = /* glsl */ `
{
  vec3 tN = normalize(vTerrainNormal);
  vec3 tT = normalize(vec3(1.0, 0.0, 0.0) - tN * tN.x);
  vec3 tB = normalize(vec3(0.0, 0.0, 1.0) - tN * tN.z);
  float tZ = sqrt(max(1.0 - dot(tTilt, tTilt), 0.0));
  normal = normalize((viewMatrix * vec4(normalize(tT * tTilt.x + tB * tTilt.y + tN * tZ), 0.0)).xyz);
}
`;

/**
 * Рельеф сплатом PBR-наборов. Наборы грузятся асинхронно (`ready`): до этого земля
 * рисуется цветом палитры. `size` — сторона слоя массива (1024, на слабом качестве 512).
 * Цвет `material.color` — общий множитель (сезон, мрачная перекраска), цвет вершин —
 * лёгкий разброс яркости.
 */
export function createTerrainSplat(
  t: MapTerrain,
  options: { size?: number } = {},
) {
  const size = options.size ?? 1024;
  const palette = (t.palette ?? [{ color: '#6d8f4a', name: '' }]).slice(
    0,
    MAX_KINDS,
  );
  const sets = [
    ...new Set(palette.map((p) => p.texture).filter((s): s is string => !!s)),
  ];
  const layerOf = Array.from({ length: MAX_KINDS }, (_, i) => {
    const set = palette[i]?.texture;
    return set ? sets.indexOf(set) : -1;
  });
  const kindColor = Array.from(
    { length: MAX_KINDS },
    (_, i) => new T.Color(palette[i]?.color ?? '#808080'),
  );

  const kinds = new T.DataTexture(
    t.kinds ?? new Uint8Array(t.cols * t.rows),
    t.cols,
    t.rows,
    T.RedFormat,
    T.UnsignedByteType,
  );
  kinds.unpackAlignment = 1;
  kinds.minFilter = kinds.magFilter = T.NearestFilter;
  kinds.generateMipmaps = false;
  kinds.needsUpdate = true;
  const placeholder = new T.DataArrayTexture(
    new Uint8Array([128, 128, 255, 230]),
    1,
    1,
    1,
  );
  placeholder.needsUpdate = true;
  const uniforms = {
    uKinds: { value: kinds },
    uGrid: { value: new T.Vector3(t.minX, t.minZ, 1 / t.cell) },
    uGridSize: { value: new T.Vector2(t.cols, t.rows) },
    uAlbedo: { value: placeholder as T.DataArrayTexture },
    uNormalRough: { value: placeholder as T.DataArrayTexture },
    uLayerOf: { value: layerOf },
    uKindColor: { value: kindColor },
    uLayerTint: {
      value: Array.from({ length: MAX_KINDS }, () => new T.Color(1, 1, 1)),
    },
    uRockKind: { value: rockKind(t) },
    uReady: { value: 0 },
  };

  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTerrainWorld;\nvarying vec3 vTerrainNormal;',
      )
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrainNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SPLAT_COMMON}`)
      .replace('#include <map_fragment>', SPLAT_MAP)
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = roughness * tRough;',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${SPLAT_NORMAL}`,
      );
  };
  material.customProgramCacheKey = () => 'terrain-splat';

  const group = buildChunks(
    t,
    material,
    (_kind, f, out, i) => {
      out[i] = out[i + 1] = out[i + 2] = f;
    },
    false,
  );

  let disposed = false;
  let albedo: T.DataArrayTexture | undefined,
    normalRough: T.DataArrayTexture | undefined;
  const ready = Promise.all(
    sets.map((id) =>
      Promise.all([
        loadImage(textureSetUrl(id, 'albedo')),
        loadImage(textureSetUrl(id, 'normal')),
        loadImage(textureSetUrl(id, 'rough')),
      ]),
    ),
  ).then((images) => {
    if (disposed || !sets.length) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const texels = size * size;
    const albedoData = new Uint8Array(texels * 4 * sets.length),
      normalData = new Uint8Array(texels * 4 * sets.length);
    images.forEach(([a, n, r], layer) => {
      const base = layer * texels * 4;
      const ap = pixels(a, size, ctx);
      if (ap) albedoData.set(ap, base);
      else albedoData.fill(128, base, base + texels * 4);
      const np = pixels(n, size, ctx);
      if (np) normalData.set(np, base);
      const rp = pixels(r, size, ctx);
      for (let i = 0; i < texels; i++) {
        const o = base + i * 4;
        if (!np) {
          normalData[o] = normalData[o + 1] = 128;
          normalData[o + 2] = 255;
        }
        // Шероховатость — в альфе карты нормалей: два массива вместо трёх.
        normalData[o + 3] = rp ? rp[i * 4] : 230;
      }
    });
    // Сканы снимали в разную погоду: один набор светлее, другой синее. Средний цвет слоя
    // наполовину подтягивается к цвету палитры — она задаёт тон карты и совпадает с миникартой.
    sets.forEach((id, layer) => {
      const kind = palette.findIndex((p) => p.texture === id);
      const mean = [0, 0, 0];
      const base = layer * texels * 4;
      let n = 0;
      for (let i = 0; i < texels; i += 61) {
        for (let ch = 0; ch < 3; ch++)
          mean[ch] += (albedoData[base + i * 4 + ch] / 255) ** 2.2;
        n++;
      }
      const want = kindColor[kind];
      const tint = uniforms.uLayerTint.value[layer];
      const ratio = (ch: number, target: number) =>
        Math.min(2, Math.max(0.5, target / Math.max(1e-3, mean[ch] / n)));
      tint.setRGB(
        Math.sqrt(ratio(0, want.r)),
        Math.sqrt(ratio(1, want.g)),
        Math.sqrt(ratio(2, want.b)),
      );
    });
    albedo = arrayTexture(albedoData, size, sets.length, true);
    normalRough = arrayTexture(normalData, size, sets.length, false);
    uniforms.uAlbedo.value = albedo;
    uniforms.uNormalRough.value = normalRough;
    uniforms.uReady.value = 1;
  });

  return {
    group,
    material,
    ready,
    dispose() {
      disposed = true;
      group.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      material.dispose();
      kinds.dispose();
      placeholder.dispose();
      albedo?.dispose();
      normalRough?.dispose();
    },
  };
}
