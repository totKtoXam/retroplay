// Сборка реалистичных ассетов карты «Зона заражения» (lib/maps/outbreak.ts) из
// манифеста scripts/outbreak-real-assets.json: фотосканы и игровые модели с
// Sketchfab (CC-BY), Poly Haven (CC0), Microsoft Rocketbox (MIT), PBR-наборы
// ambientCG / Poly Haven (CC0), декали, HDRI и процедурные материалы проекта.
//
// Оригинальные сайты из рабочего окружения недоступны, поэтому исходники заранее
// собраны из публичных GitHub-зеркал (репозиторий, коммит и путь — в манифесте)
// в папку scratchpad: `<src>/assets/<группа>/<id>.glb`, `<src>/assets/textures/<набор>/`,
// `<src>/assets/decals/`, `<src>/assets/hdri/`, `<src>/proc/<имя>_{albedo,normal,rough}.png`.
//
// Что делает с каждой моделью:
//   - нормализует: равномерный масштаб до `fit.target` ([ось x|y|z|max, метры]),
//     поворот `fit.rot` (градусы по x, y, z), затем сдвиг — низ рамки на y=0, центр
//     рамки по x/z в 0. У моделей без скина всё это запекается в вершины, а узлы
//     становятся прямыми детьми сцены с единичной матрицей (карта ставит копии
//     через InstancedMesh по примитивам и не хочет учитывать иерархию); у скинованных
//     (зомби, выжившие, автобус) преобразование нельзя запечь — оно кладётся на
//     общий корневой узел над скелетом, а рамка считается по вершинам ПОСЛЕ скина в
//     позе покоя (getBounds у скинованных сеток врёт: позиции в пространстве костей);
//   - раскрывает EXT_mesh_gpu_instancing (копии узлов), снимает квантование перед
//     преобразованием и квантует обратно только нормали/UV — позиции остаются
//     float32, чтобы у узлов не появлялось корректирующих матриц;
//   - dedup, prune, при необходимости пережимает текстуры в WebP ≤1024, meshopt.
//   Если агент персонажей положил запечённые позы в `assets/corpses-baked/<id>.glb`,
//   анимированных выживших в `assets/survivors-anim/<id>.glb`, зомби с клипами в
//   `assets/zombies-anim/<id>.glb` или статичных в `assets/zombies-static/<id>.glb`,
//   берутся они (по совпадению имени файла с id модели) и уже без `fit` — они
//   нормализованы при запекании; лишние файлы из corpses-baked
//   добавляются как `corpses/<имя>` с кредитами зомби, чьё имя — префикс файла.
//
// Текстуры: каждый набор → albedo/normal/rough.webp 1024 q85 (roughness —
// оттенки серого; без карты шероховатости — ровные 0.8; у ARM-карты берётся
// канал G; без карты нормалей — плоская). Декали → decals/<id>[-<карта>].webp,
// HDRI копируются как есть.
//
// Результат: public/models/outbreak-real/<группа>/<id>.glb, public/textures/outbreak/,
// public/hdri/, lib/maps/outbreak-real-models.ts (рамки, столкновение, клипы) и
// public/models/outbreak-real/CREDITS.md (авторы и лицензии).
//
// Запуск (зависимости ставятся рядом, в проект не добавляются):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
//   node scripts/build-outbreak-real-models.mjs --src <scratchpad>/real [--only <regexp по id>] [--force] [--skip-models] [--skip-textures]
// Если зависимости лежат в другой папке (например, в scratchpad), её node_modules
// указывается в GLTF_MODULES — ESM не читает NODE_PATH, поэтому пакеты
// подгружаются по абсолютному пути.
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? '') : undefined;
};
const flag = (name) => argv.includes(name);
const srcArg = opt('--src') ?? process.env.OUTBREAK_SRC;
if (!srcArg) {
  console.error('Укажите --src <папка scratchpad/real> (или OUTBREAK_SRC).');
  process.exit(1);
}
// Допускается и `.../real/assets` — тогда корень на уровень выше.
const SRC =
  path.basename(path.resolve(srcArg)) === 'assets'
    ? path.dirname(path.resolve(srcArg))
    : path.resolve(srcArg);
