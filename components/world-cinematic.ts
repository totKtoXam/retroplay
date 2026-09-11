import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RoomState } from '@/lib/model';

function noise(x: number, z: number) {
  return (
    Math.sin(x * 1.13 + Math.sin(z * 0.71)) * Math.cos(z * 0.93) +
    0.5 * Math.sin(x * 2.7 - z * 1.9) +
    0.22 * Math.cos(z * 5.1 + x * 3.3)
  );
}
function detailTexture(wood = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!,
    data = ctx.createImageData(256, 256);
  let seed = 47291;
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = wood
        ? Math.sin(x * 0.7 + Math.sin(y * 0.025) * 2) * 15
        : noise(x * 0.11, y * 0.11) * 13;
      const v = 225 + grain * 0.25 + (seed / 4294967296 - 0.5) * 12,
        index = (y * 256 + x) * 4;
      data.data[index] = data.data[index + 1] = data.data[index + 2] = v;
      data.data[index + 3] = 255;
    }
  ctx.putImageData(data, 0, 0);
  if (wood) {
    ctx.fillStyle = '#746e61';
    for (let x = 0; x < 256; x += 64) ctx.fillRect(x, 0, 2, 256);
  }
  const t = new T.CanvasTexture(canvas);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createSurfaceLibrary() {
  const stone = detailTexture(),
    wood = detailTexture(true),
    height = stone.clone();
  height.colorSpace = T.NoColorSpace;
  const timber = new Set([
    '#b39782',
    '#9e8f87',
    '#937f7b',
    '#806b66',
    '#aa8f83',
    '#c6b9ad',
    '#7d6a69',
    '#d4c1ab',
  ]);
  const metal = new Set([
    '#56667e',
    '#354258',
    '#626e81',
    '#52647d',
    '#51657d',
    '#818295',
  ]);
  return {
    material(color: string) {
      const isWood = timber.has(color),
        isMetal = metal.has(color);
      return new T.MeshStandardMaterial({
        color,
        map: isWood ? wood : stone,
        bumpMap: height,
        bumpScale: isMetal ? 0.003 : 0.012,
        roughness: isMetal ? 0.32 : isWood ? 0.73 : 0.92,
        metalness: isMetal ? 0.65 : 0,
        flatShading: false,
      });
    },
    projectUV(geometry: T.BufferGeometry) {
      const p = geometry.getAttribute('position'),
        n = geometry.getAttribute('normal'),
        uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        const top = Math.abs(n.getY(i)) > 0.55;
        uv[i * 2] = (Math.abs(n.getX(i)) > 0.7 ? p.getZ(i) : p.getX(i)) * 0.45;
        uv[i * 2 + 1] = (top ? p.getZ(i) : p.getY(i)) * 0.45;
      }
      geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    },
    dispose() {
      stone.dispose();
      wood.dispose();
      height.dispose();
    },
  };
}

