/** Device-local presentation only. This contract deliberately contains no game state. */
export const RESOURCE_PACKS = [
  {
    id: 'default',
    name: 'Default',
    subtitle: 'Jinaly · тактика и аниме',
    badge: 'ORIGINAL',
    ui: 'default',
  },
  {
    id: 'realistic-bodycam',
    name: 'Realistic / Bodycam',
    subtitle: 'Бетон, сталь и свет объектива',
    badge: 'FIELD / 01',
    ui: 'field',
  },
] as const;
export type ResourcePackId = (typeof RESOURCE_PACKS)[number]['id'];
export const PACK_STORAGE_KEY = 'jinaly-resource-pack';
export function parseResourcePack(value: unknown): ResourcePackId {
  return RESOURCE_PACKS.some((p) => p.id === value)
    ? (value as ResourcePackId)
    : 'default';
}
export function visualBudget(quality: string) {
  const high = quality === 'cinematic' || quality === 'high';
  const low = quality === 'low';
  return {
    textureSize: high ? 512 : 256,
    anisotropy: high ? 8 : low ? 1 : 4,
    detailDistance: high ? 55 : low ? 20 : 35,
    particles: low ? 28 : high ? 100 : 55,
    localLights: low ? 0 : high ? 4 : 2,
    bloom: low ? 0 : high ? 0.09 : 0.055,
  };
}
