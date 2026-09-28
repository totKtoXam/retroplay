import * as T from 'three';
import { GRENADES } from '../lib/game-items.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

/** Лёгкий хеш-шум по точке: неровности камня без текстур. */
function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Точки профиля по эллипсу корпуса — для рычага, который лежит на корпусе. */
function arc(rx: number, ry: number, from: number, to: number, steps: number) {
  const out: T.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    out.push(new T.Vector2(Math.cos(a) * rx, Math.sin(a) * ry));
  }
  return out;
}

/**
 * Ракета салюта летит носом по +z: гладкий корпус из вращения профиля,
 * полоса, золотой обтекатель, сопло и четыре стабилизатора.
 */
export function makeFireworkRocket(color: string) {
  const group = new T.Group();
  const paint = new T.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.15,
    emissive: color,
    emissiveIntensity: 0.25,
  });
  const gold = new T.MeshStandardMaterial({
    color: '#f2c14e',
    roughness: 0.25,
    metalness: 0.85,
    emissive: '#6b4a10',
    emissiveIntensity: 0.4,
  });
  const dark = new T.MeshStandardMaterial({ color: '#2b2f3a', roughness: 0.5, metalness: 0.6 });
  // Профили — в координатах (радиус, высота); LatheGeometry крутит их вокруг y,
  // потом y поворачиваем в +z.
  const lathe = (points: [number, number][], segments = 12) =>
    new T.LatheGeometry(points.map(([r, y]) => new T.Vector2(r, y)), segments).rotateX(Math.PI / 2);
  const body = new T.Mesh(
    lathe([
      [0.001, -0.17],
      [0.042, -0.17],
      [0.045, -0.16],
      [0.045, 0.15],
      [0.047, 0.16],
    ]),
    paint,
  );
  const band = new T.Mesh(
    lathe([
      [0.047, -0.02],
      [0.048, -0.015],
      [0.048, 0.035],
      [0.047, 0.04],
    ]),
    gold,
  );
  const nose = new T.Mesh(
    lathe([
      [0.048, 0.155],
      [0.046, 0.19],
      [0.036, 0.25],
      [0.018, 0.3],
      [0.001, 0.325],
    ]),
    gold,
  );
  const nozzle = new T.Mesh(
    lathe(
      [
        [0.026, -0.17],
        [0.034, -0.2],
        [0.04, -0.225],
        [0.03, -0.225],
      ],
      10,
    ),
    dark,
  );
  const fin = new T.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(0.06, -0.04);
  fin.lineTo(0.06, -0.08);
  fin.lineTo(0, -0.1);
  fin.closePath();
  const fins = mergeGeometries(
    [0, 1, 2, 3].map((i) =>
      new T.ExtrudeGeometry(fin, { depth: 0.008, bevelEnabled: false })
        .translate(0.04, -0.07, -0.004)
        .rotateY((i * Math.PI) / 2)
        .rotateX(Math.PI / 2),
    ),
  );
  group.add(body, band, nose, nozzle, new T.Mesh(fins, gold));
  return group;
}

/**
 * Праздничная граната: настоящий силуэт — корпус, запал с рычагом и кольцом
 * чеки, — но в цвете и с отделкой своего вида:
 * - пиньята — рифлёный «ананас», поясок-зигзаг и бахрома снизу;
 * - взрыв красок — гладкое глянцевое яйцо в подтёках краски;
 * - снежный шар — стеклянная сфера со снегом на подставке;
 * - валентинка — гладкое яйцо с объёмным сердцем;
 * - пиксельная — корпус из кубиков;
 * - метеор — оплавленный камень, светящийся изнутри.
 * Геометрия своя у каждой гранаты (её освобождают вместе с ней), материалы
 * без текстур. Треугольников — до тысячи с небольшим.
 */
