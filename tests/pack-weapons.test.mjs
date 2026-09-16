import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createFirstPersonHands } from '../components/world-hands.ts';
import { createUrbanTool } from '../components/resource-packs/urban/assets.ts';
import { dressFieldWeapons } from '../components/resource-packs/realistic/characters.ts';

// Ресурс-паки навешивают на краскомёт свои накладки поверх базовой модели.
// Оружие рисуется без проверки глубины, поэтому любая накладка на прицельной
// линии закрывает и мушку, и точку коллиматора, как бы глубоко она ни стояла.

const fake = () => new T.MeshStandardMaterial({ side: T.DoubleSide });
const PACKS = {
  urban: (hands) =>
    createUrbanTool(hands, { ceramic: fake(), copper: fake() }),
  realistic: (hands) => dressFieldWeapons(hands, { get: fake }),
};

for (const [pack, dress] of Object.entries(PACKS)) {
  for (const sight of ['dot', 'irons']) {
    test(`Накладки пака ${pack} не закрывают прицел краскомёта (${sight})`, () => {
      const camera = new T.PerspectiveCamera(60, 1, 0.06, 350);
      const hands = createFirstPersonHands(camera);
      const gun = hands.group.getObjectByName('paint-launcher');
      const before = new Set();
      gun.traverse((o) => before.add(o));
      dress(hands.group);
      for (let i = 0; i < 90; i++)
        hands.update(
          1 / 60, 10 + i / 60, 0, 'paint', '#ffffff', true, 1, 0, 'pinata', 0, sight,
        );
      camera.updateMatrixWorld(true);
      const added = [];
      gun.traverse((o) => {
        if (!before.has(o) && o instanceof T.Mesh) added.push(o);
      });
      assert.ok(added.length, `пак ${pack} должен что-то добавить на краскомёт`);
      const ray = new T.Raycaster();
      // Центр экрана и кольцо вокруг него: точка коллиматора и мушка должны
      // оставаться видны вместе с небольшим полем вокруг.
      const probes = [[0, 0]];
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        probes.push([Math.cos(a) * 0.04, Math.sin(a) * 0.04]);
      }
      for (const [x, y] of probes) {
        ray.setFromCamera(new T.Vector2(x, y), camera);
        const hits = [];
        for (const mesh of added) T.Mesh.prototype.raycast.call(mesh, ray, hits);
        assert.equal(
          hits.length,
          0,
          `луч через (${x.toFixed(2)}, ${y.toFixed(2)}) упирается в накладку пака ${pack} в ${hits[0]?.distance.toFixed(3)} м`,
        );
      }
    });
  }
}