const ONLY = opt('--only') ? new RegExp(opt('--only')) : null;
const FORCE = flag('--force');
const MANIFEST = path.resolve('scripts/outbreak-real-assets.json');
const OUT_MODELS = path.resolve('public/models/outbreak-real');
const OUT_TEX = path.resolve('public/textures/outbreak');
const OUT_HDRI = path.resolve('public/hdri');
const TABLE = path.resolve('lib/maps/outbreak-real-models.ts');
const CREDITS = path.join(OUT_MODELS, 'CREDITS.md');

/** Пакет по имени: из GLTF_MODULES (абсолютный путь по exports) или обычным import. */
async function load(name) {
  const modules = process.env.GLTF_MODULES;
  if (!modules) return import(name);
  const dir = path.join(modules, name);
  const pkg = JSON.parse(
    await readFile(path.join(dir, 'package.json'), 'utf8'),
  );
  const entry = (e) => {
    if (typeof e === 'string') return e;
    if (!e) return undefined;
    if (e['.']) return entry(e['.']);
    for (const k of ['import', 'default', 'module'])
      if (e[k]) return entry(e[k]);
    return undefined;
  };
  const file = entry(pkg.exports) ?? pkg.module ?? pkg.main;
  return import(pathToFileURL(path.join(dir, file)).href);
}
const { Logger, NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } =
  await load('@gltf-transform/extensions');
const {
  dedup,
  dequantize,
  prune,
  quantize,
  reorder,
  textureCompress,
  transformMesh,
  uninstance,
} = await load('@gltf-transform/functions');
const { MeshoptDecoder, MeshoptEncoder } = await load('meshoptimizer');
const sharp = (await load('sharp')).default;

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });

const exists = (p) =>
  stat(p).then(
    () => true,
    () => false,
  );
const src = (rel) => path.join(SRC, rel);

// ---------- Матрицы 4×4 столбцами, как в glTF ----------
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul4 = (a, b) => {
  const o = Array.from({ length: 16 }, () => 0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const apply = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];
const scale4 = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
const translate4 = (x, y, z) => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  x,
  y,
  z,
  1,
];
/** Поворот на градусы вокруг X, затем Y, затем Z (в мировых осях): R = Rz·Ry·Rx. */
function rotate4([ax, ay, az]) {
  const r = (d) => (d * Math.PI) / 180;
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(r(ax)),
    Math.sin(r(ax)),
    Math.cos(r(ay)),
    Math.sin(r(ay)),
    Math.cos(r(az)),
    Math.sin(r(az)),
  ];
  const rx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
  const ry = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  const rz = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return mul4(rz, mul4(ry, rx));
}

/**
 * Матрица вершины `i`: у обычного узла — мировая узла, у скинованного — смесь
 * матриц костей по весам (мировая кости × обратная привязки), как в шейдере.
 */
function vertexMatrices(node, prim) {
  const world = node.getWorldMatrix();
  const skin = node.getSkin();
  const joints = prim.getAttribute('JOINTS_0');
  const weights = prim.getAttribute('WEIGHTS_0');
  if (!skin || !joints || !weights) return () => world;
  const ibm = skin.getInverseBindMatrices();
  const jointMats = skin
    .listJoints()
    .map((j, k) => mul4(j.getWorldMatrix(), ibm ? ibm.getElement(k, []) : I4));
  return (i) => {
    const jn = joints.getElement(i, []);
    const w = weights.getElement(i, []);
    const m = Array.from({ length: 16 }, () => 0);
    for (let k = 0; k < 4; k++)
      if (w[k]) for (let e = 0; e < 16; e++) m[e] += jointMats[jn[k]][e] * w[k];
    return m;
  };
}

/** Все вершины сцены в мировых координатах (у скинованных — в позе покоя). */
function worldPositions(scene) {
  const out = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const matrixOf = vertexMatrices(node, prim);
      for (let i = 0; i < pos.getCount(); i++) {
        const p = pos.getElement(i, []);
        out.push(...apply(matrixOf(i), p[0], p[1], p[2]));
      }
    }
  });
  return out;
}

function bounds(positions, m = I4) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const p = apply(m, positions[i], positions[i + 1], positions[i + 2]);
    for (let j = 0; j < 3; j++) {
      if (p[j] < min[j]) min[j] = p[j];
      if (p[j] > max[j]) max[j] = p[j];
    }
  }
  return { min, max };
}

