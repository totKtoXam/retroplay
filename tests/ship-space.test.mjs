import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { getMap } from '../lib/maps/index.ts';
import { SPACE_SUN, sunbeamGeometry } from '../components/world-space.ts';

const ship = getMap('ship').arena;
const windows = ship.decor.filter((d) => d.kind === 'window');
const doors = ship.decor.filter((d) => d.kind === 'door');
const consoles = ship.boxes.filter((b) => /^(console|panel):/.test(b.art ?? ''));
/** Стена вдоль x (северная или южная) или вдоль z (западная или восточная). */
const alongX = (yaw) => Math.abs(Math.sin(yaw ?? 0)) < 0.5;
const normalOf = (yaw) => new T.Vector3(Math.sin(yaw ?? 0), 0, Math.cos(yaw ?? 0));
const rightOf = (yaw) => new T.Vector3(Math.cos(yaw ?? 0), 0, -Math.sin(yaw ?? 0));
/** Рама окна выходит за стекло на 0,18 м с каждой стороны. */
const FRAME = 0.18;

test('ship portholes are big and fit under the ceiling', () => {
  assert.ok(windows.length >= 12, `иллюминаторов ${windows.length}`);
  for (const w of windows) {
    assert.ok(w.h >= 2, `окно высотой ${w.h}`);
    assert.ok(w.y + w.h / 2 + FRAME <= 3.2, 'рама не упирается в потолок');
    assert.ok(w.y - w.h / 2 - FRAME > 0.3, 'низ окна выше пола');
  }
});

test('ship portholes never cover a console, a sabotage panel or a door on the same wall', () => {
  for (const w of windows) {
    const along = alongX(w.yaw);
    const at = along ? w.x : w.z;
    const line = along ? w.z : w.x;
    const [from, to] = [at - w.w / 2 - FRAME, at + w.w / 2 + FRAME];
    for (const c of consoles) {
      if (alongX(c.yaw) !== along || Math.abs((along ? c.z : c.x) - line) > 1) continue;
      const half = (along ? c.w : c.d) / 2;
      const cAt = along ? c.x : c.z;
      assert.ok(cAt + half <= from || cAt - half >= to, `окно у ${w.x},${w.z} закрывает пульт ${c.art} у ${c.x},${c.z}`);
    }
    for (const d of doors) {
      if (Math.abs((along ? d.z : d.x) - line) > 0.2 || alongX(d.yaw) !== along) continue;
      const dAt = along ? d.x : d.z;
      assert.ok(dAt + d.w / 2 <= from || dAt - d.w / 2 >= to, `окно у ${w.x},${w.z} налезает на дверь у ${d.x},${d.z}`);
    }
  }
});

test('the sun shines only through portholes that face it, and the light lands inside the room', () => {
  let lit = 0;
  for (const w of windows) {
    const normal = normalOf(w.yaw);
    const center = new T.Vector3(w.x, w.y, w.z).addScaledVector(normal, 0.17);
    const beam = sunbeamGeometry(center, normal, rightOf(w.yaw), w.w, w.h, 2);
    const facesSun = SPACE_SUN.dot(normal.clone().negate()) >= 0.15;
    assert.equal(!!beam, facesSun, `окно у ${w.x},${w.z}`);
    if (!beam) continue;
    lit++;
    const pos = beam.patch.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const p = new T.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      assert.ok(Math.abs(p.y) < 0.05, 'пятно лежит на полу');
      // Пятно — по ту сторону стекла, в отсеке, и не дальше, чем помещается в отсек.
      const into = p.clone().sub(center).dot(normal);
      assert.ok(into > 0.3 && into < 7, `свет уходит в отсек на ${into.toFixed(2)} м`);
    }
  }
  assert.ok(lit >= 4, `солнце светит в ${lit} иллюминаторов`);
  assert.ok(windows.length - lit >= 4, 'а в другие видны планеты');
});
