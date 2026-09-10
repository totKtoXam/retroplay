import { makeGrenade, setGrenadeStyle } from './party-geometry.ts';
import * as T from 'three';
import { buildAgentSkin } from './world-agent.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type AvatarMotion = {
  speed: number;
  strafe: number;
  forward: number;
  airborne: boolean;
  velocityY: number;
  stance: 'stand' | 'sit' | 'lie';
  tool: string;
  variant?: string;
  pitch: number;
  working?: boolean;
  inventory?: boolean;
  aiming?: boolean;
  crouching?: boolean;
  reload?: number;
  hp?: number;
};
type Rig = {
  root: T.Group;
  chest: T.Group;
  head: T.Group;
  legs: T.Group[];
  knees: T.Group[];
  arms: T.Group[];
  elbows: T.Group[];
  scarf: T.Group;
  coat: T.Group;
  gun: T.Group;
  tablet: T.Group;
  classic: T.Group;
  anime: T.Group;
  phase: number;
  speed: number;
  airborne: boolean;
  landing: number;
  recoil: number;
  equip: number;
  tool: string;
};
const rigs = new WeakMap<T.Group, Rig>();

export function createAvatar(color: string) {
  if (color === '#368c78') color = '#657ac9';
  const avatar = new T.Group(),
    root = new T.Group();
  root.name = 'rig';
  avatar.add(root);
  const materials = new Map<string, T.MeshStandardMaterial>();
  const mat = (c: string) => {
    if (!materials.has(c))
      materials.set(
        c,
        new T.MeshStandardMaterial({
          color: c,
          roughness: 0.82,
          flatShading: true,
        }),
      );
    return materials.get(c)!;
  };
  const add = (
    parent: T.Object3D,
    geometry: T.BufferGeometry,
    c: string,
    x: number,
    y: number,
    z: number,
  ) => {
    const m = new T.Mesh(geometry, mat(c));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const box = (
    p: T.Object3D,
    c: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) => add(p, new T.BoxGeometry(w, h, d), c, x, y, z);
  const ball = (
    p: T.Object3D,
    c: string,
    x: number,
    y: number,
    z: number,
    r: number,
  ) => add(p, new T.SphereGeometry(r, 12, 8), c, x, y, z);
  const pivot = (
    p: T.Object3D,
    name: string,
    x: number,
    y: number,
    z: number,
  ) => {
    const g = new T.Group();
    g.name = name;
    g.position.set(x, y, z);
    p.add(g);
    return g;
  };
  const chest = pivot(root, 'chest', 0, 1.02, 0);
  add(chest, new T.CylinderGeometry(0.285, 0.235, 0.59, 10), color, 0, 0.23, 0);
  box(chest, '#e6eafa', 0, 0.29, -0.235, 0.075, 0.49, 0.025);
  box(chest, '#303954', 0, -0.08, 0, 0.48, 0.12, 0.29);
  box(chest, '#f2c572', 0.12, -0.08, -0.16, 0.085, 0.08, 0.035);
  for (const x of [-0.12, 0.12])
    box(chest, '#374465', x, 0.09, -0.228, 0.16, 0.13, 0.027);
  const head = pivot(chest, 'head', 0, 0.66, 0);
  add(
    head,
    new T.CylinderGeometry(0.09, 0.12, 0.15, 10),
    '#e3bda6',
    0,
    -0.12,
    0,
  );
  const face = ball(head, '#efcdb6', 0, 0.12, 0, 0.245);
  face.scale.set(0.92, 1.09, 0.91);
  const classic = pivot(head, 'classic-detail', 0, 0, 0),
    anime = pivot(head, 'anime-detail', 0, 0, 0);
  add(
    classic,
    new T.SphereGeometry(0.255, 12, 8, 0, Math.PI * 2, 0, 1.8),
    '#303548',
    0,
    0.18,
    0.025,
  );
  box(classic, '#c8a76c', 0, 0.33, -0.12, 0.32, 0.06, 0.25);
  add(classic, new T.CylinderGeometry(0.2, 0.24, 0.1, 12), color, 0, 0.39, 0);
  for (const x of [-0.077, 0.077]) {
    const eye = ball(classic, '#27384d', x, 0.13, -0.216, 0.027);
    eye.scale.y = 1.2;
    box(anime, '#fff9f1', x * 1.2, 0.135, -0.211, 0.106, 0.125, 0.024);
    const iris = ball(anime, '#6387d9', x * 1.2, 0.128, -0.238, 0.046);
    iris.scale.set(0.72, 1.13, 0.31);
    const pupil = ball(anime, '#28344a', x * 1.2, 0.13, -0.25, 0.023);
    pupil.scale.set(0.64, 1.1, 0.22);
    ball(anime, '#ffffff', x * 1.2 - 0.014, 0.155, -0.258, 0.012);
    box(
      anime,
      '#28324b',
      x * 1.2,
      0.2,
      -0.222,
      0.115,
      0.022,
      0.024,
    ).rotation.z = x < 0 ? -0.1 : 0.1;
    box(anime, '#e7a6ab', x * 1.62, 0.045, -0.171, 0.047, 0.018, 0.018);
  }
  box(head, '#b8877c', 0, 0.006, -0.206, 0.056, 0.016, 0.012);
  add(
    anime,
    new T.SphereGeometry(0.275, 14, 10, 0, Math.PI * 2, 0, 1.75),
    '#464373',
    0,
    0.2,
    0.03,
  );
  for (let i = 0; i < 9; i++) {
    const a = -1.3 + i * 0.32;
    const lock = add(
      anime,
      new T.ConeGeometry(0.074, 0.31, 4),
      i % 3 ? '#534d83' : '#8d81bd',
      Math.sin(a) * 0.2,
      0.19 + Math.cos(a) * 0.025,
      -0.15 - Math.cos(a) * 0.06,
    );
    lock.rotation.set(0.22, 0, Math.PI + Math.sin(a) * 0.4);
  }
  for (const side of [-1, 1]) {
    const lock = add(
      anime,
      new T.ConeGeometry(0.11, 0.48, 5),
      '#514d80',
      side * 0.235,
      0.02,
      0.07,
    );
    lock.rotation.z = Math.PI + side * 0.1;
    ball(anime, '#f3cd91', side * 0.238, 0.18, 0.01, 0.036);
  }
  const legs: T.Group[] = [],
    knees: T.Group[] = [],
    arms: T.Group[] = [],
    elbows: T.Group[] = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const leg = pivot(root, i ? 'legR' : 'legL', side * 0.145, 0.92, 0);
    legs.push(leg);
    add(
      leg,
      new T.CylinderGeometry(0.115, 0.095, 0.39, 8),
      '#344261',
      0,
      -0.18,
      0,
    );
    const knee = pivot(leg, i ? 'kneeR' : 'kneeL', 0, -0.39, 0);
    knees.push(knee);
    ball(knee, '#7686ab', 0, 0, -0.035, 0.096);
    add(
      knee,
      new T.CylinderGeometry(0.09, 0.075, 0.34, 8),
      '#3c4d70',
      0,
      -0.18,
      0,
    );
    box(knee, '#eef0fa', 0, -0.42, -0.07, 0.21, 0.15, 0.34);
    box(knee, '#8c9bc0', 0, -0.5, -0.065, 0.218, 0.04, 0.36);
    box(knee, color, 0, -0.37, -0.175, 0.12, 0.035, 0.03);
    const arm = pivot(chest, i ? 'armR' : 'armL', side * 0.345, 0.45, 0);
    arms.push(arm);
    add(arm, new T.CylinderGeometry(0.112, 0.091, 0.28, 8), color, 0, -0.13, 0);
    const elbow = pivot(arm, i ? 'elbowR' : 'elbowL', 0, -0.28, 0);
    elbows.push(elbow);
    add(
      elbow,
      new T.CylinderGeometry(0.085, 0.069, 0.25, 8),
      '#edf0f7',
      0,
      -0.11,
      0,
    );
    box(elbow, '#8d9cb8', 0, -0.225, 0, 0.15, 0.07, 0.15);
    ball(elbow, '#ebc6ac', 0, -0.29, 0, 0.077);
  }
  const scarf = pivot(chest, 'scarf', 0, 0.53, 0.07);
  add(
    scarf,
    new T.TorusGeometry(0.17, 0.065, 5, 12),
    '#eeaa91',
    0,
    0,
    0,
  ).rotation.x = Math.PI / 2;
  box(scarf, '#f3bca1', -0.11, -0.18, 0.18, 0.14, 0.44, 0.04).rotation.x =
    -0.32;
  const coat = pivot(chest, 'coat-tail', 0, -0.06, 0.1);
  for (const side of [-1, 1])
    box(coat, color, side * 0.15, -0.2, 0.14, 0.26, 0.46, 0.07).rotation.z =
      -side * 0.13;
  box(chest, '#434765', 0, 0.16, 0.225, 0.33, 0.35, 0.17);
  box(chest, '#b2aad9', 0, 0.18, 0.326, 0.24, 0.15, 0.035);
  const gun = pivot(elbows[1], 'gun', 0, -0.29, -0.03);
  const gunPaint = pivot(gun, 'gun-paint', 0, 0, 0);
  box(gunPaint, '#434d72', 0, 0.025, 0, 0.13, 0.24, 0.12);
  add(
    gunPaint,
    new T.CylinderGeometry(0.09, 0.12, 0.48, 10),
    '#b2bce1',
    0,
    0.18,
    -0.06,
  ).rotation.x = Math.PI / 2;
  add(
    gunPaint,
    new T.CylinderGeometry(0.13, 0.13, 0.08, 10),
    '#b18afa',
    0,
    0.18,
    -0.32,
  ).rotation.x = Math.PI / 2;
  ball(gunPaint, '#df9dd1', 0, 0.27, 0.015, 0.125);

  const gunShotgun = pivot(gun, 'gun-shotgun', 0, 0, 0);
  box(gunShotgun, '#32374e', 0, 0.025, 0, 0.15, 0.22, 0.15);
  add(
    gunShotgun,
    new T.CylinderGeometry(0.075, 0.08, 0.52, 10),
    '#9ea8c8',
    0,
    0.17,
    -0.12,
  ).rotation.x = Math.PI / 2;
  add(
    gunShotgun,
    new T.CylinderGeometry(0.065, 0.07, 0.45, 10),
    '#25293d',
    0,
    0.09,
    -0.10,
  ).rotation.x = Math.PI / 2;
  box(gunShotgun, '#e5be6b', 0, 0.17, -0.38, 0.12, 0.12, 0.06);

  const gunSniper = pivot(gun, 'gun-sniper', 0, 0, 0);
  box(gunSniper, '#232838', 0, 0.02, 0, 0.11, 0.20, 0.18);
  add(
    gunSniper,
    new T.CylinderGeometry(0.045, 0.05, 0.85, 10),
    '#828fae',
    0,
    0.17,
    -0.28,
  ).rotation.x = Math.PI / 2;
  add(
    gunSniper,
    new T.CylinderGeometry(0.055, 0.055, 0.38, 10),
    '#181b25',
    0,
    0.28,
    -0.10,
  ).rotation.x = Math.PI / 2;
  box(gunSniper, '#64d4ef', 0, 0.28, -0.30, 0.06, 0.06, 0.02);
  const tablet = pivot(elbows[0], 'tablet', 0, -0.29, 0);
  box(tablet, '#39415b', 0, 0.04, -0.11, 0.36, 0.035, 0.47);
  box(tablet, '#a6ddeb', 0, 0.065, -0.11, 0.3, 0.012, 0.4);
  for (let i = 0; i < 3; i++)
    box(tablet, '#e7f5ff', -0.02, 0.073, -0.2 + i * 0.09, 0.22, 0.005, 0.025);
  const disposeAgentMaterials = buildAgentSkin(avatar, color);
  rigs.set(avatar, {
    root,
    chest,
    head,
    legs,
    knees,
    arms,
    elbows,
    scarf,
    coat,
    gun,
    tablet,
    classic,
    anime,
    phase: 0,
    speed: 0,
    airborne: false,
    landing: 0,
    recoil: 0,
    equip: 0,
    tool: '',
  });
  // Цвет запекается в вершины: одна отрисовка на сустав вместо десятков отдельных деталей.
  const skin = new T.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.8,
  });
  const outlineMaterial = new T.ShaderMaterial({
    side: T.BackSide,
    vertexShader:
      'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position+normal*.009,1.0);}',
    fragmentShader: 'void main(){gl_FragColor=vec4(.24,.22,.34,1.0);}',
  });
  const joints: T.Group[] = [];
  avatar.traverse((o) => {
    if (o instanceof T.Group) joints.push(o);
  });
  for (const joint of joints) {
    const pieces = joint.children.filter(
      (o): o is T.Mesh => o instanceof T.Mesh,
    );
    if (!pieces.length) continue;
    const geos = pieces.map((p) => {
      p.updateMatrix();
      const geo = p.geometry.index
        ? p.geometry.toNonIndexed()
        : p.geometry.clone();
      geo.applyMatrix4(p.matrix);
      const color = (p.material as T.MeshStandardMaterial).color;
      const colors = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = color.r;
        colors[i + 1] = color.g;
        colors[i + 2] = color.b;
      }
      geo.setAttribute('color', new T.BufferAttribute(colors, 3));
      return geo;
    });
    const geometry = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!geometry) continue;
    pieces.forEach((p) => {
      p.removeFromParent();
      p.geometry.dispose();
    });
    const shape = new T.Mesh(geometry, skin);
    shape.castShadow = true;
    joint.add(shape);
    const outline = new T.Mesh(geometry, outlineMaterial);
    outline.name = 'anime-outline';
    outline.visible = false;
    outline.raycast = () => {};
    joint.add(outline);
  }
  materials.forEach((m) => m.dispose());
  disposeAgentMaterials();
  const faceRoot = new T.Group();
  faceRoot.name = 'unmasked-head';
  while (head.children.length) faceRoot.add(head.children[0]);
  head.add(faceRoot);
  const bag = new T.Group();
  bag.name = 'anonymous-bag';
  bag.rotation.y = Math.PI;
  bag.position.y = 0.12;
  bag.visible = false;
  const paper = new T.Mesh(
    new T.BoxGeometry(0.56, 0.65, 0.52),
    new T.MeshStandardMaterial({ color: '#d7b587', roughness: 1 }),
  );
  bag.add(paper);
  const ink = new T.MeshBasicMaterial({ color: '#34323a' });
  for (const x of [-0.105, 0.105]) {
    const eye = new T.Mesh(new T.CircleGeometry(0.026, 8), ink);
    eye.position.set(x, 0.04, 0.264);
    bag.add(eye);
  }
  const smile = new T.Mesh(
    new T.TorusGeometry(0.12, 0.012, 4, 16, Math.PI),
    ink,
  );
  smile.rotation.z = Math.PI;
  smile.position.set(0, -0.035, 0.264);
  bag.add(smile);
  head.add(bag);
  const grenade = makeGrenade('#f49fd6');
  grenade.name = 'held-grenade';
  grenade.visible = false;
  grenade.position.set(0, -0.3, 0.03);
  elbows[1].add(grenade);
  setAvatarStyle(avatar, false);
  return avatar;
}

