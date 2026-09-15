// Кого команда видит на карте. Правило одно: враг попадает на план, только если
// кто-то из своих действительно смотрит на него — держит в узком секторе вокруг
// прицела и не через стену. Иначе план показывал бы то, чего игрок глазами не
// видит, и сам становился бы читом.
import { eyeHeight, viewDirection } from './game-camera.ts';
import { rayCastWorldObstacle, type BoxCollider3D } from './world-collision.ts';

/**
 * Половина угла сектора засветки. 14° — примерно центральная треть экрана по
 * горизонтали при обзоре камеры в 64°: «куда направлено оружие», а не «что
 * попало в кадр». От прицеливания сектор не зависит — он про ствол, не про FOV.
 */
export const SPOT_CONE = (14 * Math.PI) / 180;
/**
 * Дальше этого боец на плане уже не помогает: на таком расстоянии фигура
 * различима с трудом, а без предела один снайпер, ведущий стволом по горизонту,
 * засвечивал бы всю чужую команду сразу.
 */
export const SPOT_RANGE = 60;
/**
 * Сколько отметка живёт после засветки. Без памяти она мигала бы от каждого
 * дрожания прицела; с ней на плане остаётся последнее известное место — то, что
 * своими глазами и запоминают.
 */
export const SPOT_MEMORY_MS = 2500;

/** Тот, кто смотрит: поза со взглядом. */
export type Watcher = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch?: number;
  stance?: string;
};
/** Тот, кого могут увидеть. */
export type Target = { id: string; x: number; y: number; z: number; stance?: string };

const height = (stance?: string) => (stance === 'lie' ? 0.6 : stance === 'sit' ? 1.2 : 1.8);

/**
 * Точки тела, по которым проверяем видимость: макушка и грудь. Двух хватает —
 * из-за укрытия обычно торчит именно голова, и по одной только груди боец за
 * ящиком считался бы невидимым, хотя его прекрасно видно.
 */
function samplePoints(t: Target): [number, number, number][] {
  const h = height(t.stance);
  return [
    [t.x, t.y + h - 0.15, t.z],
    [t.x, t.y + h * 0.55, t.z],
  ];
}

/**
 * Видит ли `watcher` цель `target`: точка тела должна попасть в сектор вокруг
 * взгляда и не быть перекрыта геометрией карты.
 */
export function inSight(
  watcher: Watcher,
  target: Target,
  colliders: BoxCollider3D[],
  range = SPOT_RANGE,
  cone = SPOT_CONE,
): boolean {
  const flat = Math.hypot(target.x - watcher.x, target.z - watcher.z);
  if (flat > range) return false;
  const eye = [watcher.x, watcher.y + eyeHeight(watcher.stance ?? 'stand'), watcher.z] as const;
  // Тот же вектор взгляда, что строит камеру (lib/game-camera.ts): направление
  // засветки и картинка на экране обязаны расходиться только в пределах сектора.
  const look = viewDirection(watcher.yaw, watcher.pitch ?? 0);
  const cosCone = Math.cos(cone);
  for (const point of samplePoints(target)) {
    const dx = point[0] - eye[0],
      dy = point[1] - eye[1],
      dz = point[2] - eye[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    if ((dx * look.x + dy * look.y + dz * look.z) / len < cosCone) continue;
    if (!rayCastWorldObstacle([...eye], point, colliders)) return true;
  }
  return false;
}

/**
 * Кого из `targets` видит хоть кто-то из `watchers`. Смотрящие — вся своя
 * команда: увиденное одним видит весь отряд, как если бы он сказал об этом
 * вслух.
 */
export function spotTargets(
  watchers: Watcher[],
  targets: Target[],
  colliders: BoxCollider3D[],
): string[] {
  const seen: string[] = [];
  for (const target of targets)
    if (watchers.some((w) => inSight(w, target, colliders))) seen.push(target.id);
  return seen;
}
