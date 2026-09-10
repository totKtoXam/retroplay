import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Presentation meshes never participate in shots, interaction rays or camera collision. */
export function visualOnly(object: T.Object3D) {
  object.userData.presentationOnly = true;
  object.userData.noCameraCollision = true;
  object.raycast = () => {};
  return object;
}
export function geometryBatch(parent: T.Object3D) {
  const buckets = new Map<T.Material, T.BufferGeometry[]>();
  function add(
    geometry: T.BufferGeometry,
    material: T.Material,
    position: number[],
    rotation: number[] = [0, 0, 0],
  ) {
    const m = new T.Matrix4().compose(
      new T.Vector3(...position),
      new T.Quaternion().setFromEuler(new T.Euler(...rotation)),
      new T.Vector3(1, 1, 1),
    );
    const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    geo.applyMatrix4(m);
    const list = buckets.get(material) ?? [];
    list.push(geo);
    buckets.set(material, list);
  }
  return {
    add,
    box(size: number[], mat: T.Material, pos: number[], radius = 0.018) {
      add(
        new RoundedBoxGeometry(
          size[0],
          size[1],
          size[2],
          1,
          Math.min(radius, ...size.map((v) => v / 4)),
        ),
        mat,
        pos,
      );
    },
    pipe(a: number[], b: number[], radius: number, mat: T.Material) {
      const start = new T.Vector3(...a),
        end = new T.Vector3(...b),
        dir = end.clone().sub(start);
      const geo = new T.CylinderGeometry(radius, radius, dir.length(), 10);
      geo.applyQuaternion(
        new T.Quaternion().setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          dir.normalize(),
        ),
      );
      add(geo, mat, start.add(end).multiplyScalar(0.5).toArray());
    },
    finish() {
      const meshes: T.Mesh[] = [];
      buckets.forEach((geos, mat) => {
        const merged = mergeGeometries(geos);
        geos.forEach((g) => g.dispose());
        if (!merged) return;
        const mesh = new T.Mesh(merged, mat);
        visualOnly(mesh);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        meshes.push(mesh);
      });
      buckets.clear();
      return meshes;
    },
  };
}

/** Folds in geometry, continuous UVs and unchanged joint attachment. */
export function garment(rings: number[][], radial = 20) {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let row = 0; row < rings.length; row++) {
    const [y, width, depth] = rings[row];
    for (let col = 0; col <= radial; col++) {
      const a = (col / radial) * Math.PI * 2;
      const fold = 1 + Math.sin(a * 7 + row * 1.7) * 0.035;
      positions.push(Math.cos(a) * width * fold, y, Math.sin(a) * depth * fold);
      uvs.push((col / radial) * 2, (row / (rings.length - 1)) * 2);
      if (row < rings.length - 1 && col < radial) {
        const i = row * (radial + 1) + col;
        indices.push(
          i,
          i + radial + 1,
          i + 1,
          i + 1,
          i + radial + 1,
          i + radial + 2,
        );
      }
    }
  }
  // Close at existing joint centres; no limb gaps during the original animations.
  for (const row of [0, rings.length - 1])
    for (let col = 1; col < radial - 1; col++) {
      const i = row * (radial + 1);
      if (row === 0) indices.push(i, i + col, i + col + 1);
      else indices.push(i, i + col + 1, i + col);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
