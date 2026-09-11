import * as T from 'three';
import type { Room } from '@/lib/model';
import { getGroundHeight } from '@/lib/world-collision';
import type { createWorldScene } from './world-scene';
import { animateAvatar, setAvatarAnonymous } from './world-avatar';
import { attachCustomSkins, applyAvatarSkin } from './world-skins';

/**
 * Remote player avatars of the world engine: creation/retirement, name
 * labels, death timers, pose interpolation/prediction and animation.
 * Extracted verbatim from the engine effect in world.tsx.
 */
export function createWorldRemotePlayers({
  scene,
  kit,
  quality,
  latest,
}: {
  scene: T.Scene;
  kit: ReturnType<typeof createWorldScene>;
  quality: string;
  latest: { readonly current: { room: Room } };
}) {
  const remoteAvatars = new Map<string, T.Group>(),
    remoteBandanaMats = new Map<string, T.MeshStandardMaterial>(),
    labels = new Map<string, T.Sprite>(),
    remoteMotion = new Map<
      string,
      {
        lastX: number;
        lastY: number;
        lastZ: number;
        lastYaw: number;
        lastTime: number;
      }
    >();
  const addLabel = (name: string, color: string) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#182237de';
    ctx.roundRect(0, 0, 256, 60, 15);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(8, 13, 4, 30);
    ctx.fillStyle = '#fff';
    ctx.font = '500 23px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name.slice(0, 18), 132, 39);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(
      new T.SpriteMaterial({ map: tex, transparent: true, depthTest: true }),
    );
    sprite.scale.set(1.8, 0.45, 1);
    sprite.position.y = 2.55;
    return sprite;
  };
  const deadTimers = new Map<string, number>();
  // Remote avatars of members that left or went stale; disposed after the
  // resource pack has released them (visuals.update below) in the same frame.
  const retiredAvatars: T.Group[] = [],
    liveRemoteIds = new Set<string>();
  let remoteKey = '';
  const retireRemote = (id: string, remote: T.Group) => {
    remote.removeFromParent();
    retiredAvatars.push(remote);
    remoteAvatars.delete(id);
    labels.delete(id);
    remoteBandanaMats.delete(id);
    remoteMotion.delete(id);
    deadTimers.delete(id);
    remoteKey = Array.from(remoteAvatars.keys()).join(',');
  };
  const disposeRemoteAvatar = (remote: T.Group) => {
    remote.traverse((o) => {
      for (let q: T.Object3D | null = o; q && q !== remote; q = q.parent)
        if (q.userData.presentationOnly) return;
      if (o instanceof T.Sprite) {
        // Sprite geometry is a shared three.js singleton — keep it.
        o.material.map?.dispose();
        o.material.dispose();
      } else if (o instanceof T.Mesh) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material)
          ? o.material
          : [o.material];
        materials.forEach((m) => m.dispose());
      }
    });
  };
  const update = (now: number, dt: number) => {
    const serverNow =
      (latest.current.room as Room & { serverNow?: number }).serverNow ??
      Date.now();
    liveRemoteIds.clear();
    for (const member of latest.current.room.members) {
      if (member.id === latest.current.room.self) continue;
      // Server treats players unseen for 15 s as gone; don't keep avatars for them.
      if (serverNow - member.lastSeen >= 15000) continue;
      liveRemoteIds.add(member.id);
      let remote = remoteAvatars.get(member.id);
      if (!remote) {
        remote = kit.avatarFactory(member.color);
        remoteAvatars.set(member.id, remote);
        remoteKey = Array.from(remoteAvatars.keys()).join(',');
        remote.traverse((o) => {
          if (o instanceof T.Mesh) o.castShadow = quality === 'high';
        });
        scene.add(remote);
        // Attach custom skins to remote avatar
        const remoteSkinResult = attachCustomSkins(remote);
        remoteBandanaMats.set(member.id, remoteSkinResult.bandanaMat);
        applyAvatarSkin(remote, member.hat || member.skin || 'agent', member.bandanaColor || member.color, remoteSkinResult.bandanaMat);
        const label = addLabel(member.name, member.color);
        labels.set(member.id, label);
        remote.add(label);
        if (member.pose) {
          remote.position.set(
            member.pose.x,
            member.pose.y + 0.27,
            member.pose.z,
          );
          remote.rotation.y = member.pose.yaw || 0;
        }
      }
      const isRemoteDead = (member.hp ?? 100) === 0;
      if (isRemoteDead) {
        if (!deadTimers.has(member.id)) {
          deadTimers.set(member.id, now);
        }
      } else {
        deadTimers.delete(member.id);
      }
      const remoteDeathTime = deadTimers.get(member.id);
      const isRemoteDeathRecent =
        isRemoteDead && now - (remoteDeathTime || now) < 3800;

      remote.visible =
        Date.now() - member.lastSeen < 15000 &&
        (!isRemoteDead || isRemoteDeathRecent);
      setAvatarAnonymous(
        remote,
        !!latest.current.room.state.anonymousPlayers,
      );
      const isRemoteShielded = (member.immuneRemaining || 0) > 0;
      // Update remote skin if changed
      applyAvatarSkin(remote, member.hat || member.skin || 'agent', member.bandanaColor || member.color, remoteBandanaMats.get(member.id));
      const caption = isRemoteDead
        ? '💀 ПОГИБ'
        : latest.current.room.state.anonymousPlayers
          ? `${member.hp ?? 100} HP${isRemoteShielded ? ' 🛡️' : ''}`
          : `${member.name.slice(0, 12)} · ${member.hp ?? 100}${isRemoteShielded ? ' 🛡️' : ''}`;
      let label = labels.get(member.id);
      // Hide label when host setting hidePlayerStatus is on
      const shouldHideLabel = !!latest.current.room.state.hidePlayerStatus;
      if (label?.userData.caption !== caption) {
        if (label) {
          label.removeFromParent();
          label.material.map?.dispose();
          label.material.dispose();
        }
        label = addLabel(caption, member.color);
        label.userData.caption = caption;
        labels.set(member.id, label);
        remote.add(label);
      }
      if (label) label.visible = !shouldHideLabel && remote.visible;

      const p = member.pose;
      let motion = remoteMotion.get(member.id);
      if (!motion) {
        motion = {
          lastX: p.x,
          lastY: p.y,
          lastZ: p.z,
          lastYaw: p.yaw || 0,
          lastTime: now,
        };
        remoteMotion.set(member.id, motion);
      }
      if (
        p.x !== motion.lastX ||
        p.y !== motion.lastY ||
        p.z !== motion.lastZ ||
        p.yaw !== motion.lastYaw
      ) {
        motion.lastX = p.x;
        motion.lastY = p.y;
        motion.lastZ = p.z;
        motion.lastYaw = p.yaw || 0;
        motion.lastTime = now;
      }

      const timeSince = Math.min(
        0.35,
        Math.max(0, (now - motion.lastTime) / 1000),
      );
      let targetX = p.x;
      let targetZ = p.z;
      const targetY = p.y + 0.27;

      if (p.moving && (p.speed || 0) > 0) {
        const spd = p.speed || 3.4;
        const fwd = p.forward ?? 1;
        const str = p.strafe ?? 0;
        const sinY = Math.sin(p.yaw || 0);
        const cosY = Math.cos(p.yaw || 0);
        const vx = (-sinY * fwd + cosY * str) * spd;
        const vz = (-cosY * fwd - sinY * str) * spd;
        targetX += vx * timeSince;
        targetZ += vz * timeSince;
      }

      const distSq =
        (remote.position.x - targetX) ** 2 +
        (remote.position.z - targetZ) ** 2;
      if (distSq > 36) {
        remote.position.set(targetX, targetY, targetZ);
        remote.rotation.y = p.yaw || 0;
      } else {
        const posFactor = 1 - Math.exp(-15 * dt);
        remote.position.x += (targetX - remote.position.x) * posFactor;
        remote.position.z += (targetZ - remote.position.z) * posFactor;
        remote.position.y +=
          (targetY - remote.position.y) * (1 - Math.exp(-18 * dt));

        let diffYaw = ((p.yaw || 0) - remote.rotation.y) % (Math.PI * 2);
        if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
        if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
        remote.rotation.y += diffYaw * (1 - Math.exp(-16 * dt));
      }
      animateAvatar(
        remote,
        {
          speed: p.speed ?? (p.moving ? 3.4 : 0),
          strafe: p.strafe || 0,
          forward: p.forward ?? 1,
          airborne: p.y > getGroundHeight(p.x, p.z, p.y) + 0.08,
          velocityY: 0,
          stance: p.stance,
          tool: p.tool || 'other',
          variant: p.variant,
          pitch: p.pitch || 0,
          working: p.working,
          crouching: p.crouching,
          aiming: p.aiming,
          reload: p.reload,
          hp: member.hp ?? 100,
        },
        dt,
        now / 1000,
      );
    }
    if (remoteAvatars.size !== liveRemoteIds.size)
      for (const [id, remote] of remoteAvatars)
        if (!liveRemoteIds.has(id)) retireRemote(id, remote);
  };
  const disposeRetired = () => {
    if (retiredAvatars.length) {
      retiredAvatars.forEach(disposeRemoteAvatar);
      retiredAvatars.length = 0;
    }
  };
  return {
    remoteAvatars,
    deadTimers,
    get remoteKey() {
      return remoteKey;
    },
    update,
    disposeRetired,
  };
}
