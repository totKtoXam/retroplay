// Сборка моделей карты «Зона заражения» (lib/maps/outbreak.ts) из наборов Kenney (CC0):
//   City Kit (Commercial), City Kit (Suburban), City Kit (Roads), Car Kit, Nature Kit,
//   Graveyard Kit — https://kenney.nl/assets
//
// Исходники — самодостаточные .glb из зеркала https://github.com/Hidencod/tge-assets
// (все модели там — Kenney, CC0). Сайт kenney.nl из рабочего окружения недоступен,
// поэтому скрипт берёт файлы с raw.githubusercontent.com по зафиксированному коммиту.
// Можно передать папку `packs/` уже скачанного зеркала.
//
// Что делает с каждой моделью:
//   - сводит все её части в один примитив: карта ставит тысячи копий через
//     InstancedMesh, а у инстанса ровно одна геометрия и один материал;
//   - запекает цвет в вершины: у Kenney текстура — палитра из полос (colormap.png),
//     у Nature Kit — плоские цвета материалов; и то и другое точно передаётся
//     цветом вершины, и все модели делят один материал;
//   - масштабирует в метры (SCALE по набору, `s` у отдельной модели), не трогая начало
//     координат: у плиток дорог оно в центре клетки, у деревьев — у корня.
//
// Результат: public/models/outbreak/props.glb (узлы `prop:<id>`) и
// lib/maps/outbreak-models.ts — рамки моделей в метрах и их столкновение.
//
// Запуск (зависимости ставятся рядом, в проект не добавляются):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
//   node scripts/build-outbreak-models.mjs [папка packs зеркала]
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  meshopt,
  prune,
  quantize,
  weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dir = process.argv[2];
const OUT = path.resolve(process.env.OUT ?? 'public/models/outbreak');
const TABLE = path.resolve(process.env.TABLE ?? 'lib/maps/outbreak-models.ts');
const MIRROR =
  'https://raw.githubusercontent.com/Hidencod/tge-assets/dc56ea9f77595fc96433b7d944ad5ce5ef1b61c2/packs';

/** Набор → короткий префикс id и масштаб в метры по умолчанию. */
const PACKS = {
  com: { pack: 'city-kit-commercial', scale: 8 },
  sub: { pack: 'city-kit-suburban', scale: 7 },
  road: { pack: 'city-kit-roads', scale: 8 },
  car: { pack: 'car-kit', scale: 1.8 },
  nat: { pack: 'nature-kit', scale: 7 },
  grave: { pack: 'graveyard-kit', scale: 2.4 },
};

/**
 * Модели и их столкновение: `box` — вся рамка, `trunk` — ствол полушириной `t` м
 * у начала координат во всю высоту, `none` — сквозь проходят (трава, разметка, мусор).
 */
const box = (ids, extra = {}) =>
  ids.map((id) => ({ id, hit: 'box', ...extra }));
const none = (ids, extra = {}) =>
  ids.map((id) => ({ id, hit: 'none', ...extra }));
const trunk = (ids, t, extra = {}) =>
  ids.map((id) => ({ id, hit: 'trunk', t, ...extra }));
const letters = (from, to) =>
  Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, i) =>
    String.fromCharCode(from.charCodeAt(0) + i),
  );

