import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RoomState } from '@/lib/model';

/** Декорации не требуют внешних моделей, текстур или полноэкранного постпроцессинга. */
export function createWorldArt(scene: T.Scene) {
  const garden = new T.Group(),
    animeGarden = new T.Group(),
    atelier = new T.Group();
  garden.name = 'festival-garden';
  animeGarden.name = 'anime-sky-garden';
  scene.add(garden, animeGarden, atelier);
  const mats = new Map<string, T.MeshStandardMaterial>();
  const material = (color: string, glow = 0) => {
    const key = color + glow;
    if (!mats.has(key))
      mats.set(
        key,
        new T.MeshStandardMaterial({
          color,
          roughness: 0.8,
          flatShading: true,
          emissive: color,
          emissiveIntensity: glow,
        }),
      );
    return mats.get(key)!;
  };
  const mesh = (
    p: T.Object3D,
    g: T.BufferGeometry,
    c: string,
    x: number,
    y: number,
    z: number,
    glow = 0,
  ) => {
    const m = new T.Mesh(g, material(c, glow));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    p.add(m);
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
  ) => mesh(p, new T.BoxGeometry(w, h, d), c, x, y, z);
  const cone = (
    p: T.Object3D,
    c: string,
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
  ) => mesh(p, new T.ConeGeometry(r, h, 7), c, x, y, z);
  const sphere = (
    p: T.Object3D,
    c: string,
    x: number,
    y: number,
    z: number,
    r: number,
  ) => mesh(p, new T.IcosahedronGeometry(r, 1), c, x, y, z);
  const tube = (
    p: T.Object3D,
    c: string,
    points: T.Vector3[],
    radius: number,
    glow = 0,
  ) =>
    mesh(
      p,
      new T.TubeGeometry(new T.CatmullRomCurve3(points), 28, radius, 6, false),
      c,
      0,
      0,
      0,
      glow,
    );
  // Скульптурная входная арка с мотивом шанырака: новый вертикальный ориентир.
  for (const side of [-1, 1]) {
    tube(
      garden,
      side < 0 ? '#dd9b87' : '#809ccc',
      [
        new T.Vector3(side * 5.3, 0.2, -13),
        new T.Vector3(side * 5.3, 5.1, -13),
        new T.Vector3(side * 3.4, 7.3, -13),
        new T.Vector3(0, 7.6, -13),
      ],
      0.19,
    );
    tube(
      garden,
      '#ffe3b1',
      [
        new T.Vector3(side * 5.3, 0.4, -12.77),
        new T.Vector3(side * 5.3, 5, -12.77),
        new T.Vector3(side * 3.4, 7.2, -12.77),
        new T.Vector3(0, 7.5, -12.77),
      ],
      0.037,
      0.6,
    );
    box(garden, '#d4c4ad', side * 5.3, 0.45, -13, 0.8, 0.9, 0.8);
  }
  mesh(
    garden,
    new T.TorusGeometry(0.75, 0.075, 6, 32),
    '#d6b577',
    0,
    6.4,
    -12.9,
  );
  for (const a of [0, Math.PI / 3, (Math.PI * 2) / 3])
    box(garden, '#d6b577', 0, 6.4, -12.9, 0.045, 1.44, 0.045).rotation.z = a;
  // Крыши павильонов: волнистые ленты вместо плоской перекладины.
  const stations = [
    [-9, -6],
    [9, -6],
    [-9, 9],
    [9, 9],
  ];
  stations.forEach(([x, z], i) => {
    const color = ['#83b7d4', '#eeb6aa', '#e5c286', '#b4a3df'][i];
    for (let j = 0; j < 11; j++) {
      const dx = (j - 5) * 0.57,
        height = 4.95 + Math.pow(dx / 3, 2) * 0.45;
      const slat = box(
        garden,
        j % 2 ? color : '#f3e9d9',
        x + dx,
        height,
        z,
        0.51,
        0.12,
        2.4,
      );
      slat.rotation.z = -dx * 0.12;
    }
    for (const side of [-1, 1]) {
      box(garden, '#e9d9c6', x + side * 3.4, 0.6, z + 1.8, 0.8, 1.2, 0.8);
      for (let k = 0; k < 4; k++)
        sphere(
          garden,
          k % 2 ? '#668f9b' : '#81acaf',
          x + side * 3.4 + Math.sin(k * 2) * 0.26,
          1.35 + k * 0.17,
          z + 1.8 + Math.cos(k * 2) * 0.25,
          0.48,
        );
    }
  });
  // Светящиеся гирлянды, вымпелы, цветные сиденья вдоль прогулочной дорожки.
  for (const z of [-2, 16]) {
    for (const side of [-1, 1])
      mesh(
        garden,
        new T.CylinderGeometry(0.045, 0.06, 5.8, 7),
        '#5c6481',
        side * 13,
        2.9,
        z,
      );
    tube(
      garden,
      '#69718e',
      [
        new T.Vector3(-13, 5.8, z),
        new T.Vector3(0, 4.7, z),
        new T.Vector3(13, 5.8, z),
      ],
      0.026,
    );
    for (let j = 0; j < 17; j++) {
      const x = -12 + j * 1.5,
        y = 4.7 + Math.pow(x / 13, 2) * 1.1;
      sphere(garden, '#ffe7ad', x, y - 0.13, z, 0.115).material = material(
        '#ffe7ad',
        1.15,
      );
      if (j % 2 === 0) {
        const flag = mesh(
          garden,
          new T.ConeGeometry(0.24, 0.43, 3),
          ['#ecac9c', '#91b6d7', '#bdacdd'][j % 3],
          x,
          y - 0.43,
          z,
        );
        flag.rotation.z = Math.PI;
      }
    }
  }
  for (const [x, z] of [
    [-16, 14],
    [16, 14],
    [-16, -7],
    [16, -7],
  ]) {
    mesh(
      garden,
      new T.CylinderGeometry(0.03, 0.05, 3.2, 8),
      '#c2a683',
      x,
      1.6,
      z,
    );
    mesh(garden, new T.ConeGeometry(1.9, 0.6, 12), '#edd9bb', x, 3.45, z);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      mesh(
        garden,
        new T.CylinderGeometry(0.5, 0.6, 0.35, 12),
        ['#ddaa9b', '#8eb4c8', '#b1a1d0'][i],
        x + Math.cos(a) * 1.15,
        0.36,
        z + Math.sin(a) * 1.15,
      );
    }
  }
  // Удалённые летающие сады и водопады — только в аниме-варианте.
  const falls: T.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const a = -2.7 + i * 1.17,
      r = 35 + (i % 2) * 8,
      x = Math.sin(a) * r,
      z = Math.cos(a) * r - 7,
      y = 8 + (i % 3) * 4;
    const island = cone(animeGarden, '#a8a1c5', x, y - 1.5, z, 5 + (i % 2), 5);
    island.rotation.z = Math.PI;
    mesh(
      animeGarden,
      new T.CylinderGeometry(5 + (i % 2), 5 + (i % 2), 0.35, 12),
      '#cddfd6',
      x,
      y + 1,
      z,
    );
    for (let k = 0; k < 3; k++) {
      const tx = x + (k - 1) * 2;
      mesh(
        animeGarden,
        new T.CylinderGeometry(0.08, 0.18, 2.3, 6),
        '#8a7189',
        tx,
        y + 2.2,
        z,
      );
      sphere(
        animeGarden,
        ['#f4bad8', '#e3b4ea', '#ffcddd'][k],
        tx,
        y + 3.5,
        z,
        1.5,
      );
      sphere(animeGarden, '#ffe0e9', tx + 0.7, y + 3.8, z - 0.4, 0.9);
    }
    const waterfall = new T.Mesh(
      new T.PlaneGeometry(1.3, y + 3),
      new T.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        transparent: true,
        side: T.DoubleSide,
        depthWrite: false,
        vertexShader:
          'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader:
          'varying vec2 vUv;uniform float time;void main(){float flow=sin(vUv.y*50.+time*4.+vUv.x*11.);float edge=smoothstep(0.,.15,vUv.x)*smoothstep(0.,.15,1.-vUv.x);gl_FragColor=vec4(mix(vec3(.4,.76,.94),vec3(.88,.97,1.),flow*.25+.5),edge*.7);}',
      }),
    );
    waterfall.position.set(x, (y - 1) / 2, z + 4.9);
    animeGarden.add(waterfall);
    falls.push(waterfall);
  }
  // Хрустальный портал и парящие фонарики аниме-сада.
  for (const side of [-1, 1]) {
    mesh(
      animeGarden,
      new T.CylinderGeometry(0.28, 0.4, 7, 8),
      '#b2a2ce',
      side * 6,
      3.5,
      -23,
    );
    cone(animeGarden, '#fff0ce', side * 6, 7.5, -23, 0.7, 1.2);
    const crystal = mesh(
      animeGarden,
      new T.OctahedronGeometry(0.8),
      '#91d2e3',
      side * 6,
      8.8,
      -23,
      0.2,
    );
    crystal.rotation.z = 0.3;
  }
  tube(
    animeGarden,
    '#e8c0df',
    [
      new T.Vector3(-6, 7, -23),
      new T.Vector3(0, 9.6, -23),
      new T.Vector3(6, 7, -23),
    ],
    0.25,
  );
  // Интерьер: цветные акустические панели, подвесные кольца и зимний сад.
  for (let i = 0; i < 13; i++) {
    const x = -17 + i * 2.8;
    box(atelier, i % 2 ? '#d4b6a7' : '#b6b1ce', x, 1.1, -18.5, 1.7, 1.8, 0.2);
    box(atelier, '#efd7a2', x, 2.12, -18.34, 1.72, 0.045, 0.025);
  }
  for (const x of [-11, 0, 11]) {
    const ring = mesh(
      atelier,
      new T.TorusGeometry(2.1, 0.055, 6, 32),
      '#ffe9ba',
      x,
      6.8,
      0,
      0.8,
    );
    ring.rotation.x = Math.PI / 2;
    for (const dx of [-1.8, 1.8])
      box(atelier, '#9d93b6', x + dx, 7.1, 0, 0.025, 0.7, 0.025);
    box(atelier, '#f1ddc6', x, 0.6, -17, 3.1, 1.2, 1);
    for (let j = 0; j < 5; j++)
      sphere(
        atelier,
        j % 2 ? '#8db9ac' : '#72a092',
        x - 1.1 + j * 0.55,
        1.55 + (j % 2) * 0.3,
        -17,
        0.65,
      );
  }
  // Объединяем статическую геометрию, а водопады сохраняем отдельными.
  const batch = (group: T.Group) => {
    group.updateMatrixWorld(true);
    const buckets = new Map<T.Material, T.BufferGeometry[]>(),
      remove: T.Mesh[] = [];
    group.traverse((o) => {
      if (
        !(o instanceof T.Mesh) ||
        Array.isArray(o.material) ||
        o.material instanceof T.ShaderMaterial
      )
        return;
      const list = buckets.get(o.material) || [];
      list.push(
        (o.geometry.index
          ? o.geometry.toNonIndexed()
          : o.geometry.clone()
        ).applyMatrix4(o.matrixWorld),
      );
      buckets.set(o.material, list);
      remove.push(o);
    });
    remove.forEach((o) => {
      o.removeFromParent();
      o.geometry.dispose();
    });
    buckets.forEach((geos, mat) => {
      const geo = mergeGeometries(geos);
      if (geo) {
        const m = new T.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
      geos.forEach((g) => g.dispose());
    });
  };
  batch(garden);
  batch(animeGarden);
  batch(atelier);
  const petals = new T.InstancedMesh(
    new T.PlaneGeometry(0.12, 0.19),
    new T.MeshBasicMaterial({ color: '#ffd2e6', side: T.DoubleSide }),
    64,
  );
  petals.frustumCulled = false;
  scene.add(petals);
  const dummy = new T.Object3D();
  const gradient = new T.DataTexture(
    new Uint8Array([70, 145, 210, 255]),
    4,
    1,
    T.RedFormat,
  );
  gradient.minFilter = T.NearestFilter;
  gradient.magFilter = T.NearestFilter;
  gradient.needsUpdate = true;
  const toons = new Map<T.MeshStandardMaterial, T.MeshToonMaterial>();
  const originals = new WeakMap<T.Mesh, T.MeshStandardMaterial>();
  let currentAnime = false,
    currentInterior = false;
  const styleObject = (object: T.Object3D, anime = currentAnime) => {
    object.traverse((o) => {
      for (let p: T.Object3D | null = o; p; p = p.parent)
        if (p.userData.presentationOnly) return;
      if (!(o instanceof T.Mesh) || Array.isArray(o.material)) return;
      const source =
        originals.get(o) ||
        (o.material instanceof T.MeshStandardMaterial ? o.material : null);
      if (!source) return;
      originals.set(o, source);
      if (!anime) {
        o.material = source;
        return;
      }
      if (!toons.has(source)) {
        const toon = new T.MeshToonMaterial({
          gradientMap: gradient,
          side: source.side,
          map: source.map,
          vertexColors: source.vertexColors,
          transparent: source.transparent,
          opacity: source.opacity,
        });
        toon.color = source.color;
        toon.emissive = source.emissive;
        toon.emissiveIntensity = source.emissiveIntensity;
        toons.set(source, toon);
      }
      o.material = toons.get(source)!;
    });
  };
  return {
    styleObject,
    update(s: RoomState) {
      currentAnime = s.visualStyle === 'anime';
      currentInterior = s.interior;
      garden.visible = currentAnime;
      animeGarden.visible = currentAnime && !s.interior;
      atelier.visible = s.interior;
      petals.visible = (currentAnime || s.season === 'spring') && !s.interior;
      styleObject(scene);
    },
    animate(time: number) {
      if (currentAnime && !currentInterior)
        falls.forEach(
          (f) => ((f.material as T.ShaderMaterial).uniforms.time.value = time),
        );
      if (petals.visible) {
        for (let i = 0; i < 64; i++) {
          dummy.position.set(
            Math.sin(i * 2.4) * 21 + Math.sin(time * 0.3 + i),
            7 - ((time * 0.5 + i * 0.39) % 7),
            Math.cos(i * 2.4) * 21,
          );
          dummy.rotation.set(time * 0.7 + i, time * 0.5 + i, i);
          dummy.updateMatrix();
          petals.setMatrixAt(i, dummy.matrix);
        }
        petals.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      gradient.dispose();
      toons.forEach((m, source) => {
        m.dispose();
        source.dispose();
      });
    },
  };
}
