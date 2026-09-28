import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { WEAPON_MODEL, WEAPON_SUPPORT } from '../components/world-weapon-models.ts';
import { WEAPON_SIGHTS } from '../lib/weapon-sights.ts';

// Модели оружия (public/models/weapons/weapons.glb) и числа прицелов
// (lib/weapon-sights.ts) сняты с одной геометрии. Если модель пересобрать
// иначе, мушка, дуло и хват разъедутся с тем, что нарисовано, — тест это ловит.

const load = async () => {
  await MeshoptDecoder.ready;
  const data = readFileSync(new URL('../public/models/weapons/weapons.glb', import.meta.url));
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
};

for (const [tool, id] of Object.entries(WEAPON_MODEL)) {
  test(`Модель ${id} (${tool}): хват в начале координат, дуло, мушка и цевьё на модели`, async () => {
    const scene = await load();
    const model = scene.getObjectByName(`weapon-${id}`);
    assert.ok(model, `в weapons.glb нет weapon-${id}`);
    const box = new T.Box3().setFromObject(model);
    const sight = WEAPON_SIGHTS[tool];
    // Ствол смотрит в −Z: дуло у переднего края модели.
    assert.ok(Math.abs(sight.muzzle[2] - box.min.z) < 0.02, `дуло ${tool} не у среза ствола: ${sight.muzzle[2]} против ${box.min.z.toFixed(3)}`);
    // Хват правой рукой — внутри модели, у рукоятки (начало координат).
    assert.ok(box.containsPoint(new T.Vector3(0, 0, 0)), `хват ${tool} вне модели`);
    // Мушка — над моделью не выше пары сантиметров: линия прицела лежит на железе.
    assert.ok(sight.y <= box.max.y + 0.01 && sight.y > 0, `линия прицела ${tool} не на модели: ${sight.y} при верхе ${box.max.y.toFixed(3)}`);
    assert.ok(sight.front > box.min.z && sight.front < sight.rear, `мушка ${tool} вне ствола`);
    const support = new T.Vector3(...WEAPON_SUPPORT[id]);
    assert.ok(box.clone().expandByScalar(0.04).containsPoint(support), `левая рука ${tool} не у модели`);
  });
}
