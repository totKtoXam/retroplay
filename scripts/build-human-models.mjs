// Сборка моделей людей для игры из наборов Quaternius (CC0):
//   Universal Base Characters [Standard] — тела и причёски,
//   Universal Animation Library [Standard] — анимации на том же скелете.
//
// Наборы большие (сотни мегабайт с текстурами 2048 px и версиями для всех
// движков), поэтому в репозиторий идут только результаты этого скрипта в
// public/models/humans/. Исходники скачиваются с itch.io вручную:
//   https://quaternius.itch.io/universal-base-characters
//   https://quaternius.itch.io/universal-animation-library
//
// Запуск (зависимости ставятся рядом, в проект не добавляются):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
//   node scripts/build-human-models.mjs <папка «Universal Base Characters[Standard]»> <UAL1_Standard.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  mergeDocuments,
  meshopt,
  prune,
  quantize,
  resample,
  simplifyPrimitive,
  textureCompress,
  unpartition,
  weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const [basePack, animationFile] = process.argv.slice(2);
if (!basePack || !animationFile) {
  console.error('usage: node scripts/build-human-models.mjs <Universal Base Characters[Standard]> <UAL1_Standard.glb>');
  process.exit(1);
}
const OUT = path.resolve(process.env.OUT ?? 'public/models/humans');
await mkdir(OUT, { recursive: true });
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const bodies = path.join(basePack, 'Base Characters', 'Godot - UE');
const hairs = path.join(basePack, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)');

/** Тела: причёски встраиваются в тот же файл и садятся на тот же скелет. */
const CHARACTERS = [
  { id: 'male', body: 'Superhero_Male_FullBody.gltf', hair: ['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Beard'] },
  { id: 'female', body: 'Superhero_Female_FullBody.gltf', hair: ['Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale'] },
];
/** Упрощённое тело для дальних бойцов: доля треугольников от полного. */
const LOD_RATIO = 0.22;

/** Какие анимации нужны игре; остальные из библиотеки не везём. */
const CLIPS = [
  'Idle_Loop',
  'Walk_Loop',
  'Jog_Fwd_Loop',
  'Sprint_Loop',
  'Crouch_Idle_Loop',
  'Crouch_Fwd_Loop',
  'Jump_Start',
  'Jump_Loop',
  'Jump_Land',
  'Death01',
  'Hit_Chest',
  'Hit_Head',
  'Pistol_Idle_Loop',
  'Pistol_Aim_Up',
  'Pistol_Aim_Neutral',
  'Pistol_Aim_Down',
  'Pistol_Shoot',
  'Pistol_Reload',
  'Idle_Torch_Loop',
  'Sitting_Idle_Loop',
  'Interact',
  'Fixing_Kneeling',
  'Idle_Talking_Loop',
  'Swim_Fwd_Loop',
  'Swim_Idle_Loop',
  'Spell_Simple_Shoot',
];

/** Кости, по которым вершина считается открытой кожей (лицо и шея) или снаряжением. */
const SKIN_BONES = /^(Head|neck_01)$/;
const GEAR_BONES = /^(hand_|index_|middle_|pinky_|ring_|thumb_|foot_|ball_)/;

/**
 * Маска костюма в цвете вершин (COLOR_0): r — ткань костюма, g — перчатки и
 * ботинки, остальное — открытая кожа. Тело из набора — заготовка под одежду
 * (в одном белье); в игре поверх него рисуется облегающий тактический костюм,
 * и шейдер берёт из этой маски, где ткань, а где кожа. Граница проходит по
 * рёбрам сетки — у шеи это воротник, у запястий — манжеты перчаток.
 */
function suitMask(doc, mesh, skin) {
  const joints = skin.listJoints().map((n) => n.getName());
  for (const prim of mesh.listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0'),
      W = prim.getAttribute('WEIGHTS_0');
    const count = J.getCount();
    const out = new Float32Array(count * 3);
    const j = [0, 0, 0, 0],
      w = [0, 0, 0, 0];
    for (let i = 0; i < count; i++) {
      J.getElement(i, j);
      W.getElement(i, w);
      let skinW = 0,
        gearW = 0;
      for (let k = 0; k < 4; k++) {
        const name = joints[j[k]] ?? '';
        if (SKIN_BONES.test(name)) skinW += w[k];
        else if (GEAR_BONES.test(name)) gearW += w[k];
      }
      // Шея наполовину под воротником: кожей считаем только то, что почти целиком на голове.
      const bare = skinW > 0.55 ? 1 : 0;
      const gear = bare ? 0 : gearW > 0.5 ? 1 : 0;
      out[i * 3] = bare || gear ? 0 : 1;
      out[i * 3 + 1] = gear;
    }
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(out).setBuffer(doc.getRoot().listBuffers()[0]));
  }
}

const size = async (file) => `${((await stat(file)).size / 1024).toFixed(0)} KB`;

