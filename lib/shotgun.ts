import { hitZone, inHitRange, type HitZone } from './game-items.ts';
import { rayCastWorldObstacle, type BoxCollider3D } from './world-collision.ts';

/**
 * Дробовик конфетти. Залп — восемь дробин, каждая летит своим лучом в конусе
 * вокруг прицела и ранит сама по себе: сколько дробин попало и куда — столько
 * и урона. Рисунок разлёта задаёт id выстрела, поэтому сервер и все клиенты
 * видят одни и те же дробины, а от выстрела к выстрелу рисунок разный.
 */

export const SHOTGUN_PELLETS = 8;
/** Дальше дробь не летит, м. */
export const SHOTGUN_RANGE = 28;
/** Полуугол конуса разлёта, рад (~5.2°): на 10 м дробь ложится в круг радиусом 0.9 м. */
export const SHOTGUN_SPREAD = 0.09;
/** Урон одной дробины по зонам вблизи. Восемь в корпус — 112, гарантированное убийство. */
export const PELLET_DAMAGE: Record<HitZone, number> = { head: 25, torso: 14, limb: 9 };
/** До этой дистанции дробь бьёт в полную силу, дальше слабеет до половины к SHOTGUN_RANGE. */
const FULL_DAMAGE_RANGE = 8;

type Pose = { x: number; y: number; z: number; yaw?: number; stance: string };
type Vec3 = [number, number, number];

/** Детерминированный генератор (mulberry32) из строки id. */
function random(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Концы лучей дробин на SHOTGUN_RANGE от ствола. Узор — «подсолнух» со
 * случайным поворотом и дрожанием: дробины покрывают круг равномерно и не
 * слипаются, а одна всегда идёт почти в центр прицела.
 */
export function pelletEnds(origin: number[], target: number[], id: string): Vec3[] {
  let dx = target[0] - origin[0],
    dy = target[1] - origin[1],
    dz = target[2] - origin[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  // Базис плоскости, поперечной выстрелу: «вправо» горизонтально, «вверх» — третий.
  let rx = -dz,
    rz = dx;
  const rLen = Math.hypot(rx, rz);
  if (rLen < 1e-4) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rLen;
    rz /= rLen;
  }
  const ux = -dy * rz,
    uy = rz * dx - rx * dz,
    uz = dy * rx;
  const rnd = random(id);
  const turn = rnd() * Math.PI * 2;
  const ends: Vec3[] = [];
  for (let i = 0; i < SHOTGUN_PELLETS; i++) {
    // Доля радиуса: i-я дробина — в своём кольце равной площади.
    const r = Math.sqrt((i + 0.15 + rnd() * 0.7) / SHOTGUN_PELLETS) * Math.tan(SHOTGUN_SPREAD);
    const a = turn + i * 2.39996 + (rnd() - 0.5) * 0.6;
    const ox = Math.cos(a) * r,
      oy = Math.sin(a) * r;
    const ex = dx + rx * ox + ux * oy,
      ey = dy + uy * oy,
      ez = dz + rz * ox + uz * oy;
    const k = SHOTGUN_RANGE / Math.hypot(ex, ey, ez);
    ends.push([origin[0] + ex * k, origin[1] + ey * k, origin[2] + ez * k]);
  }
  return ends;
}

/** Урон одной дробины: по зоне и с ослаблением на дальности. */
export function pelletDamage(zone: HitZone, distance: number) {
  const fade = Math.max(0, Math.min(1, (distance - FULL_DAMAGE_RANGE) / (SHOTGUN_RANGE - FULL_DAMAGE_RANGE)));
  return Math.round(PELLET_DAMAGE[zone] * (1 - fade * 0.5));
}

export type Pellet = {
  /** Куда дробина долетела: в тело, в стену или на предел дальности. */
  end: Vec3;
  hit?: { victim: string; zone: HitZone; damage: number };
};

export type VolleyHits = Map<string, { pellets: number; damage: number; head: boolean }>;

/**
 * Залп целиком: куда легла каждая дробина и сколько досталось каждому.
 * Дробина ранит только первого на своём пути и не проходит сквозь стены.
 */
export function shotgunVolley(
  origin: number[],
  target: number[],
  id: string,
  victims: Iterable<{ id: string; pose: Pose }>,
  colliders?: BoxCollider3D[],
): { pellets: Pellet[]; hits: VolleyHits } {
  const list = [...victims];
  const hits: VolleyHits = new Map();
  const pellets = pelletEnds(origin, target, id).map((end): Pellet => {
    let best: { victim: string; pose: Pose; distance: number } | undefined;
    for (const v of list) {
      if (!inHitRange('confetti', origin, end, v.pose, colliders)) continue;
      const distance = Math.hypot(v.pose.x - origin[0], v.pose.z - origin[2]);
      if (!best || distance < best.distance) best = { victim: v.id, pose: v.pose, distance };
    }
    if (!best) {
      const wall = rayCastWorldObstacle(origin, end, colliders);
      return { end: wall ? wall.point : end };
    }
    const zone = hitZone(origin, end, best.pose);
    const damage = pelletDamage(zone, best.distance);
    const sum = hits.get(best.victim) ?? { pellets: 0, damage: 0, head: false };
    sum.pellets += 1;
    sum.damage += damage;
    sum.head ||= zone === 'head';
    hits.set(best.victim, sum);
    // Дробина гаснет в теле: на дистанции до цели вдоль своего луча.
    const k = Math.min(1, best.distance / SHOTGUN_RANGE);
    return {
      end: [origin[0] + (end[0] - origin[0]) * k, origin[1] + (end[1] - origin[1]) * k, origin[2] + (end[2] - origin[2]) * k],
      hit: { victim: best.victim, zone, damage },
    };
  });
  return { pellets, hits };
}
