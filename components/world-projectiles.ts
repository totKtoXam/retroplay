import * as T from 'three';
import type { Room, WorldEffect } from '@/lib/model';
import { inHitRange } from '@/lib/game-items';
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
  hitGlowHandler,
  burst,
  splat,
  smearPlayerWithPaint,
  checkSceneryHit,
}: {
  scene: T.Scene;
  latest: { readonly current: { room: Room } };
  remoteAvatars: Map<string, T.Group>;
  avatar: T.Group;
  hands: { group: T.Object3D };
  pos: T.Vector3;
  perspectiveRef: { readonly current: Perspective };
  hitGlowHandler: { readonly current: (color: string) => void };
  burst: Vfx['burst'];
  splat: Vfx['splat'];
  smearPlayerWithPaint: Vfx['smearPlayerWithPaint'];
  checkSceneryHit: (
    at: T.Vector3,
    normal: T.Vector3,
  ) => { point: T.Vector3; normal: T.Vector3 } | null;
}) {
  const flights: Flight[] = [],
    seen = new Set<string>();
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
    seen.add(e.id);
    const remote = remoteAvatars.get(e.author);
    if (remote) avatarShoot(remote);
    if (seen.size > 200) {
      const first = seen.values().next().value;
      if (first) seen.delete(first);
    }
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
        const hitMe =
          f.target.distanceTo(myCenter) < 1.15 ||
          inHitRange(
            f.kind,
            [f.origin.x, f.origin.y, f.origin.z],
            [f.target.x, f.target.y, f.target.z],
            { x: myPos.x, y: myPos.y, z: myPos.z, stance: currentStance },
          );

        if (hitMe && f.author !== latest.current.room.self) {
          isHitOnPlayer = true;
          hitPlayerGroup = avatar;
          hitGlowHandler.current(f.color);
          if (perspectiveRef.current === 'first') {
            splat(
              new T.Vector3(0.04, -0.02, -0.45),
              new T.Vector3(0, 0, 1),
              f.color,
              f.born + f.duration,
              hands.group,
              0.22,
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
            if (
              f.target.distanceTo(remoteCenter) < 1.15 ||
              inHitRange(
                f.kind,
                [f.origin.x, f.origin.y, f.origin.z],
                [f.target.x, f.target.y, f.target.z],
                {
                  x: member.pose.x,
                  y: member.pose.y,
                  z: member.pose.z,
                  stance: member.pose.stance,
                },
              )
            ) {
              isHitOnPlayer = true;
              hitPlayerGroup = remote;
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
