import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ZONES, type RoomState } from '@/lib/model';
export const STATIONS = [
  [-9, -6],
  [9, -6],
  [-9, 9],
  [9, 9],
];
export function createWorldScene() {
  const scene = new T.Scene(),
    decor = new T.Group();
  scene.add(decor);
  const mats = new Map<string, T.MeshStandardMaterial>();
  const material = (c: string) => {
    if (!mats.has(c))
      mats.set(
        c,
        new T.MeshStandardMaterial({
          color: c,
          roughness: 0.85,
          flatShading: true,
        }),
      );
    return mats.get(c)!;
  };
  const mesh = (
    geo: T.BufferGeometry,
    c: string,
    x: number,
    y: number,
    z: number,
    p: T.Object3D = decor,
  ) => {
    const m = new T.Mesh(geo, material(c));
    m.position.set(x, y, z);
    p.add(m);
    return m;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    c: string,
    x: number,
    y: number,
    z: number,
    p: T.Object3D = decor,
  ) => mesh(new T.BoxGeometry(w, h, d), c, x, y, z, p);
  const cyl = (
    rt: number,
    rb: number,
    h: number,
    c: string,
    x: number,
    y: number,
    z: number,
    p: T.Object3D = decor,
    n = 16,
  ) => mesh(new T.CylinderGeometry(rt, rb, h, n), c, x, y, z, p);
  const sphere = (
    r: number,
    c: string,
    x: number,
    y: number,
    z: number,
    p: T.Object3D = decor,
  ) => mesh(new T.IcosahedronGeometry(r, 1), c, x, y, z, p);
  const hemi = new T.HemisphereLight('#e1edff', '#6c6483', 2.7);
  scene.add(hemi);
  const sunlight = new T.DirectionalLight('#ffedce', 3.1);
  sunlight.position.set(-18, 35, 18);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  sunlight.shadow.camera.left = -33;
  sunlight.shadow.camera.right = 33;
  sunlight.shadow.camera.top = 33;
  sunlight.shadow.camera.bottom = -33;
  sunlight.shadow.camera.near = 1;
  sunlight.shadow.camera.far = 110;
  sunlight.shadow.bias = -0.0005;
  sunlight.shadow.normalBias = 0.035;
  scene.add(sunlight);
  const rim = new T.DirectionalLight('#899aff', 1.2);
  rim.position.set(20, 8, -25);
  scene.add(rim);
  const skyMaterial = new T.ShaderMaterial({
    uniforms: {
      top: { value: new T.Color('#76b6ed') },
      bottom: { value: new T.Color('#e0dff4') },
    },
    vertexShader:
      'varying vec3 vWorld; void main(){vWorld=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:
      'uniform vec3 top;uniform vec3 bottom;varying vec3 vWorld;void main(){float h=clamp((normalize(vWorld).y+0.04)*1.5,0.0,1.0);gl_FragColor=vec4(mix(bottom,top,pow(h,0.7)),1.0);}',
    side: T.BackSide,
    depthWrite: false,
  });
  scene.add(new T.Mesh(new T.SphereGeometry(160, 24, 16), skyMaterial));
  const sun = new T.Mesh(
    new T.SphereGeometry(3.3, 20, 12),
    new T.MeshBasicMaterial({ color: '#fff1cb' }),
  );
  sun.position.set(-55, 36, -80);
  scene.add(sun);
  const starPositions = new Float32Array(240 * 3);
  for (let i = 0; i < 240; i++) {
    const a = i * 2.3999,
      r = 120,
      h = 15 + (i % 29) * 3;
    starPositions[i * 3] = Math.cos(a) * r;
    starPositions[i * 3 + 1] = h;
    starPositions[i * 3 + 2] = Math.sin(a) * r;
  }
  const stars = new T.Points(
    new T.BufferGeometry().setAttribute(
      'position',
      new T.BufferAttribute(starPositions, 3),
    ),
    new T.PointsMaterial({
      color: '#dceaff',
      size: 0.32,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
    }),
  );
  scene.add(stars);
  const groundMaterial = material('#749879'),
    leafMaterials = [
      material('#427f74'),
      material('#548b8c'),
      material('#74a393'),
    ];
  // Каменный остров над водой, плавные уровни рельефа и длинная панорама гор.
  cyl(29, 25, 3, '#747994', 0, -1.7, 0, decor, 64);
  cyl(29, 29, 0.25, '#749879', 0, -0.05, 0, decor, 64);
  const water = new T.Mesh(
    new T.PlaneGeometry(500, 500),
    new T.MeshStandardMaterial({
      color: '#599eb8',
      roughness: 0.35,
      metalness: 0.15,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -3.1;
  decor.add(water);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2,
      r = 78 + (i % 3) * 9,
      h = 17 + (i % 5) * 6;
    const mountain = mesh(
      new T.ConeGeometry(17, h, 5),
      ['#95a7c8', '#8c96b7', '#aeb7cf'][i % 3],
      Math.cos(a) * r,
      h / 2 - 6,
      Math.sin(a) * r,
    );
    mountain.rotation.y = i * 0.6;
    const snow = mesh(
      new T.ConeGeometry(5.8, h * 0.33, 5),
      '#eef2f9',
      Math.cos(a) * r,
      h * 0.84 - 6,
      Math.sin(a) * r,
    );
    snow.rotation.y = i * 0.6;
  }
  const pond = new T.Mesh(
    new T.CircleGeometry(5, 40),
    new T.MeshStandardMaterial({
      color: '#56b6d3',
      roughness: 0.28,
      metalness: 0.22,
    }),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.scale.set(1, 1.8, 1);
  pond.position.set(-19, 0.09, 2);
  decor.add(pond);
  const pondRim = cyl(5.35, 5.5, 0.18, '#aeb8c4', -19, 0.01, 2, decor, 40);
  pondRim.scale.z = 1.8;
  // Цветные зоны на отдельных светлых площадках.
  cyl(4.4, 4.6, 0.2, '#b8c5d1', 0, 0.09, 1, decor, 32);
  cyl(4, 4, 0.06, '#e4dfdb', 0, 0.22, 1, decor, 32);
  cyl(1.6, 1.7, 0.12, '#7485c6', 0, 0.27, 1, decor, 12);
  const emblem = cyl(0.8, 0.8, 0.14, '#d6be8b', 0, 0.3, 1, decor, 6);
  emblem.rotation.y = Math.PI / 6;
  box(3, 0.08, 36, '#bfc3c4', 0, 0.14, 0);
  box(23, 0.09, 2.5, '#bfc3c4', 0, 0.14, -3);
  box(23, 0.09, 2.5, '#bfc3c4', 0, 0.14, 12);
  for (let i = -8; i < 10; i++) {
    box(2.75, 0.025, 0.035, '#a5acb5', 0, 0.195, i * 1.8);
  }
  // Водоём и деревянный мост: заметный ориентир для камеры.
  for (let i = 0; i < 9; i++)
    box(4, 0.13, 0.48, '#b39782', -19, 0.43, i * 0.48 - 0.2);
  for (const x of [-21, -17]) {
    box(0.08, 0.08, 4.5, '#818295', x, 1.2, 1.8);
    for (let i = 0; i < 3; i++) box(0.12, 1.2, 0.12, '#9e8f87', x, 0.64, i * 2);
  }
  const snowCaps: T.Object3D[] = [];
  const blossomGroup = new T.Group();
  decor.add(blossomGroup);
  const pine = (x: number, z: number, h: number, i: number) => {
    cyl(0.12, 0.22, h * 0.52, '#806b66', x, h * 0.26, z, decor, 7);
    for (let k = 0; k < 3; k++) {
      const tree = mesh(
        new T.ConeGeometry(h * 0.28 - k * 0.18, h * 0.54, 7),
        '#427f74',
        x,
        h * 0.55 + k * h * 0.19,
        z,
      );
      tree.material = leafMaterials[i % 3];
      const cap = mesh(
        new T.ConeGeometry(h * 0.18 - k * 0.1, h * 0.31, 7),
        '#dce9f0',
        x,
        h * 0.67 + k * h * 0.19,
        z,
      );
      snowCaps.push(cap);
    }
  };
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2,
      r = 23 + (i % 3) * 1.4;
    const x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    if (x < -17 && Math.abs(z) < 9) continue;
    pine(x, z, 3.4 + (i % 4) * 0.6, i);
  }
  for (const x of [-14, 14]) {
    cyl(0.12, 0.3, 3.3, '#937f7b', x, 1.65, -12, decor, 7);
    for (let j = 0; j < 5; j++) {
      const a = j * 2.4;
      sphere(
        1.2,
        ['#efa7ba', '#f6c2c9', '#d28bab'][j % 3],
        x + Math.cos(a) * 0.9,
        3.4 + (j % 2) * 0.6,
        -12 + Math.sin(a) * 0.8,
        blossomGroup,
      );
    }
  }
  for (let i = 0; i < 45; i++) {
    const a = i * 2.4,
      r = 17 + (i % 9);
    const rock = mesh(
      new T.DodecahedronGeometry(0.3 + (i % 4) * 0.13, 0),
      ['#a6b0b9', '#bdc4ce', '#8593a7'][i % 3],
      Math.cos(a) * r,
      0.12,
      Math.sin(a) * r,
    );
    rock.rotation.set(i, 0, i * 0.6);
  }
  const flowers = new T.Group();
  decor.add(flowers);
  for (let i = 0; i < 70; i++) {
    const a = i * 2.399,
      r = 14 + (i % 7),
      x = Math.sin(a) * r,
      z = Math.cos(a) * r;
    box(0.035, 0.24, 0.035, '#487e7a', x, 0.28, z, flowers);
    sphere(0.1, ['#c5a3ef', '#f4d599', '#eb90b9'][i % 3], x, 0.44, z, flowers);
  }
  // Современные павильоны: доски — часть мира, а не висящий интерфейс.
  const boards: {
    texture: T.CanvasTexture;
    canvas: HTMLCanvasElement;
    zone: string;
    panel: T.Mesh;
  }[] = [];
  STATIONS.forEach(([x, z], i) => {
    const zone = ZONES[i],
      c = ['#669feb', '#e49b9e', '#e4bd71', '#a798e2'][i];
    box(6.7, 0.2, 5, c, x, 0.18, z + 1.1);
    box(6.2, 0.1, 4.5, '#dee2e7', x, 0.34, z + 1.1);
    for (const dx of [-2.7, 2.7]) {
      box(0.16, 4.6, 0.16, '#56667e', x + dx, 2.45, z);
      box(0.32, 0.06, 0.32, '#ecddbb', x + dx, 4.8, z);
    }
    box(6.1, 0.16, 1.3, c, x, 4.7, z + 0.15);
    box(5.65, 2.95, 0.23, '#354258', x, 2.8, z);
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    const panel = new T.Mesh(
      new T.PlaneGeometry(5.4, 2.7),
      new T.MeshBasicMaterial({ map: texture }),
    );
    panel.position.set(x, 2.8, z + 0.13);
    panel.userData.zone = zone.id;
    scene.add(panel);
    boards.push({ texture, canvas, zone: zone.id, panel });
    box(3.5, 0.13, 0.6, '#aa8f83', x, 0.85, z + 3);
    box(3.5, 0.6, 0.1, '#aa8f83', x, 1.13, z + 3.3);
    for (const dx of [-1.35, 1.35])
      box(0.12, 0.7, 0.45, '#626e81', x + dx, 0.47, z + 3);
  });
  // Юрта: орнамент, дверь, шанырак, полукруглое крыльцо и дастархан.
  const yurt = new T.Group();
  decor.add(yurt);
  cyl(3.9, 4, 0.2, '#b6a99e', 0, 0.2, -18, yurt, 32);
  cyl(3.5, 3.5, 2.7, '#e8e2df', 0, 1.6, -18, yurt, 32);
  mesh(new T.ConeGeometry(4, 2.1, 32), '#d4c1ab', 0, 4, -18, yurt);
  cyl(0.62, 0.7, 0.2, '#586c8b', 0, 5.06, -18, yurt);
  const ring = mesh(
    new T.TorusGeometry(0.62, 0.08, 6, 24),
    '#ddbe77',
    0,
    5.2,
    -18,
    yurt,
  );
  ring.rotation.x = Math.PI / 2;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const ornament = box(
      0.3,
      0.24,
      0.1,
      i % 2 ? '#609bae' : '#d6b36e',
      Math.sin(a) * 3.53,
      2.6,
      -18 + Math.cos(a) * 3.53,
      yurt,
    );
    ornament.rotation.y = a;
    const post = box(
      0.055,
      2.2,
      0.055,
      '#c6b9ad',
      Math.sin(a) * 3.52,
      1.5,
      -18 + Math.cos(a) * 3.52,
      yurt,
    );
    post.rotation.y = a;
  }
  box(1.5, 2.3, 0.15, '#7d6a69', 0, 1.42, -14.49, yurt);
  box(1.25, 2.07, 0.17, '#324664', 0, 1.32, -14.38, yurt);
  box(0.065, 2.03, 0.2, '#c5ac77', 0, 1.32, -14.27, yurt);
  sphere(0.04, '#eccb83', 0.16, 1.2, -14.21, yurt);
  box(3, 0.06, 2, '#8a78a2', 0, 0.4, -13.6, yurt);
  for (let i = 0; i < 6; i++)
    box(0.12, 0.025, 1.7, '#ccaa87', -1.3 + i * 0.5, 0.445, -13.6, yurt);
  cyl(1.6, 1.6, 0.42, '#bd9b7c', 0, 0.65, -10, decor, 20);
  cyl(1.68, 1.68, 0.1, '#eee3cd', 0, 0.91, -10, decor, 20);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    cyl(
      0.16,
      0.14,
      0.1,
      '#81a9b4',
      Math.cos(a) * 1.05,
      1.01,
      -10 + Math.sin(a) * 1.05,
      decor,
      10,
    );
    sphere(0.08, '#dcad63', Math.cos(a) * 0.5, 1.02, -10 + Math.sin(a) * 0.5);
  }
  const holiday = new T.Group();
  decor.add(holiday);
  for (const x of [-5, 5]) {
    cyl(0.04, 0.07, 4.9, '#8599b1', x, 2.5, -15, holiday, 8);
    box(1.5, 0.95, 0.025, '#43a8c1', x + 0.7, 4.1, -15, holiday);
    mesh(
      new T.CircleGeometry(0.21, 16),
      '#e8c570',
      x + 0.8,
      4.1,
      -14.98,
      holiday,
    );
  }
  const lanternMaterials: T.MeshStandardMaterial[] = [];
  for (const x of [-4.6, 4.6])
    for (const z of [-9, 2, 13]) {
      cyl(0.05, 0.07, 3.4, '#52647d', x, 1.7, z);
      box(0.56, 0.65, 0.56, '#51657d', x, 3.5, z);
      const glow = new T.MeshStandardMaterial({
        color: '#ffe2a0',
        emissive: '#ffc771',
        emissiveIntensity: 0.7,
      });
      lanternMaterials.push(glow);
      const window = box(0.39, 0.43, 0.58, '#ffe2a0', x, 3.5, z);
      window.material = glow;
      const window2 = box(0.58, 0.43, 0.39, '#ffe2a0', x, 3.5, z);
      window2.material = glow;
      mesh(new T.ConeGeometry(0.5, 0.35, 4), '#62738a', x, 3.98, z);
    }
  const winterDecor = new T.Group();
  scene.add(winterDecor);
  for (let i = 0; i < 3; i++) {
    const b = box(
      0.7,
      0.6,
      0.7,
      ['#b980a1', '#7a94d1', '#e1b975'][i],
      i * 0.9 - 1,
      0.55,
      -11,
      winterDecor,
    );
    b.rotation.y = i * 0.4;
    box(0.08, 0.65, 0.75, '#eedcaa', i * 0.9 - 1, 0.55, -11, winterDecor);
  }
  const ornament = new T.Mesh(
    new T.OctahedronGeometry(0.4),
    new T.MeshStandardMaterial({
      color: '#f6cd77',
      emissive: '#eab34b',
      emissiveIntensity: 0.8,
    }),
  );
  ornament.position.set(0, 3.5, -10);
  winterDecor.add(ornament);
  const interior = new T.Group();
  scene.add(interior);
  box(38, 0.35, 38, '#a9a3ac', 0, 0.16, 0, interior);
  box(38, 7, 0.25, '#a8b1c6', 0, 3.5, -19, interior);
  box(0.25, 7, 38, '#8d97af', -19, 3.5, 0, interior);
  box(0.25, 7, 38, '#8d97af', 19, 3.5, 0, interior);
  for (const x of [-12, 0, 12]) {
    box(6, 3.3, 0.14, '#667fba', x, 3.8, -18.83, interior);
    box(0.1, 3.3, 0.2, '#ced4e5', x, 3.8, -18.7, interior);
    box(6, 0.1, 0.2, '#ced4e5', x, 3.8, -18.7, interior);
    box(7, 0.2, 1, '#d2c7bf', x, 2.05, -18.5, interior);
  }
  for (const x of [-16, 16]) {
    box(0.3, 7, 36, '#596680', x, 7, 0, interior);
    for (const z of [-12, 0, 12]) {
      box(0.27, 7, 0.27, '#5d6d84', x, 3.5, z, interior);
      box(3, 0.18, 2, '#b2a4a3', x, 5.2, z, interior);
    }
  }
  interior.visible = false;
  // Объединяем статические меши по материалам, чтобы снизить число draw calls.
  const batch = (group: T.Group) => {
    group.updateMatrixWorld(true);
    const buckets = new Map<T.Material, T.BufferGeometry[]>();
    const toRemove: T.Mesh[] = [];
    group.traverse((o) => {
      if (!(o instanceof T.Mesh) || Array.isArray(o.material)) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const list = buckets.get(o.material) || [];
      list.push(geo);
      buckets.set(o.material, list);
      toRemove.push(o);
    });
    for (const m of toRemove) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos);
      if (merged) group.add(new T.Mesh(merged, mat));
      geos.forEach((g) => g.dispose());
    }
  };
  // Группы с сезонной видимостью не объединяются с постоянным ландшафтом.
  blossomGroup.removeFromParent();
  flowers.removeFromParent();
  holiday.removeFromParent();
  yurt.removeFromParent();
  scene.add(blossomGroup, flowers, holiday, yurt);
  snowCaps.forEach((o) => {
    o.removeFromParent();
    scene.add(o);
  });
  batch(decor);
  batch(yurt);
  batch(interior);
  batch(flowers);
  batch(blossomGroup);
  batch(holiday);
  const clouds = new T.Group();
  scene.add(clouds);
  for (let i = 0; i < 6; i++) {
    const g = new T.Group();
    for (let j = 0; j < 3; j++) {
      const c = new T.Mesh(
        new T.IcosahedronGeometry(3.2 + (j % 2), 1),
        new T.MeshBasicMaterial({
          color: '#f3f1fa',
          transparent: true,
          opacity: 0.7,
        }),
      );
      c.scale.set(1.5, 0.5, 1);
      c.position.set(j * 3, 0, j % 2);
      g.add(c);
    }
    g.position.set(-50 + i * 19, 27 + (i % 3) * 3, -50 - (i % 2) * 10);
    clouds.add(g);
  }
  const colliders = STATIONS.map(([x, z]) => ({ x, z, w: 5.8, d: 0.5 }));
  colliders.push(
    { x: 0, z: -18, w: 6.8, d: 6.8 },
    { x: 0, z: -10, w: 2.8, d: 2.8 },
  );
  const update = (s: RoomState) => {
    const night = s.time === 'night',
      sunset = s.time === 'sunset',
      dawn = s.time === 'dawn',
      winter = s.season === 'winter',
      autumn = s.season === 'autumn';
    const top = night
        ? '#111832'
        : sunset
          ? '#707cc0'
          : dawn
            ? '#999dcc'
            : '#79b8ed',
      bottom = night
        ? '#3a3b69'
        : sunset
          ? '#edb6a9'
          : dawn
            ? '#efcbd4'
            : '#d2dfef';
    skyMaterial.uniforms.top.value.set(top);
    skyMaterial.uniforms.bottom.value.set(bottom);
    scene.fog = new T.Fog(bottom, 52, 140);
    hemi.intensity = night ? 0.9 : 1.4;
    hemi.color.set(night ? '#98b6ff' : '#e6edff');
    sunlight.intensity = night ? 0.7 : sunset ? 2.4 : 2.8;
    sunlight.position.set(-24, sunset ? 16 : night ? 28 : 38, 18);
    sunlight.shadow.needsUpdate = true;
    sunlight.color.set(sunset ? '#ffb687' : night ? '#98acff' : '#ffedce');
    rim.intensity = night ? 1.5 : 1;
    sun.position.y = night ? 45 : sunset ? 9 : dawn ? 13 : 38;
    (sun.material as T.MeshBasicMaterial).color.set(
      night ? '#dbe6ff' : '#ffe1ae',
    );
    sun.scale.setScalar(night ? 0.55 : 1);
    stars.visible = night;
    clouds.visible = !night;
    groundMaterial.color.set(
      winter
        ? '#d6e1ec'
        : autumn
          ? '#b49b86'
          : s.theme === 'steppe'
            ? '#b7b294'
            : '#81a99b',
    );
    const colors = winter
      ? ['#b8ccdc', '#9bb7cc', '#c6d6df']
      : autumn
        ? ['#bb7b69', '#d4a17a', '#a8788e']
        : s.season === 'spring'
          ? ['#548f88', '#7097a2', '#6faaa1']
          : ['#427b80', '#58868f', '#679b97'];
    leafMaterials.forEach((m, i) => m.color.set(colors[i]));
    snowCaps.forEach((o) => (o.visible = winter));
    flowers.visible = !winter;
    blossomGroup.visible = s.season === 'spring';
    holiday.visible = s.theme !== 'steppe';
    winterDecor.visible = s.theme === 'newyear';
    interior.visible = s.interior;
    yurt.visible = !s.interior;
    lanternMaterials.forEach((m) => (m.emissiveIntensity = night ? 2 : 1));
  };
  const avatarFactory = (color: string) => {
    if (color === '#368c78') color = '#7386c9';
    const group = new T.Group();
    const root = new T.Group();
    group.add(root);
    root.name = 'rig';
    const torso = cyl(0.3, 0.26, 0.7, color, 0, 1.08, 0, root, 8);
    torso.name = 'torso';
    cyl(0.13, 0.16, 0.15, '#d6b297', 0, 1.52, 0, root, 8);
    mesh(new T.SphereGeometry(0.25, 14, 10), '#e0bba0', 0, 1.76, 0, root);
    mesh(
      new T.SphereGeometry(0.263, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
      '#363343',
      0,
      1.81,
      0.02,
      root,
    );
    for (const x of [-0.085, 0.085])
      sphere(0.023, '#33364c', x, 1.78, -0.232, root);
    box(0.18, 0.03, 0.015, '#b7877f', 0, 1.66, -0.227, root);
    box(0.35, 0.06, 0.22, '#899edf', 0, 1.91, -0.17, root);
    cyl(0.23, 0.25, 0.12, '#657acf', 0, 1.99, 0, root, 10);
    for (const x of [-0.17, 0.17]) {
      const leg = new T.Group();
      leg.position.set(x, 0.77, 0);
      leg.name = x < 0 ? 'legL' : 'legR';
      root.add(leg);
      box(0.2, 0.57, 0.23, '#303e58', 0, -0.28, 0, leg);
      box(0.23, 0.15, 0.37, '#d6dfef', 0, -0.59, -0.06, leg);
      box(0.24, 0.045, 0.39, '#8191ae', 0, -0.67, -0.06, leg);
    }
    for (const x of [-0.39, 0.39]) {
      const arm = new T.Group();
      arm.position.set(x, 1.4, 0);
      arm.name = x < 0 ? 'armL' : 'armR';
      root.add(arm);
      cyl(0.115, 0.1, 0.51, color, 0, -0.24, 0, arm, 8);
      sphere(0.105, '#ddb599', 0, -0.52, 0, arm);
    }
    box(0.39, 0.42, 0.19, '#343e66', 0, 1.13, 0.27, root);
    box(0.28, 0.2, 0.055, '#8898df', 0, 1.13, 0.39, root);
    box(0.035, 0.54, 0.03, '#b7c1e1', -0.15, 1.1, -0.255, root);
    box(0.035, 0.54, 0.03, '#b7c1e1', 0.15, 1.1, -0.255, root);
    const gun = new T.Group();
    gun.name = 'gun';
    gun.position.set(0.43, 1.02, -0.4);
    gun.rotation.x = Math.PI / 2;
    root.add(gun);
    cyl(0.1, 0.14, 0.64, '#9eabdc', 0, 0, 0, gun, 10);
    cyl(0.15, 0.15, 0.12, '#8875de', 0, 0.27, 0, gun, 10);
    sphere(0.17, '#c980d5', 0, -0.1, 0.17, gun);
    box(0.12, 0.26, 0.13, '#445679', 0, -0.26, -0.1, gun);
    return group;
  };
  const setNotes = (s: RoomState) => {
    for (const b of boards) {
      b.panel.visible = !(s.template === 'three' && b.zone === 'bad');
      const ctx = b.canvas.getContext('2d')!,
        i = ZONES.findIndex((z) => z.id === b.zone),
        z = ZONES[i];
      ctx.fillStyle = '#f6f5fa';
      ctx.fillRect(0, 0, 1024, 512);
      ctx.fillStyle = ['#6397dc', '#d78e9b', '#c5a36c', '#a093cc'][i];
      ctx.fillRect(0, 0, 1024, 100);
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 35px sans-serif';
      ctx.fillText(
        s.template === 'three' && z.id === 'good'
          ? 'Продолжать делать'
          : z.title,
        35,
        62,
      );
      ctx.font = '20px sans-serif';
      ctx.fillText(String(i + 1).padStart(2, '0'), 930, 60);
      const notes = s.notes.filter(
        (n) =>
          n.zone === z.id && !['draw', 'connector', 'frame'].includes(n.kind),
      );
      notes.slice(0, 8).forEach((n, j) => {
        const x = 25 + (j % 4) * 250,
          y = 126 + Math.floor(j / 4) * 184;
        ctx.fillStyle = n.color;
        ctx.fillRect(x, y, 232, 159);
        ctx.fillStyle = '#444759';
        ctx.font = '22px sans-serif';
        const words = n.text.split(/\s/);
        let line = '',
          row = 0;
        for (const word of words) {
          if (ctx.measureText(line + word + ' ').width > 203) {
            ctx.fillText(line.slice(0, 21), x + 13, y + 31 + row * 28);
            line = word + ' ';
            if (++row > 3) break;
          } else line += word + ' ';
        }
        if (row <= 3)
          ctx.fillText(line.slice(0, 21), x + 13, y + 31 + row * 28);
      });
      if (!notes.length) {
        ctx.fillStyle = '#8690a6';
        ctx.font = '27px sans-serif';
        ctx.fillText('Ваши идеи меняют следующий спринт', 35, 245);
        ctx.fillStyle = '#687cbb';
        ctx.font = '22px sans-serif';
        ctx.fillText('E — открыть доску', 35, 300);
      }
      b.texture.needsUpdate = true;
    }
  };
  decor.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  for (const g of [yurt, blossomGroup, flowers, interior])
    g.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  return {
    scene,
    boards,
    colliders,
    avatarFactory,
    update,
    setNotes,
    clouds,
    sunlight,
  };
}
