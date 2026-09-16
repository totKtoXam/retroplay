// Клиентская сторона режима «Предатель»: что игрок может сделать прямо сейчас, исходя из
// своего снимка партии (`ImpostorView`). Здесь только подсказки интерфейсу — решает всё
// равно сервер (lib/impostor.ts), поэтому расстояния берутся те же, но с запасом не спорят.
import {
  BUTTON_RANGE,
  KILL_RANGE,
  REPORT_RANGE,
  TASK_RANGE,
  type ImpostorView,
} from './impostor.ts';
import type { GameMap } from './maps/types.ts';

type Point = { x: number; z: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** Партия идёт: роли розданы и ещё не открыты. */
export const inGame = (v?: ImpostorView | null): v is ImpostorView =>
  !!v && (v.phase === 'intro' || v.phase === 'play' || v.phase === 'meeting' || v.phase === 'voting' || v.phase === 'eject');

/** Я призрак: погиб или пришёл зрителем во время партии. */
export const amGhost = (v?: ImpostorView | null) => inGame(v) && (!v.role || !v.alive);

/** Движение заморожено: показ ролей, собрание, итог голосования. */
export const impostorFrozen = (v?: ImpostorView | null) =>
  !!v && (v.phase === 'intro' || v.phase === 'meeting' || v.phase === 'voting' || v.phase === 'eject');

/** Невыполненное своё задание, у пульта которого я стою. Предателю — никогда. */
export function taskHere(v: ImpostorView | undefined, me: Point) {
  if (!v || v.phase !== 'play' || v.role !== 'crew') return null;
  let best = null,
    bestDistance = TASK_RANGE;
  for (const t of v.tasks) {
    if (t.done) continue;
    const d = distance(me, t);
    if (d <= bestDistance) {
      best = t;
      bestDistance = d;
    }
  }
  return best;
}

/** Тело в пределах репорта (живым). */
export function bodyHere(v: ImpostorView | undefined, me: Point) {
  if (!v || v.phase !== 'play' || !v.role || !v.alive) return null;
  let best = null,
    bestDistance = REPORT_RANGE;
  for (const b of v.bodies) {
    const d = distance(me, b);
    if (d <= bestDistance) {
      best = b;
      bestDistance = d;
    }
  }
  return best;
}

/** Ближайшая цель для ножа: живой игрок не из союзников, в пределах удара. */
export function killTarget(
  v: ImpostorView | undefined,
  self: string,
  me: Point,
  members: { id: string; pose: Point }[],
) {
  if (!v || v.phase !== 'play' || v.role !== 'impostor' || !v.alive) return null;
  const alive = new Set(v.players.filter((p) => p.alive && !p.left).map((p) => p.id));
  let best = null,
    bestDistance = KILL_RANGE;
  for (const m of members) {
    if (m.id === self || !alive.has(m.id) || v.allies.includes(m.id)) continue;
    const d = distance(me, m.pose);
    if (d <= bestDistance) {
      best = m.id;
      bestDistance = d;
    }
  }
  return best;
}

/** Стою у кнопки экстренного собрания и могу её нажать. */
export function atButton(v: ImpostorView | undefined, map: GameMap, me: Point) {
  if (!v || v.phase !== 'play' || !v.role || !v.alive || !map.meeting) return false;
  return distance(me, map.meeting) <= BUTTON_RANGE;
}

/** Название отсека, где стоит игрок. */
export function zoneAt(map: GameMap, me: Point) {
  return map.arena?.zones?.find((z) => me.x > z.minX && me.x < z.maxX && me.z > z.minZ && me.z < z.maxZ)?.name ?? '';
}

/**
 * Можно ли говорить с этим собеседником. Звук идёт напрямую между браузерами, и живой не
 * знает, кто из соседей погиб, — поэтому ограничивает говорящий: призрак говорит только
 * с призраками, живые молчат вне собраний.
 */
export function voiceAllowed(v: ImpostorView | undefined, peer: string) {
  if (!inGame(v)) return true;
  if (amGhost(v)) {
    const p = v.players.find((x) => x.id === peer);
    return !p || !p.alive || p.left;
  }
  return v.phase === 'meeting' || v.phase === 'voting' || v.phase === 'eject';
}

/** Сколько секунд осталось до момента `at` по серверным часам (не меньше нуля). */
export const secondsLeft = (at: number, now: number) => Math.max(0, Math.ceil((at - now) / 1000));
