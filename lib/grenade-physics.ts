import type { BoxCollider3D } from './world-collision.ts';
import { GRENADE_FUSE_MS } from './weapon-definition.ts';

/**
 * Полёт гранаты: бросок с постоянной скоростью по линии прицела, гравитация,
 * отскоки от стен, пола и потолка, качение с трением. Одна и та же симуляция
 * идёт на сервере (где рванёт — там и урон) и у клиентов (что рисовать), поэтому
 * в сеть уходит только прицел `origin → target`, а не путь.
 *
 * Считается фиксированным шагом и только сложением, умножением и `Math.sqrt`:
 * они в IEEE 754 дают один результат во всех движках, так что сервер и браузеры
 * получают одну и ту же точку взрыва.
 */

type Vec3 = [number, number, number];

/** Что граната видит в мире: стены и мебель, пол под ней и потолок над ней. */
export type GrenadeWorld = {
  colliders: BoxCollider3D[];
  groundHeight: (x: number, z: number, y?: number) => number;
  ceilingHeight?: (x: number, z: number, y?: number) => number;
};

export type GrenadeFlight = {
  /** Положение через каждые `SAMPLE_MS` от броска, последнее — в миг взрыва. */
  path: Vec3[];
  /** Точка взрыва. */
  end: Vec3;
  /** Когда граната ударилась обо что-то заметно (мс от броска), для звука. */
  bounces: number[];
};

/** Скорость броска, м/с: около 23 м навесом на ровном месте. */
export const GRENADE_SPEED = 15;
/** Ускорение свободного падения, м/с². */
export const GRENADE_GRAVITY = 9.81;
/** Бросок чуть выше перекрестия, как рукой: иначе граната падает под прицел. */
const LIFT = 0.12;
const RADIUS = 0.08;
/** Доля скорости по нормали, что остаётся после удара. */
const RESTITUTION = 0.35;
/** Доля скорости вдоль поверхности, что остаётся после удара. */
const BOUNCE_FRICTION = 0.55;
/** Торможение при качении по полу, м/с². */
const ROLL_DECEL = 9;
/** Медленнее этого по нормали граната уже не подпрыгивает, а лежит. */
const SETTLE_SPEED = 1.2;
/** Удар слабее этого не слышно. */
const AUDIBLE_SPEED = 2.5;
const STEP_MS = 1000 / 120;
export const GRENADE_SAMPLE_MS = STEP_MS * 2;

const norm = (x: number, y: number, z: number): Vec3 => {
  const l = Math.sqrt(x * x + y * y + z * z);
  return l > 1e-9 ? [x / l, y / l, z / l] : [0, 0, -1];
};

/** Скорость в момент броска для прицела `origin → target`. */
export function throwVelocity(origin: number[], target: number[]): Vec3 {
  const d = norm(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]);
  const v = norm(d[0], d[1] + LIFT, d[2]);
  return [v[0] * GRENADE_SPEED, v[1] * GRENADE_SPEED, v[2] * GRENADE_SPEED];
}

/**
 * Первый вход отрезка `p → p + d` в коробку, раздутую на радиус гранаты:
 * доля пути и ось, по которой вошли. Коробки, внутри которых граната уже
 * находится, пропускаются: иначе она застрянет в том, откуда её бросили.
 */
function enterBox(p: Vec3, d: Vec3, c: BoxCollider3D): { t: number; axis: number } | null {
  const min = [c.minX - RADIUS, c.minY - RADIUS, c.minZ - RADIUS];
  const max = [c.maxX + RADIUS, c.maxY + RADIUS, c.maxZ + RADIUS];
  let enter = -Infinity,
    exit = Infinity,
    axis = -1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (p[i] < min[i] || p[i] > max[i]) return null;
      continue;
    }
    let t1 = (min[i] - p[i]) / d[i],
      t2 = (max[i] - p[i]) / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > enter) {
      enter = t1;
      axis = i;
    }
    if (t2 < exit) exit = t2;
    if (enter > exit) return null;
  }
  return enter >= 0 && enter <= 1 && axis >= 0 ? { t: enter, axis } : null;
}

/** Отскок: нормальная составляющая меняет знак и гаснет, касательная теряет трение. */
function bounce(v: Vec3, axis: number) {
  const impact = Math.abs(v[axis]);
  for (let i = 0; i < 3; i++) v[i] *= i === axis ? -RESTITUTION : BOUNCE_FRICTION;
  return impact;
}

/** Лежит на горизонтальной поверхности: катится, пока трение не остановит. Остановилась — true. */
function roll(v: Vec3, dt: number) {
  v[1] = 0;
  const speed = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
  const k = speed > 1e-9 ? Math.max(0, 1 - (ROLL_DECEL * dt) / speed) : 0;
  v[0] *= k;
  v[2] *= k;
  return k === 0;
}

