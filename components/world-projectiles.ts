import * as T from 'three';
import type { Room, WorldEffect } from '@/lib/model';
import { hitZone, inHitRange, type HitZone } from '@/lib/game-items';
import type { BoxCollider3D } from '@/lib/world-collision';
import type { Perspective } from '@/lib/game-camera';
import {
  partyGeometry,
  grenadeParty,
  fireworkParty,
  makeGrenade,
  makeFireworkRocket,
} from './party-geometry';
import { avatarShoot } from './world-avatar';
import type { createWorldVfx } from './world-vfx';

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
  colliders,
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
  /** Стены текущей карты: без них отметка попадания загоралась бы сквозь них. */
  colliders: BoxCollider3D[];
}) {
  const flights: Flight[] = [];
  /**
   * Уже проигранные выстрелы: id → когда увидели. Память обязана жить дольше,
   * чем сервер держит эффект (EFFECT_TTL_MS = 15 с), иначе в перестрелке
   * id вытесняется за несколько секунд, эффект всё ещё лежит в состоянии
   * комнаты — и клиент запускает его заново, рождая выстрелы из ниоткуда.
   */
  const seen = new Map<string, number>();
  const SEEN_TTL_MS = 25_000;
  const paintGeo = new T.SphereGeometry(0.105, 7, 5);
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
    const remote = remoteAvatars.get(e.author);
    if (remote) avatarShoot(remote);
    if (seen.size > 300)
      for (const [id, at] of seen)
        if (now - at > SEEN_TTL_MS) seen.delete(id);
    const start = new T.Vector3(...e.origin),
      target = new T.Vector3(...e.target),
      normal = new T.Vector3(...e.normal).normalize();
    const ball =
      e.kind === 'grenade'
        ? makeGrenade(e.color, e.variant)
        : e.kind === 'sniper'
          ? makeFireworkRocket(e.color)
          : e.kind === 'like'
            ? new T.Mesh(
                partyGeometry('hearts'),
                new T.MeshBasicMaterial({ color: '#ff647c', side: T.DoubleSide }),
              )
            : new T.Mesh(paintGeo, new T.MeshBasicMaterial({ color: e.color }));
    ball.position.copy(start);
    ball.userData.transientProjectile = true;
    scene.add(ball);
    flights.push({
      mesh: ball,
      origin: start,
      target,
      normal,
      born: performance.now() - Math.max(0, Date.now() - e.at),
      duration:
        e.kind === 'grenade'
          ? 1100
          : e.kind === 'sniper'
            ? Math.max(25, start.distanceTo(target) * 1.8)
            : Math.max(130, start.distanceTo(target) * 22),
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
      f.mesh.position.lerpVectors(f.origin, f.target, t);
      if (f.kind === 'grenade') {
        f.mesh.position.y += Math.sin(t * Math.PI) * 3;
        f.mesh.rotation.x = t * 10;
        f.mesh.rotation.y = t * 7;
        f.mesh.rotation.z = t * 14;
      } else if (f.kind === 'sniper') {
        const dir = f.target.clone().sub(f.origin).normalize();
        f.mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir);
      }
      if (t >= 1) {
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
          if (isHitOnPlayer && hitPlayerGroup) {
            smearPlayerWithPaint(
              hitPlayerGroup,
              f.target,
              f.normal,
              f.color,
              f.born + f.duration,
            );
          } else {
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
        } else {
          if (f.kind === 'grenade') {
            burst(f.target, f.color, f.born + f.duration, 'shard');
            burst(f.target, '#ffd166', f.born + f.duration, 'ribbon');
            burst(
              f.target,
              f.color,
              f.born + f.duration,
              grenadeParty(f.variant),
            );
          } else {
            burst(
              f.target,
              f.color,
              f.born + f.duration,
              f.kind === 'sniper'
                ? fireworkParty(f.variant)
                : f.kind === 'like'
                  ? 'hearts'
                  : f.variant,
            );
          }
          if (f.kind === 'grenade' && f.variant === 'paintburst') {
            if (isHitOnPlayer && hitPlayerGroup) {
              smearPlayerWithPaint(
                hitPlayerGroup,
                f.target,
                f.normal,
                f.color,
                f.born + f.duration,
              );
            } else {
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
          if (o instanceof T.Mesh) {
            (o.material as T.Material).dispose();
            if (
              f.kind === 'grenade' ||
              f.kind === 'sniper' ||
              f.kind === 'like'
            )
              o.geometry.dispose();
          }
        });
        flights.splice(i, 1);
      }
    }
  };
  const dispose = () => {
    paintGeo.dispose();
  };
  return { flights, spawn, update, dispose };
}
