import * as T from 'three';

export type Perspective = 'first' | 'third';
export function eyeHeight(stance: string) {
  return stance === 'lie' ? 0.55 : stance === 'sit' ? 1.12 : 1.91;
}
export function viewDirection(yaw: number, pitch: number) {
  return new T.Vector3(
    -Math.sin(yaw) * Math.cos(pitch),
    -Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
}
export function cameraFrame(
  position: T.Vector3,
  yaw: number,
  pitch: number,
  height: number,
  perspective: Perspective,
  distance: number,
) {
  const direction = viewDirection(yaw, pitch);
  const eye = position.clone().add(new T.Vector3(0, height, 0));
  const camera = eye.clone();
  if (perspective === 'third')
    camera
      .addScaledVector(direction, -distance)
      .add(new T.Vector3(Math.cos(yaw) * 0.58, 0.08, -Math.sin(yaw) * 0.58));
  camera.y = Math.max(0.35, camera.y);
  return {
    eye,
    position: camera,
    target: camera.clone().addScaledVector(direction, 30),
    direction,
  };
}
export function visibleInWorld(object: T.Object3D) {
  for (let p: T.Object3D | null = object; p; p = p.parent)
    if (!p.visible) return false;
  return true;
}

function collisionOverride(
  object: T.Object3D,
  property: 'projectileCollision' | 'cameraCollision',
) {
  for (let p: T.Object3D | null = object; p; p = p.parent) {
    const collision = p.userData[property];
    if (collision === 'block' || collision === 'ignore') return collision;
  }
  return undefined;
}

function isSolidMaterial(material: T.Material | undefined) {
  return !!(
    material &&
    material.visible &&
    !material.transparent &&
    material.opacity > 0.001 &&
    material.side !== T.BackSide
  );
}

function hasSolidMaterial(object: T.Mesh, materialIndex?: number) {
  const materials = Array.isArray(object.material)
    ? object.material
    : [object.material];
  return materialIndex === undefined
    ? materials.some(isSolidMaterial)
    : isSolidMaterial(materials[materialIndex]);
}
/**
 * Determines whether a visible mesh should stop a projectile.  Three's
 * Raycaster intersects transparent materials too, so the rendered material
 * and an optional group-level override must both be considered.
 */
export function blocksProjectile(object: T.Object3D, materialIndex?: number) {
  if (!visibleInWorld(object) || !(object instanceof T.Mesh)) return false;
  const override = collisionOverride(object, 'projectileCollision');
  if (override) return override === 'block';
  return hasSolidMaterial(object, materialIndex);
}

/** Returns the nearest solid surface intersected by a projectile ray. */
export function firstProjectileHit(
  ray: T.Raycaster,
  objects: T.Object3D[],
  minDistance = 0.08,
) {
  return ray
    .intersectObjects(objects, false)
    .find(
      (hit) =>
        hit.distance > minDistance &&
        blocksProjectile(hit.object, hit.face?.materialIndex),
    );
}

/** Whether a mesh can shorten the third-person camera boom. */
export function blocksCamera(
  object: T.Object3D,
  materialIndex?: number,
): object is T.Mesh {
  if (!visibleInWorld(object) || !(object instanceof T.Mesh)) return false;
  const override = collisionOverride(object, 'cameraCollision');
  if (override) return override === 'block';
  for (let p: T.Object3D | null = object; p; p = p.parent)
    if (p.userData.noCameraCollision) return false;
  return hasSolidMaterial(object, materialIndex);
}
/** Камера сокращает расстояние до ближайшей стены, сохраняя запас перед поверхностью. */
export function avoidCameraWalls(
  eye: T.Vector3,
  desired: T.Vector3,
  objects: T.Object3D[],
) {
  const delta = desired.clone().sub(eye),
    distance = delta.length();
  if (distance < 0.001) return desired.clone();
  const ray = new T.Raycaster(eye, delta.normalize(), 0, distance + 0.18);
  const hit = ray
    .intersectObjects(objects.filter(visibleInWorld), false)
    .find((h) => blocksCamera(h.object, h.face?.materialIndex));
  return hit
    ? eye.clone().addScaledVector(delta, Math.max(0.08, hit.distance - 0.22))
    : desired.clone();
}
