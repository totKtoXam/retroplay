import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Авторская модель «AERO»: отдельные поверхности одежды на существующем скелете. */
export function buildAgentSkin(avatar: T.Group, accent: string) {
  const joints: T.Group[] = [];
  avatar.traverse((o) => {
    if (o instanceof T.Group) joints.push(o);
  });
  for (const joint of joints) {
    const meshes = joint.children.filter((o) => o instanceof T.Mesh);
    if (!meshes.length) continue;
    const legacy = new T.Group();
    legacy.name = 'legacy-skin';
    meshes.forEach((m) => legacy.add(m));
    joint.add(legacy);
  }
  const materials = new Map<string, T.MeshStandardMaterial>();
  const material = (color: string) => {
    if (!materials.has(color))
      materials.set(
        color,
        new T.MeshStandardMaterial({ color, roughness: 0.68 }),
      );
    return materials.get(color)!;
  };
  const surface = (name: string) => {
    const group = new T.Group();
    group.name = 'agent-skin';
    avatar.getObjectByName(name)!.add(group);
    return group;
  };
  const part = (
    p: T.Group,
    geo: T.BufferGeometry,
    color: string,
    x = 0,
    y = 0,
    z = 0,
  ) => {
    const m = new T.Mesh(geo, material(color));
    m.position.set(x, y, z);
    p.add(m);
    return m;
  };
  const box = (
    p: T.Group,
    c: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    r = 0.025,
  ) =>
    part(
      p,
      new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3)),
      c,
      x,
      y,
      z,
    );
  const ellipsoid = (
    p: T.Group,
    c: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) => {
    const g = new T.SphereGeometry(1, 16, 12);
    g.scale(w, h, d);
    return part(p, g, c, x, y, z);
  };
  const loft = (p: T.Group, c: string, rings: number[][], z = 0) => {
    const vertices: number[] = [],
      indices: number[] = [],
      n = 16;
    for (const [y, w, d] of rings)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        vertices.push(Math.cos(a) * w, y, Math.sin(a) * d + z);
      }
    for (let j = 0; j < rings.length - 1; j++)
      for (let i = 0; i < n; i++) {
        const a = j * n + i,
          b = j * n + ((i + 1) % n);
        indices.push(a, a + n, b, b, a + n, b + n);
      }
    // Торцы закрыты, чтобы суставы оставались цельными при прыжках и перезарядке.
    for (const row of [0, rings.length - 1])
      for (let i = 1; i < n - 1; i++) {
        if (row === 0) indices.push(row * n, row * n + i, row * n + i + 1);
        else indices.push(row * n, row * n + i + 1, row * n + i);
      }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    g.setIndex(indices);
    g.setAttribute(
      'uv',
      new T.Float32BufferAttribute(
        new Float32Array((vertices.length / 3) * 2),
        2,
      ),
    );
    g.computeVertexNormals();
    return part(p, g, c);
  };
  const ink = '#192b36',
    fabric = '#324a55',
    armor = '#708891',
    edge = '#bfcac0',
    skin = '#c99a7d',
    gold = '#d7ae72';
  const body = surface('chest');
  loft(body, ink, [
    [-0.13, 0.205, 0.13],
    [0, 0.215, 0.145],
    [0.25, 0.29, 0.17],
    [0.48, 0.27, 0.135],
    [0.55, 0.12, 0.09],
  ]);
  for (const side of [-1, 1]) {
    box(
      body,
      side < 0 ? '#c17c65' : '#627f88',
      side * 0.143,
      0.3,
      -0.139,
      0.235,
      0.34,
      0.076,
      0.035,
    ).rotation.z = side * -0.12;
    box(body, fabric, side * 0.245, 0.1, 0.015, 0.085, 0.25, 0.22);
    box(body, accent, side * 0.23, 0.4, -0.177, 0.055, 0.17, 0.025).rotation.z =
      -side * 0.14;
    box(body, ink, side * 0.18, -0.06, -0.147, 0.115, 0.14, 0.095);
    box(body, gold, side * 0.18, -0.055, -0.2, 0.07, 0.032, 0.008);
  }
  box(body, ink, 0, 0.3, -0.19, 0.035, 0.39, 0.025);
  box(body, gold, 0, -0.1, -0.157, 0.105, 0.07, 0.025);
  box(body, fabric, 0, 0.25, 0.155, 0.35, 0.36, 0.095, 0.04);
  box(body, edge, 0, 0.3, 0.211, 0.25, 0.2, 0.028);
  box(body, accent, 0, 0.3, 0.23, 0.035, 0.15, 0.014);
  for (const side of [-1, 1])
    box(body, ink, side * 0.15, 0.47, 0.16, 0.065, 0.18, 0.06).rotation.x =
      -0.4;
  const head = surface('head');
  loft(
    head,
    skin,
    [
      [-0.13, 0.065, 0.065],
      [-0.035, 0.079, 0.07],
      [0.015, 0.082, 0.076],
      [0.06, 0.126, 0.102],
      [0.18, 0.148, 0.118],
      [0.27, 0.13, 0.108],
      [0.3, 0.09, 0.08],
    ],
    -0.009,
  );
  // Скулы, нос, веки и волосы формируют лицо вместо шара с точками.
  for (const side of [-1, 1]) {
    ellipsoid(head, skin, side * 0.143, 0.15, 0, 0.026, 0.046, 0.022);
    box(
      head,
      '#eee4d2',
      side * 0.065,
      0.163,
      -0.113,
      0.065,
      0.024,
      0.012,
      0.009,
    );
    box(
      head,
      '#374f53',
      side * 0.062,
      0.164,
      -0.122,
      0.022,
      0.022,
      0.008,
      0.006,
    );
    box(
      head,
      ink,
      side * 0.064,
      0.198,
      -0.116,
      0.076,
      0.018,
      0.017,
      0.006,
    ).rotation.z = -side * 0.1;
    box(
      head,
      skin,
      side * 0.062,
      0.124,
      -0.108,
      0.065,
      0.025,
      0.019,
      0.01,
    ).rotation.z = side * 0.18;
  }
  loft(
    head,
    '#bc8c70',
    [
      [0.065, 0.022, 0.005],
      [0.12, 0.023, 0.023],
      [0.2, 0.013, 0.006],
    ],
    -0.12,
  );
  box(head, '#795c53', 0, 0.05, -0.092, 0.048, 0.009, 0.009, 0.003);
  ellipsoid(head, ink, 0, 0.26, 0.028, 0.153, 0.096, 0.122);
  for (let i = 0; i < 5; i++) {
    const hair = box(
      head,
      i === 3 ? '#52727a' : ink,
      -0.11 + i * 0.05,
      0.286 + i * 0.006,
      -0.026,
      0.06,
      0.076,
      0.18,
      0.025,
    );
    hair.rotation.set(-0.3, 0, -0.22);
  }
  box(head, fabric, -0.15, 0.16, 0.004, 0.04, 0.092, 0.067);
  box(head, accent, -0.177, 0.17, -0.006, 0.008, 0.042, 0.035);
  const mic = part(
    head,
    new T.CylinderGeometry(0.007, 0.007, 0.15, 6),
    ink,
    -0.14,
    0.075,
    -0.072,
  );
  mic.rotation.x = -0.8;
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1;
    const leg = surface(i ? 'legR' : 'legL'),
      knee = surface(i ? 'kneeR' : 'kneeL');
    loft(leg, fabric, [
      [-0.4, 0.085, 0.09],
      [-0.25, 0.112, 0.113],
      [-0.06, 0.127, 0.125],
      [0.04, 0.12, 0.12],
    ]);
    box(leg, ink, side * 0.096, -0.19, 0.014, 0.075, 0.23, 0.17);
    box(leg, armor, side * 0.131, -0.16, -0.011, 0.029, 0.13, 0.11);
    box(leg, accent, 0, -0.29, -0.109, 0.07, 0.027, 0.018, 0.006);
    loft(knee, ink, [
      [-0.4, 0.073, 0.081],
      [-0.26, 0.075, 0.085],
      [-0.05, 0.092, 0.098],
      [0.02, 0.092, 0.09],
    ]);
    box(knee, armor, 0, -0.055, -0.083, 0.15, 0.16, 0.062, 0.035);
    box(knee, fabric, 0, -0.23, -0.077, 0.112, 0.13, 0.035);
    box(knee, ink, 0, -0.413, -0.043, 0.181, 0.18, 0.3, 0.045);
    box(knee, '#4f6068', 0, -0.49, -0.055, 0.185, 0.034, 0.32, 0.009);
    box(knee, armor, 0, -0.405, -0.164, 0.13, 0.075, 0.066, 0.022);
    const arm = surface(i ? 'armR' : 'armL'),
      elbow = surface(i ? 'elbowR' : 'elbowL');
    loft(arm, fabric, [
      [-0.29, 0.075, 0.079],
      [-0.13, 0.093, 0.1],
      [0.045, 0.116, 0.108],
    ]);
    ellipsoid(
      arm,
      i ? '#627f88' : '#c17c65',
      side * 0.014,
      -0.015,
      0.006,
      0.102,
      0.081,
      0.105,
    );
    box(arm, accent, side * 0.113, -0.012, 0.003, 0.019, 0.062, 0.082, 0.008);
    loft(elbow, ink, [
      [-0.24, 0.055, 0.061],
      [-0.08, 0.075, 0.077],
      [0.01, 0.078, 0.081],
    ]);
    box(elbow, armor, 0, -0.112, -0.061, 0.116, 0.18, 0.045);
    box(elbow, accent, 0, -0.135, -0.087, 0.072, 0.022, 0.008, 0.002);
    box(elbow, ink, 0, -0.26, 0, 0.105, 0.074, 0.108);
    box(elbow, fabric, 0, -0.295, -0.007, 0.104, 0.086, 0.107);
    for (let f = 0; f < 4; f++)
      box(
        elbow,
        skin,
        -0.036 + f * 0.024,
        -0.34,
        -0.014,
        0.018,
        0.042,
        0.07,
        0.007,
      );
    ellipsoid(elbow, ink, side * 0.057, -0.29, -0.01, 0.025, 0.04, 0.035);
  }
  const weapon = surface('gun');
  box(weapon, ink, 0, 0.025, 0.005, 0.1, 0.21, 0.1);
  box(weapon, armor, 0, 0.16, -0.1, 0.13, 0.14, 0.42, 0.018);
  box(weapon, accent, 0, 0.19, -0.33, 0.14, 0.08, 0.06, 0.014);
  box(weapon, ink, 0, 0.25, -0.09, 0.055, 0.022, 0.3, 0.005);
  part(
    weapon,
    new T.CylinderGeometry(0.033, 0.033, 0.24, 12),
    ink,
    0,
    0.16,
    -0.39,
  ).rotation.x = Math.PI / 2;
  box(weapon, gold, 0, 0.04, -0.16, 0.095, 0.16, 0.12);
  // Материалы удалит существующая пакетная сборка после запекания цвета в вершины.
  return () => materials.forEach((m) => m.dispose());
}
