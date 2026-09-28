import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';

// Текстуры эффектов рисуются на canvas: в Node хватает заглушки, которая всё принимает.
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

const { createWorldVfx, vfxTier } = await import('../components/world-vfx.ts');
const { makeGrenade, setGrenadeStyle, makeFireworkRocket } = await import('../components/party-geometry.ts');
const { GRENADES } = await import('../lib/game-items.ts');

const setup = (quality) => {
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(70, 1, 0.01, 200);
  camera.position.set(0, 1.6, 10);
  scene.add(camera);
  return { scene, camera, vfx: createWorldVfx({ scene, quality, camera }) };
};
const at = () => new T.Vector3(0, 1, 0);
const up = new T.Vector3(0, 1, 0);

test('уровни качества: низкое, сбалансированное, высокое, кино', () => {
  assert.deepEqual(['low', 'balanced', 'high', 'cinematic', 'что-то'].map(vfxTier), [0, 1, 2, 3, 1]);
});

test('частиц взрыва тем больше, чем выше качество', () => {
  const counts = ['low', 'balanced', 'cinematic'].map((q) => {
    const { vfx } = setup(q);
    vfx.burst(at(), '#f49fd6', 0, 'grenade:pinata', up);
    const s = vfx.stats();
    vfx.dispose();
    return s.pieces + s.glow + s.smoke;
  });
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2], counts.join(' < '));
  assert.ok(counts[0] < 120, `низкое качество дёшево: ${counts[0]}`);
});

test('живых вспышек не больше потолка, сколько ни стреляй', () => {
  const { vfx } = setup('cinematic');
  for (let i = 0; i < 40; i++) vfx.burst(at(), '#ffb851', i, 'pop:classic', up);
  assert.ok(vfx.stats().bursts <= 12);
  vfx.dispose();
});

test('спрайтов не больше ёмкости слоя, даже в затяжном бою', () => {
  const { vfx } = setup('low');
  for (let i = 0; i < 60; i++) vfx.burst(at(), '#ffcb65', i, 'firework:salute');
  const s = vfx.stats();
  assert.ok(s.glow + s.smoke <= s.capacity);
  vfx.dispose();
});

test('всё отжившее убирается: частицы, кольца и свет гаснут', () => {
  const { vfx } = setup('cinematic');
  vfx.burst(at(), '#f49fd6', 0, 'grenade:paintburst', up);
  vfx.burst(at(), '#ffcb65', 0, 'firework:salute');
  vfx.muzzleFlash(at(), new T.Vector3(0, 0, -1), '#ff647c', 0, 'sniper');
  assert.ok(vfx.stats().shockwaves > 0);
  for (let i = 1; i <= 80; i++) vfx.update(i * 100, 0.1);
  assert.deepEqual(
    (({ bursts, pieces, glow, smoke, shockwaves }) => ({ bursts, pieces, glow, smoke, shockwaves }))(vfx.stats()),
    { bursts: 0, pieces: 0, glow: 0, smoke: 0, shockwaves: 0 },
  );
  vfx.dispose();
});

test('свет вспышек постоянный: взрывы не добавляют источников в сцену', () => {
  const lights = (scene) => {
    let n = 0;
    scene.traverse((o) => (n += o instanceof T.PointLight ? 1 : 0));
    return n;
  };
  const low = setup('low');
  assert.equal(lights(low.scene), 0, 'на низком качестве света вспышек нет');
  low.vfx.dispose();
  const { scene, vfx } = setup('cinematic');
  const before = lights(scene);
  assert.equal(before, 1);
  for (let i = 0; i < 5; i++) vfx.burst(at(), '#f49fd6', i, 'grenade:meteor', up);
  vfx.update(50, 0.05);
  assert.equal(lights(scene), before);
  vfx.dispose();
  assert.equal(lights(scene), 0, 'dispose убирает свет из сцены');
});

test('вспышка у ствола: у гранаты её нет, из-за стены (ствол в камере) — тоже', () => {
  const { vfx, camera } = setup('balanced');
  vfx.muzzleFlash(at(), new T.Vector3(0, 0, -1), '#fff', 0, 'grenade');
  vfx.muzzleFlash(camera.position.clone(), new T.Vector3(0, 0, -1), '#fff', 0, 'paint');
  assert.equal(vfx.stats().glow + vfx.stats().smoke, 0);
  vfx.muzzleFlash(at(), new T.Vector3(0, 0, -1), '#fff', 0, 'paint');
  assert.ok(vfx.stats().glow > 0);
  vfx.dispose();
});

test('dispose убирает слои частиц из сцены', () => {
  const { scene, vfx } = setup('high');
  vfx.burst(at(), '#ffb851', 0, 'pop:classic', up);
  assert.ok(scene.children.some((o) => o instanceof T.Points));
  assert.ok(scene.children.some((o) => o instanceof T.InstancedMesh));
  vfx.dispose();
  assert.ok(!scene.children.some((o) => o instanceof T.Points || o instanceof T.InstancedMesh));
});

const triangles = (root) => {
  let n = 0;
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const g = o.geometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
};

test('граната каждого вида — скромная по треугольникам', () => {
  for (const g of GRENADES) {
    const model = makeGrenade(g.color, g.id);
    const n = triangles(model);
    assert.ok(n > 100 && n < 2500, `${g.id}: ${n}`);
  }
  assert.ok(triangles(makeFireworkRocket('#ffcb65')) < 800);
});

test('setGrenadeStyle меняет вид гранаты в руках и освобождает старую', () => {
  const group = makeGrenade('#f49fd6');
  const old = [];
  group.traverse((o) => o instanceof T.Mesh && old.push(o.geometry));
  let disposed = 0;
  old.forEach((g) => g.addEventListener('dispose', () => disposed++));
  setGrenadeStyle(group, 'pixel', true);
  assert.equal(disposed, old.length);
  assert.ok(group.children.length > 0);
  group.traverse((o) => {
    if (o instanceof T.Mesh) assert.equal(o.renderOrder, 1001);
  });
});

test('grenade models have no zero normals (NaN in lighting turns into black squares under bloom)', async () => {
  const { makeGrenade } = await import('../components/party-geometry.ts');
  for (const variant of ['pinata', 'paintburst', 'snowglobe', 'heartburst', 'pixel', 'meteor']) {
    makeGrenade('#64d4ef', variant).traverse((o) => {
      if (!o.isMesh) return;
      const n = o.geometry.getAttribute('normal');
      const v = new T.Vector3();
      for (let i = 0; i < n.count; i++) assert.ok(v.fromBufferAttribute(n, i).lengthSq() > 1e-10, `${variant}: нулевая нормаль`);
    });
  }
});
