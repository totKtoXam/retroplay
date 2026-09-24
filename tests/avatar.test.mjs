import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {
  createAvatar,
  animateAvatar,
  avatarShoot,
  setAvatarStyle,
  setAvatarAnonymous,
  followCameraHeading,
} from '../components/world-avatar.ts';
import { attachCustomSkins, applyAvatarSkin } from '../components/world-skins.ts';
import { AVATAR_SKINS } from '../lib/avatar-catalog.ts';
import { cleanText } from '../lib/model.ts';

const idle = {
  speed: 0,
  strafe: 0,
  forward: 1,
  airborne: false,
  velocityY: 0,
  stance: 'stand',
  tool: 'other',
  pitch: 0,
};
function frames(a, m, n = 60, dt = 1 / 60) {
  for (let i = 0; i < n; i++) animateAvatar(a, { ...idle, ...m }, dt, i * dt);
}
test('Camera drives heading while stationary and crosses angle wrap by the short path', () => {
  let angle = 0;
  for (let i = 0; i < 60; i++)
    angle = followCameraHeading(angle, Math.PI / 2, 1 / 60);
  assert.ok(Math.abs(angle - Math.PI / 2) < 0.001);
  const crossed = followCameraHeading(Math.PI - 0.02, -Math.PI + 0.02, 1 / 60);
  assert.ok(crossed > Math.PI - 0.02);
  assert.ok(crossed < Math.PI + 0.02);
});
test('Sitting articulates knees without squashing the character; prone transition is smooth', () => {
  const a = createAvatar('#8196dd');
  frames(a, { stance: 'sit' });
  const rig = a.getObjectByName('rig');
  assert.equal(rig.scale.y, 1);
  assert.ok(a.getObjectByName('kneeL').rotation.x < -1.4);
  assert.ok(a.getObjectByName('legL').rotation.x > 1.3);
  animateAvatar(a, { ...idle, stance: 'lie' }, 1 / 60, 2);
  assert.ok(rig.rotation.x > -Math.PI / 2);
  assert.ok(rig.rotation.x < 0);
  frames(a, { stance: 'lie' });
  assert.ok(Math.abs(rig.rotation.x + Math.PI / 2) < 0.001);
  assert.ok(rig.position.y > 0.18);
});
test('Jump bends legs; landing absorbs impact and returns to idle', () => {
  const a = createAvatar('#8196dd');
  frames(a, { airborne: true, velocityY: 4 }, 20);
  assert.ok(a.getObjectByName('kneeL').rotation.x < -0.5);
  animateAvatar(a, idle, 1 / 60, 1);
  assert.ok(a.getObjectByName('rig').position.y < 0);
  frames(a, {}, 90);
  assert.ok(Math.abs(a.getObjectByName('rig').position.y) < 0.02);
});
test('Weapon recoil recovers, inventory replaces gun with tablet, anime is switchable', () => {
  const a = createAvatar('#8196dd');
  frames(a, { tool: 'paint' });
  const gun = a.getObjectByName('gun'),
    rest = gun.position.z;
  avatarShoot(a);
  animateAvatar(a, { ...idle, tool: 'paint' }, 1 / 60, 1);
  assert.ok(gun.position.z > rest);
  frames(a, { tool: 'paint' }, 90);
  assert.ok(Math.abs(gun.position.z - rest) < 0.002);
  frames(a, { tool: 'paint', inventory: true }, 2);
  assert.equal(gun.visible, false);
  assert.equal(a.getObjectByName('tablet').visible, true);
  setAvatarStyle(a, true);
  assert.equal(a.getObjectByName('anime-detail').visible, true);
  assert.equal(a.getObjectByName('classic-detail').visible, false);
  setAvatarStyle(a, false);
  assert.equal(a.getObjectByName('classic-detail').visible, true);
});
test('Pose blending is stable at 30 and 60 FPS', () => {
  const a = createAvatar('#8196dd'),
    b = createAvatar('#8196dd');
  frames(a, { stance: 'sit' }, 30, 1 / 30);
  frames(b, { stance: 'sit' }, 60, 1 / 60);
  assert.ok(
    Math.abs(
      a.getObjectByName('legL').rotation.x -
        b.getObjectByName('legL').rotation.x,
    ) < 0.001,
  );
});