async function textures(doc) {
  // Базовый цвет — 1024 px, карты нормалей и шероховатости — 512 px: на экране
  // боец редко занимает больше трети высоты кадра.
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [1024, 1024], slots: /baseColor/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88, resize: [512, 512], slots: /^(?!baseColor)/ }),
  );
}

for (const c of CHARACTERS) {
  const doc = await io.read(path.join(bodies, c.body));
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const armature = root.listScenes()[0].listChildren().find((n) => n.getName() === 'Armature');
  const bodyNode = armature.listChildren().find((n) => n.getMesh() && n.getMesh().listPrimitives()[0].getAttribute('POSITION').getCount() > 3000);
  bodyNode.setName('body');
  for (const n of armature.listChildren()) if (n.getMesh() && n !== bodyNode) n.setName(n.getName().toLowerCase().includes('eye') && !n.getName().toLowerCase().includes('brow') ? 'eyes' : 'eyebrows');

  for (const hair of c.hair) {
    const src = await io.read(path.join(hairs, `${hair}.gltf`));
    const srcNode = src.getRoot().listNodes().find((n) => n.getMesh());
    const sceneCount = root.listScenes().length;
    mergeDocuments(doc, src);
    const merged = root.listScenes().slice(sceneCount);
    // Узел причёски из присоединённой сцены: перевешиваем под свой Armature и свой скелет.
    const node = merged.flatMap((s) => {
      const out = [];
      s.traverse((n) => n.getMesh() && n.getMesh().getName() === srcNode.getMesh().getName() && out.push(n));
      return out;
    })[0];
    node.setName(`hair-${hair.replace(/^Hair_/, '').toLowerCase()}`);
    node.setSkin(skin);
    node.getParentNode()?.removeChild(node);
    for (const s of merged) for (const child of s.listChildren()) s.removeChild(child);
    armature.addChild(node);
    for (const s of merged) s.dispose();
  }
  // Дальнее тело: та же кожа и скелет, в разы меньше треугольников.
  await doc.transform(prune({ keepLeaves: true }), dedup(), weld());
  suitMask(doc, bodyNode.getMesh(), skin);
  // Mesh.clone() делит с оригиналом примитивы и их данные — упрощение резало бы
  // и полное тело. Копируем примитивы вместе с атрибутами и индексами.
  const lodMesh = doc.createMesh('body-lod');
  for (const prim of bodyNode.getMesh().listPrimitives()) {
    const copy = prim.clone();
    for (const semantic of copy.listSemantics()) copy.setAttribute(semantic, copy.getAttribute(semantic).clone());
    if (copy.getIndices()) copy.setIndices(copy.getIndices().clone());
    simplifyPrimitive(copy, { simplifier: MeshoptSimplifier, ratio: LOD_RATIO, error: 0.02 });
    lodMesh.addPrimitive(copy);
  }
  armature.addChild(doc.createNode('body-lod').setMesh(lodMesh).setSkin(skin));
  await textures(doc);
  await doc.transform(prune({ keepLeaves: true }), unpartition(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = path.join(OUT, `human-${c.id}.glb`);
  await io.write(file, doc);
  console.log(file, await size(file));
}

// Анимации: без сетки манекена, только нужные клипы, сжатые ключи.
{
  const doc = await io.read(animationFile);
  const root = doc.getRoot();
  for (const a of root.listAnimations()) if (!CLIPS.includes(a.getName())) a.dispose();
  for (const n of root.listNodes()) if (n.getMesh()) n.setMesh(null).setSkin(null);
  for (const m of root.listMeshes()) m.dispose();
  const missing = CLIPS.filter((name) => !root.listAnimations().some((a) => a.getName() === name));
  if (missing.length) throw Error(`нет анимаций: ${missing.join(', ')}`);
  await doc.transform(resample({ tolerance: 1e-4 }));
  // Дорожки, которые ничего не меняют, — большая часть файла: у каждой свой
  // заголовок. Кость не меняет длину и масштаб, поэтому сдвиг, равный позе
  // покоя, и масштаб 1 выбрасываем; неподвижный поворот, равный позе покоя, — тоже.
  const same = (values, rest) => {
    for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - rest[i % rest.length]) > 1e-4) return false;
    return true;
  };
  let dropped = 0;
  for (const a of root.listAnimations())
    for (const ch of a.listChannels()) {
      const node = ch.getTargetNode();
      const values = ch.getSampler().getOutput().getArray();
      const target = ch.getTargetPath();
      const rest = target === 'scale' ? node.getScale() : target === 'translation' ? node.getTranslation() : target === 'rotation' ? node.getRotation() : null;
      if (!rest) continue;
      // Поворот q и −q — одно и то же.
      const neg = rest.map((v) => -v);
      if (same(values, rest) || (target === 'rotation' && same(values, neg))) {
        ch.getSampler().dispose();
        ch.dispose();
        dropped++;
      }
    }
  console.log('dropped static channels', dropped);
  await doc.transform(prune({ keepLeaves: true }), unpartition(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = path.join(OUT, 'human-animations.glb');
  await io.write(file, doc);
  console.log(file, await size(file), root.listAnimations().length, 'clips');
}
