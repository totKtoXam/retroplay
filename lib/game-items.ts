export const PAINTS = [
  ['coral', 'Коралл', '#ff647c'],
  ['amber', 'Янтарь', '#ffb851'],
  ['lemon', 'Лимон', '#f5e879'],
  ['mint', 'Мята', '#7fe0b8'],
  ['cyan', 'Бирюза', '#64d4ef'],
  ['blue', 'Ультрамарин', '#6482ff'],
  ['violet', 'Лаванда', '#bc91f5'],
  ['pink', 'Розовый', '#f49fd6'],
].map(([id, label, color]) => ({ id, label, color, icon: '●' }));
export const CONFETTI = [
  ['classic', 'Классика', '▰', '#ffb851'],
  ['stars', 'Звёздочки', '★', '#f5e879'],
  ['snow', 'Снежки', '❄', '#c5eaff'],
  ['hearts', 'Сердечки', '♥', '#ff647c'],
  ['digital', 'Цифровое', '01', '#7fe0b8'],
  ['petals', 'Лепестки', '✿', '#f49fd6'],
  ['comets', 'Кометы', '✦', '#bc91f5'],
  ['shanyrak', 'Шаңырақ', '☀', '#ffcb65'],
].map(([id, label, icon, color]) => ({ id, label, icon, color }));
export const GRENADES = [
  ['pinata', 'Пиньята', '🪅', '#f49fd6'],
  ['paintburst', 'Взрыв красок', '◉', '#64d4ef'],
  ['snowglobe', 'Снежный шар', '❄', '#c5eaff'],
  ['heartburst', 'Валентинка', '♥', '#ff647c'],
  ['pixel', 'Пиксельная', '▦', '#7fe0b8'],
  ['meteor', 'Метеор', '✦', '#ffb851'],
].map(([id, label, icon, color]) => ({ id, label, icon, color }));
export const FIREWORKS = [
  ['salute', 'Салют', '✨', '#ffcb65'],
  ['sparkler', 'Искры', '✦', '#64d4ef'],
  ['dragon', 'Дракон', '🐉', '#ff647c'],
  ['comet', 'Комета', '☄️', '#bc91f5'],
  ['aurora', 'Аврора', '🌌', '#7fe0b8'],
  ['solar', 'Солнце', '☀️', '#f5e879'],
  ['galaxy', 'Галактика', '🪐', '#ff84c8'],
  ['flower', 'Хризантема', '🌸', '#f49fd6'],
].map(([id, label, icon, color]) => ({ id, label, icon, color }));
export type WheelItem = {
  id: string;
  label: string;
  color: string;
  icon: string;
};
export const effectStyle = (kind: string, value: unknown) => {
  if (kind === 'like') return 'hearts';
  if (kind === 'sniper')
    return FIREWORKS.find((v) => v.id === value)?.id || 'salute';
  if (kind === 'grenade')
    return GRENADES.find((v) => v.id === value)?.id || 'pinata';
  return CONFETTI.find((v) => v.id === value)?.id || 'classic';
};
export const effectCooldown = (kind: string) =>
  kind === 'grenade' ? 1200 : kind === 'sniper' ? 1100 : kind === 'confetti' ? 650 : kind === 'like' ? 350 : 90;
export const effectDamage = (kind: string, distance?: number) => {
  if (kind === 'like') return 0;
  if (kind === 'grenade') return 45;
  if (kind === 'sniper') return 75;
  if (kind === 'paint') return 20;
  if (kind === 'confetti') {
    if (distance !== undefined) {
      if (distance < 4.5) return 56;
      if (distance < 9) return 35;
      return 14;
    }
    return 42;
  }
  return 20;
};
/** Shortest distance from a 3D point to a 3D line segment [a, b]. */
export function pointToSegmentDist(
  p: number[],
  a: number[],
  b: number[],
): number {
  const abx = b[0] - a[0],
    aby = b[1] - a[1],
    abz = b[2] - a[2];
  const apx = p[0] - a[0],
    apy = p[1] - a[1],
    apz = p[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  const t =
    len2 > 1e-8
      ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / len2))
      : 0;
  return Math.hypot(
    p[0] - (a[0] + t * abx),
    p[1] - (a[1] + t * aby),
    p[2] - (a[2] + t * abz),
  );
}

