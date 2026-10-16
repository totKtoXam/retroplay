import * as T from 'three';
import { simulateGrenade, type GrenadeWorld } from '@/lib/grenade-physics';
import { visibleInWorld } from '@/lib/game-camera';

/**
 * Прицел гранаты: пока зажата ЛКМ со слотом гранаты, от руки до места взрыва
 * тянется линия полёта, а на месте взрыва лежит кольцо-метка. Полёт тот же,
 * что посчитают сервер и все клиенты (lib/grenade-physics.ts).
 *
 * Вынесено из движка мира в world.tsx дословно. Когда целиться, решает ввод
 * (флаг `grenadeAiming`, world-input.ts): он же прячет и показывает линию и
 * метку, поэтому они отдаются наружу. Здесь — сами объекты и расчёт кадра.
 */
export function createGrenadeAim({
  scene,
  camera,
  ray,
  mouse,
  map,
  state,
  sceneryTargets,
  gatherRemoteAvatarMeshes,
  weaponOrigin,
}: {
  scene: T.Scene;
  camera: T.Camera;
  /** Общий луч движка: им же стреляют. */
  ray: T.Raycaster;
  /** Курсор в координатах экрана −1…1: им целятся, пока мышь не захвачена. */
  mouse: T.Vector2;
  /** Карта: от её пола и стен отскакивает граната. */
  map: GrenadeWorld;
  /** Обзор зажатой кнопкой без захвата мыши: целимся в центр экрана. */
  state: { readonly softLook: boolean };
  /** Кэш статичных мешей сцены. Движок его пересобирает — поэтому геттер. */
  sceneryTargets: () => readonly T.Mesh[];
  gatherRemoteAvatarMeshes: () => T.Mesh[];
  /** Откуда вылетает граната: из ствола в первом лице, от плеча — в третьем. */
  weaponOrigin: (tool: string) => T.Vector3;
}) {
  const trajectoryGeo = new T.BufferGeometry();
  const trajectoryMat = new T.LineBasicMaterial({
    color: '#ffe066',
    transparent: true,
    opacity: 0.85,
  });
  const trajectoryLine = new T.Line(trajectoryGeo, trajectoryMat);
  // Точки линии меняются каждый кадр, а сфера для отсечения считается один раз.
  trajectoryLine.frustumCulled = false;
  trajectoryLine.visible = false;
  scene.add(trajectoryLine);

  const landingMarker = new T.Mesh(
    new T.RingGeometry(0.18, 0.42, 16),
    new T.MeshBasicMaterial({
      color: '#ffe066',
      transparent: true,
      opacity: 0.8,
      side: T.DoubleSide,
    }),
  );
  landingMarker.rotation.x = -Math.PI / 2;
  landingMarker.visible = false;
  scene.add(landingMarker);
  // Прицел гранаты считается каждый кадр, пока зажата ЛКМ: всё, что ему
  // нужно, выделено один раз (анализ 2026-09-11, п. 4 — аллокации в кадре).
  const aimCenter = new T.Vector2(0, 0);
  const aimTargets: T.Mesh[] = [];
  const aimFallback = new T.Vector3();
  const markerFlat = landingMarker.quaternion.clone();
  let trajectoryCapacity = 0;
  /** Точки полёта в геометрию линии без новых массивов, пока хватает места. */
  const writeTrajectory = (path: readonly (readonly number[])[]) => {
    if (path.length > trajectoryCapacity) {
      trajectoryCapacity = Math.max(64, path.length * 2);
      trajectoryGeo.setAttribute(
        'position',
        new T.BufferAttribute(new Float32Array(trajectoryCapacity * 3), 3),
      );
    }
    const position = trajectoryGeo.getAttribute('position') as T.BufferAttribute;
    for (let i = 0; i < path.length; i++) position.setXYZ(i, path[i][0], path[i][1], path[i][2]);
    position.needsUpdate = true;
    trajectoryGeo.setDrawRange(0, path.length);
  };
  /** Кадр прицела; `active` — ЛКМ зажата, и в руках граната. */
  const update = (active: boolean) => {
    if (active) {
      ray.setFromCamera(document.pointerLockElement || state.softLook ? aimCenter : mouse, camera);
      const trajTargets = aimTargets;
      trajTargets.length = 0;
      for (const o of sceneryTargets())
        if (
          visibleInWorld(o) &&
          o.geometry.type !== 'SphereGeometry' &&
          o.geometry.type !== 'ShapeGeometry'
        )
          trajTargets.push(o);
      for (const o of gatherRemoteAvatarMeshes())
        if (
          visibleInWorld(o) &&
          o.geometry.type !== 'SphereGeometry' &&
          o.geometry.type !== 'ShapeGeometry'
        )
          trajTargets.push(o);
      const hit = ray
        .intersectObjects(trajTargets, false)
        .find((h) => h.distance < 50 && h.distance > 0.1);
      const arcTarget = hit ? hit.point : ray.ray.at(25, aimFallback);
      // Тот же полёт, что посчитают сервер и все клиенты: с отскоками и качением.
      const arc = simulateGrenade(weaponOrigin('grenade').toArray(), arcTarget.toArray(), map);
      writeTrajectory(arc.path);
      trajectoryLine.visible = true;

      // Метка — там, где граната рванёт; лежит она к этому времени или ещё летит.
      landingMarker.position.fromArray(arc.end);
      landingMarker.position.y = Math.max(0.02, arc.end[1] - 0.06);
      landingMarker.quaternion.copy(markerFlat);
      landingMarker.visible = true;
    } else if (trajectoryLine.visible) {
      trajectoryLine.visible = false;
      landingMarker.visible = false;
    }
  };
  const dispose = () => {
    trajectoryGeo.dispose();
    trajectoryMat.dispose();
    landingMarker.geometry.dispose();
    (landingMarker.material as T.Material).dispose();
  };
  return { trajectoryLine, landingMarker, update, dispose };
}
