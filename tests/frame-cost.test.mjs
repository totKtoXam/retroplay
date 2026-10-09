import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { findNamed, MISS_TTL_MS } from '../components/find-named.ts';
import { createAvatar, setAvatarStyle, setAvatarAnonymous } from '../components/world-avatar.ts';
import { attachCustomSkins, applyAvatarSkin } from '../components/world-skins.ts';
import { castsHumanShadow } from '../components/world-human.ts';

const named = (name, parent) => {
  const o = new T.Group();
  o.name = name;
  parent?.add(o);
  return o;
};

test('findNamed находит то же, что getObjectByName, и не теряет перенесённый узел', () => {
  const root = named('root');
  const arm = named('arm', root);
  const socket = named('socket', root);
  const gun = named('gun', arm);
  assert.equal(findNamed(root, 'gun', 0), root.getObjectByName('gun'));
  // Человек переносит оружие к своей кисти — внутри того же бойца.
  socket.add(gun);
  assert.equal(findNamed(root, 'gun', 0), gun);
  // Узел ушёл из бойца: кэш его больше не выдаёт.
  gun.removeFromParent();
  assert.equal(findNamed(root, 'gun', 0), undefined);
});

test('findNamed верит промаху недолго: догруженный узел находится', () => {
  const root = named('root');
  assert.equal(findNamed(root, 'weapon', 0), undefined);
  const weapon = named('weapon', root);
  assert.equal(findNamed(root, 'weapon', 1), undefined, 'промах ещё свежий');
  assert.equal(findNamed(root, 'weapon', MISS_TTL_MS + 1), weapon);
});

test('Кадр не обходит бойца заново, если скин и цвет не менялись', () => {
  const avatar = createAvatar('#5aa9ff');
  const skins = attachCustomSkins(avatar);
  applyAvatarSkin(avatar, 'ninja', '#ff00ff', skins.bandanaMat);
  let walks = 0;
  const traverse = avatar.traverse.bind(avatar);
  avatar.traverse = (cb) => {
    walks++;
    return traverse(cb);
  };
  for (let i = 0; i < 10; i++) {
    applyAvatarSkin(avatar, 'ninja', '#ff00ff', skins.bandanaMat);
    setAvatarAnonymous(avatar, false);
  }
  assert.equal(walks, 0);
  applyAvatarSkin(avatar, 'knight', '#ff00ff', skins.bandanaMat);
  assert.ok(walks > 0, 'смена скина применяется');
  assert.equal(avatar.getObjectByName('skin-knight-head').visible, true);
  assert.equal(avatar.getObjectByName('skin-ninja-head').visible, false);
});

test('После смены стиля скин экипажа снова прячет тело рига', () => {
  const avatar = createAvatar('#5aa9ff');
  const skins = attachCustomSkins(avatar);
  const chestBody = () =>
    avatar.getObjectByName('chest').children.some((o) => (o.name === 'agent-skin' || o.name === 'legacy-skin') && o.visible);
  applyAvatarSkin(avatar, 'agent', '#ff00ff', skins.bandanaMat);
  assert.equal(chestBody(), true, 'у агента тело рига на месте');
  applyAvatarSkin(avatar, 'crew-captain', '#ff00ff', skins.bandanaMat);
  assert.equal(chestBody(), false);
  // Сцена переставляет стиль всем бойцам — и заново включает их тела.
  setAvatarStyle(avatar, false);
  applyAvatarSkin(avatar, 'crew-captain', '#ff00ff', skins.bandanaMat);
  assert.equal(chestBody(), false);
});

test('Тень бойца: без глаз и бровей, вдали — одним упрощённым телом', () => {
  const mesh = (name, parent) => {
    const m = new T.Mesh();
    m.name = name;
    if (parent) named(parent).add(m);
    return m;
  };
  for (const inner of [mesh('eyes'), mesh('eyebrows'), mesh('', 'human-bandana')])
    assert.equal(castsHumanShadow(inner, 'near'), false);
  for (const part of [mesh('body'), mesh('hair-long'), mesh('human-gear-agent'), mesh('weapon-shotgun_1')]) {
    assert.equal(castsHumanShadow(part, 'near'), true);
    assert.equal(castsHumanShadow(part, 'far'), false);
  }
  assert.equal(castsHumanShadow(mesh('body-lod'), 'far'), true);
  assert.equal(castsHumanShadow(mesh('body-lod'), 'none'), false);
});