export function createCinematicLandscape(scene: T.Scene, stations: number[][]) {
  const group = new T.Group();
  group.name = 'cinematic-landscape';
  scene.add(group);
  const sky = new Sky();
  sky.scale.setScalar(440);
  sky.material.uniforms.nightMix = { value: 0 };
  sky.material.fragmentShader =
    'uniform float nightMix;\n' + sky.material.fragmentShader;
  sky.material.fragmentShader = sky.material.fragmentShader.replace(
    'vec4( retColor, 1.0 )',
    'vec4( mix(retColor, vec3(.012,.022,.045), nightMix), 1.0 )',
  );
  sky.material.uniforms.turbidity.value = 5;
  sky.material.uniforms.rayleigh.value = 1.5;
  sky.material.uniforms.mieCoefficient.value = 0.004;
  sky.material.uniforms.mieDirectionalG.value = 0.82;
  group.add(sky);
  const terrain = new T.PlaneGeometry(260, 260, 150, 150);
  terrain.rotateX(-Math.PI / 2);
  const p = terrain.getAttribute('position'),
    colors = new Float32Array(p.count * 3),
    rock = new T.Color('#8899a8'),
    snow = new T.Color('#cdd7db'),
    shade = new T.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i),
      r = Math.hypot(x, z),
      angle = Math.atan2(z, x);
    const envelope = T.MathUtils.smoothstep(r, 76, 113);
    const ridge =
      1 - Math.abs(Math.sin(angle * 5 + noise(x * 0.012, z * 0.012) * 0.7));
    const h =
      -4 +
      envelope *
        (14 +
          ridge * 25 +
          noise(x * 0.055, z * 0.055) * 9 +
          noise(x * 0.2, z * 0.2) * 1.8);
    p.setY(i, h);
    shade
      .copy(rock)
      .lerp(
        snow,
        T.MathUtils.smoothstep(h + noise(x * 0.2, z * 0.2) * 3, 23, 36),
      )
      .multiplyScalar(0.87 + noise(x * 0.13, z * 0.13) * 0.08);
    colors.set(shade.toArray(), i * 3);
  }
  terrain.computeVertexNormals();
  terrain.setAttribute('color', new T.BufferAttribute(colors, 3));
  const mountains = new T.Mesh(
    terrain,
    new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }),
  );
  mountains.userData.noCameraCollision = true;
  mountains.receiveShadow = true;
  group.add(mountains);
  // Игольчатые ветви на общих картах прозрачности: лес рисуется двумя instanced-мешами.
  const needles = document.createElement('canvas');
  needles.width = needles.height = 128;
  const ctx = needles.getContext('2d')!;
  ctx.strokeStyle = '#e4ebda';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(64, 126);
  ctx.lineTo(64, 8);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 120; i++) {
    const y = 12 + i * 0.9,
      spread = 9 + y * 0.32;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(64, y + 10);
      ctx.lineTo(64 + side * spread, y - 9);
      ctx.lineTo(64 + side * (spread * 0.72), y + 4);
      ctx.stroke();
    }
  }
  const leafMap = new T.CanvasTexture(needles);
  leafMap.colorSpace = T.SRGBColorSpace;
  const leafMaterial = new T.MeshStandardMaterial({
    map: leafMap,
    color: '#55624a',
    alphaTest: 0.38,
    side: T.DoubleSide,
    roughness: 0.92,
  });
  const leaves = new T.InstancedMesh(
    new T.PlaneGeometry(1, 1),
    leafMaterial,
    32 * 14 * 3,
  );
  const trunks = new T.InstancedMesh(
    new T.CylinderGeometry(0.09, 0.22, 1, 8),
    new T.MeshStandardMaterial({ color: '#544639', roughness: 1 }),
    32,
  );
  const dummy = new T.Object3D();
  let count = 0;
  for (let i = 0; i < 32; i++) {
    const a = i * 2.399,
      r = 25 + (i % 4) * 2.6,
      x = Math.sin(a) * r,
      z = Math.cos(a) * r,
      h = 5.7 + (i % 5) * 0.65;
    dummy.position.set(x, h * 0.45, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, h * 0.9, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    for (let level = 0; level < 14; level++)
      for (let side = 0; side < 3; side++) {
        const width = (1 - level / 16) * 3.9,
          theta = (side * Math.PI) / 3 + level * 0.63;
        dummy.position.set(
          x + Math.cos(theta) * 0.14,
          h * 0.25 + level * h * 0.049,
          z + Math.sin(theta) * 0.14,
        );
        dummy.rotation.set(0.12, theta, Math.sin(level) * 0.12);
        dummy.scale.set(width, 1.65, 1);
        dummy.updateMatrix();
        leaves.setMatrixAt(count++, dummy.matrix);
      }
  }
  leaves.castShadow = trunks.castShadow = true;
  leaves.receiveShadow = true;
  group.add(leaves, trunks);
  const grass = new T.InstancedMesh(
    new T.PlaneGeometry(0.12, 0.38),
    new T.MeshStandardMaterial({
      color: '#777451',
      side: T.DoubleSide,
      roughness: 1,
    }),
    900,
  );
  for (let i = 0; i < 900; i++) {
    const a = i * 2.399,
      r = 18 + (i % 91) * 0.11;
    dummy.position.set(Math.sin(a) * r, 0.28, Math.cos(a) * r);
    dummy.rotation.set(-0.2, i * 0.71, Math.sin(i) * 0.3);
    dummy.scale.setScalar(0.65 + (i % 7) * 0.1);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
  }
  group.add(grass);
  // Светящиеся дорожки и архитектурные светильники вместо ярких цветных платформ.
  const lights = new T.Group();
  lights.userData.projectileCollision = 'ignore';
  group.add(lights);
  const lightMat = new T.MeshStandardMaterial({
    color: '#d8f1ee',
    emissive: '#8ce9da',
    emissiveIntensity: 2.4,
  });
  const architecture = new T.Group();
  group.add(architecture);
  const charcoal = new T.MeshStandardMaterial({
    color: '#263d48',
    metalness: 0.6,
    roughness: 0.33,
  });
  const limestone = new T.MeshStandardMaterial({
    color: '#ded7c5',
    roughness: 0.81,
  });
  const timberMap = detailTexture(true);
  const timber = new T.MeshStandardMaterial({
    color: '#7f674d',
    map: timberMap,
    roughness: 0.72,
  });
  const glass = new T.MeshPhysicalMaterial({
    color: '#99b8bb',
    metalness: 0.25,
    roughness: 0.1,
    transparent: true,
    opacity: 0.16,
    side: T.DoubleSide,
    depthWrite: false,
  });
  const blueGlass = new T.MeshPhysicalMaterial({
    color: '#527d89',
    metalness: 0.2,
    roughness: 0.12,
    transparent: true,
    opacity: 0.24,
    side: T.DoubleSide,
    depthWrite: false,
  });
  const blocks = new Map<T.Material, T.BufferGeometry[]>();
  const block = (
    w: number,
    h: number,
    d: number,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const geo = new RoundedBoxGeometry(
      w,
      h,
      d,
      2,
      Math.min(0.06, w / 4, h / 4, d / 4),
    );
    geo.translate(x, y, z);
    const list = blocks.get(mat) || [];
    list.push(geo);
    blocks.set(mat, list);
  };
  for (const [x, z] of stations) {
    block(6.85, 0.22, 4.2, limestone, x, 0.26, z + 1.5);
    block(6.65, 0.18, 4.15, charcoal, x, 4.87, z + 1.35);
    for (const side of [-1, 1]) {
      block(0.13, 4.5, 0.13, charcoal, x + side * 3.13, 2.6, z + 2.9);
      block(0.02, 2.4, 1.3, glass, x + side * 3.05, 1.85, z + 1.55);
      block(0.03, 0.045, 2.6, lightMat, x + side * 3, 4.75, z + 1.4);
    }
    for (let i = 0; i < 19; i++)
      block(0.17, 0.09, 3.8, timber, x - 2.94 + i * 0.325, 4.71, z + 1.4);
    block(3.65, 0.19, 0.65, timber, x, 0.85, z + 3.15);
    block(3.65, 0.1, 0.18, charcoal, x, 0.6, z + 3.15);
  }
  const coral = new T.MeshStandardMaterial({
    color: '#c96e61',
    roughness: 0.8,
  });
  const blue = new T.MeshStandardMaterial({ color: '#527d89', roughness: 0.7 });
  const cream = new T.MeshStandardMaterial({
    color: '#eee6d5',
    roughness: 0.9,
  });
  const labels: T.Texture[] = [];
  const sign = (
    text: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    bg = '#213b46',
  ) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#f2e9d8';
    ctx.font = '600 100px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 55, 130);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    labels.push(texture);
    const mesh = new T.Mesh(
      new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({ map: texture }),
    );
    mesh.userData.projectileCollision = 'ignore';
    mesh.position.set(x, y, z);
    mesh.userData.presentationLabel = text;
    group.add(mesh);
  };
  // Боковые корпуса стоят за границами прогулочной зоны, сохраняя четыре доступных стенда.
  for (const side of [-1, 1]) {
    block(7, 9, 18, side < 0 ? coral : limestone, side * 27, 4.4, -8);
    block(7.5, 0.5, 18.5, cream, side * 27, 9.1, -8);
    block(6, 3.5, 7, blue, side * 26, 10.8, -12);
    for (let level = 0; level < 2; level++)
      for (let i = 0; i < 5; i++) {
        block(
          0.1,
          1.9,
          1.55,
          charcoal,
          side * 23.45,
          2.5 + level * 3.7,
          -15 + i * 3,
        );
        block(
          0.2,
          0.12,
          1.8,
          cream,
          side * 23.35,
          1.5 + level * 3.7,
          -15 + i * 3,
        );
      }
    for (let i = 0; i < 5; i++)
      block(0.2, 8.6, 0.18, cream, side * 23.3, 4.2, -16 + i * 4);
    block(7, 0.7, 9, charcoal, side * 26, 5, 14);
    block(6, 4.2, 8, blue, side * 27, 2.2, 14);
    block(7, 0.22, 8, cream, side * 27, 4.55, 14);
  }
  // Центральный корпус занимает прежний объём юрты: существующая коллизия сохраняется.
  // The façade is built around the glazed opening.  Previously the visual
  // window sat in front of one large solid box, so a projectile that passed
  // the glass immediately hit its invisible backing wall.
  block(6.6, 5.8, 0.35, limestone, 0, 3, -21.08);
  for (const side of [-1, 1])
    block(0.35, 5.8, 6.5, limestone, side * 3.13, 3, -18);
  for (const x of [-2.4, 2.4])
    block(1.8, 0.82, 0.35, limestone, x, 0.5, -14.75);
  block(6.6, 1.35, 0.35, limestone, 0, 5.33, -14.75);
  block(7.1, 0.3, 7, cream, 0, 6, -18);
  block(3, 0.1, 0.07, charcoal, 0, 0.9, -14.71);
  block(3, 0.1, 0.07, charcoal, 0, 4.05, -14.71);
  for (const x of [-1.45, 1.45])
    block(0.1, 3.25, 0.07, charcoal, x, 2.48, -14.71);
  block(2.7, 3.05, 0.08, blueGlass, 0, 2.48, -14.66);
  for (const side of [-1, 1]) {
    block(0.12, 3.7, 0.13, lightMat, side * 1.42, 2.4, -14.57);
    block(0.5, 5.2, 0.32, coral, side * 2.65, 2.9, -14.59);
  }
  block(7.9, 0.24, 2.1, charcoal, 0, 4.8, -14.1);
  block(5.7, 1.6, 4.3, blue, 0, 6.9, -18.2);
  sign('JINALY  /  01', 0, 5.48, -14.67, 5.7, 0.8);
  sign('TEAM CAMPUS', 0, 7.02, -15.99, 4.9, 0.75);
  // Цветовые порталы помогают различать зоны с большого расстояния.
  for (let i = 0; i < stations.length; i++) {
    const [x, z] = stations[i];
    const zoneMaterial = i % 2 ? coral : blue;
    block(6.2, 0.55, 0.55, zoneMaterial, x, 5.16, z);
    block(0.48, 4.7, 0.42, zoneMaterial, x - 2.99, 2.75, z);
    block(0.48, 4.7, 0.42, cream, x + 2.99, 2.75, z);
    sign(
      ['01 / KEEP', '02 / LEARN', '03 / START', '04 / STOP'][i],
      x,
      5.18,
      z + 0.29,
      5.5,
      0.4,
      i % 2 ? '#ab6058' : '#3b626e',
    );
  }
  // Шанырак над центральной площадью в современной стальной интерпретации.
  const crown = new T.Mesh(new T.TorusGeometry(2.5, 0.055, 6, 48), charcoal);
  crown.rotation.x = Math.PI / 2;
  crown.position.set(0, 6.5, 1);
  group.add(crown);
  for (const side of [-1, 1])
    block(0.13, 6.3, 0.13, charcoal, side * 2.5, 3.3, 1);
  for (let i = -2; i <= 2; i++) {
    const l = Math.sqrt(6.25 - i * i) * 2;
    block(l, 0.025, 0.045, cream, 0, 6.5, 1 + i * 0.8);
  }
  for (const x of [-4.6, 4.6])
    for (const z of [-9, 2, 13]) {
      block(0.12, 3.4, 0.12, charcoal, x, 1.8, z);
      block(0.1, 0.08, 1.1, cream, x, 3.51, z + 0.4);
      block(0.06, 0.02, 0.85, lightMat, x, 3.46, z + 0.5);
    }
  for (const [mat, geos] of blocks) {
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (merged) {
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const m = new T.Mesh(merged, mat);
      m.castShadow = !mat.transparent;
      m.receiveShadow = true;
      architecture.add(m);
    }
  }
  for (const x of [-1.55, 1.55])
    for (let i = 0; i < 14; i++) {
      const light = new T.Mesh(new T.BoxGeometry(0.045, 0.018, 0.65), lightMat);
      light.position.set(x, 0.235, -13 + i * 2);
      lights.add(light);
    }
  let currentTime = '';
  let environment: T.WebGLRenderTarget | undefined;
  let pmrem: T.PMREMGenerator | undefined;
  return {
    group,
    update(s: RoomState, renderer?: T.WebGLRenderer) {
      const cinematic = s.visualStyle !== 'anime';
      group.visible = cinematic;
      const night = s.time === 'night',
        sunset = s.time === 'sunset',
        dawn = s.time === 'dawn';
      const direction = new T.Vector3(
        -0.65,
        night ? 0.16 : sunset ? 0.14 : dawn ? 0.22 : 0.7,
        -0.5,
      ).normalize();
      sky.material.uniforms.sunPosition.value.copy(direction);
      sky.material.uniforms.nightMix.value = night ? 1 : 0;
      sky.material.uniforms.rayleigh.value = night ? 4 : sunset ? 2.9 : 1.5;
      leaves.visible = trunks.visible = grass.visible = false;
      lights.visible = !s.interior;
      leafMaterial.color.set(
        s.season === 'winter'
          ? '#c4c9c1'
          : s.season === 'autumn'
            ? '#77765d'
            : '#53634c',
      );
      (grass.material as T.MeshStandardMaterial).color.set(
        s.season === 'winter' ? '#d8dcd7' : '#777451',
      );
      if (renderer && cinematic && currentTime !== s.time) {
        currentTime = s.time;
        pmrem ??= new T.PMREMGenerator(renderer);
        const capture = new T.Scene();
        const envSky = sky.clone();
        capture.add(envSky);
        environment?.dispose();
        environment = pmrem.fromScene(capture, 0.06, 0.1, 500, { size: 128 });
      }
      scene.environment = cinematic ? environment?.texture || null : null;
      scene.environmentIntensity = night ? 0.12 : s.interior ? 0.35 : 0.48;
      if (renderer)
        renderer.toneMappingExposure = cinematic
          ? night
            ? 0.48
            : sunset
              ? 0.86
              : 0.94
          : 0.94;
    },
    dispose() {
      labels.forEach((t) => t.dispose());
      timberMap.dispose();
      environment?.dispose();
      pmrem?.dispose();
      leafMap.dispose();
    },
  };
}
