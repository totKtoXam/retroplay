import * as T from 'three';
// Relative paths with extensions: this module is also exercised straight from node in
// tests/world-player.test.mjs, which has no '@/' alias.
import type { Pose } from '../lib/model.ts';
import { isBlocked3D } from '../lib/world-collision.ts';
import { stanceHeight, type GameMap } from '../lib/maps/types.ts';
import { wrapAngle } from '../lib/game-camera.ts';
import { followCameraHeading } from './world-avatar.ts';

/**
 * The local player of the world engine: where the body is, how fast it falls,
 * which way it faces and which stance it holds — plus the one frame step that
 * moves it.
 *
 * All of this used to be a dozen `let`s inside the 2500-line engine effect in
 * world.tsx, written from key handlers and read from ~100 places. The pieces
 * only make sense together: a stance may change only where the body still
 * fits, gravity and the ground query must agree on the same feet height, and
 * depenetration has to run after every move — invariants that are easy to
 * break while editing unrelated code a thousand lines away. Gathering them in
 * one module makes the whole player a single reviewable unit and leaves
 * world.tsx with input, camera, weapons and HUD.
 *
 * Extracted verbatim from the engine effect in world.tsx: same formulas, same
 * constants, same order of operations.
 */
export function createWorldPlayer({
  map,
  keys,
  initial,
  isDead,
  onStance,
}: {
  map: GameMap;
  keys: Set<string>;
  /** The member's pose at the moment the engine starts. */
  initial?: Pose;
  isDead: () => boolean;
  /** React `setStance`: the HUD mirrors the stance, the engine owns it. */
  onStance: (stance: 'stand' | 'sit' | 'lie') => void;
}) {
  const pos = new T.Vector3(
    initial?.x ?? 0,
    initial?.y ?? 0,
    initial?.z ?? 15,
  );
  let cameraYaw = initial?.yaw || 0,
    heading = cameraYaw,
    pitch = 0.16,
    vy = 0,
    currentStance: 'stand' | 'sit' | 'lie' = initial?.stance || 'stand',
    lastC = -1000,
    crouchHeld = false,
    beforeCrouch: 'stand' | 'sit' | 'lie' = 'stand';
  let accumulated = 0;

  // Body height follows the stance, so crouching or lying fits through low openings.
  const blocked = (x: number, z: number, y = pos.y, stance = currentStance) =>
    isBlocked3D(x, z, y, 0.32, stanceHeight(stance), map.colliders);
  /** Whether there is room to take `stance` here (no standing up inside a crawl hole). */
  const canStand = (stance: 'stand' | 'sit' | 'lie') =>
    !blocked(pos.x, pos.z, pos.y, stance) &&
    pos.y + stanceHeight(stance) < map.ceilingHeight(pos.x, pos.z, pos.y) + 0.01;

  /** Space: only off solid ground, and only where standing up actually fits. */
  const jump = () => {
    if (isDead()) return;
    const groundYNow = map.groundHeight(pos.x, pos.z, pos.y);
    if (Math.abs(pos.y - groundYNow) <= 0.08 && canStand('stand')) {
      currentStance = 'stand';
      onStance('stand');
      vy = 5.7;
    }
  };
  /** KeyC: stand <-> sit, or lie when pressed twice inside the double-press window. */
  const toggleStance = (now: number) => {
    if (isDead() || crouchHeld) return;
    const nextStance =
      now - lastC < 360
        ? 'lie'
        : currentStance === 'stand'
          ? 'sit'
          : 'stand';
    if (canStand(nextStance)) currentStance = nextStance;
    lastC = now;
    onStance(currentStance);
  };
  /** KeyX down: crouch for as long as it is held, remembering what to return to. */
  const holdCrouch = () => {
    if (crouchHeld) return;
    beforeCrouch = currentStance;
    crouchHeld = true;
    currentStance = 'sit';
    onStance('sit');
  };
  /** KeyX up, or focus lost while it was down: return to the remembered stance if it fits. */
  const releaseCrouch = () => {
    if (!crouchHeld) return;
    if (canStand(beforeCrouch)) currentStance = beforeCrouch;
    crouchHeld = false;
    onStance(currentStance);
  };
  /** The server put us on a spawn point of the room's map. */
  const teleport = (x: number, y: number, z: number) => {
    pos.set(x, y, z);
    vy = 0;
    currentStance = 'stand';
    accumulated = 0;
    onStance('stand');
  };
  /** Correct the body without stealing mouse look or the player's held input. */
  const correctPosition = (pose: Pose) => {
    pos.set(pose.x, pose.y, pose.z);
    vy = 0;
    accumulated = 0;
    currentStance = pose.stance;
    onStance(currentStance);
  };

  /**
   * One frame of movement and physics. `control` is false while the pointer is
   * free, a dialog is open or we are dead. Returns what the caller still needs
   * for the avatar animation, the shadow and the pose it sends to the server.
   *
   * The camera turns only from the mouse and the arrow keys: the old
   * screen-edge turn kept rotating the view on its own whenever the pointer
   * happened to rest near the edge.
   */
  const update = (dt: number, input: { control: boolean; aimHeld: boolean }) => {
    let dx = 0,
      dz = 0;
    if (input.control) {
      dx = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      dz = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
      cameraYaw = wrapAngle(
        cameraYaw +
        (Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'))) *
        dt *
        1.5,
      );
      pitch = T.MathUtils.clamp(
        pitch +
        (Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'))) *
        dt *
        0.8,
        -1.35,
        1.4,
      );
    }
    cameraYaw = wrapAngle(cameraYaw);
    const moving = !!(dx || dz),
      slow = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed =
      currentStance === 'lie'
        ? 0.65
        : currentStance === 'sit'
          ? 1.5
          : slow
            ? 2
            : input.aimHeld
              ? 3
              : 4.8;
    if (moving) {
      const len = Math.hypot(dx, dz);
      dx /= len;
      dz /= len;
      const vx = dx * Math.cos(cameraYaw) + dz * Math.sin(cameraYaw),
        vz = -dx * Math.sin(cameraYaw) + dz * Math.cos(cameraYaw);
      const nx = T.MathUtils.clamp(pos.x + vx * speed * dt, -36, 36),
        nz = T.MathUtils.clamp(pos.z + vz * speed * dt, -36, 36);

      // Try X movement with step-up assist:
      const nextGroundX = map.groundHeight(nx, pos.z, pos.y);
      const stepDeltaX = nextGroundX - pos.y;
      if (
        stepDeltaX <= 0.55 &&
        !blocked(nx, pos.z, Math.max(pos.y, nextGroundX))
      ) {
        pos.x = nx;
        if (stepDeltaX > 0.01 && pos.y < nextGroundX) {
          pos.y = T.MathUtils.lerp(pos.y, nextGroundX, Math.min(1, 20 * dt));
        }
      }

      // Try Z movement with step-up assist:
      const nextGroundZ = map.groundHeight(pos.x, nz, pos.y);
      const stepDeltaZ = nextGroundZ - pos.y;
      if (
        stepDeltaZ <= 0.55 &&
        !blocked(pos.x, nz, Math.max(pos.y, nextGroundZ))
      ) {
        pos.z = nz;
        if (stepDeltaZ > 0.01 && pos.y < nextGroundZ) {
          pos.y = T.MathUtils.lerp(pos.y, nextGroundZ, Math.min(1, 20 * dt));
        }
      }
    }
    heading = wrapAngle(followCameraHeading(heading, cameraYaw, dt));

    // Dynamic ground height detection & gravity:
    const groundY = map.groundHeight(pos.x, pos.z, pos.y);
    vy -= 13 * dt;
    pos.y = pos.y + vy * dt;
    if (pos.y <= groundY) {
      pos.y = groundY;
      vy = 0;
    }
    // Ceiling collision to prevent head clipping through floors/roofs:
    const ceilY = map.ceilingHeight(pos.x, pos.z, pos.y);
    const bodyHeight = stanceHeight(currentStance);
    if (pos.y + bodyHeight >= ceilY) {
      pos.y = Math.max(groundY, ceilY - bodyHeight);
      if (vy > 0) vy = 0;
    }

    // Anti-stuck depenetration: guarantee player never gets stuck inside colliders
    const playerRadius = 0.32;
    const worldColliders = map.colliders;
    for (const c of worldColliders) {
      if (
        pos.x + playerRadius > c.minX &&
        pos.x - playerRadius < c.maxX &&
        pos.z + playerRadius > c.minZ &&
        pos.z - playerRadius < c.maxZ
      ) {
        const feetY = pos.y + 0.35;
        const headY = pos.y + stanceHeight(currentStance) - 0.05;
        if (headY > c.minY && feetY < c.maxY) {
          if (pos.y >= c.maxY - 0.55) {
            pos.y = c.maxY;
            if (vy < 0) vy = 0;
          } else {
            const overlapLeft = (pos.x + playerRadius) - c.minX;
            const overlapRight = c.maxX - (pos.x - playerRadius);
            const overlapBack = (pos.z + playerRadius) - c.minZ;
            const overlapFront = c.maxZ - (pos.z - playerRadius);
            const minOverlap = Math.min(overlapLeft, overlapRight, overlapBack, overlapFront);
            if (minOverlap === overlapLeft) pos.x = c.minX - playerRadius;
            else if (minOverlap === overlapRight) pos.x = c.maxX + playerRadius;
            else if (minOverlap === overlapBack) pos.z = c.minZ - playerRadius;
            else pos.z = c.maxZ + playerRadius;
          }
        }
      }
    }
    return { moving, speed, dx, dz, groundY };
  };

  // Simulate at 60 Hz regardless of render FPS. Bound catch-up after a suspended tab.
  let lastMotion = { moving: false, speed: 4.8, dx: 0, dz: 0, groundY: pos.y };
  const advance = (elapsed: number, input: { control: boolean; aimHeld: boolean }) => {
    const step = 1 / 60;
    if (!Number.isFinite(elapsed) || elapsed <= 0) return lastMotion;
    accumulated += Math.min(elapsed, 0.25);
    while (accumulated + 1e-9 >= step) {
      lastMotion = update(step, input);
      accumulated = Math.max(0, accumulated - step);
    }
    return lastMotion;
  };

  return {
    pos,
    get stance() {
      return currentStance;
    },
    get crouching() {
      return crouchHeld;
    },
    get heading() {
      return heading;
    },
    // Mouse look and the orbit/reset engine commands write the yaw; pitch is
    // written by mouse look too, so both stay read-write.
    get cameraYaw() {
      return cameraYaw;
    },
    set cameraYaw(value: number) {
      cameraYaw = value;
    },
    get pitch() {
      return pitch;
    },
    set pitch(value: number) {
      pitch = value;
    },
    get vy() {
      return vy;
    },
    blocked,
    canStand,
    jump,
    toggleStance,
    holdCrouch,
    releaseCrouch,
    teleport,
    correctPosition,
    update,
    advance,
  };
}
