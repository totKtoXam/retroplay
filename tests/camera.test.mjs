import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {
  cameraFrame,
  eyeHeight,
  avoidCameraWalls,
  blocksCamera,
  blocksProjectile,
  visibleInWorld,
} from '../lib/game-camera.ts';

test('Switching FPP/TPP preserves aiming direction at every yaw and pitch', () => {
  for (const yaw of [0, 1.5, -3.1])
    for (const pitch of [-1.2, 0, 0.9]) {
      const p = new T.Vector3(2, 0, 3),
        f = cameraFrame(p, yaw, pitch, 1.91, 'first', 6.5),
        t = cameraFrame(p, yaw, pitch, 1.91, 'third', 6.5);
      assert.ok(f.direction.distanceTo(t.direction) < 1e-8);
      assert.equal(f.position.y, 1.91);
      assert.ok(
        f.target
          .clone()
          .sub(f.position)
          .normalize()
          .distanceTo(t.target.clone().sub(t.position).normalize()) < 1e-8,
      );
    }
});
test('Standing, sitting and prone eye heights are above the ground', () => {
  assert.ok(eyeHeight('stand') > eyeHeight('sit'));
  assert.ok(eyeHeight('sit') > eyeHeight('lie'));
  assert.ok(eyeHeight('lie') > 0.3);
});
test('Third-person camera stops before walls and ignores hidden scenery', () => {
  const eye = new T.Vector3(0, 1.9, 0),
    desired = new T.Vector3(0, 1.9, 6);
  const wall = new T.Mesh(
    new T.BoxGeometry(4, 4, 0.3),
    new T.MeshBasicMaterial(),
  );
  wall.position.set(0, 2, 3);
  wall.updateMatrixWorld(true);
  const result = avoidCameraWalls(eye, desired, [wall]);
  assert.ok(result.z < 2.85);
  assert.ok(result.z > 2.5);
  const parent = new T.Group();
  parent.add(wall);
  parent.visible = false;
  assert.equal(visibleInWorld(wall), false);
  assert.ok(avoidCameraWalls(eye, desired, [wall]).equals(desired));
  assert.ok(avoidCameraWalls(eye, eye, []).equals(eye));
});

test('Camera collisions honor ancestor metadata and skip transparent faces', () => {
  const eye = new T.Vector3(0, 1.9, 0),
    desired = new T.Vector3(0, 1.9, 6);
  const ignoredGroup = new T.Group();
  ignoredGroup.userData.noCameraCollision = true;
  const ignoredWall = new T.Mesh(
    new T.BoxGeometry(4, 4, 0.3),
    new T.MeshBasicMaterial(),
  );
  ignoredWall.position.set(0, 2, 2);
  ignoredGroup.add(ignoredWall);
  ignoredGroup.updateMatrixWorld(true);
  const wall = new T.Mesh(
    new T.BoxGeometry(4, 4, 0.3),
    new T.MeshBasicMaterial(),
  );
  wall.position.set(0, 2, 4);
  wall.updateMatrixWorld(true);
  assert.equal(blocksCamera(ignoredWall), false);
  assert.ok(avoidCameraWalls(eye, desired, [ignoredWall, wall]).z > 3.5);
});

test('Projectile collision respects transparent windows and model metadata', () => {
  const wall = new T.Mesh(
    new T.BoxGeometry(1, 1, 1),
    new T.MeshBasicMaterial(),
  );
  const glass = new T.Mesh(
    new T.PlaneGeometry(1, 1),
    new T.MeshBasicMaterial({ transparent: true, opacity: 0.2 }),
  );
  assert.equal(blocksProjectile(wall), true);
  assert.equal(blocksProjectile(glass), false);

  const model = new T.Group();
  model.userData.projectileCollision = 'ignore';
  model.add(wall);
  assert.equal(blocksProjectile(wall), false);
  model.userData.projectileCollision = 'block';
  model.add(glass);
  assert.equal(blocksProjectile(glass), true);
});

test('Projectile collision checks the material of the intersected face', () => {
  const opaque = new T.MeshBasicMaterial();
  const glass = new T.MeshBasicMaterial({ transparent: true, opacity: 0.2 });
  const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), [opaque, glass]);
  assert.equal(blocksProjectile(mesh), true);
  assert.equal(blocksProjectile(mesh, 0), true);
  assert.equal(blocksProjectile(mesh, 1), false);
  glass.visible = false;
  assert.equal(blocksProjectile(mesh, 1), false);
});
