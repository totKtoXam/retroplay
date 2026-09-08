import * as T from 'three';
import { GRENADES } from '../lib/game-items.ts';
/** Shared small particle meshes; no textures or per-particle draw calls. */
export function partyGeometry(style: string): T.BufferGeometry {
  if (style === 'snow') return new T.IcosahedronGeometry(0.09, 0);
  if (style === 'classic') return new T.PlaneGeometry(0.08, 0.15);
  if (style === 'digital') {
    const a = new T.Shape();
    a.moveTo(-0.05, -0.08);
    a.lineTo(0.05, -0.08);
    a.lineTo(0.05, 0.08);
    a.lineTo(-0.05, 0.08);
    a.closePath();
    const hole = new T.Path();
    hole.moveTo(-0.022, -0.05);
    hole.lineTo(-0.022, 0.05);
    hole.lineTo(0.022, 0.05);
    hole.lineTo(0.022, -0.05);
    hole.closePath();
    a.holes.push(hole);
    return new T.ShapeGeometry(a);
  }
  if (style === 'shanyrak') return new T.RingGeometry(0.045, 0.1, 12);
  const s = new T.Shape();
  if (style === 'hearts') {
    s.moveTo(0, -0.11);
    s.bezierCurveTo(-0.23, 0.04, -0.08, 0.17, 0, 0.065);
    s.bezierCurveTo(0.08, 0.17, 0.23, 0.04, 0, -0.11);
  } else if (style === 'petals') {
    s.moveTo(0, -0.13);
    s.quadraticCurveTo(-0.14, 0, 0, 0.13);
    s.quadraticCurveTo(0.14, 0, 0, -0.13);
  } else {
    const count = style === 'comets' ? 8 : 10;
    for (let i = 0; i <= count; i++) {
      const a = (i / count) * Math.PI * 2,
        r = i % 2 ? 0.045 : 0.13;
      const x = Math.cos(a) * r,
        y = Math.sin(a) * r;
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
  }
  return new T.ShapeGeometry(s);
}
export const grenadeParty = (style: string) =>
  ({
    pinata: 'stars',
    snowglobe: 'snow',
    heartburst: 'hearts',
    pixel: 'digital',
    meteor: 'comets',
    paintburst: 'classic',
  })[style] || 'stars';
export function makeGrenade(color: string, variant = 'pinata') {
  const group = new T.Group();
  const body = new T.Mesh(
    variant === 'pinata'
      ? new T.OctahedronGeometry(0.18)
      : variant === 'pixel'
        ? new T.BoxGeometry(0.25, 0.25, 0.25)
        : new T.IcosahedronGeometry(0.17, 1),
    new T.MeshStandardMaterial({ color, roughness: 0.65 }),
  );
  group.add(body);
  const ring = new T.Mesh(
    new T.TorusGeometry(0.045, 0.009, 4, 10),
    new T.MeshStandardMaterial({
      color: '#d2d7df',
      metalness: 0.5,
      roughness: 0.4,
    }),
  );
  ring.position.y = 0.22;
  group.add(ring);
  if (variant === 'pinata')
    for (let i = 0; i < 5; i++) {
      const strip = new T.Mesh(
        new T.BoxGeometry(0.04, 0.13, 0.02),
        new T.MeshStandardMaterial({
          color: ['#ffcc65', '#8bcbe5', '#f891b1'][i % 3],
        }),
      );
      strip.position.set((i - 2) * 0.05, -0.19, 0);
      strip.rotation.z = (i - 2) * 0.17;
      group.add(strip);
    }
  return group;
}

export function setGrenadeStyle(
  group: T.Object3D,
  variant: string,
  firstPerson = false,
) {
  if (group.userData.variant === variant) return;
  group.userData.variant = variant;
  while (group.children.length) {
    const child = group.children[0];
    child.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        (o.material as T.Material).dispose();
      }
    });
    child.removeFromParent();
  }
  const style = GRENADES.find((g) => g.id === variant) || GRENADES[0];
  const model = makeGrenade(style.color, style.id);
  while (model.children.length) group.add(model.children[0]);
  if (firstPerson)
    group.traverse((o) => {
      if (o instanceof T.Mesh) {
        (o.material as T.Material).depthTest = false;
        o.renderOrder = 1001;
        o.raycast = () => {};
      }
    });
}
