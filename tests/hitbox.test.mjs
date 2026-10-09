import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inHitRange,
  isHeadshot,
  hitZone,
  effectDamage,
} from '../lib/game-items.ts';
import { pelletEnds, shotgunVolley, SHOTGUN_PELLETS } from '../lib/shotgun.ts';

test('Headshot is strictly registered on head, not on chest or torso', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand' };

  // Firing from z = 5 towards z = -5 through player at (0, 0, 0)
  const fireAt = (y, x = 0) => ({
    origin: [x, y, 5],
    target: [x, y, -5],
  });

  // 1. Direct head center (y = 2.07) -> Headshot
  const headShot = fireAt(2.07);
  assert.ok(inHitRange('paint', headShot.origin, headShot.target, pose));
  assert.equal(isHeadshot('paint', headShot.origin, headShot.target, pose), true);

  // 2. Forehead (y = 2.20) -> Headshot
  const forehead = fireAt(2.20);
  assert.ok(inHitRange('paint', forehead.origin, forehead.target, pose));
  assert.equal(isHeadshot('paint', forehead.origin, forehead.target, pose), true);

  // 3. Lower face / chin (y = 1.90) -> Headshot
  const chin = fireAt(1.90);
  assert.ok(inHitRange('paint', chin.origin, chin.target, pose));
  assert.equal(isHeadshot('paint', chin.origin, chin.target, pose), true);

  // 4. Chest (y = 1.50) -> Hit registered, but NOT a headshot!
  const chest = fireAt(1.50);
  assert.ok(inHitRange('paint', chest.origin, chest.target, pose));
  assert.equal(isHeadshot('paint', chest.origin, chest.target, pose), false, 'chest shot must NOT be headshot');

  // 5. Upper chest / collarbone (y = 1.70) -> Hit registered, but NOT a headshot!
  const upperChest = fireAt(1.70);
  assert.ok(inHitRange('paint', upperChest.origin, upperChest.target, pose));
  assert.equal(isHeadshot('paint', upperChest.origin, upperChest.target, pose), false, 'collarbone must NOT be headshot');

  // 6. Stomach (y = 1.20) -> Hit registered, NOT a headshot
  const stomach = fireAt(1.20);
  assert.ok(inHitRange('paint', stomach.origin, stomach.target, pose));
  assert.equal(isHeadshot('paint', stomach.origin, stomach.target, pose), false);

  // 7. Legs (y = 0.50) -> Hit registered, NOT a headshot
  const legs = fireAt(0.50);
  assert.ok(inHitRange('paint', legs.origin, legs.target, pose));
  assert.equal(isHeadshot('paint', legs.origin, legs.target, pose), false);

  // 8. Grenades never register as headshots
  assert.equal(isHeadshot('grenade', headShot.origin, headShot.target, pose), false);

  // 9. Wide miss (x = 1.2, y = 2.07)
  const miss = fireAt(2.07, 1.2);
  assert.equal(inHitRange('paint', miss.origin, miss.target, pose), false);
  assert.equal(isHeadshot('paint', miss.origin, miss.target, pose), false);
});

test('Sitting stance headshot vs chest detection', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, stance: 'sit' };
  const fireAt = (y) => ({
    origin: [0, y, 4],
    target: [0, y, -4],
  });

  // Sitting head at y = 1.67
  const head = fireAt(1.67);
  assert.ok(inHitRange('paint', head.origin, head.target, pose));
  assert.equal(isHeadshot('paint', head.origin, head.target, pose), true);

  // Sitting chest at y = 1.10 -> NOT headshot
  const chest = fireAt(1.10);
  assert.ok(inHitRange('paint', chest.origin, chest.target, pose));
  assert.equal(isHeadshot('paint', chest.origin, chest.target, pose), false);
});

/** Залп по одной цели без стен карты; несколько разных id — разные рисунки разлёта. */
const volleyAt = (origin, target, pose, id, colliders = []) =>
  shotgunVolley(origin, target, id, [{ id: 'v', pose }], colliders).hits.get('v') ?? { pellets: 0, damage: 0, head: false };
