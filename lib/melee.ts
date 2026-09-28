/**
 * Ближний бой: надувной молот, нож, багет и кулаки. Один слот, вариант выбирают
 * колесом, как стиль гранаты. Удар — отрезок от глаз бойца по взгляду на длину
 * руки с оружием; попадание, как и у стрельбы, считает сервер (lib/room-hub-core.ts)
 * по позам жертв на момент, когда удар дошёл.
 */

export const MELEE = [
  ['hammer', 'Надувной молот', '🔨', '#ff84c8'],
  ['knife', 'Нож', '🔪', '#c9d2dc'],
  ['baguette', 'Багет', '🥖', '#e0a55a'],
  ['fists', 'Кулаки', '👊', '#ffcb9a'],
].map(([id, label, icon, color]) => ({ id, label, icon, color }));

export type MeleeId = 'hammer' | 'knife' | 'baguette' | 'fists';

export type MeleeStats = {
  /** Урон по туловищу. */
  damage: number;
  /** Пауза между ударами, мс. */
  cooldown: number;
  /** От нажатия до касания: замах, мс. Урон приходит по его окончании. */
  windup: number;
  /** Досягаемость от глаз, м. */
  reach: number;
  /** Насколько удар шире луча, м: молот и багет машут дугой, нож колет точно. */
  width: number;
  /** Урон в спину; нож в спину убивает. */
  backstab: number;
};

export const MELEE_STATS: Record<MeleeId, MeleeStats> = {
  // Тяжёлый и широкий: промахнуться трудно, но замах долгий.
  hammer: { damage: 45, cooldown: 800, windup: 280, reach: 2.3, width: 0.4, backstab: 70 },
  // Быстрый и короткий; в спину — сразу насмерть.
  knife: { damage: 40, cooldown: 450, windup: 110, reach: 1.8, width: 0.12, backstab: 100 },
  // Длинный и тяжёлый, чуть медленнее ножа и сильнее молота.
  baguette: { damage: 55, cooldown: 750, windup: 250, reach: 2.4, width: 0.3, backstab: 80 },
  // Всегда под рукой: слабые, зато частые.
  fists: { damage: 25, cooldown: 380, windup: 90, reach: 1.5, width: 0.18, backstab: 38 },
};

export const isMelee = (value: unknown): value is MeleeId =>
  typeof value === 'string' && Object.hasOwn(MELEE_STATS, value);
export const meleeStyle = (value: unknown): MeleeId => (isMelee(value) ? value : 'hammer');
export const meleeStats = (value: unknown) => MELEE_STATS[meleeStyle(value)];

/** Голова больнее, руки и ноги — слабее. */
const HEAD_SCALE = 1.5;
const LIMB_SCALE = 0.7;

/**
 * Удар пришёлся со спины: атакующий позади жертвы, в задней полусфере её взгляда.
 * Взгляд позы — (−sin yaw, −cos yaw), как у камеры (lib/game-camera.ts).
 */
export function fromBehind(attacker: number[], victim: { x: number; z: number; yaw?: number }) {
  const dx = attacker[0] - victim.x,
    dz = attacker[2] - victim.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const yaw = victim.yaw ?? 0;
  const dot = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / len;
  return dot < -0.35;
}

export function meleeDamage(id: unknown, zone: 'head' | 'torso' | 'limb', behind: boolean) {
  const s = meleeStats(id);
  if (behind) return s.backstab;
  const base = zone === 'head' ? s.damage * HEAD_SCALE : zone === 'limb' ? s.damage * LIMB_SCALE : s.damage;
  return Math.round(base);
}
