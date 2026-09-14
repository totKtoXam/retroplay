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
export const weaponCooldown = (kind: string) =>
  isBlaster(kind) ? WEAPONS[kind].cooldown : kind === 'grenade' ? 1200 : 90;