test('Tactical skin replaces all legacy body surfaces within a small draw-call budget', () => {
  const a = createAvatar('#8196dd');
  const visible = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const legacy = [],
    agent = [],
    meshes = [];
  a.traverse((o) => {
    if (o.name === 'legacy-skin') legacy.push(o);
    if (o.name === 'agent-skin') agent.push(o);
    if (o.isMesh && visible(o)) meshes.push(o);
  });
  assert.ok(agent.length >= 10);
  assert.ok(legacy.every((o) => !visible(o)));
  assert.ok(meshes.length <= 24, 'Character must batch details per joint');
  setAvatarStyle(a, true);
  assert.ok(agent.every((o) => !visible(o)));
  assert.ok(legacy.some(visible));
});

test('Anonymous bag conceals the head across both styles and can be removed', () => {
  const a = createAvatar('#657ac9');
  setAvatarAnonymous(a, true);
  for (const anime of [true, false]) {
    setAvatarStyle(a, anime);
    assert.equal(a.getObjectByName('unmasked-head').visible, false);
    assert.equal(a.getObjectByName('anonymous-bag').visible, true);
  }
  setAvatarAnonymous(a, false);
  assert.equal(a.getObjectByName('unmasked-head').visible, true);
  assert.equal(a.getObjectByName('anonymous-bag').visible, false);
});

/*
 * Бандана и накладки скинов (components/world-skins.ts). Проверяем не «применилось ли
 * значение», а видно ли деталь с камеры превью: прежняя лента 0.48 × 0.44 была меньше
 * головы и целиком тонула внутри неё, хотя цвет исправно менялся.
 */
const onScreen = (o) => {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};
/**
 * Сколько лучей из камеры превью (avatar-preview-scene) дошло до материала.
 * Сетку держим узкой — по ширине головы на высоте ленты: полный «скриншот»
 * трассировкой стоит десятки секунд и в юнит-тестах не окупается.
 */
function headRays(avatar, material) {
  avatar.updateMatrixWorld(true);
  const eye = new T.Vector3(0.2, 1.25, -3.7);
  const ray = new T.Raycaster();
  let hits = 0;
  for (let i = -10; i <= 10; i++)
    for (const y of [1.75, 1.78, 1.81]) {
      const to = new T.Vector3(i * 0.025, y, 0);
      ray.set(eye, to.clone().sub(eye).normalize());
      // Raycaster не смотрит на visible, поэтому скрытые наборы отсеиваем сами.
      const first = ray
        .intersectObject(avatar, true)
        .filter((h) => onScreen(h.object))[0];
      if (first && first.object.material === material) hits++;
    }
  return hits;
}
const dressed = (skinId, anime = false) => {
  const avatar = createAvatar('#5aa9ff');
  setAvatarStyle(avatar, anime);
  const skins = attachCustomSkins(avatar);
  applyAvatarSkin(avatar, skinId, '#ff00ff', skins.bandanaMat);
  return { avatar, skins };
};

test('Бандану видно на голове, а её цвет уходит в материал', () => {
  // Скины с визором на лоб (рыцарь, киберпанк, химзащита) закрывают ленту спереди
  // законно, поэтому спрашиваем только тех, у кого лоб открыт.
  for (const anime of [false, true])
    for (const skinId of ['agent', 'classic', 'ninja']) {
      const { avatar, skins } = dressed(skinId, anime);
      assert.equal(skins.bandanaMat.color.getHexString(), 'ff00ff');
      assert.ok(
        headRays(avatar, skins.bandanaMat) > 20,
        `бандана тонет внутри головы: ${skinId}, anime=${anime}`,
      );
    }
});

test('Под куполом скафандра бандана спрятана, а не протыкает шлем', () => {
  const { avatar, skins } = dressed('cosmo');
  assert.equal(avatar.getObjectByName('avatar-bandana').visible, false);
  assert.equal(headRays(avatar, skins.bandanaMat), 0);
});

test('Накладки скинов смотрят вперёд: лицо рига в −Z, узел банданы на затылке', () => {
  const { avatar } = dressed('ninja');
  avatar.updateMatrixWorld(true);
  const at = (o) => o.getWorldPosition(new T.Vector3());
  assert.ok(at(avatar.getObjectByName('skin-ninja-head').children[0]).z < 0, 'маска на лице');
  assert.ok(at(avatar.getObjectByName('avatar-bandana').children[1]).z > 0, 'узел на затылке');
});

