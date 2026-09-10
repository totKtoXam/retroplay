import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { parseResourcePack, visualBudget } from '../lib/resource-packs.ts';
import { surfacePixels, createRealisticMaterials } from '../components/resource-packs/realistic/materials.ts';
import { dressFieldCharacter } from '../components/resource-packs/realistic/characters.ts';
import { createFieldEnvironment } from '../components/resource-packs/realistic/environment.ts';
import { createAvatar, animateAvatar, setAvatarAnonymous, setAvatarStyle } from '../components/world-avatar.ts';
import { visibleInWorld, avoidCameraWalls } from '../lib/game-camera.ts';

test('Saved pack IDs validate independently of room state; existing quality presets bound GPU allocation', () => {
  assert.equal(parseResourcePack(null), 'default');
  assert.equal(parseResourcePack('realistic-bodycam'), 'realistic-bodycam');
  assert.equal(parseResourcePack('untrusted-pack'), 'default');
  assert.equal(visualBudget('high').textureSize, visualBudget('cinematic').textureSize);
  assert.equal(visualBudget('low').localLights, 0);
  assert.ok(visualBudget('low').detailDistance < visualBudget('cinematic').detailDistance);
});
test('Original PBR maps are deterministic, finite and contain real normal/roughness variation', () => {
  for (const surface of ['concrete', 'steel', 'rubber', 'canvas', 'plaster', 'wetstone']) {
    const a = surfacePixels(surface, 64), b = surfacePixels(surface, 64);
    assert.deepEqual(a, b);
    assert.equal(a.albedo.length, 64 * 64 * 4);
    assert.ok(new Set(a.normal).size > 40);
    assert.ok(new Set(a.orm).size > 20);
  }
});
function rayHits(root, ray) {
  const meshes = []; root.updateMatrixWorld(true);
  root.traverse((o) => { if (o instanceof T.Mesh && visibleInWorld(o)) meshes.push(o); });
  return ray.intersectObjects(meshes, false).map((h) => [h.object.id, ...h.point.toArray().map((v) => +v.toFixed(7))]);
}
test('New character leaves raycast hitboxes and animated joint transforms identical, including sit/prone/reload', () => {
  const library = createRealisticMaterials('low');
  for (const anime of [false, true]) {
    const avatar = createAvatar('#8196dd'); setAvatarStyle(avatar, anime);
    const canonicalMeshes = [];
    avatar.traverse((o) => { if (o instanceof T.Mesh) canonicalMeshes.push([o, o.geometry, o.material, o.visible]); });
    const rays = [];
    for (let y = 0.15; y < 2.5; y += 0.13) for (const x of [-0.22, 0, 0.22])
      rays.push(new T.Raycaster(new T.Vector3(x, y, -5), new T.Vector3(0, 0, 1)));
    const before = rays.map((r) => rayHits(avatar, r));
    const skin = dressFieldCharacter(avatar, library);
    assert.deepEqual(rays.map((r) => rayHits(avatar, r)), before, 'all collision points and original mesh identities match');
    const twin = createAvatar('#8196dd'); setAvatarStyle(twin, anime);
    const names = ['rig', 'head', 'chest', 'legL', 'kneeL', 'armR', 'elbowR', 'gun', 'tablet'];
    for (const stance of ['stand', 'sit', 'lie']) for (const tool of ['paint', 'confetti', 'grenade', 'sniper', 'tablet']) {
      const motion = { speed: 3, strafe: 0.5, forward: 1, airborne: stance === 'stand', velocityY: 3, stance, tool, pitch: 0.2, reload: 0.5 };
      for (let i = 0; i < 20; i++) { animateAvatar(avatar, motion, 1 / 30, i / 30); animateAvatar(twin, motion, 1 / 30, i / 30); }
      avatar.updateMatrixWorld(true); twin.updateMatrixWorld(true);
      for (const name of names) assert.deepEqual(avatar.getObjectByName(name).matrix.elements, twin.getObjectByName(name).matrix.elements, name);
      for (const ray of rays) {
        const a = rayHits(avatar, ray).map((v) => v.slice(1));
        const b = rayHits(twin, ray).map((v) => v.slice(1));
        assert.deepEqual(a, b, `${stance}/${tool} collision geometry`);
      }
    }
    setAvatarAnonymous(avatar, true);
    assert.equal(visibleInWorld(avatar.getObjectByName('unmasked-head').getObjectByName('field-uniform')), false);
    assert.equal(avatar.getObjectByName('anonymous-bag').visible, true);
    skin.dispose();
    for (const [mesh, geometry, material, visible] of canonicalMeshes) { assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material); assert.equal(mesh.visible, visible); }
  }
  assert.ok(library.textureBytes <= 6 * 3 * 256 ** 2 * 4 * 4 / 3);
  library.dispose();
});
test('Decorative geometry cannot change camera obstacles or shooting; instancing and LOD bound cost', () => {
  const library = createRealisticMaterials('low'), scene = new T.Scene();
  const wall = new T.Mesh(new T.BoxGeometry(10, 10, 0.5), new T.MeshStandardMaterial()); wall.position.z = -6; scene.add(wall);
  const camera = new T.PerspectiveCamera();
  const eye = new T.Vector3(0, 2, 0), desired = new T.Vector3(0, 2, -10);
  scene.updateMatrixWorld(true);
  const before = avoidCameraWalls(eye, desired, [wall]);
  const pack = createFieldEnvironment(scene, library, 'low', [[-9, -6], [9, -6], [-9, 9], [9, 9]]);
  const meshes = []; scene.traverse((o) => { if (o instanceof T.Mesh) meshes.push(o); }); scene.updateMatrixWorld(true);
  assert.deepEqual(avoidCameraWalls(eye, desired, meshes).toArray(), before.toArray());
  const hit = new T.Raycaster(eye, desired.clone().sub(eye).normalize()).intersectObjects(meshes, false);
  assert.ok(hit.every((h) => h.object === wall));
  assert.ok(meshes.length < 20, 'environment is batched, not one draw per prop');
  let geometries = 0, disposed = 0;
  pack.root.traverse((o) => { if (o.geometry) { geometries++; o.geometry.addEventListener('dispose', () => disposed++); } });
  pack.update(1, camera, true); pack.dispose();
  assert.equal(disposed, geometries); assert.equal(scene.children.length, 1); library.dispose();
});
