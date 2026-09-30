import * as T from 'three';
import { GAME_TOOLS, uid, type Room, type WorldEffect } from '@/lib/model';
import { CONFETTI, FIREWORKS, GRENADES, SHOTGUN_PELLET_OFFSETS } from '@/lib/game-items';
import { MELEE, meleeStats } from '@/lib/melee';
import { aimedSpread, recoilKick, spreadScale, type Handling, type ViewRecoil } from '@/lib/weapon-recoil';
import { blocksProjectile, eyeHeight, type Perspective } from '@/lib/game-camera';
import { rayCastWorldObstacle } from '@/lib/world-collision';
import { openShare, type RoofMap } from '@/lib/weather-shelter';
import { windDrift, WIND_DRIFT } from '@/lib/weather';
import { GRENADE_COOLDOWN_MS, isBlaster } from '@/lib/weapon-definition';
import type { Blaster } from '@/lib/tool-magazine';
import type { WeaponPrediction } from '@/lib/weapon-prediction';
import type { WeaponCommand, WeaponReply } from '@/lib/weapon-protocol';
import type { GameMap } from '@/lib/maps/types';
import type { WorldKit } from './world-map-scene';
import { avatarShoot } from './world-avatar';
import type { createFirstPersonHands } from './world-hands';
import type { createWorldPlayer } from './world-player';
import type { createWorldProjectiles } from './world-projectiles';
import type { createWorldVfx } from './world-vfx';
import type { createWorldWeather } from './world-weather';
import type { createWeaponSounds } from './world-weapon-sounds';
import type { PersonalAlert } from './use-kill-feed';

type Projectiles = ReturnType<typeof createWorldProjectiles>;
type Vfx = ReturnType<typeof createWorldVfx>;

/**
 * Оружие своего игрока: выстрел, удар ближнего боя, перезарядка и сверка
 * магазина с сервером (предсказание — lib/weapon-prediction.ts).
 *
 * Вынесено из движка мира в world.tsx дословно: те же формулы и тот же
 * порядок. Флаги, которые делят ввод, кадр и оружие (`aimHeld`, `middle`,
 * `softLook`, очередь выстрелов, время последней гранаты…), остаются
 * переменными движка — сюда они приходят объектом `state` с геттерами и
 * сеттерами на те же переменные.
 */
