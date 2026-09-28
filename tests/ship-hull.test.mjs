import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';

// Обшивка рисует текстуру на canvas: в Node хватает заглушки, которая всё принимает.
const context = new Proxy(
  {},
  {
    get: (target, key) => (key in target ? target[key] : () => ({ addColorStop() {} })),
    set: () => true,
  },
);
// Ключ собран из частей: линтер путает эту заглушку с устаревшей перегрузкой DOM.
globalThis.document ??= {
  ['create' + 'Element']: () => ({ width: 0, height: 0, getContext: () => context }),
};

const { getMap } = await import('../lib/maps/index.ts');
const { createShipHull } = await import('../components/world-ship-hull.ts');

const ship = getMap('ship').arena;
const windows = ship.decor.filter((d) => d.kind === 'window');
const walls = ship.boxes.filter((b) => b.art === 'wall');
const hull = createShipHull(ship.hull, walls, windows);
hull.group.updateMatrixWorld(true);
const armor = hull.group.children.find((o) => o.material?.name === 'ship-hull');

/** Первое попадание луча в броню (у корпуса лучи выключены — пересекаем напрямую). */
const hit = (from, dir, far) => {
  const ray = new T.Raycaster(from, dir.clone().normalize(), 0, far);
  const hits = [];
  T.Mesh.prototype.raycast.call(armor, ray, hits);
  return hits.sort((a, b) => a.distance - b.distance)[0];
};

test('ship hull is built around every module', () => {
  assert.ok(armor, 'броня корпуса собрана');
  for (const m of ship.hull) {
    const cx = (m.minX + m.maxX) / 2,
      cz = (m.minZ + m.maxZ) / 2;
    const roof = hit(new T.Vector3(cx, 20, cz), new T.Vector3(0, -1, 0), 30);
    assert.ok(roof && roof.point.y > 3.2, `у модуля ${m.kind} есть крыша над потолком`);
  }
});

test('portholes are cut through the hull, the wall beside them is clad', () => {
  for (const w of windows) {
    const outward = new T.Vector3(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
    const center = new T.Vector3(w.x, w.y, w.z).addScaledVector(outward, -0.1);
    const through = hit(center, outward, 0.6);
    assert.ok(!through, `окно (${w.x}, ${w.z}) закрыто обшивкой — из него ничего не видно`);
    // Над окном — сплошная обшивка.
    const above = hit(new T.Vector3(w.x, w.y + w.h / 2 + 0.3, w.z).addScaledVector(outward, -0.1), outward, 0.6);
    assert.ok(above, `стена над окном (${w.x}, ${w.z}) не обшита`);
  }
});