/** Путь гранаты от броска до взрыва через `fuseMs`. */
export function simulateGrenade(
  origin: number[],
  target: number[],
  world: GrenadeWorld,
  fuseMs = GRENADE_FUSE_MS,
): GrenadeFlight {
  const p: Vec3 = [origin[0], origin[1], origin[2]];
  const v = throwVelocity(origin, target);
  const dt = STEP_MS / 1000;
  const steps = Math.round(fuseMs / STEP_MS);
  const path: Vec3[] = [[p[0], p[1], p[2]]];
  const bounces: number[] = [];
  let resting = false;
  for (let s = 1; s <= steps; s++) {
    const at = s * STEP_MS;
    if (!resting) {
      v[1] -= GRENADE_GRAVITY * dt;
      const d: Vec3 = [v[0] * dt, v[1] * dt, v[2] * dt];
      let first: { t: number; axis: number } | null = null;
      for (const c of world.colliders) {
        const hit = enterBox(p, d, c);
        if (hit && (!first || hit.t < first.t)) first = hit;
      }
      const prevY = p[1];
      if (first) {
        // Встаём у стены чуть раньше точки касания и отскакиваем; остаток шага пропадает.
        const t = Math.max(0, first.t - 1e-3);
        for (let i = 0; i < 3; i++) p[i] += d[i] * t;
        // Крышка стола или ящика: лёгкое касание сверху — уже не прыжок, а качение.
        if (first.axis === 1 && v[1] < 0 && -v[1] <= SETTLE_SPEED) resting = roll(v, dt);
        else if (bounce(v, first.axis) > AUDIBLE_SPEED) bounces.push(at);
      } else for (let i = 0; i < 3; i++) p[i] += d[i];

      const ground = world.groundHeight(p[0], p[2], prevY) + RADIUS;
      if (p[1] < ground && v[1] <= 0) {
        p[1] = ground;
        if (-v[1] <= SETTLE_SPEED) resting = roll(v, dt);
        else if (bounce(v, 1) > AUDIBLE_SPEED) bounces.push(at);
      }
      const ceiling = (world.ceilingHeight?.(p[0], p[2], prevY) ?? Infinity) - RADIUS;
      if (p[1] > ceiling && v[1] > 0) {
        p[1] = ceiling;
        if (bounce(v, 1) > AUDIBLE_SPEED) bounces.push(at);
      }
    }
    if (s % 2 === 0 || s === steps) path.push([p[0], p[1], p[2]]);
  }
  return { path, end: [p[0], p[1], p[2]], bounces };
}

/** Где граната в момент `ms` от броска: между соседними точками пути — по прямой. */
export function grenadeAt(flight: GrenadeFlight, ms: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const { path } = flight;
  const f = Math.max(0, ms / GRENADE_SAMPLE_MS);
  const i = Math.min(path.length - 1, Math.floor(f));
  const j = Math.min(path.length - 1, i + 1);
  const k = Math.min(1, f - i);
  for (let a = 0; a < 3; a++) out[a] = path[i][a] + (path[j][a] - path[i][a]) * k;
  return out;
}

/**
 * Точка прицела, с которой граната ляжет у `landing` на ровном месте. Нужна ботам:
 * они выбирают, куда должна упасть граната, а бросают, как игрок, — по линии прицела.
 * Перебирается угол броска; стены не учитываются, отскоки и качение — да.
 */
export function aimGrenadeAt(origin: number[], landing: number[], fuseMs = GRENADE_FUSE_MS): Vec3 {
  const dx = landing[0] - origin[0],
    dz = landing[2] - origin[2];
  const flat = Math.hypot(dx, dz);
  const hx = flat > 1e-6 ? dx / flat : 0,
    hz = flat > 1e-6 ? dz / flat : -1;
  const floor: GrenadeWorld = { colliders: [], groundHeight: () => landing[1] };
  const aim = (pitch: number): Vec3 => [
    origin[0] + hx * Math.cos(pitch) * 10,
    origin[1] + Math.sin(pitch) * 10,
    origin[2] + hz * Math.cos(pitch) * 10,
  ];
  let best = aim(0),
    miss = Infinity;
  for (let pitch = -1.2; pitch <= 1.2; pitch += 0.04) {
    const candidate = aim(pitch);
    const { end } = simulateGrenade(origin, candidate, floor, fuseMs);
    const off = Math.hypot(end[0] - landing[0], end[2] - landing[2]);
    if (off < miss) {
      miss = off;
      best = candidate;
    }
  }
  return best;
}
