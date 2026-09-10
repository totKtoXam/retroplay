import * as T from 'three';
import { geometryBatch, garment, visualOnly } from './geometry.ts';
import type { RealisticMaterials } from './materials.ts';

/** A new field uniform on the existing rig. Original meshes remain the raycast surfaces. */
export function dressFieldCharacter(
  avatar: T.Group,
  library: RealisticMaterials,
) {
  const additions: T.Group[] = [],
    hidden: Array<{
      mesh: T.Mesh;
      material: T.Material | T.Material[];
      shadow: boolean;
    }> = [];
  const invisible = new T.MeshBasicMaterial({ visible: false });
  avatar.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    let body = false,
      held = false;
    for (let p: T.Object3D | null = o.parent; p && p !== avatar; p = p.parent) {
      if (
        p.name === 'agent-skin' ||
        p.name === 'legacy-skin' ||
        p.name === 'classic-detail' ||
        p.name === 'anime-detail'
      )
        body = true;
      if (['gun', 'tablet', 'held-grenade', 'anonymous-bag'].includes(p.name))
        held = true;
    }
    if (body && !held) {
      hidden.push({ mesh: o, material: o.material, shadow: o.castShadow });
      // Material visibility affects drawing, not Object3D visibility used by hit/camera tests.
      o.material = invisible;
      o.castShadow = false;
    }
  });
  const canvas = library.get('canvas'),
    rubber = library.get('rubber'),
    steel = library.get('steel');
  const create = (name: string) => {
    const parent = avatar.getObjectByName(name);
    const group = new T.Group();
    group.name = 'field-uniform';
    visualOnly(group);
    parent?.add(group);
    additions.push(group);
    return geometryBatch(group);
  };
  const chest = create('chest');
  chest.add(
    garment([
      [-0.13, 0.21, 0.14],
      [0.02, 0.22, 0.15],
      [0.22, 0.29, 0.18],
      [0.42, 0.27, 0.16],
      [0.53, 0.12, 0.09],
    ]),
    canvas,
    [0, 0, 0],
  );
  chest.box([0.43, 0.4, 0.065], rubber, [0, 0.25, -0.164], 0.035);
  chest.box([0.38, 0.4, 0.08], canvas, [0, 0.26, 0.16], 0.03);
  for (const side of [-1, 1]) {
    chest.box([0.066, 0.4, 0.03], canvas, [side * 0.18, 0.31, -0.21]);
    chest.box([0.16, 0.18, 0.09], canvas, [side * 0.115, 0.04, -0.18]);
    chest.box([0.12, 0.04, 0.012], rubber, [side * 0.115, 0.11, -0.234]);
    for (let row = 0; row < 4; row++)
      chest.box(
        [0.155, 0.018, 0.015],
        canvas,
        [side * 0.108, 0.22 + row * 0.049, -0.204],
        0.004,
      );
  }
  chest.box([0.48, 0.055, 0.31], rubber, [0, -0.08, 0]);
  chest.box([0.09, 0.06, 0.017], steel, [0, -0.08, -0.163]);
  // An original compact chest camera, not a brand/model replica.
  chest.box([0.085, 0.105, 0.046], rubber, [0.065, 0.38, -0.221]);
  chest.add(
    new T.CylinderGeometry(0.019, 0.019, 0.012, 16),
    steel,
    [0.065, 0.405, -0.249],
    [Math.PI / 2, 0, 0],
  );
  chest.finish();
  const head = create('unmasked-head');
  head.add(
    garment([
      [-0.15, 0.07, 0.065],
      [-0.05, 0.09, 0.09],
      [0.05, 0.15, 0.128],
      [0.21, 0.152, 0.135],
      [0.3, 0.12, 0.11],
      [0.34, 0.04, 0.04],
    ]),
    canvas,
    [0, 0, 0],
  );
  head.box([0.285, 0.071, 0.08], rubber, [0, 0.18, -0.11]);
  // Smoked safety lenses and respirator retain anonymous bag behaviour automatically.
  for (const side of [-1, 1]) {
    head.box([0.105, 0.041, 0.028], steel, [side * 0.071, 0.18, -0.16], 0.009);
    head.add(
      new T.CylinderGeometry(0.04, 0.035, 0.023, 16),
      rubber,
      [side * 0.071, 0.043, -0.135],
      [Math.PI / 2, 0, 0],
    );
  }
  head.box([0.07, 0.065, 0.06], rubber, [0, 0.07, -0.143]);
  head.finish();
  for (const side of ['L', 'R']) {
    const leg = create('leg' + side),
      knee = create('knee' + side),
      arm = create('arm' + side),
      elbow = create('elbow' + side);
    leg.add(
      garment([
        [-0.41, 0.085, 0.09],
        [-0.3, 0.1, 0.11],
        [-0.16, 0.12, 0.125],
        [0.04, 0.13, 0.13],
      ]),
      canvas,
      [0, 0, 0],
    );
    leg.box([0.065, 0.2, 0.14], canvas, [
      side === 'L' ? -0.1 : 0.1,
      -0.18,
      0.015,
    ]);
    knee.add(
      garment([
        [-0.42, 0.073, 0.085],
        [-0.31, 0.08, 0.09],
        [-0.18, 0.086, 0.09],
        [0.02, 0.093, 0.099],
      ]),
      canvas,
      [0, 0, 0],
    );
    knee.box([0.145, 0.15, 0.05], rubber, [0, -0.055, -0.08], 0.035);
    knee.box([0.18, 0.18, 0.28], rubber, [0, -0.405, -0.036], 0.04);
    knee.box([0.185, 0.027, 0.29], rubber, [0, -0.489, -0.04]);
    for (let i = 0; i < 5; i++)
      knee.box([0.097, 0.012, 0.012], canvas, [0, -0.35 - i * 0.017, -0.149]);
    arm.add(
      garment([
        [-0.3, 0.075, 0.08],
        [-0.16, 0.1, 0.105],
        [-0.01, 0.112, 0.11],
        [0.04, 0.105, 0.103],
      ]),
      canvas,
      [0, 0, 0],
    );
    arm.box([0.02, 0.085, 0.075], rubber, [
      side === 'L' ? -0.112 : 0.112,
      -0.05,
      0,
    ]);
    elbow.add(
      garment([
        [-0.26, 0.057, 0.065],
        [-0.19, 0.067, 0.074],
        [-0.06, 0.077, 0.08],
        [0.01, 0.078, 0.083],
      ]),
      canvas,
      [0, 0, 0],
    );
    elbow.box([0.095, 0.093, 0.104], rubber, [0, -0.296, -0.006]);
    for (let i = 0; i < 4; i++)
      elbow.box(
        [0.018, 0.046, 0.062],
        rubber,
        [-0.034 + i * 0.023, -0.342, -0.018],
        0.008,
      );
    [leg, knee, arm, elbow].forEach((b) => b.finish());
  }
  return {
    sync() {
      hidden.forEach(({ mesh }) => {
        mesh.material = invisible;
        mesh.castShadow = false;
      });
    },
    dispose() {
      hidden.forEach(({ mesh, material, shadow }) => {
        mesh.material = material;
        mesh.castShadow = shadow;
      });
      additions.forEach((g) => {
        g.removeFromParent();
        g.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
      });
      invisible.dispose();
    },
  };
}