function triangles(scene) {
  let tris = 0;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const idx = prim.getIndices();
      tris +=
        (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  });
  return Math.round(tris);
}

// ---------- Модели ----------
const r3 = (v) => Math.round(v * 1000) / 1000;

const BAKED_DIRS = [
  'assets/corpses-baked',
  'assets/survivors-anim',
  'assets/zombies-anim',
  'assets/zombies-static',
];

/** Файл модели: запечённые/анимированные версии от агента персонажей важнее исходника. */
async function modelSource(model) {
  const name = path.basename(model.id);
  for (const dir of BAKED_DIRS) {
    const p = src(`${dir}/${name}.glb`);
    if (await exists(p)) return { file: p, baked: true };
  }
  return { file: src(model.file), baked: false };
}

/** Лишние файлы corpses-baked → новые модели `corpses/<имя>` с кредитами зомби-источника. */
async function extraCorpses(models) {
  const dir = src('assets/corpses-baked');
  if (!(await exists(dir))) return [];
  const known = new Set(models.map((m) => path.basename(m.id)));
  const extra = [];
  for (const f of (await readdir(dir))
    .filter((f) => f.endsWith('.glb'))
    .sort()) {
    const name = f.slice(0, -4);
    if (known.has(name)) continue;
    // Источник кредитов — модель, чьё имя стоит в начале файла: `z2-dead1` ← zombies/z2,
    // `s3-lying` ← survivors/s3, `c3-a` ← corpses/c3.
    const origin = models
      .filter(
        (m) =>
          ['zombies', 'survivors', 'corpses'].includes(m.group) &&
          name.startsWith(path.basename(m.id)),
      )
      .sort((a, b) => b.id.length - a.id.length)[0];
    if (!origin) {
      console.warn(`corpses-baked/${f}: не найден источник, пропуск`);
      continue;
    }
    extra.push({
      ...origin,
      id: `corpses/${name}`,
      group: 'corpses',
      file: `assets/corpses-baked/${f}`,
      hit: 'none',
      gore: true,
      skinned: false,
      fit: undefined,
      derived: origin.id,
    });
  }
  return extra;
}