export function makeGrenade(color: string, variant = 'pinata') {
  const group = new T.Group();
  const tone = new T.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  tone.getHSL(hsl);
  // Пастельный цвет предмета на корпусе выглядел бы пластмассой: делаем сочнее.
  const rich = new T.Color().setHSL(hsl.h, Math.max(hsl.s, 0.7), Math.min(hsl.l, 0.58));
  const metal = new T.MeshStandardMaterial({ color: '#d9dde4', roughness: 0.28, metalness: 0.9 });
  const gold = new T.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.3, metalness: 0.85 });
  const RX = 0.12,
    RY = 0.135;
  let top = RY;
  if (variant === 'snowglobe') {
    const glass = new T.Mesh(
      new T.SphereGeometry(0.12, 18, 12),
      new T.MeshStandardMaterial({
        color: '#dff4ff',
        roughness: 0.04,
        metalness: 0.3,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    );
    glass.renderOrder = 1;
    const snow = new T.Mesh(
      new T.SphereGeometry(0.1, 14, 6, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38),
      new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, emissive: '#bfe6ff', emissiveIntensity: 0.25 }),
    );
    const tree = new T.Mesh(
      new T.ConeGeometry(0.035, 0.09, 7).translate(0, -0.02, 0),
      new T.MeshStandardMaterial({ color: rich, roughness: 0.6 }),
    );
    const base = new T.Mesh(new T.CylinderGeometry(0.085, 0.1, 0.05, 16).translate(0, -0.125, 0), gold);
    group.add(snow, tree, glass, base);
    top = 0.12;
  } else if (variant === 'pixel') {
    // Кубики 4×4×4 без углов и невидимой середины; соседние — в два тона.
    const cubes: T.BufferGeometry[] = [];
    const s = 0.066;
    const light = rich.clone().offsetHSL(0, 0, 0.1),
      shade = rich.clone().offsetHSL(0, 0, -0.08);
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 4; z++) {
          const c = [x, y, z].map((k) => (k - 1.5) * s);
          const edge = [x, y, z].filter((k) => k === 0 || k === 3).length;
          if (edge === 3 || edge === 0) continue;
          const cube = new T.BoxGeometry(s, s, s).translate(c[0], c[1] * 1.05, c[2]);
          const tint = (x + y + z) % 2 ? light : shade;
          const colors = new Float32Array(cube.getAttribute('position').count * 3);
          for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
          cube.setAttribute('color', new T.BufferAttribute(colors, 3));
          cubes.push(cube);
        }
    group.add(
      new T.Mesh(
        mergeGeometries(cubes),
        new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, flatShading: true }),
      ),
    );
    top = 2 * s * 1.05;
  } else {
    const smooth = variant === 'paintburst' || variant === 'heartburst';
    const geometry =
      variant === 'meteor' ? new T.IcosahedronGeometry(RX, 2) : new T.SphereGeometry(RX, 20, 14);
    const position = geometry.getAttribute('position');
    const v = new T.Vector3();
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i);
      const n = v.clone().normalize();
      let r = RX;
      if (variant === 'meteor') r *= 0.86 + hash3(n.x * 3.1, n.y * 3.1, n.z * 3.1) * 0.22;
      else if (!smooth) {
        // Рифление «ананаса»: продольные и поперечные канавки.
        const theta = Math.atan2(n.z, n.x),
          phi = Math.acos(T.MathUtils.clamp(n.y, -1, 1));
        const across = Math.max(0, Math.cos(theta * 8)) ** 4,
          along = Math.max(0, Math.cos(phi * 9)) ** 4;
        r *= 1 - 0.09 * Math.max(across, along) * Math.sin(phi);
      }
      v.copy(n).multiplyScalar(r);
      v.y *= RY / RX;
      position.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
    const shell = new T.Mesh(
      geometry,
      new T.MeshStandardMaterial({
        color: variant === 'meteor' ? rich.clone().multiplyScalar(0.45) : rich,
        roughness: variant === 'paintburst' ? 0.12 : variant === 'meteor' ? 0.9 : 0.42,
        metalness: variant === 'meteor' ? 0 : 0.08,
        flatShading: variant === 'meteor',
        emissive: variant === 'meteor' ? '#ff5a1a' : '#000000',
        emissiveIntensity: variant === 'meteor' ? 0.35 : 0,
      }),
    );
    group.add(shell);
    if (variant === 'pinata') {
      // Поясок-зигзаг и бахрома: праздничная пиньята, а не армейская «лимонка».
      const band = new T.Mesh(
        new T.TorusGeometry(RX * 1.01, 0.012, 5, 28).rotateX(Math.PI / 2),
        new T.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.4, metalness: 0.3 }),
      );
      group.add(band);
      const fringe: T.BufferGeometry[] = [];
      const palette = ['#ff3d7f', '#ffc93c', '#29c5ff', '#7dff6b', '#b36bff'].map((c) => new T.Color(c));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const strip = new T.PlaneGeometry(0.02, 0.08)
          .translate(0, -0.04, 0)
          .rotateX(0.35)
          .translate(0, 0, 0.07)
          .rotateY(a)
          .translate(0, -RY * 0.72, 0);
        const colors = new Float32Array(strip.getAttribute('position').count * 3);
        for (let k = 0; k < colors.length; k += 3) palette[i % palette.length].toArray(colors, k);
        strip.setAttribute('color', new T.BufferAttribute(colors, 3));
        fringe.push(strip);
      }
      group.add(
        new T.Mesh(
          mergeGeometries(fringe),
          new T.MeshStandardMaterial({ vertexColors: true, side: T.DoubleSide, roughness: 0.6 }),
        ),
      );
    } else if (variant === 'paintburst') {
      // Подтёки краски других цветов: капли, приплюснутые к корпусу.
      const drips = ['#ff3d7f', '#ffc93c', '#7dff6b', '#b36bff'];
      drips.forEach((c, i) => {
        const a = i * 1.7 + 0.4,
          y = 0.05 - i * 0.03;
        const blob = new T.Mesh(
          new T.SphereGeometry(0.035, 10, 6).scale(1, 1.8, 0.35),
          new T.MeshStandardMaterial({ color: c, roughness: 0.1 }),
        );
        const r = RX * Math.sqrt(Math.max(0.1, 1 - (y / RY) ** 2)) * 0.97;
        blob.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
        blob.lookAt(blob.position.clone().multiplyScalar(2));
        group.add(blob);
      });
    } else if (variant === 'heartburst') {
      const heart = new T.Shape();
      heart.moveTo(0, -0.05);
      heart.bezierCurveTo(-0.1, 0.02, -0.035, 0.075, 0, 0.03);
      heart.bezierCurveTo(0.035, 0.075, 0.1, 0.02, 0, -0.05);
      const emblem = new T.Mesh(
        new T.ExtrudeGeometry(heart, {
          depth: 0.01,
          bevelEnabled: true,
          bevelThickness: 0.008,
          bevelSize: 0.006,
          bevelSegments: 1,
          curveSegments: 6,
        }),
        new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, emissive: '#ff9fb4', emissiveIntensity: 0.3 }),
      );
      emblem.position.set(0, 0, RX * 0.93);
      group.add(emblem);
    }
  }
  // Запал: колпачок, рычаг вдоль корпуса и кольцо чеки сбоку.
  const fuze = new T.Mesh(
    new T.CylinderGeometry(0.026, 0.03, 0.05, 12).translate(0, top + 0.015, 0),
    metal,
  );
  const cap = new T.Mesh(new T.CylinderGeometry(0.018, 0.026, 0.014, 12).translate(0, top + 0.047, 0), metal);
  const outer = [new T.Vector2(-0.01, top + 0.056), ...arc(RX + 0.012, RY + 0.012, 1.25, -0.15, 9)],
    inner = arc(RX + 0.003, RY + 0.003, -0.15, 1.25, 9);
  const leverShape = new T.Shape([...outer, ...inner, new T.Vector2(-0.01, top + 0.047)]);
  const lever = new T.Mesh(
    new T.ExtrudeGeometry(leverShape, { depth: 0.026, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -0.013),
    variant === 'snowglobe' ? metal : gold,
  );
  if (variant === 'snowglobe' || variant === 'pixel') lever.scale.set(1, top / RY, 1);
  const ring = new T.Mesh(new T.TorusGeometry(0.024, 0.0045, 6, 18), gold);
  ring.position.set(-0.045, top + 0.02, 0.012);
  ring.rotation.set(0, 0.5, 0);
  const pin = new T.Mesh(new T.CylinderGeometry(0.004, 0.004, 0.05, 6).rotateZ(Math.PI / 2), metal);
  pin.position.set(-0.02, top + 0.02, 0);
  group.add(fuze, cap, lever, ring, pin);
  group.traverse((o) => {
    if (o instanceof T.Mesh) repairNormals(o.geometry);
  });
  return group;
}

/**
 * Сферы и тела вращения сходятся в полюсе в одну точку, и у вершин там
 * нормаль нулевая. Нормализация нуля в шейдере — NaN, а свечение (bloom)
 * размазывает NaN-пиксель в чёрный прямоугольник. Такой вершине ставим
 * нормаль «от центра».
 */
function repairNormals(geometry: T.BufferGeometry) {
  const normal = geometry.getAttribute('normal');
  const position = geometry.getAttribute('position');
  if (!normal || !position) return;
  const n = new T.Vector3();
  for (let i = 0; i < normal.count; i++) {
    n.fromBufferAttribute(normal, i);
    if (n.lengthSq() > 1e-10) continue;
    n.fromBufferAttribute(position, i);
    if (n.lengthSq() < 1e-10) n.set(0, 1, 0);
    n.normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
  }
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