export function dressFieldWeapons(hands: T.Group, library: RealisticMaterials) {
  const group = new T.Group();
  group.name = 'field-tool-detail';
  visualOnly(group);
  const source = hands.getObjectByName('paint-launcher');
  source?.add(group);
  const metal = library.get('steel').clone(),
    polymer = library.get('rubber').clone();
  metal.depthTest = polymer.depthTest = false;
  const batch = geometryBatch(group);
  // Rail teeth, fasteners, heat shield, industrial pressure gauge. Existing barrel stays put.
  for (let i = 0; i < 10; i++)
    batch.box(
      [0.115, 0.014, 0.017],
      metal,
      [0, 0.12, -0.13 - i * 0.025],
      0.002,
    );
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++)
      batch.box([0.013, 0.047, 0.045], polymer, [
        side * 0.08,
        0.032,
        -0.28 - i * 0.045,
      ]);
    for (const z of [-0.17, -0.4])
      batch.add(
        new T.CylinderGeometry(0.009, 0.009, 0.006, 8),
        metal,
        [side * 0.082, 0.063, z],
        [0, 0, Math.PI / 2],
      );
  }
  batch.box([0.03, 0.037, 0.12], metal, [0.078, 0.058, -0.04]);
  batch.finish().forEach((m) => {
    m.renderOrder = 1001;
    m.castShadow = false;
  });
  return {
    dispose() {
      group.removeFromParent();
      group.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      metal.dispose();
      polymer.dispose();
    },
  };
}
