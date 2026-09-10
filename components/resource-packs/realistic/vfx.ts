import * as T from 'three';
import { visualOnly } from './geometry.ts';

/** Short, bounded pressure-mist impacts, additive to the existing information-bearing effects. */
export function createFieldVfx(scene: T.Scene, quality: string) {
  const count = quality === 'low' ? 12 : 26;
  const active: { mesh: T.Points; life: number }[] = [];
  const geometry = new T.BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = i * 2.3999; const radius = 0.04 + (i % 6) * 0.016;
    positions.set([Math.sin(a) * radius, Math.cos(a * 1.3) * radius, Math.cos(a) * radius], i * 3);
  }
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  return {
    impact(at: T.Vector3, color: string) {
      if (active.length >= 12) return;
      const material = new T.PointsMaterial({ color, size: 0.025, transparent: true, opacity: 0.35, depthWrite: false });
      const mesh = new T.Points(geometry, material); visualOnly(mesh); mesh.position.copy(at);
      scene.add(mesh); active.push({ mesh, life: 0 });
    },
    update(dt: number) {
      for (let i = active.length - 1; i >= 0; i--) {
        const effect = active[i]; effect.life += dt;
        effect.mesh.scale.setScalar(1 + effect.life * 2.7);
        effect.mesh.position.y += dt * 0.055;
        (effect.mesh.material as T.PointsMaterial).opacity = 0.32 * Math.max(0, 1 - effect.life / 0.65);
        if (effect.life > 0.65) { effect.mesh.removeFromParent(); (effect.mesh.material as T.Material).dispose(); active.splice(i, 1); }
      }
    },
    dispose() { active.forEach(({ mesh }) => { mesh.removeFromParent(); (mesh.material as T.Material).dispose(); }); active.length = 0; geometry.dispose(); },
  };
}
