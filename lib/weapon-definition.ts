import { meleeStats } from './melee.ts';

/** Canonical weapon timings: preserve the existing player's cadence and reload animation. */
export const WEAPONS = {
  paint: { capacity: 24, cooldown: 180, reload: 1450 },
  confetti: { capacity: 6, cooldown: 550, reload: 1700 },
  sniper: { capacity: 5, cooldown: 1050, reload: 1900 },
  like: { capacity: 12, cooldown: 320, reload: 1250 },
} as const;
export type Blaster = keyof typeof WEAPONS;
export const isBlaster = (value: unknown): value is Blaster =>
  typeof value === 'string' && Object.hasOwn(WEAPONS, value);
/** Гранату можно бросать раз в 10 секунд; выстрелы из другого оружия этот отсчёт не сбивают. */
export const GRENADE_COOLDOWN_MS = 10_000;
/**
 * Граната взрывается через столько после броска — где бы ни была: в полёте,
 * после отскоков или уже лёжа (lib/grenade-physics.ts). Столько же длится её полёт у клиентов.
 */
export const GRENADE_FUSE_MS = 1800;
/** Пауза после выстрела; у ближнего боя своя для каждого оружия (`variant`). */
export const weaponCooldown = (kind: string, variant?: string) =>
  isBlaster(kind)
    ? WEAPONS[kind].cooldown
    : kind === 'grenade'
      ? GRENADE_COOLDOWN_MS
      : kind === 'melee'
        ? meleeStats(variant).cooldown
        : 90;
/**
 * Может ли стрелок снова стрелять этим оружием. После любого выстрела — пауза
 * оружия (не дольше 1,2 с), а у гранаты ещё и свой отсчёт от прошлого броска.
 */
export const cooledDown = (
  m: { lastShot: number; lastGrenade?: number },
  kind: string,
  now: number,
  variant?: string,
) =>
  m.lastShot <= now - Math.min(weaponCooldown(kind, variant), 1200) &&
  (kind !== 'grenade' || (m.lastGrenade ?? -Infinity) <= now - GRENADE_COOLDOWN_MS);
/**
 * Сколько снаряд летит от ствола до точки прицела, мс. Клиенты рисуют полёт ровно
 * столько, а сервер ранит только по его окончании: нельзя погибнуть от шарика,
 * который на экране ещё не долетел.
 */
export const flightMs = (kind: string, distance: number, variant?: string) =>
  kind === 'grenade'
    ? GRENADE_FUSE_MS
    : kind === 'melee'
      ? meleeStats(variant).windup
      : kind === 'sniper'
      ? Math.max(25, distance * 1.8)
      : Math.max(130, distance * 22);
