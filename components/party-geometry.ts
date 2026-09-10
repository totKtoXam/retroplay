import * as T from 'three';
import { GRENADES } from '../lib/game-items.ts';
/** Shared small particle meshes; no textures or per-particle draw calls. */
export function partyGeometry(style: string): T.BufferGeometry {
  if (style === 'snow') return new T.IcosahedronGeometry(0.09, 0);
  if (style === 'classic') return new T.PlaneGeometry(0.07, 0.15);
  if (style === 'ribbon') return new T.PlaneGeometry(0.038, 0.24);
  if (style === 'shard') return new T.TetrahedronGeometry(0.13, 0);
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

export const fireworkParty = (style: string) =>
  ({
    salute: 'stars',
    sparkler: 'comets',
    dragon: 'petals',
    comet: 'comets',
    aurora: 'digital',
    solar: 'stars',
    galaxy: 'shanyrak',
    flower: 'petals',
  })[style] || 'stars';

export function makeFireworkRocket(color: string) {
  const group = new T.Group();
  const body = new T.Mesh(
    new T.CylinderGeometry(0.045, 0.045, 0.38, 8),
    new T.MeshStandardMaterial({
      color,
      roughness: 0.3,
      metalness: 0.6,
      emissive: color,
      emissiveIntensity: 0.4,
    }),
  );
  body.rotation.x = Math.PI / 2;
  group.add(body);

  const nose = new T.Mesh(
    new T.ConeGeometry(0.05, 0.16, 8),
    new T.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.2,
      emissive: '#fff2a8',
      emissiveIntensity: 0.7,
    }),
  );
  nose.position.z = 0.26;
  nose.rotation.x = Math.PI / 2;
  group.add(nose);

  const fins = new T.Mesh(
    new T.BoxGeometry(0.16, 0.015, 0.1),
    new T.MeshStandardMaterial({ color: '#2b384d', metalness: 0.5 }),
  );
  fins.position.z = -0.14;
  group.add(fins);
  const fins2 = fins.clone();
  fins2.rotation.z = Math.PI / 2;
  group.add(fins2);

  return group;
}
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
