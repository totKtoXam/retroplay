// Сборка шаблона бойца в файл public/models/fighter/fighter.glb.
//
// Источник — процедурный боец (components/world-avatar.ts): тело, скин
// «Агента», оружие в руках, планшет, мешок анонима и аксессуары всех скинов
// (components/world-skins.ts). Игра копирует бойцов из этого файла, а не
// собирает каждого заново; процедурная сборка остаётся источником и запасом,
// пока файл не загрузился. После правок в этих модулях файл пересобирается:
//
//   node --experimental-strip-types scripts/build-fighter-model.mjs
//
// Сжатие — если стоят пакеты gltf-transform (в проект они не входят):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer
// Без них пишется несжатый файл (около 5 МБ вместо 0,7).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// GLTFExporter собирает GLB через Blob и FileReader; в Node есть только Blob.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
      this.onload?.({ target: this });
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend?.();
      this.onload?.({ target: this });
    });
  }
};

const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
const { buildFighterTemplate } = await import('../components/world-avatar.ts');
const { attachCustomSkins } = await import('../components/world-skins.ts');

const template = buildFighterTemplate((a) => attachCustomSkins(a));
template.name = 'fighter';
const glb = await new GLTFExporter().parseAsync(template, { binary: true, onlyVisible: false });
const out = path.resolve('public/models/fighter');
await mkdir(out, { recursive: true });
let bytes = new Uint8Array(glb);
try {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { meshopt, prune, dedup, weld } = await import('@gltf-transform/functions');
  const { MeshoptEncoder } = await import('meshoptimizer');
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.readBinary(bytes);
  // Склейка одинаковых вершин даёт основную экономию: детали при запекании в
  // сустав становятся неиндексированными. Без квантования — координаты деталей
  // остаются точными (прицельные точки оружия, шарниры).
  await doc.transform(
    prune({ keepLeaves: true, keepAttributes: true }),
    dedup(),
    weld(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantize: false }),
  );
  bytes = await io.writeBinary(doc);
} catch (error) {
  console.warn('gltf-transform не найден — пишу несжатый файл:', error.message);
}
const file = path.join(out, 'fighter.glb');
await writeFile(file, bytes);
console.log(file, `${(bytes.length / 1024).toFixed(0)} KB`);