const IDS = Array.from({ length: 60 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

test('Дробовик в упор: все дробины в корпус — убийство', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand' };
  for (const id of IDS) {
    for (const d of [1.5, 2.5]) {
      const hit = volleyAt([0, 1.4, d], [0, 1.4, 0], pose, id);
      assert.equal(hit.pellets, SHOTGUN_PELLETS, `все дробины на ${d} м`);
      assert.ok(hit.damage >= 100, `в упор убивает (${hit.damage})`);
    }
  }
  const sit = { x: 0, y: 0, z: 0, yaw: 0, stance: 'sit' };
  assert.equal(volleyAt([0, 1.1, 2], [0, 1.1, 0], sit, IDS[0]).pellets, SHOTGUN_PELLETS);
});

test('Дробовик: разлёт растёт с дистанцией, урон — по числу попавших дробин', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand' };
  const avg = (d) =>
    IDS.reduce((sum, id) => sum + volleyAt([0, 1.4, d], [0, 1.4, 0], pose, id).pellets, 0) / IDS.length;
  const near = avg(4), mid = avg(10), far = avg(16), edge = avg(26);
  assert.ok(near > mid && mid > far && far > edge, `дробин меньше с дистанцией: ${near} ${mid} ${far} ${edge}`);
  assert.ok(mid >= 3 && mid <= 7, `на 10 м попадает часть залпа (${mid})`);
  assert.ok(far >= 1 && far <= 4, `на 16 м — пара дробин (${far})`);
  // За пределом дальности дробь не долетает.
  for (const id of IDS) assert.equal(volleyAt([0, 1.4, 30], [0, 1.4, 0], pose, id).pellets, 0);
  // Больше дробин — больше урона.
  const byPellets = new Map();
  for (const id of IDS) {
    const hit = volleyAt([0, 1.4, 10], [0, 1.4, 0], pose, id);
    if (!hit.head) byPellets.set(hit.pellets, Math.max(byPellets.get(hit.pellets) ?? 0, hit.damage));
  }
  const counts = [...byPellets.keys()].sort((a, b) => a - b);
  for (let i = 1; i < counts.length; i++)
    assert.ok(byPellets.get(counts[i]) > byPellets.get(counts[i - 1]) - 10, 'урон растёт с числом дробин');
});

test('Дробовик: рисунок разлёта свой у каждого выстрела и одинаков у сервера и клиента', () => {
  const a = pelletEnds([0, 1.4, 10], [0, 1.4, 0], IDS[0]);
  assert.deepEqual(a, pelletEnds([0, 1.4, 10], [0, 1.4, 0], IDS[0]), 'тот же id — тот же рисунок');
  assert.notDeepEqual(a, pelletEnds([0, 1.4, 10], [0, 1.4, 0], IDS[1]), 'другой выстрел — другой рисунок');
  // На 10 м дробины расходятся заметно, но в пределах конуса.
  const spread = a.map(([x, y, z]) => {
    const k = 10 / Math.hypot(x, y - 1.4, z - 10);
    return Math.hypot(x * k, (y - 1.4) * k);
  });
  assert.ok(Math.max(...spread) > 0.5 && Math.max(...spread) < 0.95, `радиус разлёта на 10 м: ${Math.max(...spread)}`);
});

test('Дробовик: мимо, назад и сквозь первого — не попадает', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand' };
  assert.equal(volleyAt([5, 1.4, 5], [5, 1.4, -5], pose, IDS[0]).pellets, 0, 'в стороне');
  assert.equal(volleyAt([0, 1.4, 2.5], [0, 1.4, 10], pose, IDS[0]).pellets, 0, 'за спиной стрелка');
  // Дробина ранит только первого на своём пути.
  const front = { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand' };
  const back = { x: 0, y: 0, z: -2, yaw: 0, stance: 'stand' };
  const { hits } = shotgunVolley([0, 1.4, 3], [0, 1.4, 0], IDS[0], [{ id: 'back', pose: back }, { id: 'front', pose: front }], []);
  assert.equal(hits.get('front')?.pellets, SHOTGUN_PELLETS);
  assert.equal(hits.get('back'), undefined);
});

test('Дробовик: в голову больнее, чем в корпус', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand' };
  const head = volleyAt([0, 2.07, 3], [0, 2.07, 0], pose, IDS[0]);
  const chest = volleyAt([0, 1.4, 3], [0, 1.4, 0], pose, IDS[0]);
  assert.ok(head.head);
  assert.ok(head.damage > chest.damage);
  // Хедшот издалека — уже не мгновенная смерть, как было с центральным лучом.
  const farHead = volleyAt([0, 2.07, 18], [0, 2.07, 0], pose, IDS[0]);
  assert.ok(farHead.damage < 100, `в голову с 18 м: ${farHead.damage}`);
});

