import * as T from 'three';
import type { Room, WorldEffect } from '@/lib/model';
import { hitZone, inHitRange, type HitZone } from '@/lib/game-items';
import { flightMs } from '@/lib/weapon-definition';
import { grenadeAt, simulateGrenade, type GrenadeFlight, type GrenadeWorld } from '@/lib/grenade-physics';
import type { Perspective } from '@/lib/game-camera';
import { makeGrenade, makeFireworkRocket } from './party-geometry';
import { spriteAtlas } from './world-vfx-textures';
import { avatarShoot } from './world-avatar';
import type { createWorldVfx } from './world-vfx';
import { createMaterialPool, type MaterialPool } from './material-pool';

type Flight = {
  mesh: T.Object3D;
  variant: string;
  origin: T.Vector3;
  target: T.Vector3;
  normal: T.Vector3;
  born: number;
  duration: number;
  color: string;
  kind: string;
  author?: string;
  /** Путь гранаты с отскоками; у остальных снарядов полёт прямой. */
  grenade?: GrenadeFlight;
  /** Сколько отскоков гранаты уже прозвучало. */
  knocks?: number;
};

type Vfx = ReturnType<typeof createWorldVfx>;

/**
 * Projectile flights (paint balls, confetti pellets, grenades, firework
 * rockets, hearts) of the world engine: spawning from network/local
 * effects and the per-frame flight + impact simulation.
 * Extracted verbatim from the engine effect in world.tsx.
 */
