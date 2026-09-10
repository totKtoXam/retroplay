import * as T from 'three';
import { geometryBatch, visualOnly } from './geometry.ts';
import type { RealisticMaterials } from './materials.ts';
import { visualBudget } from '../../../lib/resource-packs.ts';

/** Original industrial dressing fixed to existing facades, roofs and board frames. */
export function createFieldEnvironment(
  scene: T.Scene,
  library: RealisticMaterials,
  quality: string,
  stations: number[][],
) {
  const root = new T.Group();
  root.name = 'field-annex';
  visualOnly(root);
  scene.add(root);
  const detail = new T.Group();
  root.add(detail);
  const metal = library.get('steel'),
    stone = library.get('concrete'),
    rubber = library.get('rubber');
  const ground = library.get('wetstone');
  const budget = visualBudget(quality),
    base = geometryBatch(root),
    fine = geometryBatch(detail);
  const emissive = new T.MeshStandardMaterial({
    color: '#eadbc1',
    emissive: '#ffddaa',
    emissiveIntensity: 1.8,
  });
  const paint = new T.MeshStandardMaterial({
    color: '#c2b181',
    roughness: 0.94,
  });
  // Service pipes, mounting brackets and ventilation sit on original solid walls.
  for (const side of [-1, 1]) {
    for (const y of [0.65, 7.55, 8.05]) {
      base.pipe([side * 23.36, y, -16.5], [side * 23.36, y, 0.5], 0.065, metal);
      for (let z = -16; z < 1; z += 2)
        fine.box([0.1, 0.22, 0.16], rubber, [side * 23.32, y, z]);
    }
    base.pipe(
      [side * 23.36, 0.6, -16.6],
      [side * 23.36, 8.1, -16.6],
      0.075,
      metal,
    );
    for (let i = 0; i < 5; i++) {
      const z = -15 + i * 3;
      // Frame mullions and chipped sills overlay the existing window panels.
      for (const y of [2.5, 6.2]) {
        base.box([0.075, 1.88, 0.055], metal, [side * 23.32, y, z]);
        base.box([0.075, 0.055, 1.52], metal, [side * 23.32, y, z]);
        fine.box([0.17, 0.055, 1.72], ground, [side * 23.23, y - 0.96, z]);
      }
      base.box([0.45, 0.65, 0.8], stone, [side * 23.43, 8.25, z]);
      for (let j = 0; j < 7; j++)
        fine.box([0.05, 0.025, 0.67], metal, [
          side * 23.18,
          8.05 + j * 0.055,
          z,
        ]);
    }
    // Roof machinery, safely outside all accessible floor space.
    for (let i = 0; i < 3; i++) {
      base.box([1.5, 0.7, 1.8], metal, [side * 26, 9.68, -6 + i * 2.5]);
      for (let j = 0; j < 6; j++)
        fine.box([1.35, 0.04, 0.06], rubber, [
          side * 26,
          10.06,
          -6.6 + i * 2.5 + j * 0.22,
        ]);
    }
  }
  // Board structure and colliders stay exactly in place. Detailed utilitarian frames.
  stations.forEach(([x, z], index) => {
    base.pipe(
      [x - 3.03, 0.55, z + 0.24],
      [x - 3.03, 4.7, z + 0.24],
      0.037,
      metal,
    );
    base.pipe(
      [x - 3.03, 4.68, z + 0.24],
      [x + 3.03, 4.68, z + 0.24],
      0.037,
      metal,
    );
    base.box([1.1, 0.07, 0.14], emissive, [x, 4.67, z + 0.37]);
    for (const side of [-1, 1]) {
      base.box([0.42, 0.17, 0.035], paint, [x + side * 2.99, 0.9, z + 0.24]);
      for (let y = 1.5; y < 4.5; y += 1)
        fine.box([0.11, 0.09, 0.045], metal, [x + side * 2.99, y, z + 0.24]);
    }
    // Cable on canopy, with natural sag and no collision.
    const points = Array.from(
      { length: 15 },
      (_, i) =>
        new T.Vector3(
          x - 2.9 + (i / 14) * 5.8,
          4.62 - Math.sin((i / 14) * Math.PI) * 0.18,
          z + 0.3,
        ),
    );
    fine.add(
      new T.TubeGeometry(new T.CatmullRomCurve3(points), 24, 0.018, 5, false),
      rubber,
      [0, 0, 0],
    );
    if (index < budget.localLights) {
      const light = new T.PointLight('#ffe0b1', 3, 9, 2);
      light.position.set(x, 4.45, z + 1);
      root.add(light);
    }
  });
  // Central annex: service panel, hinges, worn metal door and wall conduits.
  for (const side of [-1, 1]) {
    base.pipe(
      [side * 2.12, 0.35, -14.64],
      [side * 2.12, 5.8, -14.64],
      0.04,
      metal,
    );
    base.box([0.64, 0.9, 0.13], metal, [side * 2.13, 1.7, -14.64]);
    for (let i = 0; i < 8; i++)
      fine.box([0.44, 0.017, 0.016], rubber, [
        side * 2.13,
        1.49 + i * 0.055,
        -14.563,
      ]);
  }
  for (const y of [1.1, 2.7, 3.8])
    fine.box([0.13, 0.16, 0.06], metal, [1.27, y, -14.59]);
  base.box([0.06, 0.55, 0.06], metal, [0.53, 1.8, -14.56]);
  base.finish();
  fine.finish();

  // Surface-only debris: thin paper, leaves and damp patches do not create new cover.
  const debrisGeometry = new T.PlaneGeometry(0.13, 0.2);
  debrisGeometry.rotateX(-Math.PI / 2);
  const debris = new T.InstancedMesh(
    debrisGeometry,
    paint,
    quality === 'low' ? 50 : 140,
  );
  visualOnly(debris);
  const dummy = new T.Object3D();
  for (let i = 0; i < debris.count; i++) {
    const angle = i * 2.399963,
      radius = 13 + (i % 19) * 0.52;
    dummy.position.set(
      Math.cos(angle) * radius,
      0.205,
      Math.sin(angle) * radius,
    );
    dummy.rotation.set(0, angle, 0);
    dummy.scale.setScalar(0.4 + (i % 7) * 0.11);
    dummy.updateMatrix();
    debris.setMatrixAt(i, dummy.matrix);
    debris.setColorAt(i, new T.Color(i % 3 ? '#847963' : '#d2ccc0'));
  }
  root.add(debris);
  const dustGeo = new T.BufferGeometry(),
    positions = new Float32Array(budget.particles * 3);
  for (let i = 0; i < budget.particles; i++) {
    positions[i * 3] = Math.sin(i * 27.13) * 20;
    positions[i * 3 + 1] = 0.3 + (i % 17) * 0.28;
    positions[i * 3 + 2] = Math.cos(i * 13.7) * 20;
  }
  dustGeo.setAttribute('position', new T.BufferAttribute(positions, 3));
  const dustMaterial = new T.PointsMaterial({
    color: '#d8d0bf',
    size: 0.025,
    transparent: true,
    opacity: 0.23,
    depthWrite: false,
  });
  const dust = new T.Points(dustGeo, dustMaterial);
  visualOnly(dust);
  root.add(dust);
  return {
    root,
    update(time: number, camera: T.Camera, winter: boolean) {
      // Coarse LOD plus native frustum/occlusion through depth testing, without extra rays.
      detail.visible = camera.position.length() < budget.detailDistance;
      dust.position.y = Math.sin(time * 0.08) * 0.25;
      dust.rotation.y = Math.sin(time * 0.015) * 0.1;
      dustMaterial.size = winter ? 0.045 : 0.025;
      dustMaterial.opacity = winter ? 0.35 : 0.23;
      dustMaterial.color.set(winter ? '#e1e4e0' : '#d8d0bf');
    },
    dispose() {
      root.removeFromParent();
      root.traverse((o) => {
        if (o instanceof T.Mesh || o instanceof T.Points) o.geometry.dispose();
      });
      emissive.dispose();
      paint.dispose();
      dustMaterial.dispose();
    },
  };
}
