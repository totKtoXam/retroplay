import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createFirstPersonHands } from '../components/world-hands.ts';
import { WEAPON_SIGHTS, aimHold, HIP_HOLD } from '../lib/weapon-sights.ts';

const ARMED = ['paint', 'confetti', 'sniper', 'like'];
const GUN_NAME = {
  paint: 'paint-launcher',
  confetti: 'confetti-shotgun',
  sniper: 'sniper-rifle',
  like: 'like-blaster',
};

/** Прогоняем столько кадров, чтобы затухли доводка после смены оружия и отдача. */
function hold(tool, aim, frames = 90, sight = 'dot') {
  const camera = new T.PerspectiveCamera(60, 1, 0.06, 350);
  const hands = createFirstPersonHands(camera);
  for (let i = 0; i < frames; i++)
    hands.update(
      1 / 60, 10 + i / 60, 0, tool, '#ffffff', true, aim, 0, 'pinata', 0, sight,
    );
  camera.updateMatrixWorld(true);
  return { camera, hands };
}

/** Где метка прицела оказалась относительно глаза: камера смотрит вдоль -Z. */
function inEye(camera, tool, marker) {
  const gun = camera.getObjectByName(GUN_NAME[tool]);
  assert.ok(gun, `модель ${tool} должна существовать`);
  const anchor = gun.getObjectByName(marker);
  assert.ok(anchor, `у ${tool} должна быть метка ${marker}`);
  return camera.worldToLocal(anchor.getWorldPosition(new T.Vector3()));
}

for (const tool of ARMED) {
  test(`Прицеливание ставит целик и мушку ${tool} на ось камеры`, () => {
    const { camera } = hold(tool, 1);
    for (const marker of ['sight-rear', 'sight-front']) {
      const p = inEye(camera, tool, marker);
      assert.ok(
        Math.abs(p.x) < 1e-6,
        `${marker} ушла вбок на ${p.x.toFixed(4)} — целиться сквозь прицел нельзя`,
      );
      assert.ok(
        Math.abs(p.y) < 1e-6,
        `${marker} ушла по высоте на ${p.y.toFixed(4)} — целиться сквозь прицел нельзя`,
      );
      assert.ok(p.z < -0.1, `${marker} должна быть перед глазом, а не за ним`);
    }
    const rear = inEye(camera, tool, 'sight-rear');
    const front = inEye(camera, tool, 'sight-front');
    assert.ok(
      front.z < rear.z,
      'мушка стоит дальше целика: иначе это не прицельная линия',
    );
    assert.ok(
      rear.z < -0.06,
      'целик не должен уходить за ближнюю плоскость камеры — его обрежет',
    );
  });
}

test('От бедра оружие держится сбоку, а не по центру экрана', () => {
  for (const tool of ARMED) {
    const { camera } = hold(tool, 0);
    const front = inEye(camera, tool, 'sight-front');
    assert.ok(
      Math.abs(front.x) > 0.2,
      `${tool}: без ПКМ оружие должно оставаться сбоку`,
    );
  }
});

test('Покачивание при ходьбе не сбивает прицел, но заметно от бедра', () => {
  const camera = new T.PerspectiveCamera(60, 1, 0.06, 350);
  const hands = createFirstPersonHands(camera);
  const sample = (aim) => {
    const seen = [];
    for (let i = 0; i < 120; i++) {
      hands.update(1 / 60, 10 + i / 60, 1, 'paint', '#ffffff', true, aim, 0);
      camera.updateMatrixWorld(true);
      seen.push(inEye(camera, 'paint', 'sight-front').x);
    }
    return Math.max(...seen) - Math.min(...seen);
  };
  assert.ok(sample(0) > 0.001, 'от бедра ствол должен гулять при ходьбе');
  assert.ok(
    sample(1) < 1e-9,
    'в прицеливании мушка обязана стоять неподвижно в центре',
  );
});

test('У каждого ствола своя точка вылета, и она перед мушкой', () => {
  const seen = new Set();
  for (const tool of ARMED) {
    const { camera, hands } = hold(tool, 1);
    const muzzle = camera.worldToLocal(hands.muzzle(tool));
    const front = inEye(camera, tool, 'sight-front');
    assert.ok(
      muzzle.z <= front.z + 1e-9,
      `${tool}: снаряд не должен рождаться позади мушки`,
    );
    seen.add(WEAPON_SIGHTS[tool].muzzle.join(','));
  }
  assert.equal(seen.size, ARMED.length, 'у стволов разной длины разные дула');
});

test('aimHold ведёт руку от бедра к линии прицела без скачков', () => {
  for (const tool of ARMED) {
    const hip = aimHold(tool, 0);
    assert.deepEqual(hip, { ...HIP_HOLD });
    const aimed = aimHold(tool, 1);
    assert.equal(aimed.x, 0);
    assert.ok(Math.abs(aimed.y + WEAPON_SIGHTS[tool].y) < 1e-9);
    assert.ok(Math.abs(aimed.z - WEAPON_SIGHTS[tool].z) < 1e-9);
    const half = aimHold(tool, 0.5);
    assert.ok(half.y > Math.min(hip.y, aimed.y) && half.y < Math.max(hip.y, aimed.y));
    // За пределами 0..1 удержание не должно улетать: прицел зажимается.
    assert.deepEqual(aimHold(tool, 4), aimed);
    assert.deepEqual(aimHold(tool, -3), hip);
  }
  assert.deepEqual(aimHold('sticky', 1), { ...HIP_HOLD });
});

test('У краскомёта поднят ровно один прицел, и колесо его переключает', () => {
  const camera = new T.PerspectiveCamera(60, 1, 0.06, 350);
  const hands = createFirstPersonHands(camera);
  const optic = camera.getObjectByName('paint-optic');
  const irons = camera.getObjectByName('paint-irons');
  const frames = (sight) => {
    for (let i = 0; i < 8; i++)
      hands.update(
        1 / 60, 10 + i / 60, 0, 'paint', '#ffffff', true, 1, 0, 'pinata', 0, sight,
      );
  };
  frames('irons');
  assert.equal(optic.visible, false, 'с механическим коллиматор снят');
  assert.equal(irons.visible, true);
  frames('dot');
  assert.equal(optic.visible, true);
  assert.equal(irons.visible, false, 'под коллиматором мушка сложена');
});

test('Оба прицела краскомёта целятся в одну точку', () => {
  for (const sight of ['irons', 'dot']) {
    const { camera } = hold('paint', 1, 90, sight);
    for (const marker of ['sight-rear', 'sight-front']) {
      const p = inEye(camera, 'paint', marker);
      assert.ok(
        Math.abs(p.x) < 1e-6 && Math.abs(p.y) < 1e-6,
        `${sight}: ${marker} должна стоять на оси камеры`,
      );
    }
  }
});
