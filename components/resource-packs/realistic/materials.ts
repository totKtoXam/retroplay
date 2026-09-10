import * as T from 'three';
import { visualBudget } from '../../../lib/resource-packs.ts';
export type Surface =
  | 'concrete'
  | 'steel'
  | 'rubber'
  | 'canvas'
  | 'plaster'
  | 'wetstone';

function tileNoise(x: number, y: number, cells: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fade = (v: number) => v * v * (3 - 2 * v);
  const hash = (a: number, b: number) => {
    let n = Math.imul((a + cells) % cells, 374761393) + Math.imul((b + cells) % cells, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const u = fade(x - ix), v = fade(y - iy);
  return T.MathUtils.lerp(T.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u), T.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
}
/** Seamless deterministic PBR maps. No network fetches or runtime random gameplay state. */
export function surfacePixels(kind: Surface, size: number) {
  const albedo = new Uint8Array(size * size * 4),
    normal = albedo.slice(),
    orm = albedo.slice();
  const height = new Float32Array(size * size);
  let seed = 18073;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const palette: Record<Surface, number[]> = {
    concrete: [155, 151, 141],
    steel: [133, 136, 132],
    rubber: [59, 61, 58],
    canvas: [119, 116, 97],
    plaster: [193, 187, 172],
    wetstone: [100, 106, 104],
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2,
        v = (y / size) * Math.PI * 2;
      const mottling =
        (tileNoise(x / size * 4, y / size * 4, 4) * 0.55 + tileNoise(x / size * 13, y / size * 13, 13) * 0.3 + tileNoise(x / size * 37, y / size * 37, 37) * 0.15 - 0.5) * 2;
      const grain = noise(),
        pore = grain < 0.022 ? -0.2 : 0;
      const weave =
        kind === 'canvas' ? Math.sin(u * 64) * Math.sin(v * 64) * 0.18 : 0;
      const scratch =
        kind === 'steel' && Math.sin(v * 61 + Math.sin(u * 2)) > 0.988
          ? 0.18
          : 0;
      const seam = kind === 'concrete' && y % (size / 2) < 1 ? -0.2 : 0;
      height[y * size + x] =
        0.5 +
        mottling * 0.08 +
        (grain - 0.5) * 0.12 +
        pore +
        weave +
        scratch +
        seam;
      const i = (y * size + x) * 4;
      const grime = Math.max(0, mottling + 0.1) * 0.22;
      for (let c = 0; c < 3; c++)
        albedo[i + c] = Math.max(
          0,
          Math.min(
            255,
            palette[kind][c] * (1 - grime) +
              (grain - 0.5) * 23 +
              pore * 48 +
              weave * 37 +
              scratch * 190 +
              seam * 80,
          ),
        );
      albedo[i + 3] = 255;
      orm[i] = Math.round(255 * (1 + Math.min(0, pore) * 0.55));
      orm[i + 1] = Math.round(
        255 *
          (kind === 'wetstone'
            ? 0.18 + grain * 0.25
            : kind === 'steel'
              ? 0.35 + grime + grain * 0.2
              : 0.77 + grain * 0.22),
      );
      orm[i + 2] = kind === 'steel' ? 210 : 0;
      orm[i + 3] = 255;
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sample = (a: number, b: number) =>
        height[((b + size) % size) * size + ((a + size) % size)];
      const nx = (sample(x - 1, y) - sample(x + 1, y)) * 1.4;
      const ny = (sample(x, y - 1) - sample(x, y + 1)) * 1.4;
      const len = Math.hypot(nx, ny, 1),
        i = (y * size + x) * 4;
      normal[i] = ((nx / len) * 0.5 + 0.5) * 255;
      normal[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      normal[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  return { albedo, normal, orm };
}
export function createRealisticMaterials(quality: string) {
  const budget = visualBudget(quality),
    textures: T.Texture[] = [];
  const cache = new Map<Surface, T.MeshStandardMaterial>();
  const texture = (data: Uint8Array, color = false) => {
    const map = new T.DataTexture(data, budget.textureSize, budget.textureSize);
    map.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
    map.wrapS = map.wrapT = T.RepeatWrapping;
    map.magFilter = T.LinearFilter;
    map.minFilter = T.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = budget.anisotropy;
    map.needsUpdate = true;
    textures.push(map);
    return map;
  };
  return {
    get(kind: Surface) {
      if (!cache.has(kind)) {
        const pixels = surfacePixels(kind, budget.textureSize);
        const map = texture(pixels.albedo, true),
          normalMap = texture(pixels.normal),
          orm = texture(pixels.orm);
        cache.set(
          kind,
          new T.MeshStandardMaterial({
            name: `field-${kind}`,
            map,
            normalMap,
            roughnessMap: orm,
            metalnessMap: orm,
            aoMap: orm,
            aoMapIntensity: 0.55,
            roughness: 1,
            metalness: kind === 'steel' ? 1 : 0,
            normalScale: new T.Vector2(
              kind === 'canvas' ? 0.18 : 0.16,
              kind === 'canvas' ? 0.18 : 0.16,
            ),
          }),
        );
      }
      return cache.get(kind)!;
    },
    get textureBytes() {
      return (textures.length * budget.textureSize ** 2 * 4 * 4) / 3;
    },
    dispose() {
      cache.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
export type RealisticMaterials = ReturnType<typeof createRealisticMaterials>;
