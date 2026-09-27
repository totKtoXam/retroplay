import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { CHARACTER_MODELS, GRAPHICS_PRESETS, defaultCharacters, normalizeGraphics } from '../lib/graphics-settings.ts';
import { humanLook } from '../components/world-human-gear.ts';

/** JSON-часть GLB: хватает, чтобы проверить состав файла без загрузчика three.js. */
const glb = (name) => {
  const buf = readFileSync(new URL(`../public/models/humans/${name}.glb`, import.meta.url));
  assert.equal(buf.toString('ascii', 0, 4), 'glTF');
  const length = buf.readUInt32LE(12);
  return { json: JSON.parse(buf.toString('utf8', 20, 20 + length)), bytes: buf.length };
};

test('graphics settings keep the character models choice and fall back safely', () => {
  for (const preset of Object.values(GRAPHICS_PRESETS))
    assert.ok(CHARACTER_MODELS.some((c) => c.id === preset.characters));
  assert.equal(GRAPHICS_PRESETS.low.characters, 'human-lite', 'слабым компьютерам — облегчённые люди');
  assert.equal(normalizeGraphics({ characters: 'classic' }).characters, 'classic');
  assert.equal(normalizeGraphics({ characters: 'robots' }).characters, 'human');
  assert.equal(normalizeGraphics({}).characters, 'human');
  assert.equal(defaultCharacters('low'), 'human-lite');
  assert.equal(defaultCharacters('cinematic'), 'human');
});

test('a human is dressed by the skin: team colour for agents, accent for the crew, no hair under helmets', () => {
  const agent = humanLook('agent', '#d94848', '#3b82f6');
  assert.deepEqual([agent.suit, agent.tactical, agent.hair, agent.cover], ['#d94848', true, true, 0]);
  const crew = humanLook('crew-captain', '#d94848', '#3b82f6');
  assert.deepEqual([crew.suit, crew.tactical, crew.hair], ['#3b82f6', false, false]);
  assert.equal(humanLook('ninja', '#d94848', '#3b82f6').cover, 1, 'маска закрывает лицо');
  for (const skin of ['knight', 'cosmo', 'hazmat']) assert.equal(humanLook(skin, '#fff', '#fff').hair, false, skin);
  assert.equal(humanLook('classic', '#123456', '#fff').suit, '#123456');
});

test('human model files carry everything the game needs, and stay small', () => {
  const anim = glb('human-animations');
  const clips = anim.json.animations.map((a) => a.name);
  for (const clip of ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Jump_Loop', 'Death01', 'Swim_Fwd_Loop', 'Interact'])
    assert.ok(clips.includes(clip), clip);
  assert.ok(anim.bytes < 2.5e6, `анимации ${anim.bytes} байт`);
  for (const body of ['human-male', 'human-female']) {
    const { json, bytes } = glb(body);
    const names = json.nodes.map((n) => n.name);
    for (const part of ['body', 'body-lod', 'eyes', 'eyebrows']) assert.ok(names.includes(part), `${body}: ${part}`);
    assert.ok(names.filter((n) => n.startsWith('hair-')).length >= 3, `${body}: причёски`);
    // Маска костюма (scripts/build-human-models.mjs) — в цвете вершин тела и упрощённого тела.
    for (const part of ['body', 'body-lod']) {
      const node = json.nodes.find((n) => n.name === part);
      for (const prim of json.meshes[node.mesh].primitives) assert.ok('COLOR_0' in prim.attributes, `${body}: маска ${part}`);
    }
    // Упрощённое тело действительно проще.
    const tris = (part) => {
      const node = json.nodes.find((n) => n.name === part);
      return json.meshes[node.mesh].primitives.reduce((sum, p) => sum + json.accessors[p.indices].count / 3, 0);
    };
    assert.ok(tris('body-lod') < tris('body') * 0.35, `${body}: LOD ${tris('body-lod')} из ${tris('body')}`);
    // Скелет общий с анимациями: те же 65 костей.
    assert.equal(json.skins[0].joints.length, 65);
    assert.ok(bytes < 1e6, `${body}: ${bytes} байт`);
  }
  assert.ok(statSync(new URL('../public/models/humans/LICENSE.txt', import.meta.url)).size > 0, 'лицензия рядом с моделями');
});
