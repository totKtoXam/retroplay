export type AimMode = 'hold' | 'toggle';
export type WeaponAimModes = {
  paint: AimMode;
  confetti: AimMode;
  sniper: AimMode;
};
export const DEFAULT_AIM_MODES: WeaponAimModes = {
  paint: 'hold',
  confetti: 'hold',
  sniper: 'hold',
};
export function readAimModes(): WeaponAimModes {
  if (typeof window === 'undefined') return { ...DEFAULT_AIM_MODES };
  try {
    const raw = localStorage.getItem('jinaly-aim-modes');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WeaponAimModes>;
      return {
        paint: parsed.paint === 'toggle' ? 'toggle' : 'hold',
        confetti: parsed.confetti === 'toggle' ? 'toggle' : 'hold',
        sniper: parsed.sniper === 'toggle' ? 'toggle' : 'hold',
      };
    }
  } catch {}
  return { ...DEFAULT_AIM_MODES };
}
