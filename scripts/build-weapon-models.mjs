// Сборка моделей оружия для игры из Ultimate Guns Pack от Quaternius (CC0):
//   https://quaternius.com/packs/ultimategun.html
//   https://poly.pizza/bundle/Ultimate-Guns-Pack-cpgUfI4t2F
//
// Каждая модель приводится к виду, в котором её держит игра
// (components/world-weapon-models.ts): ствол смотрит в −Z, верх — +Y, размер
// настоящий, в метрах, а начало координат — там, где правая ладонь обхватывает
// рукоятку. Все четыре ствола лежат в одном файле public/models/weapons/weapons.glb.
//
// Исходники — отдельные .glb с poly.pizza (ссылки в SOURCES). Скрипт скачивает
// их сам, если не передана папка с уже скачанными файлами.
//
// Запуск (зависимости ставятся рядом, в проект не добавляются):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer
//   node scripts/build-weapon-models.mjs [папка с исходниками]
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, meshopt, prune, quantize, transformMesh, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const dir = process.argv[2];
const OUT = path.resolve(process.env.OUT ?? 'public/models/weapons');

/**
 * Какие модели набора берём и как их кладём.
 * `length` — настоящая длина оружия, м. `grip` — точка хвата правой рукой
 * в координатах вида сбоку после масштаба, относительно центра рамки модели
 * (y — вверх, z — к дулу отрицательный); снята по разметке с сеткой 5 см.
 */
const SOURCES = [
  { id: 'marker', file: 'ar3', uuid: '9a0e478c-de82-4773-9b70-a0219bb0057c', length: 0.84, grip: [-0.014, 0.166] },
  { id: 'shotgun', file: 'shotgun2', uuid: 'f71d6771-f512-4374-bd23-ba00b564db68', length: 1.0, grip: [0.013, 0.249] },
  { id: 'sniper', file: 'sniper4', uuid: 'd9962f20-fdce-42a5-81c8-2847a4487447', length: 1.18, grip: [-0.03, 0.273] },
  { id: 'pistol', file: 'pistol2', uuid: 'f5a88c73-af97-49ca-8650-4bde579d2f80', length: 0.2, grip: [-0.017, 0.063] },
];

await mkdir(OUT, { recursive: true });
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

async function source(s) {
  if (dir) return readFile(path.join(dir, `${s.file}.glb`));
  const response = await fetch(`https://static.poly.pizza/${s.uuid}.glb`);
  if (!response.ok) throw Error(`${s.file}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Матрица столбцами, как в glTF. */
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const scale = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
const move = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
/** Поворот на +90° вокруг Y: дуло набора (+X) уходит в −Z. */
const TURN = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];

const doc = new Document();
const scene = doc.createScene('weapons');
doc.getRoot().setDefaultScene(scene);
for (const s of SOURCES) {
  const src = await io.readBinary(await source(s));
  const node = src.getRoot().listNodes().find((n) => n.getMesh());
  const mesh = node.getMesh();
  // Поворот и масштаб узла — в вершины, затем разворот дулом к −Z.
  transformMesh(mesh, mul(TURN, node.getWorldMatrix()));
  node.setMatrix(scale(1));
  for (const n of src.getRoot().listNodes()) if (n !== node) n.setMatrix(scale(1));
  let b = getBounds(node);
  const k = s.length / (b.max[2] - b.min[2]);
  transformMesh(mesh, scale(k));
  b = getBounds(node);
  const c = b.min.map((v, i) => (v + b.max[i]) / 2);
  transformMesh(mesh, move(-c[0], -c[1] - s.grip[0], -c[2] - s.grip[1]));
  mesh.setName(`weapon-${s.id}`);
  node.setName(`weapon-${s.id}`);
  const count = doc.getRoot().listScenes().length;
  mergeDocuments(doc, src);
  const merged = doc.getRoot().listScenes().slice(count);
  const copy = merged.flatMap((sc) => {
    const out = [];
    sc.traverse((n) => n.getName() === `weapon-${s.id}` && out.push(n));
    return out;
  })[0];
  copy.getParentNode()?.removeChild(copy);
  for (const sc of merged) for (const child of sc.listChildren()) sc.removeChild(child);
  scene.addChild(copy);
  for (const sc of merged) sc.dispose();
  const size = getBounds(copy);
  console.log(s.id, 'рамка', size.min.map((v) => v.toFixed(3)).join(' '), '…', size.max.map((v) => v.toFixed(3)).join(' '));
}
await doc.transform(dedup(), weld(), prune(), unpartition(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const file = path.join(OUT, 'weapons.glb');
await io.write(file, doc);
console.log(file, ((await stat(file)).size / 1024).toFixed(0), 'КБ');
