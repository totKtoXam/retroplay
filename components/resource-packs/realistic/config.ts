/** Original procedural assets; no third-party game content. */
export const REALISTIC_CONFIG = {
  id: 'realistic-bodycam',
  environment: 'Alatau / Field Research Annex 01',
  materials: ['concrete', 'steel', 'rubber', 'canvas', 'plaster', 'wetstone'] as const,
  characters: 'Field technician / existing rig',
  weapons: 'Workshop series / existing mounts',
  audio: 'inherit-default',
  camera: { projection: 'inherit', distortion: 0, inertia: 0, shake: 0 },
  post: { saturation: 0.78, grain: 0.016, vignette: 0.22, aberration: 0.00025 },
} as const;
