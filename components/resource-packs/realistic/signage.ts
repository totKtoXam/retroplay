import * as T from 'three';

/** Original field-annex signage, generated at pack activation and released on switch. */
export function fieldSign(text: string) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#343b39'; ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = '#c4b695'; ctx.fillRect(0, 0, 16, 256);
  ctx.strokeStyle = '#969a8955'; ctx.strokeRect(27, 20, 973, 216);
  ctx.fillStyle = '#e5dfcb'; ctx.textBaseline = 'middle';
  ctx.font = '600 68px monospace';
  const label = text === 'TEAM CAMPUS' ? 'ALATAU / FIELD ANNEX' : text === 'JINALY  /  01' ? 'JINALY · WORKSHOP 01' : text;
  ctx.fillText(label, 58, 108, 910);
  ctx.font = '24px monospace'; ctx.fillStyle = '#a8ae9e';
  ctx.fillText('TEAM RESEARCH   /   EST. 2026', 59, 182);
  // Wear uses a fixed sequence; it does not consume the game's shot spread RNG.
  for (let i = 0; i < 170; i++) {
    ctx.fillStyle = i % 3 ? '#131b1925' : '#e8e2c713';
    ctx.fillRect((i * 109) % 1024, (i * 71) % 256, 1 + i % 22, 1 + i % 2);
  }
  const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace;
  const material = new T.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0.25 });
  return { material, dispose() { material.dispose(); map.dispose(); } };
}