export function setAvatarStyle(avatar: T.Group, anime: boolean) {
  const r = rigs.get(avatar);
  if (!r) return;
  avatar.traverse((o) => {
    if (o.name === 'anime-outline') o.visible = anime;
    if (o.name === 'legacy-skin') o.visible = anime;
    if (o.name === 'agent-skin') o.visible = !anime;
  });
  r.classic.visible = !anime;
  r.anime.visible = anime;
  r.coat.visible = anime;
  r.head.scale.setScalar(anime ? 1.17 : 1);
  r.scarf.visible = anime;
}
export function setAvatarAnonymous(avatar: T.Group, value: boolean) {
  const face = avatar.getObjectByName('unmasked-head'),
    bag = avatar.getObjectByName('anonymous-bag');
  if (face) face.visible = !value;
  if (bag) bag.visible = value;
}
export function avatarShoot(avatar: T.Group) {
  const r = rigs.get(avatar);
  if (r) r.recoil = 1;
}

/** Одни суставы и переходы для своего персонажа и сетевых аватаров. */
export function animateAvatar(
  avatar: T.Group,
  m: AvatarMotion,
  dt: number,
  time: number,
) {
  const r = rigs.get(avatar);
  if (!r) return;
  const follow = (a: number, b: number, rate = 12) =>
    T.MathUtils.lerp(a, b, 1 - Math.exp(-rate * dt));
  const airborne = m.airborne;
  if (r.airborne && !airborne) r.landing = 1;
  r.airborne = airborne;
  r.landing = Math.max(0, r.landing - dt * 4);
  r.recoil = Math.max(0, r.recoil - dt * 8);
  if (m.tool !== r.tool) {
    r.equip = 1;
    r.tool = m.tool;
  }
  r.equip = Math.max(0, r.equip - dt * 4);
  r.speed = follow(r.speed, m.speed);
  r.phase += dt * (r.speed * 2.6 + 1.3);
  const isDead = m.hp === 0;
  if (isDead) {
    r.root.position.y = follow(r.root.position.y, 0.12, 9);
    r.root.rotation.x = follow(r.root.rotation.x, -Math.PI / 2, 7);
    r.root.rotation.z = follow(r.root.rotation.z, 0.35, 6);
    r.head.rotation.x = follow(r.head.rotation.x, 0.4, 8);
    r.head.rotation.y = follow(r.head.rotation.y, 0.3, 8);
    r.arms[0].rotation.x = follow(r.arms[0].rotation.x, -0.3, 6);
    r.arms[1].rotation.x = follow(r.arms[1].rotation.x, -0.5, 6);
    r.knees[0].rotation.x = follow(r.knees[0].rotation.x, -0.4, 6);
    r.knees[1].rotation.x = follow(r.knees[1].rotation.x, -0.2, 6);
    r.gun.visible = false;
    r.tablet.visible = false;
    const g = avatar.getObjectByName('held-grenade');
    if (g) g.visible = false;
    return;
  }

  const stride = Math.min(1, r.speed / 3.3),
    sprint = Math.max(0, (r.speed - 3.4) / 3.1),
    wave = Math.sin(r.phase);
  const sitting = m.stance === 'sit',
    prone = m.stance === 'lie';
  const breathing = Math.sin(time * 1.8) * 0.012;
  r.root.position.y = follow(
    r.root.position.y,
    prone
      ? 0.2
      : sitting
        ? -0.4
        : breathing + Math.abs(wave) * 0.045 * stride - r.landing * 0.12,
  );
  r.root.rotation.x = follow(r.root.rotation.x, prone ? -Math.PI / 2 : 0);
  r.root.rotation.z = follow(
    r.root.rotation.z,
    prone ? wave * 0.055 * stride : -m.strafe * 0.065 * stride,
  );
  r.chest.rotation.x = follow(
    r.chest.rotation.x,
    sitting ? 0.06 : prone ? 0.04 : -sprint * 0.16 - r.landing * 0.18,
  );
  r.chest.rotation.y = follow(
    r.chest.rotation.y,
    wave * (m.aiming ? 0.018 : 0.065) * stride,
  );
  r.head.rotation.x = follow(
    r.head.rotation.x,
    m.working ? 0.22 : prone ? 0.6 : -m.pitch * 0.3,
  );
  r.head.rotation.z = follow(r.head.rotation.z, Math.sin(time * 1.5) * 0.018);
  const grenade = avatar.getObjectByName('held-grenade');
  if (grenade) {
    grenade.visible = m.tool === 'grenade';
    if (grenade.visible) setGrenadeStyle(grenade, m.variant || 'pinata');
  }
  const armed = ['paint', 'confetti', 'grenade', 'sniper'].includes(m.tool);
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1,
      step = Math.sin(r.phase + (i ? Math.PI : 0));
    let hip = step * 0.65 * stride * (m.forward < 0 ? -1 : 1),
      knee = Math.max(0, -step) * 0.85 * stride;
    if (sitting) {
      hip = m.crouching ? 0.92 + step * 0.12 * stride : 1.4;
      knee = m.crouching ? -1.7 : -1.5;
    } else if (prone) {
      hip = step * 0.18 * stride;
      knee = -Math.max(0, step) * 0.7 * stride;
    } else if (airborne) {
      hip = i ? -0.35 : 0.65;
      knee = -0.75 - Math.max(0, m.velocityY) * 0.06;
    } else {
      knee = -knee - r.landing * 0.65;
      hip += r.landing * 0.3;
    }
    r.legs[i].rotation.x = follow(r.legs[i].rotation.x, hip);
    r.legs[i].rotation.z = follow(
      r.legs[i].rotation.z,
      sitting ? side * 0.12 : -m.strafe * step * 0.3 * stride,
    );
    r.knees[i].rotation.x = follow(r.knees[i].rotation.x, knee);
    let arm = -step * 0.55 * stride,
      elbow = 0.12 + sprint * 0.7;
    if (sitting) {
      arm = 0.45;
      elbow = 0.7;
    }
    if (prone) {
      arm = 2.3 + step * 0.22 * stride;
      elbow = 0.85;
    }
    if (airborne) {
      arm = -0.4;
      elbow = 0.8;
    }
    if (armed && !prone) {
      arm = 0.65 - m.pitch * 0.55 - r.recoil * 0.2;
      elbow = 0.93 + r.recoil * 0.25;
    }
    if (m.reload) {
      const reload = Math.sin(m.reload * Math.PI);
      arm = i ? 0.7 : 0.4 + reload * 0.7;
      elbow = i ? 1.1 : 1.2 + reload * 0.6;
    }
    if (m.working || m.inventory || m.tool === 'pointer') {
      arm = i ? 0.55 : 0.85;
      elbow = i ? 1.45 : 0.9;
    }
    r.arms[i].rotation.x = follow(r.arms[i].rotation.x, arm - r.equip * 0.45);
    r.arms[i].rotation.z = follow(
      r.arms[i].rotation.z,
      prone
        ? side * 0.24
        : armed
          ? -side * 0.13
          : side * (0.05 + sprint * 0.12),
    );
    r.elbows[i].rotation.x = follow(r.elbows[i].rotation.x, elbow);
  }
  r.gun.rotation.x =
    -r.arms[1].rotation.x - r.elbows[1].rotation.x - m.pitch * 0.6;
  r.gun.visible = armed && m.tool !== 'grenade' && !m.working && !m.inventory;
  r.gun.position.z = follow(r.gun.position.z, -0.03 + r.recoil * 0.08);

  const gunPaint = r.gun.getObjectByName('gun-paint');
  if (gunPaint) gunPaint.visible = m.tool === 'paint';
  const gunShotgun = r.gun.getObjectByName('gun-shotgun');
  if (gunShotgun) gunShotgun.visible = m.tool === 'confetti';
  const gunSniper = r.gun.getObjectByName('gun-sniper');
  if (gunSniper) gunSniper.visible = m.tool === 'sniper';

  r.tablet.visible = !!m.working || !!m.inventory || m.tool === 'pointer';
  r.scarf.rotation.x = follow(
    r.scarf.rotation.x,
    -stride * 0.45 + Math.sin(time * 5) * 0.08 * stride,
  );
  r.coat.rotation.x = follow(
    r.coat.rotation.x,
    -stride * 0.28 + wave * 0.08 * stride,
  );
}

export function followCameraHeading(
  current: number,
  camera: number,
  dt: number,
) {
  return (
    current +
    Math.atan2(Math.sin(camera - current), Math.cos(camera - current)) *
      (1 - Math.exp(-18 * dt))
  );
}
