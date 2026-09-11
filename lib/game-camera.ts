import * as T from 'three';

export type Perspective = 'first' | 'third';
export function eyeHeight(stance: string) {
  return stance === 'lie' ? 0.55 : stance === 'sit' ? 1.12 : 1.91;
}
export function wrapAngle(angle: number) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value <= -Math.PI) value += Math.PI * 2;
  return value;
}
export function viewDirection(yaw: number, pitch: number) {
  const wrapped = wrapAngle(yaw);
  return new T.Vector3(
    -Math.sin(wrapped) * Math.cos(pitch),
    -Math.sin(pitch),
    -Math.cos(wrapped) * Math.cos(pitch),
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
  const wrappedYaw = wrapAngle(yaw);
  const direction = viewDirection(wrappedYaw, pitch);
  const eye = position.clone();
  eye.y += height;
  const camera = eye.clone();
  if (perspective === 'third') {
    camera.addScaledVector(direction, -distance);
    camera.x += Math.cos(wrappedYaw) * 0.58;
    camera.y += 0.08;
    camera.z -= Math.sin(wrappedYaw) * 0.58;
  }
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
const wallScratchRay = new T.Raycaster();
const wallScratchVisible: T.Object3D[] = [];
/** Камера сокращает расстояние до ближайшей стены, сохраняя запас перед поверхностью. */
export function avoidCameraWalls(
  eye: T.Vector3,
  desired: T.Vector3,
  objects: T.Object3D[],
) {
  const delta = desired.clone().sub(eye),
    distance = delta.length();
  if (distance < 0.001) return desired.clone();
  delta.normalize();
  wallScratchRay.set(eye, delta);
  wallScratchRay.near = 0;
  wallScratchRay.far = distance + 0.18;
  wallScratchVisible.length = 0;
  for (const o of objects) if (visibleInWorld(o)) wallScratchVisible.push(o);
  const hit = wallScratchRay
    .intersectObjects(wallScratchVisible, false)
    .find((h) => blocksCamera(h.object, h.face?.materialIndex));
  return hit
    ? eye.clone().addScaledVector(delta, Math.max(0.08, hit.distance - 0.22))
    : desired.clone();
}
