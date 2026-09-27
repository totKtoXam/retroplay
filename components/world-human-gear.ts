import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Снаряжение и скины для бойцов-людей (world-human.ts).
 *
 * Аксессуары скинов (world-skins.ts) сделаны под пропорции процедурного бойца:
 * голова радиусом 0,25 м, торс — цилиндр 0,29 м. Их не перерисовываем, а
 * пересаживаем через «переходник» — группу на кости человека, которая
 * пересчитывает координаты процедурного сустава в человеческие (центр и размер
 * головы и груди сняты с модели, scripts/build-human-models.mjs). Так любой
 * скин, нынешний или будущий, сразу садится на человека.
 *
 * Своё у людей — тактическое снаряжение скина «Агент» (бронежилет, ремень с
 * подсумками, гарнитура, наколенники) и цвет костюма под скин.
 */

/** Голова процедурного бойца: центр лица над суставом и радиус. */
const CLASSIC_HEAD = { center: 0.12, radius: 0.245 };
/** Торс процедурного бойца: центр цилиндра над суставом груди. */
const CLASSIC_CHEST_CENTER = 0.23;

/**
 * Переходники «сустав процедурного бойца → кость человека» в осях аватара
 * (держатели human-socket-* уже повёрнуты так, лицом к −Z, метры аватара).
 * Голова человека: центр на 0,106 м выше кости Head и на 2,6 см впереди,
 * «радиус» 0,124 м. Грудь: центр торса на 5 см выше кости spine_03, торс уже и
 * площе цилиндра процедурного бойца.
 */
export const HUMAN_ADAPTERS = {
  // По вертикали голова человека вытянута сильнее, чем шар процедурного бойца:
  // иначе бандана ложилась на глаза, а шляпы — обручем на макушку.
  head: {
    scale: new T.Vector3(0.124 / CLASSIC_HEAD.radius, 0.6, 0.124 / CLASSIC_HEAD.radius),
    center: new T.Vector3(0, 0.112, -0.026),
    from: CLASSIC_HEAD.center,
  },
  chest: {
    scale: new T.Vector3(0.75, 0.63, 0.6),
    center: new T.Vector3(0, 0.054, 0.03),
    from: CLASSIC_CHEST_CENTER,
  },
} as const;

export function makeAdapter(socket: T.Object3D, kind: keyof typeof HUMAN_ADAPTERS) {
  const a = HUMAN_ADAPTERS[kind];
  const g = new T.Group();
  g.name = `human-adapter-${kind}`;
  g.scale.copy(a.scale);
  // Точка (0, from, 0) сустава процедурного бойца попадает в центр головы/торса человека.
  g.position.set(a.center.x, a.center.y - a.from * a.scale.y, a.center.z);
  socket.add(g);
  return g;
}

/* ---------- Тактическое снаряжение ---------- */

const gearMaterials = new Map<string, T.MeshStandardMaterial>();
const gearMat = (color: string, roughness = 0.85, metalness = 0.05) => {
  const key = `${color}:${roughness}:${metalness}`;
  let m = gearMaterials.get(key);
  if (!m) {
    m = new T.MeshStandardMaterial({ color, roughness, metalness });
    gearMaterials.set(key, m);
  }
  return m;
};
const rbox = (w: number, h: number, d: number, r = 0.015) => new RoundedBoxGeometry(w, h, d, 2, r);