async function buildModel(model) {
  const { file, baked } = await modelSource(model);
  // Запечённые файлы уже в метрах и в нужной позе: повторный fit их бы сломал.
  if (baked) model = { ...model, fit: undefined };
  const doc = await io.read(file);
  const root = doc.getRoot();
  if (
    root
      .listExtensionsUsed()
      .some((e) => e.extensionName === 'EXT_mesh_gpu_instancing')
  )
    await doc.transform(uninstance());
  await doc.transform(dequantize());
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const positions = worldPositions(scene);
  const hasSkin = root.listSkins().length > 0;

  let matrix = I4;
  let box = { min: [0, 0, 0], max: [0, 0, 0] };
  if (positions.length) {
    const fit = model.fit ?? {};
    let scale = 1;
    if (fit.target) {
      const [axis, meters] = fit.target;
      const b = bounds(positions);
      const size = b.max.map((v, i) => v - b.min[i]);
      const current =
        axis === 'max' ? Math.max(...size) : size['xyz'.indexOf(axis)];
      scale = meters / current;
    }
    const pre = mul4(fit.rot ? rotate4(fit.rot) : I4, scale4(scale));
    const b = bounds(positions, pre);
    matrix = mul4(
      translate4(
        -(b.min[0] + b.max[0]) / 2,
        -b.min[1],
        -(b.min[2] + b.max[2]) / 2,
      ),
      pre,
    );
    box = bounds(positions, matrix);
  }

  if (hasSkin) {
    // Скин нельзя запечь: преобразование — на общем корне над скелетом и сетками.
    const top = doc.createNode('outbreak-root').setMatrix(matrix);
    for (const child of scene.listChildren()) top.addChild(child);
    scene.addChild(top);
  } else {
    const nodes = [];
    scene.traverse((n) => n.getMesh() && nodes.push(n));
    for (const node of nodes) {
      let mesh = node.getMesh();
      // Общую сетку нескольких узлов (копии после uninstance) преобразуем по отдельности.
      if (
        mesh.listParents().filter((p) => p.propertyType === 'Node').length > 1
      ) {
        mesh = mesh.clone();
        node.setMesh(mesh);
      }
      // Морф-цели статичных моделей (вершинная анимация «тел под простынями») без
      // анимации не нужны, а весят больше самой сетки; сдвиги морфов к тому же
      // нельзя переносить матрицей со сдвигом.
      for (const prim of mesh.listPrimitives()) {
        for (const target of prim.listTargets()) {
          prim.removeTarget(target);
          target.dispose();
        }
      }
      mesh.setWeights([]);
      transformMesh(mesh, mul4(matrix, node.getWorldMatrix()));
    }
    for (const node of nodes) {
      scene.addChild(node);
      node.setMatrix(I4);
    }
    // Анимации статичных моделей (вращение узлов) после запекания бессмысленны;
    // файл без геометрии — это отдельный клип для скелета (peter-d-death), его не трогаем.
    if (positions.length)
      for (const anim of root.listAnimations()) anim.dispose();
  }

  const needTex = root
    .listTextures()
    .some(
      (t) =>
        t.getMimeType() !== 'image/webp' ||
        Math.max(...(t.getSize() ?? [0])) > 1024,
    );
  await doc.transform(
    dedup(),
    prune(),
    ...(needTex
      ? [
          textureCompress({
            encoder: sharp,
            targetFormat: 'webp',
            resize: [1024, 1024],
            quality: 85,
          }),
        ]
      : []),
    // Не meshopt(): тот сам квантует POSITION и вешает на узлы корректирующие матрицы.
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+)$/ }),
  );
  // quantize() объявляет KHR_mesh_quantization только по POSITION (ошибка в
  // gltf-transform 4.5), а у нас квантованы нормали и UV — объявляем сами.
  if (
    root
      .listMeshes()
      .some((m) => m.listPrimitives().some((p) => p.getAttribute('NORMAL')))
  )
    doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const out = path.join(OUT_MODELS, `${model.id}.glb`);
  await mkdir(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  const outScene = root.getDefaultScene() ?? root.listScenes()[0];
  const clips = root.listAnimations().map((a) => a.getName());
  const size = box.max.map((v, i) => v - box.min[i]);
  const row = {
    id: model.id,
    file: `/models/outbreak-real/${model.id}.glb`,
    min: box.min.map(r3),
    max: box.max.map(r3),
    hit: model.hit,
    ...(model.hit === 'trunk'
      ? { t: r3(Math.min(0.5, Math.min(size[0], size[2]) / 2)) }
      : {}),
    ...(model.gore ? { gore: true } : {}),
    ...(hasSkin ? { skinned: true } : {}),
    ...(clips.length ? { clips } : {}),
    tris: triangles(outScene),
  };
  console.log(
    model.id.padEnd(40),
    size
      .map((v) => v.toFixed(2))
      .join('×')
      .padStart(18),
    'м',
    String(row.tris).padStart(6),
    'тр.',
    ((await stat(out)).size / 1024).toFixed(0).padStart(5),
    'КБ',
    hasSkin ? 'скин' : '',
    clips.length ? clips.join(',') : '',
    baked ? `← ${path.relative(SRC, file)}` : '',
  );
  return row;
}

// ---------- Текстуры ----------
const WEBP = { quality: 85 };
const fitIn = (img, max = 1024) =>
  img.resize(max, max, { fit: 'inside', withoutEnlargement: true });
async function writeImage(pipeline, out) {
  await mkdir(path.dirname(out), { recursive: true });
  await pipeline.webp(WEBP).toFile(out);
}
const flat = (rgb) =>
  sharp({
    create: { width: 1024, height: 1024, channels: 3, background: rgb },
  });

