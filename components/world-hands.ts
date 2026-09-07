import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createFirstPersonHands(camera: T.Camera) {
  const group = new T.Group();
  group.name = 'first-person-hands';
  camera.add(group);
  const metal = new T.MeshStandardMaterial({
    color: '#333c43',
    metalness: 0.72,
    roughness: 0.28,
    depthTest: false,
  });
  const grip = new T.MeshStandardMaterial({
    color: '#131a20',
    roughness: 0.86,
    depthTest: false,
  });
  const sleeve = new T.MeshStandardMaterial({
    color: '#46535b',
    roughness: 0.9,
    depthTest: false,
  });
  const skin = new T.MeshStandardMaterial({
    color: '#bd8c68',
    roughness: 0.8,
    depthTest: false,
  });
  const accent = new T.MeshStandardMaterial({
    color: '#ed646d',
    metalness: 0.5,
    roughness: 0.31,
    depthTest: false,
  });
  const paint = new T.MeshStandardMaterial({
    color: '#aa86f6',
    roughness: 0.3,
    metalness: 0.2,
    depthTest: false,
  });
  const part = (
    geo: T.BufferGeometry,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.renderOrder = 1000;
    m.raycast = () => {};
    group.add(m);
    return m;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
  ) => part(new RoundedBoxGeometry(w, h, d, 2, 0.018), mat, x, y, z);
  const barrel = (
    r: number,
    length: number,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const m = part(new T.CylinderGeometry(r, r, length, 16), mat, x, y, z);
    m.rotation.x = Math.PI / 2;
    return m;
  };
  box(0.15, 0.14, 0.45, metal, 0, 0, -0.15);
  barrel(0.044, 0.29, metal, 0, 0.025, -0.48);
  barrel(0.055, 0.06, accent, 0, 0.025, -0.64);
  box(0.055, 0.035, 0.29, grip, 0, 0.09, -0.15);
  for (let i = 0; i < 7; i++)
    box(0.075, 0.012, 0.012, metal, 0, 0.11, -0.26 + i * 0.037);
  box(0.08, 0.2, 0.1, grip, 0, -0.14, -0.02).rotation.x = -0.2;
  const hopper = part(
    new RoundedBoxGeometry(0.15, 0.16, 0.23, 2, 0.025),
    paint,
    0.02,
    0.2,
    -0.05,
  );
  hopper.scale.set(1, 0.7, 1.35);
  barrel(0.08, 0.28, sleeve, 0.07, -0.23, 0.17).rotation.z = -0.14;
  box(0.1, 0.12, 0.14, skin, 0.055, -0.12, 0.03).rotation.z = -0.15;
  barrel(0.075, 0.34, sleeve, -0.21, -0.21, -0.08).rotation.y = -0.85;
  box(0.12, 0.09, 0.16, skin, -0.09, -0.09, -0.25);
  for (let i = 0; i < 4; i++)
    box(0.024, 0.06, 0.045, skin, -0.069 + i * 0.026, -0.055, -0.29);
  const cartridge = box(0.085, 0.18, 0.11, grip, 0, -0.12, -0.23);
  let recoil = 0,
    equip = 0,
    lastTool = '';
  return {
    group,
    shoot: () => {
      recoil = 1;
    },
    update(
      dt: number,
      time: number,
      speed: number,
      tool: string,
      color: string,
      active: boolean,
      aim: number,
      reload: number,
    ) {
      group.visible = active && (tool === 'paint' || tool === 'confetti');
      if (lastTool !== tool) {
        lastTool = tool;
        equip = 1;
      }
      equip = Math.max(0, equip - dt * 5);
      const reloading = Math.sin(reload * Math.PI);
      cartridge.position.y = -0.12 - reloading * 0.17;
      recoil *= Math.exp(-15 * dt);
      paint.color.set(tool === 'confetti' ? '#dcb26a' : color);
      group.position.set(
        T.MathUtils.lerp(0.27, 0, aim) +
          Math.sin(time * speed * 2.4) *
            Math.min(speed, 0.9) *
            0.009 *
            (1 - aim * 0.9),
        T.MathUtils.lerp(-0.27, -0.115, aim) +
          Math.cos(time * speed * 4.8) *
            Math.min(speed, 1) *
            0.011 *
            (1 - aim * 0.9) -
          reloading * 0.18 -
          equip * 0.22,
        -0.52 + recoil * 0.075 + reloading * 0.14,
      );
      group.rotation.set(
        recoil * 0.095 + equip * 0.25,
        reloading * 0.28,
        -reloading * 0.55 + Math.sin(time * 0.8) * 0.005,
      );
    },
  };
}
