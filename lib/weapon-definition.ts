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
/** Граната взрывается через столько после броска: столько же длится её дуга у клиентов. */
export const GRENADE_FUSE_MS = 1100;
export const weaponCooldown = (kind: string) =>
  isBlaster(kind) ? WEAPONS[kind].cooldown : kind === 'grenade' ? GRENADE_COOLDOWN_MS : 90;
/**
 * Может ли стрелок снова стрелять этим оружием. После любого выстрела — пауза
 * оружия (не дольше 1,2 с), а у гранаты ещё и свой отсчёт от прошлого броска.
 */
export const cooledDown = (
  m: { lastShot: number; lastGrenade?: number },
  kind: string,
  now: number,
) =>
  m.lastShot <= now - Math.min(weaponCooldown(kind), 1200) &&
  (kind !== 'grenade' || (m.lastGrenade ?? -Infinity) <= now - GRENADE_COOLDOWN_MS);
/**
 * Сколько снаряд летит от ствола до точки прицела, мс. Клиенты рисуют полёт ровно
 * столько, а сервер ранит только по его окончании: нельзя погибнуть от шарика,
 * который на экране ещё не долетел.
 */
export const flightMs = (kind: string, distance: number) =>
  kind === 'grenade'
    ? GRENADE_FUSE_MS
    : kind === 'sniper'
      ? Math.max(25, distance * 1.8)
      : Math.max(130, distance * 22);
