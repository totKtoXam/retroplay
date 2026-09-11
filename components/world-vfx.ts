import * as T from 'three';
import { CONFETTI, FIREWORKS } from '@/lib/game-items';
import { partyGeometry } from './party-geometry';

type Particle = {
  mesh: T.InstancedMesh;
  velocity: T.Vector3[];
  positions: T.Vector3[];
  rotations: T.Euler[];
  born: number;
  lifetime?: number;
};

/**
 * Particle bursts and paint splats of the world engine: spawn helpers,
 * per-frame simulation and disposal of the shared geometries.
 * Extracted verbatim from the engine effect in world.tsx.
 */
export function createWorldVfx({
  scene,
  quality,
}: {
  scene: T.Scene;
  quality: string;
}) {
  const splats: { mesh: T.Mesh; born: number }[] = [],
    bursts: Particle[] = [];
  const dummy = new T.Object3D(),
    paintDropletGeo = new T.SphereGeometry(0.04, 6, 4),
    confettiGeo = new T.PlaneGeometry(0.07, 0.13),
    normalUp = new T.Vector3(0, 0, 1);
  const partyGeometries = new Map([
    ...[...CONFETTI, ...FIREWORKS].map(
      (c) => [c.id, partyGeometry(c.id)] as [string, T.BufferGeometry],
    ),
    ['ribbon', partyGeometry('ribbon')],
    ['shard', partyGeometry('shard')],
  ]);

  const burst = (
    at: T.Vector3,
    color: string,
    now: number,
    style = 'classic',
  ) => {
    const isPaint = style === 'paint';
    const isFirework = FIREWORKS.some((f) => f.id === style);
    const isCinematicQuality =
      quality === 'cinematic' || quality === 'high';
    const isBalancedQuality =
      quality === 'balanced' ||
      (!isCinematicQuality && quality !== 'low');
    const count = isPaint
      ? isCinematicQuality
        ? 16
        : isBalancedQuality
          ? 10
          : 6
      : isFirework
        ? isCinematicQuality
          ? 96
          : isBalancedQuality
            ? 60
            : 36
        : isCinematicQuality
          ? 80
          : isBalancedQuality
            ? 48
            : 26;
    const geo =
      style === 'paint'
        ? paintDropletGeo
        : partyGeometries.get(style) || confettiGeo;
    const mesh = new T.InstancedMesh(
      geo,
      new T.MeshBasicMaterial({ side: T.DoubleSide, transparent: true }),
      count,
    );
    const velocity: T.Vector3[] = [],
      positions: T.Vector3[] = [],
      rotations: T.Euler[] = [];
    const spreadFactor = isPaint ? 0.95 : 1;
    for (let i = 0; i < count; i++) {
      const a = i * 2.399;
      if (isFirework) {
        const phi = Math.acos(1 - 2 * ((i + 0.5) / count));
        const theta = Math.PI * (1 + 5 ** 0.5) * i;
        const spd = 2.4 + (i % 5) * 0.55;
        velocity.push(
          new T.Vector3(
            Math.sin(phi) * Math.cos(theta) * spd,
            Math.sin(phi) * Math.sin(theta) * spd + 0.7,
            Math.cos(phi) * spd,
          ),
        );
      } else {
        velocity.push(
          new T.Vector3(
            Math.cos(a) * (1.1 + (i % 5) * 0.35) * spreadFactor,
            isPaint ? 0.85 + (i % 7) * 0.25 : 1.8 + (i % 7) * 0.35,
            Math.sin(a) * (1.1 + (i % 4) * 0.35) * spreadFactor,
          ),
        );
      }
      positions.push(at.clone());
      rotations.push(new T.Euler(a, a * 0.7, a * 1.2));
      mesh.setColorAt(
        i,
        new T.Color(
          style === 'paint'
            ? color
            : isFirework
              ? [color, '#ffffff', '#ffd166', '#ff84c8', '#64d4ef'][i % 5]
              : style === 'snow'
                ? '#e7f7ff'
                : style === 'hearts'
                  ? ['#ff647c', '#ffb1c8'][i % 2]
                  : style === 'digital'
                    ? ['#7fe0b8', '#b6ffe5'][i % 2]
                    : [color, '#c8b6ff', '#80d8fa', '#ffbfd8', '#ffe29b'][i % 5],
        ),
      );
      dummy.position.copy(at);
      dummy.rotation.copy(rotations[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.userData.transientProjectile = true;
    scene.add(mesh);
    bursts.push({
      mesh,
      velocity,
      positions,
      rotations,
      born: now,
      lifetime: isPaint ? 1.6 : isFirework ? 2.5 : 4,
    });
  };
  const splat = (
    at: T.Vector3,
    normal: T.Vector3,
    color: string,
    now: number,
    parent: T.Object3D = scene,
    scale = 1,
  ) => {
    const shape = new T.Shape();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2,
        r = 0.38 + Math.sin(a * 7) * 0.09 + Math.cos(a * 5) * 0.06;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const decal = new T.Mesh(
      new T.ShapeGeometry(shape),
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        side: T.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      }),
    );
    decal.userData.projectileCollision = 'ignore';
    if (scale !== 1) decal.scale.setScalar(scale);

    if (parent !== scene) {
      parent.updateMatrixWorld(true);
      const localPos = parent.worldToLocal(at.clone());
      localPos.y = Math.max(0.35, Math.min(1.65, localPos.y));
      const localNorm = new T.Vector3(localPos.x, 0, localPos.z).normalize();
      if (localNorm.lengthSq() < 0.05) localNorm.set(0, 0, 1);
      decal.position.copy(localPos).addScaledVector(localNorm, 0.04);
      decal.quaternion.setFromUnitVectors(normalUp, localNorm);
    } else {
      decal.position.copy(at).addScaledVector(normal, 0.035);
      decal.quaternion.setFromUnitVectors(normalUp, normal.normalize());
    }
    parent.add(decal);
    splats.push({ mesh: decal, born: now });
  };
  const smearPlayerWithPaint = (
    playerGroup: T.Object3D,
    hitPoint: T.Vector3,
    hitNormal: T.Vector3,
    color: string,
    now: number,
  ) => {
    splat(hitPoint, hitNormal, color, now, playerGroup, 0.55);
    const dropletOffset = new T.Vector3(
      (Math.random() - 0.5) * 0.16,
      -0.14 - Math.random() * 0.12,
      (Math.random() - 0.5) * 0.16,
    );
    splat(
      hitPoint.clone().add(dropletOffset),
      hitNormal,
      color,
      now,
      playerGroup,
      0.28,
    );
    burst(hitPoint, color, now, 'paint');
  };
  const update = (now: number, dt: number) => {
    for (let i = splats.length - 1; i >= 0; i--) {
      const p = splats[i],
        age = (now - p.born) / 1000;
      (p.mesh.material as T.MeshBasicMaterial).opacity =
        0.9 * Math.min(1, (12 - age) / 3);
      if (age >= 12) {
        p.mesh.removeFromParent();
        p.mesh.geometry.dispose();
        (p.mesh.material as T.Material).dispose();
        splats.splice(i, 1);
      }
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i],
        age = (now - b.born) / 1000,
        maxAge = b.lifetime || 4;
      for (let j = 0; j < b.positions.length; j++) {
        b.velocity[j].x *= Math.max(0, 1 - 0.75 * dt);
        b.velocity[j].z *= Math.max(0, 1 - 0.75 * dt);
        if (b.velocity[j].y > -1.8) {
          b.velocity[j].y -= 2.2 * dt;
        } else {
          b.velocity[j].y = T.MathUtils.lerp(b.velocity[j].y, -1.8, 2.5 * dt);
        }
        const flutter = Math.sin(age * 5.5 + j * 1.7) * 0.45;
        const swirl = Math.cos(age * 4.2 + j * 2.1) * 0.35;
        b.positions[j].x += (b.velocity[j].x + flutter) * dt;
        b.positions[j].y += b.velocity[j].y * dt;
        b.positions[j].z += (b.velocity[j].z + swirl) * dt;
        b.rotations[j].x += dt * (3.8 + (j % 4) * 0.9);
        b.rotations[j].y += dt * (2.4 + (j % 3) * 0.7);
        b.rotations[j].z += dt * ((j % 2 ? 3.2 : -3.2) + (j % 5) * 0.4);
        dummy.position.copy(b.positions[j]);
        dummy.rotation.copy(b.rotations[j]);
        dummy.updateMatrix();
        b.mesh.setMatrixAt(j, dummy.matrix);
      }
      b.mesh.instanceMatrix.needsUpdate = true;
      (b.mesh.material as T.MeshBasicMaterial).opacity = Math.min(
        1,
        (maxAge - age) / (maxAge * 0.35),
      );
      if (age > maxAge) {
        b.mesh.removeFromParent();
        // Geometry is shared (paintDropletGeo / partyGeometries / confettiGeo);
        // dispose() frees only this burst's instanceMatrix/instanceColor buffers.
        b.mesh.dispose();
        (b.mesh.material as T.Material).dispose();
        bursts.splice(i, 1);
      }
    }
  };
  const dispose = () => {
    paintDropletGeo.dispose();
    confettiGeo.dispose();
    partyGeometries.forEach((g) => g.dispose());
  };
  return {
    paintDropletGeo,
    burst,
    splat,
    smearPlayerWithPaint,
    update,
    dispose,
  };
}