export function createWorldProjectiles({
  scene,
  latest,
  remoteAvatars,
  avatar,
  hands,
  pos,
  perspectiveRef,
  hitMarker,
  burst,
  splat,
  smearPlayerWithPaint,
  checkSceneryHit,
  world,
  onLaunch,
  onLand,
  onBounce,
  vfx,
}: {
  scene: T.Scene;
  latest: { readonly current: { room: Room } };
  remoteAvatars: Map<string, T.Group>;
  avatar: T.Group;
  hands: { group: T.Object3D };
  pos: T.Vector3;
  perspectiveRef: { readonly current: Perspective };
  /** Отметка своего попадания: игрок должен видеть, куда пришёлся выстрел. */
  hitMarker: { readonly current: (zone: HitZone) => void };
  burst: Vfx['burst'];
  splat: Vfx['splat'];
  smearPlayerWithPaint: Vfx['smearPlayerWithPaint'];
  checkSceneryHit: (
    at: T.Vector3,
    normal: T.Vector3,
  ) => { point: T.Vector3; normal: T.Vector3 } | null;
  /**
   * Текущая карта: её стены не дают отметке попадания загореться сквозь них,
   * а пол и стены — то, от чего отскакивает граната.
   */
  world: GrenadeWorld;
  /** Снаряд вылетел (свой или чужой) — для звука выстрела. Старые эффекты при входе в комнату не зовутся. */
  onLaunch?: (e: WorldEffect) => void;
  /** Снаряд долетел до точки — для звука попадания или взрыва. */
  onLand?: (kind: string, at: T.Vector3) => void;
  /** Граната ударилась о стену или пол. */
  onBounce?: (at: T.Vector3) => void;
  /**
   * Вспышка у ствола и след снаряда (world-vfx.ts). Без них выстрелы идут
   * без вспышки, ракета — без искр и дыма, запал гранаты не искрит.
   */
  vfx?: Pick<Vfx, 'muzzleFlash' | 'trail'>;
}) {
  const { colliders } = world;
  const flights: Flight[] = [];
  /**
   * Уже проигранные выстрелы: id → когда увидели. Память обязана жить дольше,
   * чем сервер держит эффект (EFFECT_TTL_MS = 15 с), иначе в перестрелке
   * id вытесняется за несколько секунд, эффект всё ещё лежит в состоянии
   * комнаты — и клиент запускает его заново, рождая выстрелы из ниоткуда.
   */
  const seen = new Map<string, number>();
  const SEEN_TTL_MS = 25_000;
  const scratch: [number, number, number] = [0, 0, 0];
  const tumbleFrom = new T.Vector3();
  // Скретч покадрового обновления: без аллокаций на каждый снаряд в кадре.
  const flightDir = new T.Vector3(),
    trailFrom = new T.Vector3(),
    forward = new T.Vector3(0, 0, 1),
    up = new T.Vector3(0, 1, 0);
  const paintGeo = new T.SphereGeometry(0.105, 12, 8);
  /**
   * Шлейф шарика: тонкий конус за ним, от яркого у шарика к прозрачному на
   * хвосте (цвет вершин при аддитивном смешивании: чёрный — невидимый).
   * Основание — в центре шарика, хвост — на z = -1; длину задаёт масштаб.
   */
  const trailGeo = new T.ConeGeometry(1, 1, 8, 1, true);
  trailGeo.rotateX(-Math.PI / 2).translate(0, 0, -0.5);
  {
    const position = trailGeo.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const k = 1 + position.getZ(i);
      colors.fill(k * k, i * 3, i * 3 + 3);
    }
    trailGeo.setAttribute('color', new T.BufferAttribute(colors, 3));
  }
  /** Сердечко «лайка»: объёмное, со скруглённым краем. Одна геометрия на все. */
  const heartShape = new T.Shape();
  heartShape.moveTo(0, -0.11);
  heartShape.bezierCurveTo(-0.23, 0.04, -0.08, 0.17, 0, 0.065);
  heartShape.bezierCurveTo(0.08, 0.17, 0.23, 0.04, 0, -0.11);
  const heartGeo = new T.ExtrudeGeometry(heartShape, {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 8,
  }).center();
  // Материалы шариков, шлейфов и сердечек переиспользуются: см. material-pool.ts.
  // Шарик глянцевый и чуть светится своим цветом: читается и на тёмной карте.
  const ballMaterials = createMaterialPool(
    () => new T.MeshStandardMaterial({ roughness: 0.16, metalness: 0 }),
  );
  const trailMaterials = createMaterialPool(
    () =>
      new T.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
        opacity: 0.45,
      }),
  );
  const heartMaterials = createMaterialPool(
    () =>
      new T.MeshStandardMaterial({
        color: '#ff4d6d',
        emissive: '#ff2d55',
        emissiveIntensity: 0.45,
        roughness: 0.25,
      }),
  );
  /** Пламя сопла ракеты: светящийся спрайт, материал общий на все ракеты. */
  let exhaust: { material: T.SpriteMaterial; texture: T.Texture } | null = null;
  const exhaustSprite = () => {
    if (!exhaust) {
      const texture = spriteAtlas();
      // Плитка свечения из атласа (левая верхняя).
      texture.repeat.set(0.5, 0.5);
      texture.offset.set(0, 0.5);
      exhaust = {
        texture,
        material: new T.SpriteMaterial({
          map: texture,
          color: new T.Color(2.4, 1.6, 0.8),
          blending: T.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      };
    }
    const sprite = new T.Sprite(exhaust.material);
    sprite.userData.sharedMaterial = true;
    sprite.userData.sharedGeometry = true;
    sprite.raycast = () => {};
    sprite.position.z = -0.3;
    sprite.scale.setScalar(0.32);
    return sprite;
  };
  const pooled = <M extends T.Material>(
    geometry: T.BufferGeometry,
    pool: MaterialPool<M>,
  ) => {
    const mesh = new T.Mesh(geometry, pool.acquire());
    mesh.userData.materialPool = pool;
    return mesh;
  };
  /** Шарик краски или дробина; геометрией снаряд не владеет — она общая. */
  const ball = (color: string, geometry: T.BufferGeometry = paintGeo) => {
    const mesh = pooled(geometry, ballMaterials);
    mesh.material.color.set(color);
    mesh.material.emissive.set(color).multiplyScalar(0.3);
    const trail = pooled(trailGeo, trailMaterials);
    trail.material.color.set(color);
    trail.raycast = () => {};
    // Толщина шлейфа — по радиусу снаряда: у дробины он тоньше и короче.
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    trail.userData.radius = (geometry.boundingSphere?.radius ?? 0.1) * 0.55;
    trail.userData.length = geometry === paintGeo ? 1.3 : 0.8;
    trail.scale.setScalar(0.0001);
    trail.name = 'trail';
    mesh.add(trail);
    return mesh;
  };
  const spawn = (e: WorldEffect) => {
    if (
      e.kind === 'kill' ||
      !e.origin ||
      !e.target ||
      !e.normal ||
      !e.color ||
      seen.has(e.id) ||
      Date.now() - e.at > (e.kind === 'paint' ? 14000 : 5000)
    )
      return;
    const now = Date.now();
    seen.set(e.id, now);
    // Эффекты, пролежавшие в комнате дольше полутора секунд, — не выстрел «сейчас», а история.
    if (now - e.at < 1500) onLaunch?.(e);
    const remote = remoteAvatars.get(e.author);
    if (remote) avatarShoot(remote);
    if (seen.size > 300)
      for (const [id, at] of seen)
        if (now - at > SEEN_TTL_MS) seen.delete(id);
    const start = new T.Vector3(...e.origin),
      target = new T.Vector3(...e.target),
      normal = new T.Vector3(...e.normal).normalize();
    const projectile =
      e.kind === 'grenade'
        ? makeGrenade(e.color, e.variant)
        : e.kind === 'sniper'
          ? makeFireworkRocket(e.color)
          : e.kind === 'like'
            ? pooled(heartGeo, heartMaterials)
            : ball(e.color);
    if (e.kind === 'sniper') projectile.add(exhaustSprite());
    projectile.position.copy(start);
    // Вспышка у ствола — и у своего выстрела, и у чужого; у старых эффектов её нет.
    if (now - e.at < 300 && e.kind !== 'grenade')
      vfx?.muzzleFlash(start, flightDir.copy(target).sub(start), e.color, now, e.kind);
    projectile.userData.transientProjectile = true;
    scene.add(projectile);
    // Граната рвётся там, куда долетела и докатилась, — сервер считает тот же путь.
    const grenade = e.kind === 'grenade' ? simulateGrenade(e.origin, e.target, world) : undefined;
    if (grenade) target.fromArray(grenade.end);
    const born = performance.now() - Math.max(0, Date.now() - e.at);
    flights.push({
      mesh: projectile,
      origin: start,
      target,
      grenade,
      // Отскоки, что случились до того, как мы увидели бросок, не звучат.
      knocks: grenade?.bounces.filter((b) => b < performance.now() - born).length,
      normal,
      born,
      // Столько же сервер ждёт, прежде чем ранить: урон приходит вместе со снарядом.
      duration: flightMs(e.kind, start.distanceTo(target)),
      variant: e.variant || 'classic',
      color: e.color,
      kind: e.kind,
      author: e.author,
    });
  };
  const update = (
    now: number,
    currentStance: 'stand' | 'sit' | 'lie',
  ) => {
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i],
        t = Math.min(1, (now - f.born) / f.duration);
      if (f.grenade) {
        const at = grenadeAt(f.grenade, now - f.born, scratch);
        // Кувыркается, пока катится, и замирает, когда легла.
        const moved = f.mesh.position.distanceTo(tumbleFrom.fromArray(at));
        f.mesh.position.fromArray(at);
        f.mesh.rotation.x += moved * 3.2;
        f.mesh.rotation.z += moved * 2.1;
        let knocks = f.knocks ?? 0;
        for (; knocks < f.grenade.bounces.length && f.grenade.bounces[knocks] <= now - f.born; knocks++)
          onBounce?.(f.mesh.position);
        f.knocks = knocks;
        // Горящий запал искрит, пока граната летит и катится.
        if (moved > 1e-3) vfx?.trail(tumbleFrom, f.mesh.position, f.color, now, 'grenade');
      } else {
        trailFrom.copy(f.mesh.position);
        f.mesh.position.lerpVectors(f.origin, f.target, t);
        flightDir.subVectors(f.target, f.origin);
        const length = flightDir.length();
        if (length > 1e-6) flightDir.divideScalar(length);
        f.mesh.quaternion.setFromUnitVectors(forward, flightDir);
        if (f.kind === 'sniper') {
          // Искры и дымная нить вдоль пройденного за кадр отрезка: ракета
          // долетает за пару кадров, и этот след и есть трассер салюта.
          if (t > 0) vfx?.trail(trailFrom, f.mesh.position, f.color, now, 'sniper');
          for (const c of f.mesh.children) if (c instanceof T.Sprite) c.scale.setScalar(0.26 + Math.random() * 0.16);
        } else if (f.kind === 'like') {
          // Сердечко покачивается и крутится, а не летит плашмя.
          f.mesh.rotateZ(Math.sin(now * 0.02) * 0.4);
          f.mesh.rotateY(now * 0.012);
        } else {
          // Шлейф шарика растёт от ствола до полной длины.
          const trail = f.mesh.getObjectByName('trail');
          if (trail) {
            const r = trail.userData.radius as number;
            trail.scale.set(r, r, Math.max(0.0001, Math.min(trail.userData.length as number, t * length)));
          }
        }
      }
      if (t >= 1) {
        // Звук — только у свежих приземлений: догнанные при входе в комнату летят «мгновенно».
        if (now - (f.born + f.duration) < 800) onLand?.(f.kind, f.target);
        let hitPlayerGroup: T.Object3D | null = null;
        let isHitOnPlayer = false;

        const myPos = pos;
        const myCenter = new T.Vector3(myPos.x, myPos.y + 0.95, myPos.z);
        // Грубая клиентская проверка — только для декораций (брызги краски на своём
        // аватаре и на руках в первом лице). Она заведомо шире серверной: радиус 1.15 м
        // ловит промахи рядом, а поза берётся текущая, а не отмотанная. Урон по ней
        // НЕ показываем — вспышку даёт падение hp с сервера.
        const hitMe =
          f.target.distanceTo(myCenter) < 1.15 ||
          inHitRange(
            f.kind,
            [f.origin.x, f.origin.y, f.origin.z],
            [f.target.x, f.target.y, f.target.z],
            { x: myPos.x, y: myPos.y, z: myPos.z, stance: currentStance },
            colliders,
          );

        if (hitMe && f.author !== latest.current.room.self) {
          isHitOnPlayer = true;
          hitPlayerGroup = avatar;
          if (perspectiveRef.current === 'first') {
            /*
             * Краска на своём экране: прилетело — забрызгало обзор. Клякса
             * висит на камере, а не на группе рук: она на «забрале» игрока и
             * не должна ездить вместе с оружием при прицеливании.
             *
             * И не по центру: там прицел, и залепить его — значит отнять
             * возможность ответить. Место по кругу выбирается случайно, так
             * что две подряд не ложатся друг на друга.
             */
            const angle = Math.random() * Math.PI * 2;
            const spread = 0.3 + Math.random() * 0.12;
            splat(
              new T.Vector3(
                Math.cos(angle) * spread,
                Math.sin(angle) * spread * 0.7,
                -0.45,
              ),
              new T.Vector3(0, 0, 1),
              f.color,
              f.born + f.duration,
              hands.group.parent ?? hands.group,
              0.14,
              true,
            );
          }
        }

        if (!isHitOnPlayer) {
          for (const member of latest.current.room.members) {
            if (member.id === latest.current.room.self) continue;
            const remote = remoteAvatars.get(member.id);
            if (!remote || !remote.visible) continue;
            const remoteCenter = new T.Vector3(
              member.pose.x,
              member.pose.y + 0.95,
              member.pose.z,
            );
            // Попадание по чужому аватару. Отметку о своём попадании ставит только
            // строгая проверка с коллайдерами карты: иначе она загоралась бы и на
            // выстрелах, которые сервер отбросит как перекрытые стеной.
            const strictHit = inHitRange(
              f.kind,
              [f.origin.x, f.origin.y, f.origin.z],
              [f.target.x, f.target.y, f.target.z],
              {
                x: member.pose.x,
                y: member.pose.y,
                z: member.pose.z,
                yaw: member.pose.yaw,
                stance: member.pose.stance,
              },
              colliders,
            );
            if (strictHit || f.target.distanceTo(remoteCenter) < 1.15) {
              isHitOnPlayer = true;
              hitPlayerGroup = remote;
              // Своё попадание отмечаем зоной: по гранате зон нет, она накрывает целиком.
              if (strictHit && f.author === latest.current.room.self && f.kind !== 'grenade')
                hitMarker.current(
                  hitZone(
                    [f.origin.x, f.origin.y, f.origin.z],
                    [f.target.x, f.target.y, f.target.z],
                    {
                      x: member.pose.x,
                      y: member.pose.y,
                      z: member.pose.z,
                      yaw: member.pose.yaw,
                      stance: member.pose.stance,
                    },
                  ),
                );
              break;
            }
          }
        }

        if (f.kind === 'paint') {
          // Краска ложится на то место тела, куда пришёлся шарик. Не нашлось
          // тела у точки попадания — летит дальше и пачкает стену.
          if (
            !(
              isHitOnPlayer &&
              hitPlayerGroup &&
              smearPlayerWithPaint(hitPlayerGroup, f.origin, f.target, f.color, f.born + f.duration)
            )
          ) {
            const sceneryHit = checkSceneryHit(f.target, f.normal);
            if (sceneryHit) {
              splat(
                sceneryHit.point,
                sceneryHit.normal,
                f.color,
                f.born + f.duration,
                scene,
                1,
              );
              // Брызги летят от стены, а не вверх из точки.
              burst(sceneryHit.point, f.color, f.born + f.duration, 'paint', sceneryHit.normal);
            } else burst(f.target, f.color, f.born + f.duration, 'paint', f.normal);
          }
        } else {
          if (f.kind === 'grenade') {
            // Граната рвётся, лёжа там, куда докатилась: волна идёт по полу.
            burst(f.target, f.color, f.born + f.duration, `grenade:${f.variant}`, f.grenade ? up : f.normal);
          } else {
            burst(
              f.target,
              f.color,
              f.born + f.duration,
              f.kind === 'sniper'
                ? `firework:${f.variant}`
                : f.kind === 'like'
                  ? 'pop:hearts'
                  : `pop:${f.variant}`,
              f.normal,
            );
          }
          if (f.kind === 'grenade' && f.variant === 'paintburst') {
            // Взрыв окатывает бойца со стороны, где рванула граната.
            if (
              !(
                isHitOnPlayer &&
                hitPlayerGroup &&
                smearPlayerWithPaint(hitPlayerGroup, f.target, f.target, f.color, f.born + f.duration, 0.45, Infinity)
              )
            ) {
              const sceneryHit = checkSceneryHit(f.target, f.normal);
              if (sceneryHit) {
                splat(
                  sceneryHit.point,
                  sceneryHit.normal,
                  f.color,
                  f.born + f.duration,
                  scene,
                  1,
                );
              }
            }
          }
        }
        f.mesh.removeFromParent();
        f.mesh.traverse((o) => {
          if (o instanceof T.Mesh || o instanceof T.Sprite) {
            const pool = o.userData.materialPool as MaterialPool<T.Material> | undefined;
            if (pool) pool.release(o.material as T.Material);
            else if (!o.userData.sharedMaterial) (o.material as T.Material).dispose();
            // Своя геометрия — только у гранаты и ракеты; шарики, шлейфы и сердечки делят общую.
            if ((f.kind === 'grenade' || f.kind === 'sniper') && !o.userData.sharedGeometry)
              o.geometry.dispose();
          }
        });
        flights.splice(i, 1);
      }
    }
  };
  const dispose = () => {
    paintGeo.dispose();
    trailGeo.dispose();
    heartGeo.dispose();
    ballMaterials.dispose();
    trailMaterials.dispose();
    heartMaterials.dispose();
    exhaust?.material.dispose();
    exhaust?.texture.dispose();
  };
  return { flights, spawn, update, dispose, ball };
}
