export type GraphicsSettings = {
  scale: number; shadows: 0 | 512 | 1024 | 2048 | 4096;
  textures: 512 | 1024 | 2048; anisotropy: 1 | 4 | 8 | 16;
  bloom: boolean; antialias: boolean; exposure: number; detail: number;
};
export const GRAPHICS_PRESETS: Record<string, GraphicsSettings> = {
  low: { scale: .75, shadows: 0, textures: 512, anisotropy: 1, bloom: false, antialias: true, exposure: 1, detail: 1 },
  medium: { scale: 1, shadows: 1024, textures: 1024, anisotropy: 4, bloom: true, antialias: true, exposure: 1, detail: 2 },
  high: { scale: 1, shadows: 2048, textures: 2048, anisotropy: 8, bloom: true, antialias: true, exposure: 1, detail: 3 },
  ultra: { scale: 1.25, shadows: 4096, textures: 2048, anisotropy: 16, bloom: true, antialias: true, exposure: 1, detail: 4 },
};
export const GRAPHICS_KEY = 'jinaly-graphics-v1';
export function normalizeGraphics(value: unknown): GraphicsSettings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const d = GRAPHICS_PRESETS.high;
  const number = (key: keyof GraphicsSettings, min: number, max: number) =>
    typeof v[key] === 'number' && Number.isFinite(v[key]) ? Math.max(min, Math.min(max, v[key] as number)) : d[key] as number;
  const choice = (key: keyof GraphicsSettings, allowed: number[]) => allowed.includes(v[key] as number) ? v[key] : d[key];
  return { scale: number('scale', .5, 1.5), shadows: choice('shadows', [0,512,1024,2048,4096]) as GraphicsSettings['shadows'],
    textures: choice('textures', [512,1024,2048]) as GraphicsSettings['textures'], anisotropy: choice('anisotropy', [1,4,8,16]) as GraphicsSettings['anisotropy'],
    bloom: typeof v.bloom === 'boolean' ? v.bloom : d.bloom, antialias: typeof v.antialias === 'boolean' ? v.antialias : d.antialias,
    exposure: number('exposure', .6, 1.5), detail: Math.round(number('detail', 1, 4)) };
}
export type GraphicsCheck = { fps: number; p95: number; width: number; height: number; at: number; settings: string };
export function recommendation(check: GraphicsCheck) {
  return check.fps < 35 || check.p95 > 45 ? 'low' : check.fps < 55 || check.p95 > 25 ? 'medium' : 'high';
}