const MODELS = [
  // Город и мегаполис.
  ...box(letters('a', 'n').map((l) => `com/building-${l}`)),
  ...box(
    letters('a', 'e').map((l) => `com/building-skyscraper-${l}`),
    { s: 12 },
  ),
  ...box(
    [
      ...letters('a', 'm').map((l) => `com/low-detail-building-${l}`),
      'com/low-detail-building-wide-a',
      'com/low-detail-building-wide-b',
    ],
    { s: 16 },
  ),
  ...none(['com/detail-parasol-a', 'com/detail-parasol-b']),
  // Пригород и деревни.
  ...box(letters('a', 'u').map((l) => `sub/building-type-${l}`)),
  ...box(['sub/fence', 'sub/planter'], { s: 8 }),
  ...trunk(['sub/tree-large', 'sub/tree-small'], 0.25, { s: 8 }),
  // Дороги и улица.
  ...none([
    'road/road-straight',
    'road/road-straight-half',
    'road/road-intersection',
    'road/road-intersection-line',
    'road/road-crossroad',
    'road/road-crossroad-line',
    'road/road-crossing',
    'road/road-bend',
    'road/road-bend-sidewalk',
    'road/road-curve',
    'road/road-end',
    'road/road-end-round',
    'road/road-square',
    'road/road-side',
    'road/road-driveway-single',
    'road/road-roundabout',
    'road/tile-low',
  ]),
  ...trunk(
    [
      'road/light-square',
      'road/light-square-double',
      'road/light-curved',
      'road/light-curved-double',
      'road/traffic-light',
      'road/road-sign-stop',
      'road/road-sign-warning',
      'road/road-sign-street',
    ],
    0.2,
  ),
  ...trunk(['road/electricity-pole-single', 'road/electricity-pole'], 0.25, {
    s: 14,
  }),
  ...trunk(['road/sign-highway', 'road/sign-highway-wide'], 0.3),
  ...box([
    'road/dumpster',
    'road/construction-barrier',
    'road/construction-fence',
    'road/construction-light',
    'road/construction-cone',
  ]),
  ...box(['road/bridge-pillar-wide']),
  // Брошенные машины и обломки.
  ...box([
    'car/ambulance',
    'car/delivery',
    'car/delivery-flat',
    'car/firetruck',
    'car/garbage-truck',
    'car/hatchback-sports',
    'car/police',
    'car/sedan',
    'car/sedan-sports',
    'car/suv',
    'car/suv-luxury',
    'car/taxi',
    'car/tractor',
    'car/tractor-shovel',
    'car/truck',
    'car/truck-flat',
    'car/van',
    'car/box',
  ]),
  ...none([
    'car/debris-tire',
    'car/debris-door',
    'car/debris-bumper',
    'car/debris-plate-a',
    'car/debris-plate-b',
    'car/debris-drivetrain',
    'car/cone',
  ]),
  // Лес, горы, степь, поля.
  ...trunk(
    [
      'nat/tree-oak',
      'nat/tree-oak-dark',
      'nat/tree-oak-fall',
      'nat/tree-default',
      'nat/tree-default-dark',
      'nat/tree-default-fall',
      'nat/tree-detailed',
      'nat/tree-detailed-dark',
      'nat/tree-detailed-fall',
      'nat/tree-fat',
      'nat/tree-fat-fall',
      'nat/tree-tall',
      'nat/tree-tall-dark',
      'nat/tree-thin',
      'nat/tree-thin-fall',
      'nat/tree-simple',
      'nat/tree-simple-fall',
      'nat/tree-plateau',
      'nat/tree-plateau-fall',
      'nat/tree-cone',
      'nat/tree-cone-dark',
      'nat/tree-pinedefaulta',
      'nat/tree-pinedefaultb',
      'nat/tree-pinerounda',
      'nat/tree-pineroundb',
      'nat/tree-pineroundc',
      'nat/tree-pinetalla',
      'nat/tree-pinetallb',
      'nat/tree-pinetallc',
      'nat/tree-pinetalld',
      'nat/tree-pinetalld-detailed',
      'nat/tree-pinesmalla',
      'nat/tree-pinesmallb',
    ],
    0.3,
  ),
  ...box(
    letters('a', 'f').map((l) => `nat/rock-large${l}`),
    { s: 5 },
  ),
  ...box(
    letters('a', 'j').map((l) => `nat/rock-tall${l}`),
    { s: 5 },
  ),
  ...box(
    letters('a', 'f').map((l) => `nat/stone-large${l}`),
    { s: 5 },
  ),
  ...box(
    letters('a', 'c').map((l) => `nat/stone-tall${l}`),
    { s: 5 },
  ),
  ...none(
    [
      'nat/rock-smalla',
      'nat/rock-smallb',
      'nat/rock-smalld',
      'nat/rock-smalli',
      'nat/stone-smalla',
      'nat/stone-smallb',
    ],
    { s: 4 },
  ),
  ...none(
    [
      'nat/plant-bush',
      'nat/plant-bushdetailed',
      'nat/plant-bushlarge',
      'nat/plant-bushsmall',
      'nat/plant-bushtriangle',
      'nat/plant-bushlargetriangle',
    ],
    { s: 4 },
  ),
  ...none(
    ['nat/grass', 'nat/grass-large', 'nat/grass-leafs', 'nat/grass-leafslarge'],
    { s: 3 },
  ),
  ...none(
    [
      'nat/flower-reda',
      'nat/flower-yellowa',
      'nat/flower-purplea',
      'nat/mushroom-redgroup',
      'nat/mushroom-tangroup',
    ],
    { s: 3 },
  ),
  ...box(
    [
      'nat/log-large',
      'nat/log-stack',
      'nat/log-stacklarge',
      'nat/stump-oldtall',
      'nat/stump-round',
      'nat/stump-squaredetailedwide',
    ],
    { s: 4 },
  ),
  ...box(
    [
      'nat/tent-detailedopen',
      'nat/tent-detailedclosed',
      'nat/tent-smallclosed',
      'nat/tent-smallopen',
    ],
    { s: 5 },
  ),
  ...none(['nat/campfire-stones', 'nat/campfire-logs'], { s: 4 }),
  ...none(
    [
      'nat/crops-cornstagec',
      'nat/crops-cornstaged',
      'nat/crops-wheatstageb',
      'nat/crops-leafsstageb',
      'nat/crops-dirtrow',
      'nat/crops-dirtdoublerow',
    ],
    { s: 3.5 },
  ),
  ...box(['nat/fence-simple', 'nat/fence-planks', 'nat/fence-gate'], { s: 4 }),
  ...box(
    [
      'nat/statue-obelisk',
      'nat/statue-column',
      'nat/statue-columndamaged',
      'nat/statue-head',
    ],
    { s: 4 },
  ),
  // Кладбище, хутора, руины.
  ...box([
    'grave/gravestone-bevel',
    'grave/gravestone-broken',
    'grave/gravestone-cross',
    'grave/gravestone-cross-large',
    'grave/gravestone-decorative',
    'grave/gravestone-roof',
    'grave/gravestone-round',
    'grave/gravestone-wide',
    'grave/cross',
    'grave/cross-wood',
    'grave/crypt',
    'grave/crypt-small',
    'grave/crypt-large',
    'grave/iron-fence',
    'grave/iron-fence-damaged',
    'grave/iron-fence-border-gate',
    'grave/stone-wall',
    'grave/stone-wall-damaged',
    'grave/stone-wall-column',
    'grave/brick-wall',
    'grave/fence',
    'grave/fence-damaged',
    'grave/bench-damaged',
    'grave/hay-bale',
    'grave/hay-bale-bundled',
    'grave/coffin-old',
    'grave/altar-stone',
    'grave/trunk-long',
    'grave/rocks',
    'grave/rocks-tall',
  ]),
  ...none([
    'grave/grave',
    'grave/grave-border',
    'grave/pumpkin',
    'grave/debris',
    'grave/debris-wood',
    'grave/shovel-dirt',
    'grave/fire-basket',
    'grave/urn-round',
    'grave/lantern-candle',
  ]),
  ...trunk(['grave/lightpost-single', 'grave/lightpost-double'], 0.2, {
    s: 3.2,
  }),
  ...trunk(
    [
      'grave/pine',
      'grave/pine-crooked',
      'grave/pine-fall',
      'grave/pine-fall-crooked',
    ],
    0.3,
    { s: 4.5 },
  ),
];