/** Shortest distance between two 3D line segments [p1, p2] and [q1, q2]. */
export function segmentSegmentDist(
  p1: number[],
  p2: number[],
  q1: number[],
  q2: number[],
): number {
  const ux = p2[0] - p1[0],
    uy = p2[1] - p1[1],
    uz = p2[2] - p1[2];
  const vx = q2[0] - q1[0],
    vy = q2[1] - q1[1],
    vz = q2[2] - q1[2];
  const wx = p1[0] - q1[0],
    wy = p1[1] - q1[1],
    wz = p1[2] - q1[2];

  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const denom = a * c - b * b;

  let sN: number,
    sD = denom;
  let tN: number,
    tD = denom;

  if (denom < 1e-7) {
    sN = 0.0;
    sD = 1.0;
    tN = e;
    tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0.0) {
      sN = 0.0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }

  if (tN < 0.0) {
    tN = 0.0;
    if (-d < 0.0) sN = 0.0;
    else if (-d > a) sN = sD;
    else {
      sN = -d;
      sD = a;
    }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0.0) sN = 0.0;
    else if (-d + b > a) sN = sD;
    else {
      sN = -d + b;
      sD = a;
    }
  }

  const sc = Math.abs(sN) < 1e-7 ? 0.0 : sN / sD;
  const tc = Math.abs(tN) < 1e-7 ? 0.0 : tN / tD;

  const dpx = wx + sc * ux - tc * vx;
  const dpy = wy + sc * uy - tc * vy;
  const dpz = wz + sc * uz - tc * vz;

  return Math.hypot(dpx, dpy, dpz);
}

/** Check if projectile ray passed close enough to hit player body or head. */
export function inHitRange(
  kind: string,
  origin: number[],
  target: number[],
  pose: { x: number; y: number; z: number; yaw?: number; stance: string },
): boolean {
  if (kind === 'grenade') {
    const center = [
      pose.x,
      pose.y + (pose.stance === 'lie' ? 0.35 : pose.stance === 'sit' ? 0.8 : 1.1),
      pose.z,
    ];
    return Math.hypot(...center.map((v, i) => v - target[i])) < 4.2;
  }

  const yaw = pose.yaw || 0;
  let spineBottom: number[];
  let spineTop: number[];
  let hitRadius = 0.46;

  if (pose.stance === 'lie') {
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    spineBottom = [pose.x, pose.y + 0.25, pose.z];
    spineTop = [pose.x - sinY * 1.6, pose.y + 0.25, pose.z - cosY * 1.6];
    hitRadius = 0.42;
  } else if (pose.stance === 'sit') {
    spineBottom = [pose.x, pose.y + 0.2, pose.z];
    spineTop = [pose.x, pose.y + 1.7, pose.z];
    hitRadius = 0.48;
  } else {
    // Stand
    spineBottom = [pose.x, pose.y + 0.2, pose.z];
    spineTop = [pose.x, pose.y + 2.1, pose.z];
    hitRadius = 0.46;
  }

  return segmentSegmentDist(origin, target, spineBottom, spineTop) < hitRadius;
}

/** Check if projectile ray hit the player head (headshot). */
export function isHeadshot(
  kind: string,
  origin: number[],
  target: number[],
  pose: { x: number; y: number; z: number; yaw?: number; stance: string },
): boolean {
  if (kind === 'grenade') return false;

  const yaw = pose.yaw || 0;
  let headCenter: number[];

  if (pose.stance === 'lie') {
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    headCenter = [
      pose.x - sinY * 1.55,
      pose.y + 0.36,
      pose.z - cosY * 1.55,
    ];
  } else if (pose.stance === 'sit') {
    headCenter = [pose.x, pose.y + 1.67, pose.z];
  } else {
    // Standing: avatar root (0.27) + chest (1.02) + head pivot (0.66) + face center (0.12) = 2.07
    headCenter = [pose.x, pose.y + 2.07, pose.z];
  }

  // Head sphere radius in avatar model is 0.245 (plus hair/cap ~0.26).
  // Hitbox radius 0.27 ensures hits are strictly on the head, never on the chest (which is at Y ~ 1.52).
  const dist = pointToSegmentDist(headCenter, origin, target);
  return dist < 0.27;
}
