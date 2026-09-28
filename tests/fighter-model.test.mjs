import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildFighterTemplate, createAvatar, setFighterTemplate } from '../components/world-avatar.ts';
import { attachCustomSkins, applyAvatarSkin } from '../components/world-skins.ts';
import { fighterFromFile } from '../components/world-fighter-file.ts';

const loadFile = async () => {
  await MeshoptDecoder.ready;
  const data = readFileSync(new URL('../public/models/fighter/fighter.glb', import.meta.url));
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  return fighterFromFile(gltf.scene);
};

/** Имена частей и число треугольников у каждой сетки: «отпечаток» бойца. */
const fingerprint = (root) => {
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    const path = [];
    for (let p = o; p && p !== root; p = p.parent) path.unshift(p.name);
    parts.push(`${path.join('/')}:${tris}`);
  });
  return parts.sort((a, b) => a.localeCompare(b));
};

test('the fighter file matches the procedural template (rebuild it after changing skins or weapons)', async () => {
  const fromFile = await loadFile();
  const procedural = buildFighterTemplate((a) => attachCustomSkins(a));
  assert.deepEqual(
    fingerprint(fromFile),
    fingerprint(procedural),
    'public/models/fighter/fighter.glb устарел: node --experimental-strip-types scripts/build-fighter-model.mjs',
  );
  // Детали цвета игрока помечены — иначе копии были бы одного цвета.
  let tinted = 0;
  fromFile.traverse((o) => {
    if (o.isMesh && o.geometry.getAttribute('tint')?.array.some((v) => v > 0)) tinted++;
  });
  assert.ok(tinted >= 5, `помеченных сеток ${tinted}`);
});

test('fighters are copies of the template: geometry is shared, colour is their own', async () => {
  setFighterTemplate(await loadFile());
  const red = createAvatar('#d94848'),
    blue = createAvatar('#3d7bd9');
  const geometries = (a) => {
    const set = new Set();
    a.traverse((o) => o.isMesh && o.name !== 'held-grenade' && set.add(o.geometry));
    return set;
  };
  const shared = [...geometries(red)].filter((g) => geometries(blue).has(g));
  assert.ok(shared.length > 50, `общих геометрий ${shared.length}`);
  const skinOf = (a) => {
    let m = null;
    a.traverse((o) => {
      if (o.isMesh && o.material.userData.perFighter && o.material.vertexColors) m = o.material;
    });
    return m;
  };
  assert.notEqual(skinOf(red), skinOf(blue), 'материал цвета у каждого свой');
  // Скины и бандана работают на копиях: свои материалы банданы, выбранный скин виден.
  const redSkins = attachCustomSkins(red),
    blueSkins = attachCustomSkins(blue);
  assert.notEqual(redSkins.bandanaMat, blueSkins.bandanaMat);
  applyAvatarSkin(red, 'knight', '#ff0000', redSkins.bandanaMat);
  assert.equal(red.getObjectByName('skin-knight-head').visible, true);
  assert.equal(blue.getObjectByName('skin-knight-head').visible, false, 'скин одного не виден у другого');
  // Оружие и шарниры на месте: по ним стреляет и целится игра.
  for (const name of ['gun', 'gun-paint', 'gun-sniper', 'tablet', 'head', 'elbowR', 'held-grenade'])
    assert.ok(red.getObjectByName(name), name);
  assert.ok(red.getObjectByName('gun').position.distanceTo(new T.Vector3(0, -0.29, -0.03)) < 1e-4);
});