await mkdir(OUT, { recursive: true });
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

async function source(pack, file) {
  if (dir) return readFile(path.join(dir, pack, `${file}.glb`));
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${MIRROR}/${pack}/${file}.glb`);
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    if (attempt >= 3) throw Error(`${pack}/${file}: ${response.status}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

const toLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
/** Палитры Kenney одинаковы у многих моделей: раскодированная картинка кэшируется по содержимому. */
const images = new Map();
async function pixels(texture) {
  const bytes = texture.getImage();
  const key = Buffer.from(bytes).toString('base64').slice(0, 64) + bytes.length;
  let img = images.get(key);
  if (!img) {
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    img = { data, w: info.width, h: info.height };
    images.set(key, img);
  }
  return img;
}

/** Точка через матрицу 4×4 (столбцами, как в glTF). */
const apply = (m, x, y, z, w) => [
  m[0] * x + m[4] * y + m[8] * z + m[12] * w,
  m[1] * x + m[5] * y + m[9] * z + m[13] * w,
  m[2] * x + m[6] * y + m[10] * z + m[14] * w,
];

const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene('props');
out.getRoot().setDefaultScene(scene);
const shared = out
  .createMaterial('props')
  .setBaseColorFactor([1, 1, 1, 1])
  .setRoughnessFactor(0.85)
  .setMetallicFactor(0);
const table = [];

for (const entry of MODELS) {
  const [short, file] = entry.id.split('/');
  const { pack, scale: packScale } = PACKS[short];
  const scale = entry.s ?? packScale;
  const src = await io.readBinary(await source(pack, file));
  const positions = [],
    normals = [],
    colors = [],
    indices = [];
  const nodes = [];
  (src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0]).traverse(
    (n) => n.getMesh() && nodes.push(n),
  );
  for (const node of nodes) {
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION'),
        nor = prim.getAttribute('NORMAL'),
        col = prim.getAttribute('COLOR_0');
      const material = prim.getMaterial();
      const texture = material?.getBaseColorTexture();
      // У Nature Kit (материалы без текстуры) в baseColorFactor записан цвет в sRGB, а не
      // линейный, как требует glTF: так модели выглядят на превью Kenney и зеркала. Без
      // перевода деревья и камни выходили бледными, пастельными.
      const raw = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const factor = texture ? raw : [...raw.slice(0, 3).map(toLinear), raw[3]];
      const info = material?.getBaseColorTextureInfo();
      const uv = texture
        ? prim.getAttribute(`TEXCOORD_${info.getTexCoord()}`)
        : null;
      const transform = info?.getExtension('KHR_texture_transform');
      const img = texture ? await pixels(texture) : null;
      const base = positions.length / 3;
      for (let i = 0; i < pos.getCount(); i++) {
        const p = pos.getElement(i, []);
        const [x, y, z] = apply(m, p[0], p[1], p[2], 1);
        positions.push(x * scale, y * scale, z * scale);
        const n = nor ? nor.getElement(i, []) : [0, 1, 0];
        const [nx, ny, nz] = apply(m, n[0], n[1], n[2], 0);
        const len = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / len, ny / len, nz / len);
        let rgb = factor.slice(0, 3);
        if (img && uv) {
          let [u, v] = uv.getElement(i, []);
          if (transform) {
            const [su, sv] = transform.getScale(),
              [ou, ov] = transform.getOffset();
            u = u * su + ou;
            v = v * sv + ov;
          }
          const px = Math.min(
            img.w - 1,
            Math.max(0, Math.floor((u - Math.floor(u)) * img.w)),
          );
          const py = Math.min(
            img.h - 1,
            Math.max(0, Math.floor((v - Math.floor(v)) * img.h)),
          );
          const k = (py * img.w + px) * 4;
          rgb = rgb.map((c, j) => c * toLinear(img.data[k + j] / 255));
        }
        if (col) {
          const c = col.getElement(i, []);
          rgb = rgb.map((v, j) => v * c[j]);
        }
        colors.push(...rgb);
      }
      const idx = prim.getIndices();
      if (idx)
        for (let i = 0; i < idx.getCount(); i++)
          indices.push(base + idx.getScalar(i));
      else for (let i = 0; i < pos.getCount(); i++) indices.push(base + i);
    }
  }
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let j = 0; j < 3; j++) {
      min[j] = Math.min(min[j], positions[i + j]);
      max[j] = Math.max(max[j], positions[i + j]);
    }
  const accessor = (type, array) =>
    out.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const prim = out
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array(normals)))
    .setAttribute('COLOR_0', accessor('VEC3', new Float32Array(colors)))
    .setIndices(
      accessor(
        'SCALAR',
        positions.length / 3 > 65535
          ? new Uint32Array(indices)
          : new Uint16Array(indices),
      ),
    )
    .setMaterial(shared);
  const name = `prop:${entry.id}`;
  scene.addChild(
    out.createNode(name).setMesh(out.createMesh(name).addPrimitive(prim)),
  );
  const r = (v) => Math.round(v * 100) / 100;
  table.push({
    id: entry.id,
    min: min.map(r),
    max: max.map(r),
    hit: entry.hit,
    ...(entry.t ? { t: entry.t } : {}),
  });
  console.log(
    entry.id,
    `${indices.length / 3} тр.`,
    max.map((v, j) => (v - min[j]).toFixed(1)).join('×'),
    'м',
  );
}

await out.transform(
  dedup(),
  weld(),
  prune(),
  quantize({ quantizeColor: 8 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
const file = path.join(OUT, 'props.glb');
await io.write(file, out);
console.log(
  file,
  ((await stat(file)).size / 1024).toFixed(0),
  'КБ,',
  table.length,
  'моделей',
);

const lines = table.map(
  (t) =>
    `  '${t.id}': { min: [${t.min.join(', ')}], max: [${t.max.join(', ')}], hit: '${t.hit}'${t.t ? `, t: ${t.t}` : ''} },`,
);
await writeFile(
  TABLE,
  `// Создано scripts/build-outbreak-models.mjs — не править руками.
// Рамки моделей карты «Зона заражения» в метрах (у начала координат модели, до поворота)
// и их столкновение: 'box' — вся рамка, 'trunk' — ствол полушириной \`t\` м, 'none' — сквозь.

export type PropHit = 'box' | 'trunk' | 'none';
export type PropModel = {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  hit: PropHit;
  t?: number;
};

export const OUTBREAK_MODELS = {
${lines.join('\n')}
} as const satisfies Record<string, PropModel>;

export type OutbreakModelId = keyof typeof OUTBREAK_MODELS;
`,
);
console.log(TABLE);
