import { isBlocked3D } from '../lib/world-collision.ts';
import { stanceHeight } from '../lib/maps/types.ts';

/**
 * Whether a player can walk from `from` to `to` on `map` in `stance`, following the client's
 * movement rules (components/world.tsx): steps up to 0.55 m, falls down any height, never
 * enters a wall (body height by stance, so a low opening needs crouching). Like the client,
 * floor-slab ceilings do not stop walking — keep slabs above head height when building.
 * Jumps are not used, so a `true` here is conservative. Points are { x, z, y? } (y = 0).
 */
export function reachable(map, from, to, stance = 'stand', cell = 0.5) {
  const h = stanceHeight(stance);
  const b = map.bounds;
  const toY = to.y ?? 0;
  const key = (x, z, y) => `${Math.round(x / cell)},${Math.round(z / cell)},${Math.round(y * 10)}`;
  const start = { x: from.x, z: from.z, y: map.groundHeight(from.x, from.z, (from.y ?? 0) + 0.5) };
  const seen = new Set([key(start.x, start.z, start.y)]);
  const queue = [start];
  for (let i = 0; i < queue.length && queue.length < 400_000; i++) {
    const p = queue[i];
    if (Math.hypot(p.x - to.x, p.z - to.z) <= cell * 1.5 && Math.abs(p.y - toY) < 0.6) return true;
    for (const [dx, dz] of [[cell, 0], [-cell, 0], [0, cell], [0, -cell]]) {
      const x = p.x + dx,
        z = p.z + dz;
      if (x <= b.minX || x >= b.maxX || z <= b.minZ || z >= b.maxZ) continue;
      const ground = map.groundHeight(x, z, p.y);
      if (ground - p.y > 0.55) continue;
      if (isBlocked3D(x, z, Math.max(p.y, ground), 0.32, h, map.colliders)) continue;
      const k = key(x, z, ground);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ x, z, y: ground });
    }
  }
  return false;
}
