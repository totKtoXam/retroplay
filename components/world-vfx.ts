import * as T from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { CONFETTI, FIREWORKS } from '@/lib/game-items';
import { partyGeometry } from './party-geometry';
import { createMaterialPool } from './material-pool';

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
/** Сколько вспышек живёт одновременно: больше — экран превращается в стену частиц. */
const MAX_LIVE_BURSTS = 12;
/** Краска на бойце держится дольше, чем на стенах: пока её не смыла смерть. */
const BODY_PAINT_SECONDS = 25;
/** Больше пятен на одном бойце не держим: старые уступают место новым. */
const BODY_PAINT_LIMIT = 24;
/** Глубина проекции пятна: хватает на изгиб корпуса, но не пробивает руку насквозь. */
const BODY_PAINT_DEPTH = 0.2;

/**
 * Пятно краски: клякса с неровным краем, брызги вокруг и потёк вниз. Белая —
 * цвет даёт материал. Одна текстура на все пятна.
 */
function paintStainTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  const c = size / 2;
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = size * (0.24 + Math.sin(a * 5 + 1) * 0.035 + Math.cos(a * 9) * 0.025 + Math.sin(a * 13) * 0.012);
    const x = c + Math.cos(a) * r,
      y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.fill();
  // Брызги: мелкие капли вокруг, чем дальше — тем мельче.
  for (let i = 0; i < 11; i++) {
    const a = i * 2.39996 + 0.4,
      d = size * (0.3 + ((i * 37) % 11) / 60);
    g.beginPath();
    g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, size * (0.045 - d / size / 14), 0, Math.PI * 2);
    g.fill();
  }
  // Потёк: краска стекает вниз по ткани. Верх пятна смотрит вверх по миру
  // (paintBody), а с flipY верх canvas — это верх текстуры: потёк рисуем вниз.
  for (const [dx, len, w] of [
    [-0.08, 0.2, 0.05],
    [0.07, 0.13, 0.04],
  ] as const) {
    const x = c + dx * size,
      end = c + (0.2 + len) * size;
    g.fillRect(x - (w * size) / 2, c, w * size, end - c);
    g.beginPath();
    g.arc(x, end, w * size * 0.75, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Ближе этого расстояния до камеры частица не рисуется. */
const PARTICLE_NEAR_CULL = 0.45;
/** До этого расстояния частица уменьшается, чтобы не закрывать обзор. */
const PARTICLE_NEAR_FADE = 1.3;

export function createWorldVfx({
  scene,
  quality,
  camera,
}: {
  scene: T.Scene;
  quality: string;
  /** Нужна, чтобы гасить частицы, пролетающие вплотную к глазам игрока. */
  camera?: T.Camera;
}) {
  /** Пятна краски; `owner` — на ком или на чём пятно (сцена, боец, экран). */
  const splats: { mesh: T.Mesh; born: number; owner: T.Object3D; life: number }[] = [],
    bursts: Particle[] = [];
  const nearCameraScale = (p: T.Vector3) => {
    if (!camera) return 1;
    const d = p.distanceTo(camera.position);
    if (d >= PARTICLE_NEAR_FADE) return 1;
    if (d <= PARTICLE_NEAR_CULL) return 0;
    return (d - PARTICLE_NEAR_CULL) / (PARTICLE_NEAR_FADE - PARTICLE_NEAR_CULL);
  };
  const dummy = new T.Object3D(),
    paintDropletGeo = new T.SphereGeometry(0.04, 6, 4),
    confettiGeo = new T.PlaneGeometry(0.07, 0.13),
    normalUp = new T.Vector3(0, 0, 1);
  // Материалы вспышек и клякс переиспользуются: см. material-pool.ts.
  const burstMaterials = createMaterialPool(
    () => new T.MeshBasicMaterial({ side: T.DoubleSide, transparent: true }),
  );
  const splatMaterials = createMaterialPool(
    () =>
      new T.MeshBasicMaterial({
        transparent: true,
        side: T.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      }),
  );
  let stainTexture: T.Texture | null = null;
  // Краска на теле освещается как само тело: влажный блеск, а не плоская наклейка.
  const bodyPaintMaterials = createMaterialPool(
    () =>
      new T.MeshStandardMaterial({
        map: (stainTexture ??= paintStainTexture()),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        roughness: 0.32,
        metalness: 0,
      }),
  );
  const retireSplat = (p: (typeof splats)[number]) => {
    p.mesh.removeFromParent();
    p.mesh.geometry.dispose();
    const material = p.mesh.material;
    if (material instanceof T.MeshStandardMaterial) bodyPaintMaterials.release(material);
    else splatMaterials.release(material as T.MeshBasicMaterial);
  };
  const retireBurst = (b: Particle) => {
    b.mesh.removeFromParent();
    // Geometry is shared (paintDropletGeo / partyGeometries / confettiGeo);
    // dispose() frees only this burst's instanceMatrix/instanceColor buffers.
    b.mesh.dispose();
    burstMaterials.release(b.mesh.material as T.MeshBasicMaterial);
  };
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
          ? 30
          : isBalancedQuality
            ? 20
            : 12;
    const geo =
      style === 'paint'
        ? paintDropletGeo
        : partyGeometries.get(style) || confettiGeo;
    const material = burstMaterials.acquire();
    material.opacity = 1;
    const mesh = new T.InstancedMesh(geo, material, count);
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
      dummy.scale.setScalar(1);
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
      lifetime: isPaint ? 1.6 : isFirework ? 2.5 : 2.2,
    });
    // В перестрелке десяти стрелков вспышки идут непрерывно: без потолка
    // на экране копятся тысячи частиц, они закрывают бой и роняют FPS.
    while (bursts.length > MAX_LIVE_BURSTS) {
      const oldest = bursts.shift();
      if (!oldest) break;
      retireBurst(oldest);
    }
  };
  const splat = (
    at: T.Vector3,
    normal: T.Vector3,
    color: string,
    now: number,
    parent: T.Object3D = scene,
    scale = 1,
    /**
     * `at` уже задано в координатах родителя.
     *
     * Ветка ниже писалась под кляксы на бойце: туда приходит мировая точка
     * попадания, её переводят в координаты аватара и прижимают по высоте к
     * корпусу. Брызгам на своём экране этот перевод не нужен и вреден — они и
     * так заданы относительно камеры, а «прижать к корпусу» уносило их в
     * произвольное место, вплоть до середины прицела.
     */
    inParentSpace = false,
  ) => {
    const shape = new T.Shape();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2,
        r = 0.38 + Math.sin(a * 7) * 0.09 + Math.cos(a * 5) * 0.06;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const material = splatMaterials.acquire();
    material.color.set(color);
    material.opacity = 0.9;
    const decal = new T.Mesh(new T.ShapeGeometry(shape), material);
    decal.userData.projectileCollision = 'ignore';
    if (scale !== 1) decal.scale.setScalar(scale);

    if (inParentSpace) {
      decal.position.copy(at);
      decal.quaternion.setFromUnitVectors(
        normalUp,
        normal.clone().normalize(),
      );
    } else if (parent !== scene) {
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
    splats.push({ mesh: decal, born: now, owner: parent, life: 12 });
  };
  const raycaster = new T.Raycaster();
  const bodyParts: T.Mesh[] = [];
  const projector = new T.Object3D();
  /** Видна ли часть тела: невидимый предок (первое лицо, скрытый призрак) прячет и её. */
  const shown = (o: T.Object3D, owner: T.Object3D) => {
    for (let q: T.Object3D | null = o; q; q = q.parent) {
      if (!q.visible || q.userData.presentationOnly) return false;
      if (q === owner) return true;
    }
    return false;
  };
  /**
   * Пятно краски прямо на теле бойца. Луч идёт от `from` к `toward`; там, где он
   * встретил часть тела, на её поверхность проецируется пятно (DecalGeometry) и
   * становится дочерним у этой части — клякса облегает форму, двигается с рукой
   * или головой и падает вместе с телом. Тело дальше `reach` от точки попадания
   * `impact` не красим: краска не ляжет туда, куда шарик не долетал.
   */
  const paintBody = (
    owner: T.Object3D,
    from: T.Vector3,
    toward: T.Vector3,
    impact: T.Vector3,
    color: string,
    now: number,
    size: number,
    reach: number,
  ) => {
    if (!owner.visible) return false;
    owner.updateMatrixWorld(true);
    bodyParts.length = 0;
    owner.traverse((o) => {
      if (
        o instanceof T.Mesh &&
        !(o instanceof T.InstancedMesh) &&
        !o.userData.paintStain &&
        o.geometry.getAttribute('position') &&
        shown(o, owner)
      )
        bodyParts.push(o);
    });
    const direction = toward.clone().sub(from);
    const distance = direction.length();
    if (!bodyParts.length || distance < 1e-4) return false;
    raycaster.set(from, direction.divideScalar(distance));
    raycaster.far = distance + reach;
    const hit = raycaster.intersectObjects(bodyParts, false)[0];
    if (!hit || !hit.face || hit.point.distanceTo(impact) > reach) return false;
    const part = hit.object as T.Mesh;
    const normal = hit.face.normal.clone().transformDirection(part.matrixWorld);
    // Проектор смотрит в поверхность; «верх» пятна — вверх по миру, так потёк
    // стекает вниз. Небольшой случайный поворот, чтобы пятна не были одинаковыми.
    projector.position.copy(hit.point);
    projector.up.set(0, 1, 0);
    if (Math.abs(normal.y) > 0.95) projector.up.set(0, 0, 1);
    projector.lookAt(hit.point.clone().add(normal));
    projector.rotateZ((Math.random() - 0.5) * 0.5);
    const geometry = new DecalGeometry(
      part,
      hit.point,
      projector.rotation,
      new T.Vector3(size, size, BODY_PAINT_DEPTH),
    );
    if (!geometry.getAttribute('position')?.count) {
      geometry.dispose();
      return false;
    }
    // DecalGeometry отдаёт мировые координаты; пятно живёт в координатах части тела.
    geometry.applyMatrix4(part.matrixWorld.clone().invert());
    const material = bodyPaintMaterials.acquire();
    material.color.set(color);
    material.opacity = 0.95;
    const stain = new T.Mesh(geometry, material);
    stain.userData.paintStain = true;
    stain.userData.projectileCollision = 'ignore';
    // Общая чистка аватара (world-remote-players.ts) пятна не трогает: их
    // материалы — из пула, освобождает их retireSplat.
    stain.userData.presentationOnly = true;
    stain.castShadow = false;
    part.add(stain);
    splats.push({ mesh: stain, born: now, owner, life: BODY_PAINT_SECONDS });
    let count = 0;
    for (let i = splats.length - 1; i >= 0; i--) {
      if (splats[i].owner !== owner || !splats[i].mesh.userData.paintStain) continue;
      if (++count > BODY_PAINT_LIMIT) {
        retireSplat(splats[i]);
        splats.splice(i, 1);
      }
    }
    return true;
  };
  /**
   * Попадание краской по бойцу: пятно на том месте тела, куда пришёлся шарик
   * (луч от `from` через точку прицела `toward`), и брызги. Если по пути к точке
   * прицела тела не оказалось — например, боец успел сдвинуться, — ищем его
   * поверхность не дальше `near` от точки, со стороны центра тела. Возвращает,
   * прилипла ли краска: если нет, пусть ляжет на стену позади.
   */
  const smearPlayerWithPaint = (
    playerGroup: T.Object3D,
    from: T.Vector3,
    toward: T.Vector3,
    color: string,
    now: number,
    size = 0.3,
    near = 0.35,
  ) => {
    playerGroup.updateMatrixWorld(true);
    const center = new T.Vector3(0, 0.95, 0).applyMatrix4(playerGroup.matrixWorld);
    const stuck =
      paintBody(playerGroup, from, toward, toward, color, now, size, 0.45) ||
      paintBody(playerGroup, toward, center, toward, color, now, size, near);
    burst(toward, color, now, 'paint');
    return stuck;
  };
  /** Смыть краску с бойца (или с экрана): пятна не переживают смерть. */
  const clearPaint = (owner: T.Object3D) => {
    for (let i = splats.length - 1; i >= 0; i--) {
      if (splats[i].owner !== owner) continue;
      retireSplat(splats[i]);
      splats.splice(i, 1);
    }
  };
  const update = (now: number, dt: number) => {
    for (let i = splats.length - 1; i >= 0; i--) {
      const p = splats[i],
        age = (now - p.born) / 1000;
      (p.mesh.material as T.MeshBasicMaterial).opacity =
        (p.mesh.userData.paintStain ? 0.95 : 0.9) * Math.min(1, (p.life - age) / 3);
      // Боец ушёл из комнаты — его аватара уже нет в сцене, и пятна с ним.
      if (age >= p.life || (p.mesh.userData.paintStain && !p.owner.parent)) {
        retireSplat(p);
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
        // Частица размером 10 см в 20 см от глаза закрывает пол-экрана: то, что
        // подлетело вплотную к камере, схлопываем, а рядом плавно уменьшаем.
        dummy.scale.setScalar(nearCameraScale(b.positions[j]));
        dummy.updateMatrix();
        b.mesh.setMatrixAt(j, dummy.matrix);
      }
      b.mesh.instanceMatrix.needsUpdate = true;
      (b.mesh.material as T.MeshBasicMaterial).opacity = Math.min(
        1,
        (maxAge - age) / (maxAge * 0.35),
      );
      if (age > maxAge) {
        retireBurst(b);
        bursts.splice(i, 1);
      }
    }
  };
  const dispose = () => {
    paintDropletGeo.dispose();
    confettiGeo.dispose();
    partyGeometries.forEach((g) => g.dispose());
    burstMaterials.dispose();
    splatMaterials.dispose();
    bodyPaintMaterials.dispose();
    stainTexture?.dispose();
  };
  return {
    paintDropletGeo,
    burst,
    splat,
    smearPlayerWithPaint,
    clearPaint,
    update,
    dispose,
  };
}