async function buildTextureSet(set) {
  const outDir = path.join(OUT_TEX, set.id);
  const outs = ['albedo', 'normal', 'rough'].map((k) =>
    path.join(outDir, `${k}.webp`),
  );
  if (!FORCE && (await Promise.all(outs.map(exists))).every(Boolean))
    return 'есть';
  let files = set.files;
  if (!files) {
    // Имена у ambientCG/Poly Haven разные: Color/diff/albedo, NormalGL/nor_gl, Roughness/rough, arm.
    const list = await readdir(src(set.dir));
    const pick = (re, not = /$^/) => {
      const f = list.find((f) => re.test(f) && !not.test(f));
      return f ? `${set.dir}/${f}` : undefined;
    };
    files = {
      albedo: pick(
        /color|diff|albedo|basecolor/i,
        /normal|rough|_arm|disp|_ao/i,
      ),
      normal: pick(/normalgl|nor_gl|normal/i),
      rough: pick(/rough/i, /_arm/i),
      arm: pick(/_arm/i),
    };
  }
  if (!files.albedo) throw Error(`${set.id}: нет карты цвета`);
  await writeImage(fitIn(sharp(src(files.albedo))), outs[0]);
  await writeImage(
    files.normal
      ? fitIn(sharp(src(files.normal)))
      : flat({ r: 128, g: 128, b: 255 }),
    outs[1],
  );
  const rough = files.rough
    ? fitIn(sharp(src(files.rough))).grayscale()
    : files.arm
      ? fitIn(sharp(src(files.arm))).extractChannel(1)
      : flat({ r: 204, g: 204, b: 204 }).grayscale();
  await writeImage(rough, outs[2]);
  return files.rough ? '' : files.arm ? 'rough из ARM' : 'rough 0.8';
}

async function buildDecal(decal) {
  const maps = [];
  for (const [key, rel] of Object.entries(decal.files)) {
    const name = key === 'color' ? decal.id : `${decal.id}-${key}`;
    const out = path.join(OUT_TEX, 'decals', `${name}.webp`);
    maps.push(`/textures/outbreak/decals/${name}.webp`);
    if (!FORCE && (await exists(out))) continue;
    let img = sharp(src(rel));
    if (key === 'flipbook') {
      // Кадры нарисованы белым по чёрному без альфы: альфа — из яркости, размер не
      // трогаем, чтобы сетка 3×3 осталась целой в пикселях.
      const { data, info } = await sharp(src(rel))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 4)
        data[i + 3] = Math.round(
          0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
        );
      img = sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 },
      });
    } else img = fitIn(img);
    await writeImage(img, out);
  }
  return maps;
}

// ---------- Таблица и кредиты ----------
/**
 * Массив как его печатает oxfmt: в одну строку, если влезает в 80 колонок
 * (`col` — колонка, с которой он начинается), иначе по элементу на строку с
 * отступом `indent` + 2.
 */
function tsArray(items, col, indent) {
  const line = `[${items.join(', ')}]`;
  if (line.length + col <= 80) return line;
  const pad = ' '.repeat(indent + 2);
  return `[\n${items.map((i) => `${pad}${i},`).join('\n')}\n${' '.repeat(indent)}]`;
}
const q = (v) => `'${String(v).replace(/'/g, "\\'")}'`;
/** Ключ объекта как печатает oxfmt: в кавычках только если это не идентификатор. */
const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k));