test('Hit zones: head, torso and limbs are told apart', () => {
  const stand = { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand' };
  const zoneAt = (y, x = 0) => hitZone([x, y, 5], [x, y, -5], stand);

  assert.equal(zoneAt(2.07), 'head', 'голова');
  assert.equal(zoneAt(1.5), 'torso', 'грудь');
  assert.equal(zoneAt(1.2), 'torso', 'живот');
  assert.equal(zoneAt(0.5), 'limb', 'ноги');
  assert.equal(zoneAt(0.9), 'limb', 'бёдра');
  // Руки модели вынесены на 0.345 вбок от оси тела.
  assert.equal(zoneAt(1.6, 0.4), 'limb', 'рука');
  assert.equal(zoneAt(1.6, 0.1), 'torso', 'грудь при небольшом смещении');

  const sit = { x: 0, y: 0, z: 0, yaw: 0, stance: 'sit' };
  assert.equal(hitZone([0, 1.67, 5], [0, 1.67, -5], sit), 'head');
  assert.equal(hitZone([0, 1.1, 5], [0, 1.1, -5], sit), 'torso');
  assert.equal(hitZone([0, 0.35, 5], [0, 0.35, -5], sit), 'limb');
});

/**
 * Почему вспышка не должна зависеть от клиентской геометрии: сцена одна,
 * а ответы у клиента и сервера разные. Раньше `components/world-projectiles.ts`
 * зажигал виньетку по своей проверке, и во всех трёх случаях ниже она врала.
 */
test('Клиентская догадка о попадании по себе шире серверного правила', () => {
  // Дословно бывшая клиентская проверка: радиус вокруг груди ИЛИ хитбокс,
  // причём без коллайдеров текущей карты.
  const clientThoughtItHitMe = (kind, origin, target, pose) => {
    const center = [pose.x, pose.y + 0.95, pose.z];
    const near = Math.hypot(...center.map((v, i) => v - target[i])) < 1.15;
    return near || inHitRange(kind, origin, target, pose);
  };
  const pose = { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand' };

  // 1. Промах в метре от груди: краска легла рядом, урона нет, а вспышка была.
  const missOrigin = [5, 0.95, 0];
  const missTarget = [1, 0.95, 0];
  assert.equal(clientThoughtItHitMe('paint', missOrigin, missTarget, pose), true);
  assert.equal(inHitRange('paint', missOrigin, missTarget, pose), false);

  // 2. Стена на пути: сервер считает с коллайдерами карты, клиент — без них.
  const wallShot = { origin: [5, 1.4, 0], target: [-5, 1.4, 0] };
  const wall = { minX: 2, maxX: 2.4, minZ: -3, maxZ: 3, minY: 0, maxY: 4 };
  assert.equal(inHitRange('paint', wallShot.origin, wallShot.target, pose), true);
  assert.equal(
    inHitRange('paint', wallShot.origin, wallShot.target, pose, [wall]),
    false,
    'выстрел перекрыт стеной — сервер попадание не засчитает',
  );

  // 3. Сердечко попадает в корпус, но урона у него нет вовсе.
  assert.equal(inHitRange('like', [5, 1.4, 0], [-5, 1.4, 0], pose), true);
  assert.equal(effectDamage('like'), 0);
});

/**
 * Перекрытие проверяется по точке попадания, а не по центру тела. Пока сервер
 * пускал луч в середину груди, попадания поверх укрытия и через окно
 * отбрасывались: клиент рисовал отметку, а урон не проходил.
 */
test('Стена засчитывается только там, где реально прошёл выстрел', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand' };

  // 1. Цель за ящиком 1.4 м, выстрел прошёл поверх ящика в голову.
  const crate = { minX: -3, maxX: 3, minZ: 1.8, maxZ: 2.4, minY: 0, maxY: 1.4 };
  const overCover = { origin: [0, 1.7, 6], target: [0, 2.07, 0] };
  assert.equal(hitZone(overCover.origin, overCover.target, pose), 'head');
  assert.equal(
    inHitRange('paint', overCover.origin, overCover.target, pose, [crate]),
    true,
    'голова торчит над укрытием — попадание засчитывается',
  );

  // 2. Цель в здании, стрелок снаружи стреляет в голову через окно с подоконником 1.2 м.
  const sill = { minX: -12, maxX: 12, minZ: 2, maxZ: 2.4, minY: 0, maxY: 1.2 };
  const lintel = { minX: -12, maxX: 12, minZ: 2, maxZ: 2.4, minY: 2.3, maxY: 4 };
  const window = { origin: [0, 1.0, 10], target: [0, 2.07, 0] };
  assert.equal(
    inHitRange('paint', window.origin, window.target, pose, [sill, lintel]),
    true,
    'выстрел прошёл в оконный проём — урон должен регистрироваться',
  );

  // 3. Тот же подоконник, но выстрел идёт в него: попадания нет.
  const intoSill = { origin: [0, 0.9, 10], target: [0, 0.6, 0] };
  assert.equal(
    inHitRange('paint', intoSill.origin, intoSill.target, pose, [sill, lintel]),
    false,
    'пуля вошла в стену под окном — перекрытие остаётся в силе',
  );

  // 4. Сплошная стена по-прежнему держит дробовик.
  const solid = { minX: -12, maxX: 12, minZ: 2, maxZ: 2.4, minY: 0, maxY: 4 };
  const blast = { origin: [0, 1.15, 6], target: [0, 1.15, 0] };
  assert.ok(volleyAt(blast.origin, blast.target, pose, IDS[0]).pellets > 0);
  assert.equal(
    volleyAt(blast.origin, blast.target, pose, IDS[0], [solid]).pellets,
    0,
    'дробь не проходит сквозь сплошную стену',
  );
});