test('Любой скин оставляет ровно одно видимое тело, а не одни аксессуары', () => {
  for (const anime of [false, true])
    for (const skinId of ['agent', 'classic', 'ninja', 'cyber', 'knight', 'hazmat', 'cosmo']) {
      const { avatar } = dressed(skinId, anime);
      const bodies = new Set();
      avatar.traverse((o) => {
        if ((o.name === 'legacy-skin' || o.name === 'agent-skin') && onScreen(o))
          bodies.add(o.name);
      });
      assert.equal(
        bodies.size,
        1,
        `тело должно быть ровно одно: ${skinId}, anime=${anime}, сейчас ${[...bodies].join()}`,
      );
    }
});

/*
 * Скины экипажа («Среди нас», components/world-skins.ts): id живут в каталоге
 * (lib/avatar-catalog.ts) и проходят ту же проверку, что и поле `hat` на сервере
 * (cleanText в lib/model.ts, лимит 20 символов) — второй список для них заводить
 * не пришлось.
 */
const CREW_SKIN_IDS = [
  'crewmate',
  'crew-captain',
  'crew-doctor',
  'crew-mechanic',
  'crew-chef',
  'crew-sprout',
  'crew-party',
];

test('Скины экипажа есть в каталоге, их id уникальны и проходят валидацию поля hat', () => {
  const ids = AVATAR_SKINS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'id скинов не должны повторяться');
  for (const id of CREW_SKIN_IDS) {
    assert.ok(ids.includes(id), `${id} должен быть в AVATAR_SKINS`);
    assert.equal(cleanText(id, 20), id, `${id} должен проходить валидацию поля hat (lib/model.ts)`);
  }
});

test('У скина экипажа спрятана вся плоть рига, кроме оружия и планшета в руках', () => {
  for (const skinId of CREW_SKIN_IDS) {
    const { avatar } = dressed(skinId);
    // Ни одного обычного тела (легаси или AERO) — экипаж целиком в своём скафандре.
    avatar.traverse((o) => {
      if (o.name !== 'legacy-skin' && o.name !== 'agent-skin') return;
      let underTool = false;
      for (let p = o; p; p = p.parent) if (p.name === 'gun' || p.name === 'tablet') underTool = true;
      if (!underTool) assert.equal(onScreen(o), false, `${skinId}: плоть ${o.parent?.name} видна поверх скафандра`);
    });
    // Сам скафандр (боб, визор, ноги) виден.
    for (const part of ['skin-crew-body-chest', 'skin-crew-body-head']) {
      const node = avatar.getObjectByName(part);
      assert.ok(node && onScreen(node), `${skinId}: ${part} должен быть виден`);
    }
    const legs = [];
    avatar.traverse((o) => {
      if (o.name === 'skin-crew-body-leg') legs.push(o);
    });
    assert.equal(legs.length, 2, `${skinId}: у экипажа должно быть две ноги-столбика`);
    assert.ok(legs.every(onScreen), `${skinId}: ноги должны быть видны`);
    // Бандана тонет под цельным корпусом — как под куполом «Космонавта».
    assert.equal(avatar.getObjectByName('avatar-bandana').visible, false);
  }
});

test('Скафандр экипажа красится в переданный (личный/командный) цвет', () => {
  const { avatar } = dressed('crewmate');
  const torso = avatar.getObjectByName('crew-torso');
  assert.equal(torso.material.color.getHexString(), 'ff00ff'); // dressed() красит в '#ff00ff'
});

test('У каждого скина экипажа виден ровно свой головной убор/костюм, а не чужой', () => {
  const overlay = {
    crewmate: [],
    'crew-captain': ['skin-crew-captain-head'],
    'crew-doctor': ['skin-crew-doctor-head', 'skin-crew-doctor-chest'],
    'crew-mechanic': ['skin-crew-mechanic-head', 'skin-crew-mechanic-chest'],
    'crew-chef': ['skin-crew-chef-head'],
    'crew-sprout': ['skin-crew-sprout-head'],
    'crew-party': ['skin-crew-party-head'],
  };
  const allOverlays = Object.values(overlay).flat();
  for (const skinId of CREW_SKIN_IDS) {
    const { avatar } = dressed(skinId);
    const visible = allOverlays.filter((name) => onScreen(avatar.getObjectByName(name)));
    assert.deepEqual(visible.sort(), overlay[skinId].slice().sort(), `неверная косметика для ${skinId}`);
  }
});