function tsTable(rows, textures, decals, hdris) {
  const lines = rows.map((t) => {
    const parts = [
      `file: ${q(t.file)}`,
      `min: ${tsArray(t.min, 9, 4)}`,
      `max: ${tsArray(t.max, 9, 4)}`,
      `hit: ${q(t.hit)}`,
    ];
    if (t.t !== undefined) parts.push(`t: ${t.t}`);
    if (t.gore) parts.push('gore: true');
    if (t.skinned) parts.push('skinned: true');
    if (t.clips) parts.push(`clips: ${tsArray(t.clips.map(q), 11, 4)}`);
    parts.push(`tris: ${t.tris}`);
    return `  ${key(t.id)}: {\n    ${parts.join(',\n    ')},\n  },`;
  });
  const sets = textures.map(
    (s) =>
      `  ${key(s.id)}: {\n    title: ${q(s.title)},\n    license: ${q(s.license)},\n  },`,
  );
  const decs = decals.map(
    (d) =>
      `  ${key(d.id)}: {\n    maps: ${tsArray(d.maps.map(q), 10, 4)},\n    gore: ${d.gore},\n  },`,
  );
  return `// Создано scripts/build-outbreak-real-models.mjs — не править руками.
// Реалистичные модели карты «Зона заражения»: файл GLB, рамка в метрах после
// нормализации (низ на y=0, центр по x/z в 0, до поворота на карте), столкновение
// ('box' — вся рамка, 'trunk' — ствол полушириной \`t\` м, 'none' — сквозь),
// \`gore\` — кровь и тела (прячет настройка «Кровь и жестокость»), \`skinned\` —
// скелетная анимация с клипами \`clips\`, \`tris\` — треугольников.

export type RealModel = {
  file: string;
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  hit: 'box' | 'trunk' | 'none';
  t?: number;
  gore?: boolean;
  skinned?: boolean;
  clips?: readonly string[];
  tris: number;
};

export const OUTBREAK_REAL_MODELS = {
${lines.join('\n')}
} as const satisfies Record<string, RealModel>;

export type RealModelId = keyof typeof OUTBREAK_REAL_MODELS;

/** PBR-наборы public/textures/outbreak/<id>/{albedo,normal,rough}.webp. */
export const OUTBREAK_TEXTURE_SETS = {
${sets.join('\n')}
} as const satisfies Record<string, { title: string; license: string }>;

export type OutbreakTextureSetId = keyof typeof OUTBREAK_TEXTURE_SETS;

/** HDRI public/hdri/<id>.hdr. */
export const OUTBREAK_HDRIS = ${tsArray(hdris.map(q), 29, 0)} as const;

/** Декали public/textures/outbreak/decals: карты (URL) и пометка «кровь». */
export const OUTBREAK_DECALS = {
${decs.join('\n')}
} as const satisfies Record<string, { maps: readonly string[]; gore: boolean }>;

export type OutbreakDecalId = keyof typeof OUTBREAK_DECALS;
`;
}

const GROUP_TITLES = {
  buildings: 'Здания',
  vehicles: 'Транспорт',
  props: 'Уличные объекты',
  structures: 'Конструкции',
  items: 'Предметы',
  nature: 'Природа',
  zombies: 'Зомби',
  corpses: 'Тела',
  survivors: 'Выжившие',
};
const LICENSE_TITLES = {
  'CC-BY-4.0': 'CC BY 4.0',
  'CC-BY-3.0': 'CC BY 3.0',
  'CC0-1.0': 'CC0 1.0',
  MIT: 'MIT',
};
const lic = (l) => LICENSE_TITLES[l] ?? l;
const short = (repo) => repo.replace(/^https:\/\/github\.com\//, '');
const mirror = (s) =>
  s.repo
    ? `${short(s.repo)}@${s.commit.slice(0, 7)}, \`${s.path}\``
    : `\`${s.path}\``;

function creditsMd(models, textures, decals, hdris) {
  const out = [];
  out.push(
    '# Реалистичные ассеты карты «Зона заражения»',
    '',
    'Создано `scripts/build-outbreak-real-models.mjs` из `scripts/outbreak-real-assets.json` — не править руками.',
    '',
    'Файлы в `public/models/outbreak-real`, `public/textures/outbreak` и `public/hdri` — сторонние работы под',
    'свободными лицензиями (CC BY 4.0, CC BY 3.0, CC0 1.0, MIT) и процедурные материалы проекта. Модели',
    'нормализованы (метры, низ на y=0), сжаты meshopt, текстуры пережаты в WebP ≤1024 — это производные работы,',
    'авторство и лицензия остаются за оригиналом.',
    '',
    '**Зеркала GitHub.** Оригиналы опубликованы на Sketchfab, Poly Haven, ambientCG и OpenGameArt — эти сайты',
    'недоступны из рабочего окружения, поэтому файлы взяты из публичных GitHub-репозиториев, которые вендорят',
    'их вместе с лицензией. У каждой позиции указано зеркало в виде `владелец/репозиторий@коммит, путь`; ссылка',
    'на оригинал и автора — по странице источника. Список зеркал — в конце файла.',
    '',
    '## Модели',
    '',
  );
  for (const group of Object.keys(GROUP_TITLES)) {
    const list = models.filter((m) => m.group === group);
    if (!list.length) continue;
    out.push(`### ${GROUP_TITLES[group]} (\`${group}\`)`, '');
    const by = list.filter((m) => m.license.startsWith('CC-BY'));
    const free = list.filter((m) => !m.license.startsWith('CC-BY'));
    if (by.length) {
      out.push('Атрибуция обязательна (CC BY):', '');
      for (const m of by)
        out.push(
          `- \`${m.id}\` — **${m.title}**, автор ${m.author}, ${lic(m.license)} — <${m.source.url}>` +
            ` (зеркало: ${mirror(m.source)})${m.derived ? ` — поза запечена из \`${m.derived}\`` : ''}`,
        );
      out.push('');
    }
    if (free.length) {
      out.push('CC0 и MIT:', '');
      for (const m of free)
        out.push(
          `- \`${m.id}\` — ${m.title}, ${m.author}, ${lic(m.license)} — <${m.source.url}> (зеркало: ${mirror(m.source)})`,
        );
      out.push('');
    }
  }
  out.push('## PBR-наборы текстур (`public/textures/outbreak/<id>`)', '');
  for (const t of textures)
    out.push(
      `- \`${t.id}\` — ${t.title}, ${t.author}, ${lic(t.license)} — ${
        t.source.url
          ? `<${t.source.url}> (зеркало: ${mirror(t.source)})`
          : 'процедурно, этот проект'
      }`,
    );
  out.push('', '## Декали (`public/textures/outbreak/decals`)', '');
  for (const d of decals)
    out.push(
      `- \`${d.id}\` — ${d.title}, ${d.author}, ${lic(d.license)} — <${d.source.url}> (зеркало: ${mirror(d.source)})` +
        (d.note ? ` — ${d.note}` : ''),
    );
  out.push('', '## HDRI (`public/hdri`)', '');
  for (const h of hdris)
    out.push(
      `- \`${h.id}\` — ${h.title}, ${h.author}, ${lic(h.license)} — <${h.source.url}> (зеркало: ${mirror(h.source)})`,
    );
  const repos = new Map();
  for (const x of [...models, ...textures, ...decals, ...hdris])
    if (x.source.repo) repos.set(short(x.source.repo), x.source.commit);
  out.push('', '## Зеркала GitHub (репозиторий и коммит)', '');
  for (const [repo, commit] of [...repos].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  ))
    out.push(`- <https://github.com/${repo}> — \`${commit}\``);
  out.push('');
  return out.join('\n');
}