export function createWorldWeapons({
  latest,
  selection,
  magazine,
  prediction,
  perspectiveRef,
  immuneExpireRef,
  state,
  disposed,
  isDead,
  setRounds,
  setReloading,
  setReloadHint,
  setGrenadeReadyAt,
  setAiming,
  setCaptureError,
  setPersonalAlert,
  weaponSounds,
  weaponVolume,
  scene,
  camera,
  ray,
  mouse,
  map,
  roof,
  weather,
  windOn,
  kit,
  avatar,
  hands,
  pos,
  player,
  projectiles,
  flights,
  spawn,
  burst,
  paintDropletGeo,
  viewRecoil,
  sceneryTargets,
  gatherRemoteAvatarMeshes,
}: {
  latest: {
    readonly current: {
      room: Room;
      tool: number;
      blocked: boolean;
      paintColor: string;
      onFire: (effect: WorldEffect) => Promise<WeaponReply>;
      onWeapon: (command: WeaponCommand) => Promise<WeaponReply>;
      onOp?: (op: Record<string, unknown>) => Promise<unknown>;
    };
  };
  /** Выбранные варианты предметов (колесо СКМ). */
  selection: {
    readonly current: { confettiStyle: string; grenadeStyle: string; fireworkStyle: string; meleeStyle: string };
  };
  magazine: { readonly current: WeaponPrediction['magazine'] };
  prediction: { readonly current: WeaponPrediction };
  perspectiveRef: { readonly current: Perspective };
  /** До какого `performance.now()` игрок неуязвим — и сам не стреляет. */
  immuneExpireRef: { readonly current: number };
  /** Общие с вводом и кадром переменные движка (геттеры и сеттеры). */
  state: {
    readonly middle: boolean;
    readonly softLook: boolean;
    aimHeld: boolean;
    continuousShots: number;
    readonly lastMoving: boolean;
    readonly lastAirborne: boolean;
    lastGrenade: number;
  };
  /** Движок разобран: ответы сервера, пришедшие после, уже некуда показывать. */
  disposed: () => boolean;
  isDead: () => boolean;
  setRounds: (rounds: Record<Blaster, number>) => void;
  setReloading: (reloading: boolean) => void;
  setReloadHint: (at: number) => void;
  setGrenadeReadyAt: (at: number) => void;
  setAiming: (aiming: boolean) => void;
  setCaptureError: (error: string) => void;
  setPersonalAlert: (alert: PersonalAlert) => void;
  weaponSounds: ReturnType<typeof createWeaponSounds>;
  weaponVolume: () => number;
  scene: T.Scene;
  camera: T.Camera;
  /** Общий луч движка: им же целится граната. */
  ray: T.Raycaster;
  /** Курсор в координатах экрана −1…1: им целятся, пока мышь не захвачена. */
  mouse: T.Vector2;
  map: GameMap;
  /** Карта крыш: под перекрытием ветер снаряд не сносит. */
  roof: RoofMap;
  weather: ReturnType<typeof createWorldWeather>;
  windOn: () => boolean;
  kit: WorldKit;
  avatar: T.Group;
  hands: ReturnType<typeof createFirstPersonHands>;
  pos: T.Vector3;
  player: ReturnType<typeof createWorldPlayer>;
  projectiles: Projectiles;
  flights: Projectiles['flights'];
  spawn: Projectiles['spawn'];
  burst: Vfx['burst'];
  paintDropletGeo: Vfx['paintDropletGeo'];
  viewRecoil: ViewRecoil;
  /** Кэш статичных мешей сцены. Движок его пересобирает — поэтому геттер. */
  sceneryTargets: () => readonly T.Mesh[];
  gatherRemoteAvatarMeshes: () => T.Mesh[];
}) {
  let lastReportedRounds = { ...magazine.current.rounds };
  let lastReportedReloading = magazine.current.reloading;
  const updateAmmo = () => {
    const rounds = magazine.current.rounds;
    if (
      rounds.paint !== lastReportedRounds.paint ||
      rounds.confetti !== lastReportedRounds.confetti ||
      rounds.sniper !== lastReportedRounds.sniper ||
      rounds.like !== lastReportedRounds.like
    ) {
      lastReportedRounds = { ...rounds };
      setRounds(lastReportedRounds);
    }
    if (magazine.current.reloading !== lastReportedReloading) {
      lastReportedReloading = magazine.current.reloading;
      setReloading(lastReportedReloading);
    }
  };
  const applyWeaponReply = (reply: WeaponReply) => {
    if (disposed()) return;
    prediction.current.acknowledge(reply, performance.now());
    updateAmmo();
  };
  const weaponFailure = (id: string, error: unknown) => {
    prediction.current.forget(id);
    if (!disposed()) setCaptureError(error instanceof Error ? error.message : 'Действие не подтверждено');
  };
  const sendWeaponControl = (action: WeaponCommand['action'], tool?: Blaster) => {
    const id = uid();
    prediction.current.remember(id, action, tool, performance.now());
    const life = latest.current.room.members.find((m) => m.id === latest.current.room.self)?.life ?? 0;
    void latest.current.onWeapon({ id, action, tool, life }).then(applyWeaponReply).catch((error) => weaponFailure(id, error));
  };
  prediction.current.reset(latest.current.room.members.find((m) => m.id === latest.current.room.self)?.life ?? 0);
  sendWeaponControl('sync');
  const beginReload = () => {
    const tool = GAME_TOOLS[latest.current.tool]?.id;
    if (
      tool === 'paint' ||
      tool === 'confetti' ||
      tool === 'sniper' ||
      tool === 'like'
    ) {
      magazine.current.reload(tool as Blaster, performance.now());
      sendWeaponControl('reload', tool as Blaster);
      state.aimHeld = false;
      setAiming(false);
      updateAmmo();
    }
  };
  let lastDryFire = -Infinity;
  /**
   * Спуск нажат, а стрелять нечем — идёт перезарядка (или новую гранату ещё
   * достают): сухой щелчок и «Перезарядка» посреди экрана. Краскомёт при
   * зажатой кнопке зовёт это каждый кадр, поэтому не чаще раза в 400 мс.
   */
  const reloadingFeedback = () => {
    const now = performance.now();
    if (now - lastDryFire < 400) return;
    lastDryFire = now;
    weaponSounds.dry(weaponVolume());
    setReloadHint(Date.now());
  };
  const isImmune = () => {
    return immuneExpireRef.current > performance.now();
  };
  /** Откуда вылетает снаряд: из ствола в первом лице, от плеча — в третьем. */
  const weaponOrigin = (tool: string) =>
    perspectiveRef.current === 'first'
      ? hands.muzzle(tool)
      : pos
          .clone()
          .add(
            new T.Vector3(
              Math.cos(player.cameraYaw) * 0.38,
              player.stance === 'lie' ? 0.5 : player.stance === 'sit' ? 1.05 : 1.5,
              -Math.sin(player.cameraYaw) * 0.38,
            ),
          );
  let lastSwing = -Infinity;
  /**
   * Удар ближнего боя: от глаз туда, куда смотрит прицел, на длину руки с
   * оружием; упёрлись в стену ближе — удар по стене. Через прицел, а не по
   * повороту головы, чтобы и в третьем лице бить туда, где перекрестие.
   */
  const swing = () => {
    const p = latest.current;
    const variant = selection.current.meleeStyle;
    const stats = meleeStats(variant);
    const now = performance.now();
    if (now - lastSwing < stats.cooldown) return;
    lastSwing = now;
    const eye = new T.Vector3(pos.x, pos.y + eyeHeight(player.stance), pos.z);
    ray.setFromCamera(new T.Vector2(0, 0), camera);
    const dir = ray.ray.at(30, new T.Vector3()).sub(eye).normalize();
    const reachEnd = eye.clone().addScaledVector(dir, stats.reach);
    const wall = rayCastWorldObstacle(eye.toArray(), reachEnd.toArray(), map.colliders);
    const target = wall ? new T.Vector3(...wall.point) : reachEnd;
    const e: WorldEffect = {
      id: uid(),
      kind: 'melee',
      origin: eye.toArray(),
      target: target.toArray(),
      normal: dir.clone().negate().toArray(),
      color: MELEE.find((m) => m.id === variant)?.color ?? '#ff84c8',
      variant,
      author: p.room.self,
      at: Date.now(),
    };
    spawn(e);
    avatarShoot(avatar);
    hands.swing(variant);
    prediction.current.remember(e.id, 'fire', undefined, now);
    void p.onFire(e).then((reply) => {
      applyWeaponReply(reply);
      if (!reply.ok && !disposed()) setCaptureError('Удар не принят: ' + (reply.reason ?? 'состояние комнаты'));
    }).catch((error) => weaponFailure(e.id, error));
  };
  const shoot = () => {
    if (latest.current.room.match?.phase === 'freeze') return;
    const p = latest.current;
    if (p.blocked || state.middle || isDead() || isImmune() || p.room.state.archived)
      return;
    const tool = GAME_TOOLS[p.tool]?.id;
    if (tool === 'melee') return swing();
    if (
      tool !== 'paint' &&
      tool !== 'confetti' &&
      tool !== 'grenade' &&
      tool !== 'sniper' &&
      tool !== 'like'
    )
      return;
    const now = performance.now();
    const wasReloading = magazine.current.reloading;
    if (tool === 'grenade') {
      if (now - state.lastGrenade < GRENADE_COOLDOWN_MS) {
        reloadingFeedback();
        return;
      }
      state.lastGrenade = now;
      setGrenadeReadyAt(now + GRENADE_COOLDOWN_MS);
    }
    if (
      tool !== 'grenade' &&
      !magazine.current.fire(tool as Blaster, now)
    ) {
      if (magazine.current.reloading) {
        setReloading(true);
        if (!wasReloading) sendWeaponControl('reload', tool as Blaster);
        reloadingFeedback();
      }
      if (tool === 'sniper') {
        state.aimHeld = false;
        setAiming(false);
      }
      return;
    }
    updateAmmo();

    if (tool === 'sniper' && magazine.current.rounds.sniper === 0) {
      state.aimHeld = false;
      setAiming(false);
    }

    const screenCoord = (
      document.pointerLockElement || state.softLook
        ? new T.Vector2(0, 0)
        : mouse.clone()
    );
    const handling: Handling = {
      moving: state.lastMoving,
      airborne: state.lastAirborne,
      stance: player.stance,
      aiming: !!state.aimHeld,
    };
    // Номер выстрела в очереди: по нему идёт рисунок отдачи и растёт разброс.
    const shotIndex = tool === 'paint' ? state.continuousShots++ : (state.continuousShots = 0);
    // Снайперка от бедра никогда не бьёт точно в центр: промах — хотя бы на треть разброса.
    const noScope = tool === 'sniper' && !state.aimHeld;
    const spread = state.aimHeld
      ? aimedSpread(tool, handling)
      : tool === 'paint'
        ? Math.min(0.048, 0.016 + shotIndex * 0.0032) * spreadScale(handling)
        : noScope
          ? 0.2 * spreadScale(handling)
          : 0;
    if (spread > 0) {
      const ang = Math.random() * Math.PI * 2;
      const mag = (noScope ? 0.35 + Math.random() * 0.65 : Math.sqrt(Math.random())) * spread;
      screenCoord.add(new T.Vector2(Math.cos(ang) * mag, Math.sin(ang) * mag));
    }

    ray.setFromCamera(screenCoord, camera);
    const targets: T.Mesh[] = [];
    for (const o of sceneryTargets()) if (blocksProjectile(o)) targets.push(o);
    for (const o of gatherRemoteAvatarMeshes())
      if (blocksProjectile(o)) targets.push(o);
    const maxDistance = tool === 'sniper' ? 75 : 65;
    // Ветер сносит снаряд: сначала узнаём, как далеко цель по прицелу, затем
    // поворачиваем луч к точке, смещённой ветром на этой дистанции. Сервер
    // проверяет попадание по отрезку до `target`, поэтому снос у всех один.
    if (windOn() && WIND_DRIFT[tool]) {
      const aimed = ray
        .intersectObjects(targets, false)
        .find(
          (h) =>
            h.distance < maxDistance &&
            h.distance > 0.08 &&
            blocksProjectile(h.object, h.face?.materialIndex),
        );
      const distance = aimed ? aimed.distance : tool === 'sniper' ? 65 : 35;
      const aimPoint = ray.ray.at(distance, new T.Vector3());
      // Сносит только на открытой части пути: из дома через окно — лишь снаружи.
      const share = openShare(roof, ray.ray.origin.toArray(), aimPoint.toArray());
      const drift = windDrift(tool, weather.wind, distance);
      aimPoint.x += drift.x * share;
      aimPoint.z += drift.z * share;
      ray.ray.direction.copy(aimPoint.sub(ray.ray.origin).normalize());
    }
    const hit = ray
      .intersectObjects(targets, false)
      .find(
        (h) =>
          h.distance < maxDistance &&
          h.distance > 0.08 &&
          blocksProjectile(h.object, h.face?.materialIndex),
      );
    const target = hit
      ? hit.point
      : ray.ray.at(tool === 'sniper' ? 65 : 35, new T.Vector3());
    const normal = hit?.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new T.Vector3(0, 1, 0);
    const origin = weaponOrigin(tool);
    // Ствол не должен стрелять через препятствие, находящееся ближе центра прицела.
    const muzzleRay = new T.Raycaster(
      camera.position,
      origin.clone().sub(camera.position).normalize(),
      0,
      camera.position.distanceTo(origin),
    );
    const obstruction = muzzleRay
      .intersectObjects(targets, false)
      .find((h) => blocksProjectile(h.object, h.face?.materialIndex));
    if (obstruction) {
      target.copy(obstruction.point);
      origin.copy(camera.position);
      if (obstruction.face)
        normal
          .copy(obstruction.face.normal)
          .transformDirection(obstruction.object.matrixWorld);
    }
    if (tool === 'like') {
      const boardHits = ray.intersectObjects(
        kit.boards.map((b) => b.panel),
        false,
      );
      const boardHit = boardHits.find(
        (h) => h.distance < 75 && h.distance > 0.08,
      );
      if (boardHit && boardHit.uv) {
        const zoneId = (boardHit.object.userData as { zone?: string })?.zone;
        const notes = p.room.state.notes.filter(
          (n) =>
            n.zone === zoneId &&
            !['draw', 'connector', 'frame'].includes(n.kind),
        );
        const cx = boardHit.uv.x * 1024;
        const cy = (1 - boardHit.uv.y) * 512;
        if (cx >= 25 && cx <= 1025 && cy >= 126 && cy <= 494) {
          const col = Math.floor((cx - 25) / 250);
          const row = Math.floor((cy - 126) / 184);
          if (col >= 0 && col < 4 && row >= 0 && row < 2) {
            const noteIdx = col + row * 4;
            const targetNote = notes.slice(0, 8)[noteIdx];
            if (targetNote) {
              void p.onOp?.({ type: 'vote', id: targetNote.id, force: true });
              setPersonalAlert({
                text: '+1 ГОЛОС',
                sub: targetNote.text
                  ? `"${targetNote.text.slice(0, 30)}"`
                  : 'Стикер',
                type: 'assist',
                key: Date.now(),
              });
              burst(boardHit.point, '#ff647c', now, 'hearts');
            }
          }
        }
      }
    }
    const color =
      tool === 'like'
        ? '#ff647c'
        : tool === 'grenade'
          ? GRENADES.find((g) => g.id === selection.current.grenadeStyle)!.color
          : tool === 'confetti'
            ? CONFETTI.find((c) => c.id === selection.current.confettiStyle)!.color
            : tool === 'sniper'
              ? FIREWORKS.find((f) => f.id === selection.current.fireworkStyle)!.color
              : p.paintColor;
    const variant =
      tool === 'like'
        ? 'hearts'
        : tool === 'grenade'
          ? selection.current.grenadeStyle
          : tool === 'confetti'
            ? selection.current.confettiStyle
            : tool === 'sniper'
              ? selection.current.fireworkStyle
              : 'classic';
    const isScoped = tool === 'sniper' ? !!state.aimHeld : undefined;
    const isNoScope = tool === 'sniper' ? !state.aimHeld : undefined;
    const e: WorldEffect = {
      id: uid(),
      kind: tool,
      origin: origin.toArray(),
      target: target.toArray(),
      normal: normal.toArray(),
      color,
      variant,
      author: p.room.self,
      at: Date.now(),
      scoped: isScoped,
      noScope: isNoScope,
    };
    spawn(e);
    if (tool === 'confetti') {
      const dir = target.clone().sub(origin).normalize();
      const perpX = new T.Vector3()
        .crossVectors(dir, new T.Vector3(0, 1, 0))
        .normalize();
      if (perpX.lengthSq() < 0.01) perpX.set(1, 0, 0);
      const perpY = new T.Vector3().crossVectors(perpX, dir).normalize();
      const dist = origin.distanceTo(target);

      const coneHalfAngle = 0.082;
      for (let s = 0; s < 8; s++) {
        const [ang, rFrac] = SHOTGUN_PELLET_OFFSETS[s];
        const spreadRadius = Math.tan(coneHalfAngle) * rFrac;
        const spreadDir = dir
          .clone()
          .addScaledVector(perpX, Math.cos(ang) * spreadRadius)
          .addScaledVector(perpY, Math.sin(ang) * spreadRadius)
          .normalize();
        const pelletTarget = origin.clone().addScaledVector(spreadDir, dist);
        const pelletBall = projectiles.ball(color, paintDropletGeo);
        pelletBall.position.copy(origin);
        pelletBall.userData.transientProjectile = true;
        scene.add(pelletBall);
        flights.push({
          mesh: pelletBall,
          origin: origin.clone(),
          target: pelletTarget,
          normal: normal.clone(),
          born: performance.now(),
          duration: Math.max(65, dist * 16),
          variant,
          color,
          kind: 'confetti',
          author: p.room.self,
        });
      }
    }
    avatarShoot(avatar);
    hands.shoot(tool);
    viewRecoil.kick(recoilKick(tool, shotIndex, handling));
    prediction.current.remember(e.id, 'fire', isBlaster(tool) ? tool : undefined, now);
    void p.onFire(e).then((reply) => {
      applyWeaponReply(reply);
      if (!reply.ok && !disposed()) setCaptureError('Выстрел не принят: ' + (reply.reason ?? 'состояние комнаты'));
    }).catch((error) => weaponFailure(e.id, error));
    if (tool === 'sniper' && magazine.current.rounds.sniper === 0) beginReload();
  };
  return { updateAmmo, sendWeaponControl, beginReload, reloadingFeedback, weaponOrigin, shoot };
}