function part(parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z: number) {
  const m = new T.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/**
 * Снаряжение «Агента». Координаты — в держателях костей (метры аватара, лицо к −Z).
 * Грудь: кость spine_03, торс по высоте от −0,13 до +0,24, спереди до z ≈ −0,16,
 * сзади до +0,19. Таз: кость pelvis. Голова: кость Head, центр головы (0, 0,106, −0,026).
 */
export function buildTacticalGear(sockets: Map<string, T.Group>, body: 'male' | 'female') {
  // Грудь у фигур разная: у мужской глубже спина, у женской — грудь спереди.
  const front = body === 'male' ? -0.172 : -0.19,
    back = body === 'male' ? 0.205 : 0.172;
  const groups: T.Group[] = [];
  const group = (socket: string) => {
    const s = sockets.get(socket);
    const g = new T.Group();
    g.name = 'human-gear-agent';
    s?.add(g);
    groups.push(g);
    return g;
  };
  const cloth = gearMat('#2c3138', 0.9);
  const plate = gearMat('#3a4049', 0.8);
  const strap = gearMat('#1f2328', 0.9);
  const metal = gearMat('#9aa3ad', 0.4, 0.6);

  // Бронежилет: передняя и задняя плиты, бока, плечевые лямки, подсумки. Висит
  // на середине корпуса (spine_02): верхняя кость груди в анимациях набора
  // поворачивается сильнее самой груди, и жесткий жилет на ней отходил бы от спины.
  // Координаты ниже — от кости spine_03; в группе их поднимает `lift`.
  const vest = group('torso');
  vest.position.y = body === 'male' ? 0.157 : 0.15;
  part(vest, rbox(0.32, 0.28, 0.05, 0.022), plate, 0, 0.04, front);
  // Спина под плитой скруглена к лопаткам: верх плиты наклонён вперёд, по спине.
  part(vest, rbox(0.3, 0.29, 0.045, 0.02), plate, 0, 0.04, back).rotation.x = -0.22;
  for (const side of [-1, 1]) {
    // Бока — мягкий камербанд, прижатый к корпусу.
    part(vest, rbox(0.035, 0.15, (back - front) * 0.85, 0.012), cloth, side * 0.17, -0.04, (front + back) / 2);
    // Лямки через плечо.
    part(vest, rbox(0.06, 0.025, 0.33), strap, side * 0.11, 0.2, 0);
  }
  // Три магазинных подсумка внизу спереди.
  for (let i = 0; i < 3; i++) {
    part(vest, rbox(0.085, 0.11, 0.05), cloth, -0.1 + i * 0.1, -0.06, front - 0.045);
    part(vest, rbox(0.085, 0.025, 0.055), strap, -0.1 + i * 0.1, 0.0, front - 0.046);
  }
  // Рация на левой груди и планка с липучкой на правой.
  part(vest, rbox(0.05, 0.1, 0.035), strap, 0.11, 0.12, front - 0.04);
  part(vest, new T.CylinderGeometry(0.005, 0.005, 0.1, 5), metal, 0.125, 0.21, front - 0.04);
  part(vest, rbox(0.09, 0.05, 0.01, 0.004), cloth, -0.1, 0.13, front - 0.03);

  // Ремень с подсумками и кобурой на правом бедре.
  const belt = group('pelvis');
  // Открытый цилиндр виден изнутри — ему нужен двусторонний материал, свой.
  const ringMat = gearMat('#1f2328', 0.9, 0.04);
  ringMat.side = T.DoubleSide;
  const ring = part(belt, new T.CylinderGeometry(0.175, 0.17, 0.055, 16, 1, true), ringMat, 0, 0.07, 0.01);
  ring.scale.set(1, 1, 0.88);
  part(belt, rbox(0.05, 0.035, 0.02, 0.006), metal, 0, 0.07, -0.155);
  for (const side of [-1, 1]) part(belt, rbox(0.07, 0.08, 0.05), cloth, side * 0.15, 0.04, 0.09);
  const holster = part(belt, rbox(0.06, 0.16, 0.08), strap, 0.2, -0.06, 0);
  holster.rotation.z = 0.08;

  // Гарнитура: чашки у ушей, дуга через макушку, микрофон к губам.
  const headset = group('head');
  for (const side of [-1, 1]) {
    const cup = part(headset, new T.CylinderGeometry(0.042, 0.042, 0.035, 14), strap, side * 0.105, 0.1, -0.02);
    cup.rotation.z = Math.PI / 2;
  }
  const band = new T.Mesh(new T.TorusGeometry(0.11, 0.009, 5, 18, Math.PI), strap);
  band.position.set(0, 0.105, -0.02);
  band.castShadow = true;
  headset.add(band);
  const mic = part(headset, new T.CylinderGeometry(0.004, 0.004, 0.09, 5), metal, 0.075, 0.05, -0.08);
  mic.rotation.set(0.9, 0, 0.5);

  // Наколенники — на верх голени, спереди.
  for (const [socket, side] of [['calfL', -1], ['calfR', 1]] as const) {
    const pad = group(socket);
    part(pad, rbox(0.1, 0.11, 0.05, 0.02), plate, 0, -0.03, -0.075);
    void side;
  }
  // Десятки мелких деталей — десятки отрисовок на бойца. Запекаем каждую группу
  // в одну сетку с цветом в вершинах: одна отрисовка на группу.
  groups.forEach(bake);
  return groups;
}

const bakedMaterial = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.08, side: T.DoubleSide });
function bake(group: T.Group) {
  const pieces = group.children.filter((o): o is T.Mesh => o instanceof T.Mesh);
  const geos = pieces.map((p) => {
    p.updateMatrix();
    const g = (p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone()).applyMatrix4(p.matrix);
    // Цвета вершин — в линейном пространстве, как у материала.
    const c = (p.material as T.MeshStandardMaterial).color;
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new T.BufferAttribute(colors, 3));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
    return g;
  });
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  pieces.forEach((p) => {
    p.removeFromParent();
    p.geometry.dispose();
  });
  if (!merged) return;
  const mesh = new T.Mesh(merged, bakedMaterial);
  mesh.castShadow = true;
  group.add(mesh);
}

/* ---------- Облик по скину ---------- */

export type HumanLook = {
  /** Цвет ткани костюма. */
  suit: string;
  /** Перчатки и ботинки. */
  gear: string;
  /** 1 — ткань закрывает и лицо (маска, глухой шлем). */
  cover: number;
  /** Показывать тактическое снаряжение «Агента». */
  tactical: boolean;
  /** Причёска видна: под шлемом, маской и скафандром её нет, иначе она прорастает сквозь них. */
  hair: boolean;
};

const CREW = /^crew/;

/**
 * Цвет и снаряжение человека под скин. `member` — цвет игрока (или команды),
 * `accent` — личный цвет банданы, которым красится и скафандр «Экипажа».
 */
export function humanLook(skin: string, member: string, accent: string): HumanLook {
  if (CREW.test(skin)) return { suit: accent, gear: '#6f7b88', cover: 0, tactical: false, hair: false };
  switch (skin) {
    case 'ninja':
      return { suit: '#1b1d22', gear: '#111317', cover: 1, tactical: false, hair: false };
    case 'hazmat':
      return { suit: '#d9b62b', gear: '#2a2d33', cover: 0, tactical: false, hair: false };
    case 'cosmo':
      return { suit: '#e8ecf2', gear: '#8a95a3', cover: 0, tactical: false, hair: false };
    case 'knight':
      return { suit: '#6c737d', gear: '#3a3f46', cover: 0, tactical: false, hair: false };
    case 'cyber':
      return { suit: '#1e2230', gear: '#0e1016', cover: 0, tactical: false, hair: true };
    case 'classic':
      return { suit: member, gear: '#23262d', cover: 0, tactical: false, hair: true };
    default:
      return { suit: member, gear: '#1c1f26', cover: 0, tactical: true, hair: true };
  }
}