// ---------- Запуск ----------
const models = [
  ...manifest.models.filter((m) => !m.drop),
  ...(await extraCorpses(manifest.models)),
];
for (const m of manifest.models.filter((m) => m.drop))
  console.log(`${m.id}: пропуск (${m.drop})`);

const rows = [];
if (!flag('--skip-models')) {
  await mkdir(OUT_MODELS, { recursive: true });
  for (const model of models) {
    if (ONLY && !ONLY.test(model.id)) continue;
    try {
      rows.push(await buildModel(model));
    } catch (e) {
      console.error(`${model.id}: ОШИБКА ${e.message}`);
      throw e;
    }
  }
}

const decalRows = [];
if (!flag('--skip-textures')) {
  for (const set of manifest.textures) {
    const note = await buildTextureSet(set);
    console.log('текстуры', set.id.padEnd(28), note);
  }
  for (const d of manifest.decals)
    decalRows.push({ id: d.id, gore: d.gore, maps: await buildDecal(d) });
  await mkdir(OUT_HDRI, { recursive: true });
  for (const h of manifest.hdris) {
    const out = path.join(OUT_HDRI, `${h.id}.hdr`);
    if (FORCE || !(await exists(out))) await copyFile(src(h.file), out);
  }
}

// Таблица пишется только по полной сборке моделей: с --only она была бы неполной
// (текстуры и HDRI в ней описаны из манифеста, их сборка на таблицу не влияет).
if (!ONLY && !flag('--skip-models')) {
  // Кровь как декаль — тот же процедурный набор с альфой.
  decalRows.push({
    id: 'proc-blood',
    gore: true,
    maps: ['albedo', 'normal', 'rough'].map(
      (k) => `/textures/outbreak/proc-blood/${k}.webp`,
    ),
  });
  await writeFile(
    TABLE,
    tsTable(
      rows,
      manifest.textures,
      decalRows,
      manifest.hdris.map((h) => h.id),
    ),
  );
  await writeFile(
    CREDITS,
    creditsMd(models, manifest.textures, manifest.decals, manifest.hdris),
  );
  console.log(TABLE, '\n', CREDITS);
} else console.log('Частичная сборка: таблица и CREDITS.md не обновлены.');
