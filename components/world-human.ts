import * as T from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { AvatarMotion } from './world-avatar.ts';
import { buildTacticalGear, humanLook, makeAdapter } from './world-human-gear.ts';

/*
 * Бойцы-люди: скелетные модели Quaternius (CC0, public/models/humans, сборка —
 * scripts/build-human-models.mjs) поверх процедурного бойца из world-avatar.ts.
 *
 * Процедурный боец никуда не девается: он остаётся «логикой» аватара — к его
 * суставам по имени цепляются оружие, планшет, граната, мешок анонима и скины,
 * по его позе стреляют сетевые события. Человек надевается сверху: процедурные
 * детали прячутся, а оружие и аксессуары переезжают на кости человека. Снять
 * человека (настройка графики «Модели бойцов») — значит вернуть всё обратно.
 *
 * Движение — слои, как в шутерах: ноги и корпус из анимаций набора (стойка,
 * шаг, бег, спринт, присед, прыжок, падение), смешанных по скорости и
 * направлению; сверху процедурный слой: корпус и голова доворачиваются к
 * прицелу, руки ставятся на оружие двухзвенной кинематикой (IK). Готовых
 * анимаций с винтовкой в бесплатном наборе нет, и хват по IK заодно точно
 * повторяет наклон прицела, отдачу и перезарядку.
 */

/** Во сколько раз модель крупнее исходной: мир игры рассчитан на бойцов ростом около 2,1 м. */
export const HUMAN_SCALE = 1.18;
/** Процедурный аватар стоит на 0,27 м выше земли (world-remote-players.ts); ноги человека — на земле. */
const GROUND_OFFSET = -0.27;
const MODEL_URL = '/models/humans/';

type HumanTemplate = { scene: T.Object3D };
type HumanAssets = {
  bodies: { male: HumanTemplate; female: HumanTemplate };
  clips: Map<string, T.AnimationClip>;
};

let pending: Promise<HumanAssets> | null = null;
let ready: HumanAssets | null = null;

/** Загружает модели один раз на вкладку; при ошибке следующая попытка начнётся заново. */
export function loadHumanAssets(): Promise<HumanAssets> {
  if (ready) return Promise.resolve(ready);
  if (pending) return pending;
  // Загрузчик и декодер — отдельным куском по требованию: декодер meshopt
  // собирает WebAssembly прямо при импорте, а серверу (Workers) это запрещено,
  // и классическим бойцам этот код не нужен вовсе.
  pending = Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ])
    .then(([{ GLTFLoader }, { MeshoptDecoder }]) => {
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      return Promise.all(
        ['human-male', 'human-female', 'human-animations'].map((name) =>
          loader.loadAsync(`${MODEL_URL}${name}.glb`),
        ),
      );
    })
    .then(([male, female, animations]) => {
      for (const body of [male, female]) prepareTemplate(body.scene);
      ready = {
        bodies: { male: { scene: male.scene }, female: { scene: female.scene } },
        clips: new Map(animations.animations.map((clip) => [clip.name, clip])),
      };
      return ready;
    })
    .catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}
export const humanAssets = () => ready;

/* ---------- Костюм ---------- */

const SUIT_VERTEX = /* glsl */ `
attribute vec3 suitMask;
varying vec3 vSuitMask;
`;
const SUIT_FRAGMENT = /* glsl */ `
uniform vec3 suitColor;
uniform vec3 gearColor;
uniform float suitCover;
varying vec3 vSuitMask;
`;

/**
 * Облегающий тактический костюм поверх тела-заготовки. Маска из вершин
 * (scripts/build-human-models.mjs): r — ткань, g — перчатки и ботинки. Складки
 * и рельеф берутся из яркости исходной текстуры, цвет — свой у каждого бойца:
 * цвет игрока или команды. `suitCover` = 1 закрывает и лицо — для скинов с
 * маской или шлемом во всю голову.
 */
function suitMaterial(source: T.MeshStandardMaterial) {
  const material = source.clone();
  const uniforms = {
    suitColor: { value: new T.Color('#3d4a66') },
    gearColor: { value: new T.Color('#1c1f26') },
    suitCover: { value: 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SUIT_VERTEX}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSuitMask = suitMask;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SUIT_FRAGMENT}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        float suitLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        // Складки ткани: яркость кожи под костюмом даёт объём, но не её цвет.
        float fold = clamp(0.62 + (suitLum - 0.42) * 1.1, 0.35, 1.25);
        float fabricMask = max(vSuitMask.r, suitCover * (1.0 - vSuitMask.g));
        diffuseColor.rgb = mix(diffuseColor.rgb, suitColor * fold, fabricMask);
        diffuseColor.rgb = mix(diffuseColor.rgb, gearColor * (0.75 + suitLum * 0.6), vSuitMask.g);
        float suitRough = mix(1.0, 0.85, fabricMask);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.78, fabricMask);
        roughnessFactor = mix(roughnessFactor, 0.5, vSuitMask.g);
        roughnessFactor *= suitRough;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        // Мышцы под тканью сглажены: костюм не должен выглядеть голым телом.
        normal = normalize(mix(normal, nonPerturbedNormal, fabricMask * 0.55));`,
      );
  };
  material.customProgramCacheKey = () => 'human-suit-v1';
  return { material, uniforms };
}

function prepareTemplate(scene: T.Object3D) {
  scene.traverse((o) => {
    if (!(o instanceof T.SkinnedMesh)) return;
    const mask = o.geometry.getAttribute('color');
    if (mask) {
      o.geometry.setAttribute('suitMask', mask);
      o.geometry.deleteAttribute('color');
    }
    o.frustumCulled = false;
    const m = o.material as T.MeshStandardMaterial;
    m.vertexColors = false;
    // Волосы в наборе белые — цвет задаёт материал бойца.
    if (o.name.startsWith('hair-') || o.name === 'eyebrows') m.color.set('#3b2a20');
  });
}

/* ---------- Кости ---------- */

type Bones = {
  root: T.Bone;
  pelvis: T.Bone;
  spine: T.Bone[];
  neck: T.Bone;
  head: T.Bone;
  upper: [T.Bone, T.Bone];
  lower: [T.Bone, T.Bone];
  hand: [T.Bone, T.Bone];
};
const SIDES = ['l', 'r'] as const;

function findBones(scene: T.Object3D): Bones {
  const bone = (name: string) => {
    const b = scene.getObjectByName(name);
    if (!(b instanceof T.Bone)) throw Error(`нет кости ${name}`);
    return b;
  };
  return {
    root: bone('root'),
    pelvis: bone('pelvis'),
    spine: ['spine_01', 'spine_02', 'spine_03'].map(bone),
    neck: bone('neck_01'),
    head: bone('Head'),
    upper: SIDES.map((s) => bone(`upperarm_${s}`)) as [T.Bone, T.Bone],
    lower: SIDES.map((s) => bone(`lowerarm_${s}`)) as [T.Bone, T.Bone],
    hand: SIDES.map((s) => bone(`hand_${s}`)) as [T.Bone, T.Bone],
  };
}

const _q = new T.Quaternion(),
  _q2 = new T.Quaternion(),
  _v = new T.Vector3(),
  _v2 = new T.Vector3(),
  _v3 = new T.Vector3(),
  _m = new T.Matrix4();

/** Поворачивает кость на `angle` вокруг мировой оси (кость и её потомки). */
function rotateWorld(bone: T.Object3D, axis: T.Vector3, angle: number) {
  if (!angle) return;
  const parent = bone.parent!;
  parent.getWorldQuaternion(_q2);
  _q.setFromAxisAngle(axis, angle);
  // L' = P⁻¹ · R · P · L
  bone.quaternion.premultiply(_q2.clone().invert().multiply(_q).multiply(_q2));
  // Только сама кость: потомков пересчитает следующий запрос их мировой позы
  // (getWorld* поднимается по цепочке родителей) или отрисовка.
  bone.updateWorldMatrix(false, false);
}

/** Ставит мировую ориентацию кости. */
function setWorldQuaternion(bone: T.Object3D, world: T.Quaternion) {
  bone.parent!.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(world));
  bone.updateWorldMatrix(false, false);
}

/** Доворачивает кость так, чтобы направление `from` (мировое) стало `to`. */
function aimBone(bone: T.Object3D, from: T.Vector3, to: T.Vector3) {
  _q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  bone.getWorldQuaternion(_q2);
  setWorldQuaternion(bone, _q.multiply(_q2));
}

/**
 * Двухзвенная IK: плечо → локоть → кисть к точке `target`. Локоть уходит в
 * сторону `pole`. Если цель дальше вытянутой руки — рука просто тянется к ней.
 */
function reach(upper: T.Bone, lower: T.Bone, hand: T.Bone, target: T.Vector3, pole: T.Vector3) {
  const a = upper.getWorldPosition(new T.Vector3()),
    b = lower.getWorldPosition(new T.Vector3()),
    c = hand.getWorldPosition(new T.Vector3());
  const lenA = a.distanceTo(b),
    lenB = b.distanceTo(c);
  const toTarget = _v.copy(target).sub(a);
  const dist = Math.min(toTarget.length(), (lenA + lenB) * 0.999);
  const dir = toTarget.normalize();
  // Локоть: по теореме косинусов — угол при плече.
  const cos = T.MathUtils.clamp((lenA * lenA + dist * dist - lenB * lenB) / (2 * lenA * dist), -1, 1);
  const bend = _v2.copy(pole).sub(a);
  bend.sub(_v3.copy(dir).multiplyScalar(bend.dot(dir))).normalize();
  if (!Number.isFinite(bend.x)) bend.set(0, -1, 0);
  const elbow = a
    .clone()
    .addScaledVector(dir, cos * lenA)
    .addScaledVector(bend, Math.sqrt(1 - cos * cos) * lenA);
  aimBone(upper, b.clone().sub(a), elbow.clone().sub(a));
  const b2 = lower.getWorldPosition(new T.Vector3()),
    c2 = hand.getWorldPosition(new T.Vector3());
  const handTarget = a.clone().addScaledVector(dir, dist);
  aimBone(lower, c2.sub(b2), handTarget.sub(b2));
}

/* ---------- Экземпляр ---------- */

type Layer = { action: T.AnimationAction; weight: number };
/** Материал, который не рисуется: так упрощённое тело остаётся мишенью, не появляясь на экране. */
const HIDDEN = new T.MeshBasicMaterial({ visible: false });
type HumanRig = {
  group: T.Group;
  body: T.SkinnedMesh;
  lod: T.SkinnedMesh;
  bones: Bones;
  /**
   * Поза, которую дал микшер в прошлом кадре, — до процедурного слоя. Микшер
   * пишет в кость только изменившееся значение: застывшая поза (конец падения,
   * кость без дорожки) записывается один раз, и процедурные довороты поверх неё
   * копились бы. Поэтому перед каждым кадром кости возвращаются к этой позе.
   */
  rest: { bone: T.Bone; quaternion: T.Quaternion; position: T.Vector3 }[];
  mixer: T.AnimationMixer;
  layers: Map<string, Layer>;
  suit: ReturnType<typeof suitMaterial>['uniforms'];
  suitMaterial: T.Material;
  /** Кисть в позе покоя: базис «пальцы — большой палец» для каждой руки. */
  handBasis: [T.Quaternion, T.Quaternion];
  /** Держатели предметов на кистях (оружие, планшет, граната). */
  sockets: { gun: T.Group; tablet: T.Group; grenade: T.Group };
  /** Держатели на костях: оси как у аватара в позе покоя, масштаб — метры аватара. */
  boneSockets: Map<string, T.Group>;
  /** Детали процедурного бойца, переехавшие на человека: куда их вернуть. */
  female: boolean;
  moved: { obj: T.Object3D; parent: T.Object3D; position: T.Vector3; quaternion: T.Quaternion; scale: T.Vector3 }[];
  /** Снаряжение «Агента» (world-human-gear.ts). */
  tactical: T.Group[];
  /** Выбранная причёска и борода: прячутся под шлемами (world-human-gear.ts humanLook). */
  hairRoot: { visible: boolean };
  /** Скрытые на время детали процедурного бойца, которые у человека не нужны (тело-боб «Экипажа»). */
  suppressed: T.Object3D[];
  dead: boolean;
  deathAction: T.AnimationAction | null;
  hipYaw: number;
  aimPitch: number;
  recoil: number;
  throwing: number;
  wasAirborne: boolean;
  landing: number;
  lodOn: boolean;
  proneLift: number;
  suitKey: string;
  shadows: boolean;
  /** Сколько кадров пропускать между обновлениями анимации (дальние бойцы). */
  skip: number;
  skipped: number;
  skippedDt: number;
};
const humans = new WeakMap<T.Object3D, HumanRig>();

const LOOPS = [
  'Idle_Loop',
  'Walk_Loop',
  'Jog_Fwd_Loop',
  'Sprint_Loop',
  'Crouch_Idle_Loop',
  'Crouch_Fwd_Loop',
  'Jump_Loop',
  'Swim_Fwd_Loop',
  'Interact',
  'Idle_Torch_Loop',
] as const;
/** Скорость ступней в клипе, м/с при масштабе 1 (из версии набора с root motion). */
const CLIP_SPEED: Record<string, number> = {
  Walk_Loop: 0.97,
  Jog_Fwd_Loop: 5.36,
  Sprint_Loop: 8.25,
  Crouch_Fwd_Loop: 0.75,
  Swim_Fwd_Loop: 2.18,
};

/** Стабильный выбор тела и причёски по строке (id игрока): у каждого свой облик. */
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function handBasis(hand: T.Bone, side: 'l' | 'r') {
  // Базис кисти в её локальных осях: «вперёд» — к среднему пальцу, «вверх» — к большому.
  const finger = hand.getObjectByName(`middle_01_${side}`)!.position.clone().normalize();
  const thumb = hand.getObjectByName(`thumb_01_${side}`)!.position.clone().normalize();
  const up = thumb.sub(finger.clone().multiplyScalar(thumb.dot(finger))).normalize();
  const right = new T.Vector3().crossVectors(finger, up);
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right, up, finger));
}

/**
 * Создаёт человека и надевает его на процедурного бойца `avatar`. Возвращает
 * false, если модели ещё не загружены — тогда боец пока остаётся процедурным.
 */
export function attachHuman(avatar: T.Group, seed: string) {
  if (humans.has(avatar)) return true;
  const assets = ready;
  if (!assets) return false;
  const h = hash(seed || 'player');
  const template = h % 2 ? assets.bodies.female : assets.bodies.male;
  const scene = cloneSkinned(template.scene);
  const group = new T.Group();
  group.name = 'human-body';
  group.rotation.y = Math.PI;
  group.scale.setScalar(HUMAN_SCALE);
  group.position.y = GROUND_OFFSET;
  group.add(scene);
  let body: T.SkinnedMesh | null = null,
    lod: T.SkinnedMesh | null = null;
  const hairs: T.SkinnedMesh[] = [];
  let suit: ReturnType<typeof suitMaterial> | null = null;
  scene.traverse((o) => {
    if (!(o instanceof T.SkinnedMesh)) return;
    o.castShadow = true;
    if (o.name === 'body' || o.name === 'body-lod') {
      // Материал тела у каждого бойца свой: свой цвет костюма.
      suit ??= suitMaterial(o.material as T.MeshStandardMaterial);
      o.material = suit.material;
      if (o.name === 'body') body = o;
      else lod = o;
    } else if (o.name.startsWith('hair-')) {
      hairs.push(o);
      o.material = (o.material as T.Material).clone();
    }
  });
  // TypeScript не видит присваиваний внутри traverse — фиксируем найденное явно.
  const found = { body, lod, suit } as {
    body: T.SkinnedMesh | null;
    lod: T.SkinnedMesh | null;
    suit: ReturnType<typeof suitMaterial> | null;
  };
  if (!found.body || !found.lod || !found.suit) return false;
  const suitParts = found.suit;
  // Причёска (и борода у части мужчин) — по тому же зерну.
  const heads = hairs.filter((m) => !m.name.includes('beard'));
  heads.forEach((m, i) => (m.visible = i === (h >>> 3) % heads.length));
  const beard = hairs.find((m) => m.name.includes('beard'));
  if (beard) beard.visible = (h >>> 6) % 3 === 0;
  const chosenHair = hairs.filter((m) => m.visible);
  let hairShown = true;
  const hairColor = ['#2b1d14', '#4a3222', '#1b1714', '#6b4a2e', '#8c7a6b'][(h >>> 9) % 5];
  hairs.forEach((m) => (m.material as T.MeshStandardMaterial).color.set(hairColor));

  const bones = findBones(scene);
  const mixer = new T.AnimationMixer(scene);
  const layers = new Map<string, Layer>();
  for (const name of LOOPS) {
    const clip = assets.clips.get(name);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.setEffectiveWeight(name === 'Idle_Loop' ? 1 : 0).play();
    layers.set(name, { action, weight: name === 'Idle_Loop' ? 1 : 0 });
  }
  const socket = (name: string, parent: T.Object3D) => {
    const g = new T.Group();
    g.name = name;
    parent.add(g);
    return g;
  };
  const sockets = {
    // Держатели живут в пространстве аватара и каждый кадр ставятся в кисть:
    // оружие не должно наследовать масштаб модели и повороты костей по осям набора.
    gun: socket('human-gun-socket', avatar),
    tablet: socket('human-tablet-socket', avatar),
    grenade: socket('human-grenade-socket', avatar),
  };
  avatar.add(group);
  avatar.updateMatrixWorld(true);
  const rig: HumanRig = {
    group,
    body: found.body,
    lod: found.lod,
    bones,
    rest: [],
    mixer,
    layers,
    suit: suitParts.uniforms,
    suitMaterial: suitParts.material,
    handBasis: [handBasis(bones.hand[0], 'l'), handBasis(bones.hand[1], 'r')],
    sockets,
    boneSockets: new Map(),
    female: template === assets.bodies.female,
    moved: [],
    tactical: [],
    hairRoot: {
      get visible() {
        return hairShown;
      },
      set visible(on: boolean) {
        hairShown = on;
        chosenHair.forEach((m) => (m.visible = on));
      },
    },
    suppressed: [],
    dead: false,
    deathAction: null,
    hipYaw: 0,
    aimPitch: 0,
    recoil: 0,
    throwing: 0,
    wasAirborne: false,
    landing: 0,
    lodOn: false,
    proneLift: 0,
    suitKey: '',
    shadows: true,
    skip: 0,
    skipped: 0,
    skippedDt: 0,
  };
  // Мишень для попаданий — упрощённое тело: его дешевле пересекать лучом. Когда
  // рисуется полное тело, упрощённое не рисуется, но в луч попадает.
  const hitBody = found.lod;
  hitBody.userData.projectileCollision = 'block';
  found.body.userData.projectileCollision = 'ignore';
  // Сфера для отсечения лучей — с запасом на любую позу: считать её по вершинам
  // каждый кадр дорого, а поза меняется (присед, лёжа, падение).
  hitBody.boundingSphere = new T.Sphere(new T.Vector3(0, 0.9, 0), 1.7);
  found.body.boundingSphere = hitBody.boundingSphere.clone();
  scene.traverse((o) => {
    if (o instanceof T.Bone) rig.rest.push({ bone: o, quaternion: o.quaternion.clone(), position: o.position.clone() });
  });
  // Держатели на костях ставятся в позе покоя (модель только что склонирована).
  for (const [name, bone] of Object.entries(BONE_SOCKETS)) {
    const b = scene.getObjectByName(bone);
    if (!b) continue;
    const g = new T.Group();
    g.name = 'human-socket-' + name;
    b.add(g);
    b.updateMatrixWorld(true);
    // Оси держателя совпадают с осями аватара, масштаб — метры аватара, а не модели.
    const boneWorld = b.getWorldQuaternion(new T.Quaternion());
    const avatarWorld = avatar.getWorldQuaternion(new T.Quaternion());
    g.quaternion.copy(boneWorld.invert().multiply(avatarWorld));
    g.scale.setScalar(1 / HUMAN_SCALE);
    rig.boneSockets.set(name, g);
  }
  humans.set(avatar, rig);
  rig.lodOn = true;
  setHumanDetail(avatar, false);
  return true;
}

export const hasHuman = (avatar: T.Object3D) => humans.has(avatar);

/** Кости, к которым крепятся аксессуары скинов и мешок анонима. */
const BONE_SOCKETS = {
  head: 'Head',
  chest: 'spine_03',
  torso: 'spine_02',
  pelvis: 'pelvis',
  thighL: 'thigh_l',
  thighR: 'thigh_r',
  calfL: 'calf_l',
  calfR: 'calf_r',
  upperArmL: 'upperarm_l',
  upperArmR: 'upperarm_r',
} as const;
export type HumanSocket = keyof typeof BONE_SOCKETS;
export function humanSocket(avatar: T.Object3D, name: HumanSocket) {
  return humans.get(avatar)?.boneSockets.get(name) ?? null;
}

/**
 * Надевает человека на процедурного бойца: оружие, планшет и граната
 * переезжают в держатели у кистей, мешок анонима — на голову, процедурное тело
 * прячется. Возвращает false, пока модели не загружены.
 */
export function mountHuman(avatar: T.Group, seed: string) {
  if (!attachHuman(avatar, seed)) return false;
  const r = humans.get(avatar)!;
  if (r.moved.length) return true;
  const move = (name: string, to: T.Object3D, at = new T.Vector3(), scale = 1) => {
    const o = avatar.getObjectByName(name);
    if (!o?.parent) return;
    r.moved.push({ obj: o, parent: o.parent, position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() });
    to.add(o);
    o.position.copy(at);
    o.quaternion.identity();
    o.scale.setScalar(scale);
  };
  move('gun', r.sockets.gun);
  move('tablet', r.sockets.tablet);
  move('held-grenade', r.sockets.grenade);
  // Аксессуары скинов, бандана и мешок анонима — через переходники на голову и
  // грудь человека, со своими местными координатами (world-human-gear.ts).
  const keep = (o: T.Object3D, to: T.Object3D) => {
    r.moved.push({ obj: o, parent: o.parent!, position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() });
    to.add(o);
  };
  for (const [joint, kind] of [['head', 'head'], ['chest', 'chest']] as const) {
    const from = avatar.getObjectByName(joint);
    const socket = r.boneSockets.get(kind);
    if (!from || !socket) continue;
    const adapter = makeAdapter(socket, kind);
    // Копия списка: переносим детей прямо во время обхода.
    const source = [...from.children, ...(joint === 'head' ? (from.getObjectByName('unmasked-head')?.children ?? []) : [])];
    for (const o of source)
      if (o.name.startsWith('skin-') || o.name === 'avatar-bandana' || o.name === 'anonymous-bag') keep(o, adapter);
  }
  // У процедурного бойца голова — шар, и визор «Экипажа» с банданой сидят на
  // нём низко: визор на нижней половине, бандана на уровне глаз. На лице
  // человека визор пришёлся бы на рот, а бандана — на глаза: поднимаем их.
  for (const [name, lift] of [['skin-crew-body-head', 0.15], ['avatar-bandana', 0.13]] as const) {
    const o = avatar.getObjectByName(name);
    if (o) o.position.y += lift;
  }
  // Тело-боб «Экипажа» заменяет плоть процедурного бойца; у человека своё тело —
  // остаются ранец, визор и головные уборы, а костюм красится в цвет скафандра.
  const bob = avatar.getObjectByName('crew-torso');
  if (bob) {
    bob.visible = false;
    r.suppressed.push(bob);
  }
  r.tactical = buildTacticalGear(r.boneSockets, r.female ? 'female' : 'male');
  const rig = avatar.getObjectByName('rig');
  if (rig) rig.visible = false;
  return true;
}

/** Снимает человека: детали возвращаются процедурному бойцу. */
export function unmountHuman(avatar: T.Group) {
  const r = humans.get(avatar);
  if (!r) return;
  for (const m of r.moved.reverse()) {
    m.parent.add(m.obj);
    m.obj.position.copy(m.position);
    m.obj.quaternion.copy(m.quaternion);
    m.obj.scale.copy(m.scale);
  }
  r.moved.length = 0;
  for (const o of r.suppressed) o.visible = true;
  r.suppressed.length = 0;
  const rig = avatar.getObjectByName('rig');
  if (rig) rig.visible = true;
  detachHuman(avatar);
}

/** Снимает человека с бойца и освобождает его ресурсы. */
export function detachHuman(avatar: T.Object3D) {
  const r = humans.get(avatar);
  if (!r) return;
  r.mixer.stopAllAction();
  r.group.removeFromParent();
  Object.values(r.sockets).forEach((s) => s.removeFromParent());
  r.group.traverse((o) => {
    // Снаряжение: геометрия своя у каждого бойца, материалы общие (world-human-gear.ts).
    if (o instanceof T.Mesh && !(o instanceof T.SkinnedMesh)) o.geometry.dispose();
    if (o instanceof T.SkinnedMesh) {
      // Геометрия общая с шаблоном; свои у бойца только материалы.
      const m = o.material as T.Material;
      if (o.name.startsWith('hair-')) m.dispose();
    }
  });
  r.suitMaterial.dispose();
  humans.delete(avatar);
}

/**
 * Дальний боец рисуется упрощённым телом (в четыре раза меньше треугольников).
 * Невидимое упрощённое тело остаётся мишенью для попаданий.
 */
export function setHumanDetail(avatar: T.Object3D, far: boolean) {
  const r = humans.get(avatar);
  if (!r || (r.lodOn === far && r.lod.material !== r.suitMaterial && !far)) return;
  r.lodOn = far;
  r.body.visible = !far;
  // Вблизи упрощённое тело не рисуется (невидимый материал), но остаётся в луче.
  r.lod.material = far ? r.suitMaterial : HIDDEN;
}

/**
 * Держит бойца в нужном облике: надевает человека, когда модели включены в
 * настройках и уже загружены (загрузку запускает сам), снимает — когда
 * выключены. Цвет костюма обновляется только при смене.
 */
export function syncHuman(avatar: T.Group, want: boolean, seed: string, memberColor: string) {
  if (!want) {
    if (humans.has(avatar)) unmountHuman(avatar);
    return false;
  }
  if (!ready) {
    void loadHumanAssets().catch(() => {});
    return false;
  }
  if (!humans.has(avatar) && !mountHuman(avatar, seed)) return false;
  const r = humans.get(avatar)!;
  // Скин и личный цвет пишет applyAvatarSkin (world-skins.ts) в userData аватара.
  const skin = (avatar.userData.skinLook as { skin: string; accent: string } | undefined) ?? { skin: 'agent', accent: memberColor };
  const key = `${skin.skin}|${skin.accent}|${memberColor}`;
  if (r.suitKey !== key) {
    r.suitKey = key;
    const look = humanLook(skin.skin, memberColor, skin.accent);
    r.suit.suitColor.value.set(look.suit);
    r.suit.gearColor.value.set(look.gear);
    r.suit.suitCover.value = look.cover;
    for (const g of r.tactical) g.visible = look.tactical;
    r.hairRoot.visible = look.hair;
  }
  return true;
}

/**
 * Подробность по расстоянию до камеры: вдали — упрощённое тело и анимация
 * через кадр-два. `lite` — облегчённый режим настроек: упрощённое тело всегда,
 * без теней от бойцов, редкие обновления начинаются ближе.
 */
export function updateHumanLod(avatar: T.Object3D, distance: number, lite: boolean) {
  const r = humans.get(avatar);
  if (!r) return;
  setHumanDetail(avatar, lite || distance > 16);
  r.skip = lite ? (distance > 25 ? 2 : distance > 8 ? 1 : 0) : distance > 40 ? 2 : distance > 22 ? 1 : 0;
  if (r.shadows !== !lite) {
    r.shadows = !lite;
    r.group.traverse((o) => {
      if (o instanceof T.Mesh) o.castShadow = !lite;
    });
  }
}

/** Анимировать реже: 0 — каждый кадр, 1 — через кадр и т. д. */
export function setHumanUpdateSkip(avatar: T.Object3D, skip: number) {
  const r = humans.get(avatar);
  if (r) r.skip = skip;
}

/** Цвет костюма (цвет игрока или команды) и закрытое лицо у скинов со шлемом. */
export function setHumanSuit(avatar: T.Object3D, color: string, gear = '#1c1f26', cover = 0) {
  const r = humans.get(avatar);
  if (!r) return;
  r.suit.suitColor.value.set(color);
  r.suit.gearColor.value.set(gear);
  r.suit.suitCover.value = cover;
}

export function humanShoot(avatar: T.Object3D, tool?: string) {
  const r = humans.get(avatar);
  if (!r) return;
  r.recoil = 1;
  if (tool === 'grenade') r.throwing = 1;
}

export function humanHeadBone(avatar: T.Object3D) {
  return humans.get(avatar)?.bones.head ?? null;
}
export function humanBone(avatar: T.Object3D, name: string) {
  const r = humans.get(avatar);
  return r ? (r.group.getObjectByName(name) as T.Bone | undefined) ?? null : null;
}
export function humanSockets(avatar: T.Object3D) {
  return humans.get(avatar)?.sockets ?? null;
}

/* ---------- Анимация ---------- */

const ARMED = new Set(['paint', 'confetti', 'sniper', 'flashlight']);
const UP = new T.Vector3(0, 1, 0);

/**
 * Каждый кадр: веса клипов по движению, затем процедурный слой — доворот
 * корпуса к прицелу и руки на оружии. `m` — то же движение, что получает
 * процедурный боец (world-avatar.ts animateAvatar).
 */
export function animateHuman(avatar: T.Group, m: AvatarMotion, dt: number, time: number) {
  const r = humans.get(avatar);
  if (!r) return;
  if (r.skip > 0 && r.skipped < r.skip) {
    r.skipped++;
    r.skippedDt += dt;
    return;
  }
  dt += r.skippedDt;
  r.skipped = 0;
  r.skippedDt = 0;
  const follow = (a: number, b: number, rate: number) => T.MathUtils.lerp(a, b, 1 - Math.exp(-rate * dt));
  const dead = m.hp === 0;
  const clips = ready!.clips;

  // Смерть: падение один раз и неподвижность до возрождения.
  if (dead !== r.dead) {
    r.dead = dead;
    if (dead) {
      const clip = clips.get('Death01');
      if (clip) {
        const action = r.mixer.clipAction(clip);
        action.reset().setLoop(T.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.setEffectiveWeight(1).fadeIn(0.15).play();
        r.deathAction = action;
      }
    } else if (r.deathAction) {
      r.deathAction.fadeOut(0.2);
      r.deathAction = null;
    }
  }

  const speed = m.speed;
  const moving = speed > 0.3;
  const crouch = m.stance === 'sit' || !!m.crouching;
  const prone = m.stance === 'lie';
  if (r.wasAirborne && !m.airborne) r.landing = 1;
  r.wasAirborne = m.airborne;
  r.landing = Math.max(0, r.landing - dt * 3);

  // Направление шага относительно взгляда: ноги идут туда, корпус смотрит в прицел.
  const forward = m.forward ?? 1,
    strafe = m.strafe ?? 0;
  let moveAngle = moving ? Math.atan2(strafe, forward) : 0;
  let backwards = false;
  if (Math.abs(moveAngle) > Math.PI * 0.6) {
    backwards = true;
    moveAngle = Math.atan2(Math.sin(moveAngle - Math.PI), Math.cos(moveAngle - Math.PI));
  }
  const hipTarget = prone || !moving ? 0 : T.MathUtils.clamp(-moveAngle, -1.1, 1.1);
  r.hipYaw = follow(r.hipYaw, hipTarget, 8);

  // Веса клипов нижнего слоя и темп каждого: ступни должны идти со скоростью бойца.
  const target: Record<string, number> = {};
  const pace = (clip: string, min: number, max: number) =>
    T.MathUtils.clamp(speed / ((CLIP_SPEED[clip] ?? 1) * HUMAN_SCALE), min, max);
  const rates: Record<string, number> = {
    Walk_Loop: pace('Walk_Loop', 0.5, 1.9),
    Jog_Fwd_Loop: pace('Jog_Fwd_Loop', 0.7, 1.3),
    Sprint_Loop: pace('Sprint_Loop', 0.75, 1.3),
    Crouch_Fwd_Loop: pace('Crouch_Fwd_Loop', 0.6, 2),
    Swim_Fwd_Loop: pace('Swim_Fwd_Loop', 0.4, 1.5),
  };
  if (dead) {
    // Смерть перекрывает всё.
  } else if (prone) {
    // Лёжа: горизонтальный гребок плавания похож на переползание; на месте он
    // почти замирает. Плавание «на месте» в наборе вертикальное — для лёжа не годится.
    target.Swim_Fwd_Loop = 1;
    if (!moving) rates.Swim_Fwd_Loop = 0.12;
  } else if (m.airborne) {
    target.Jump_Loop = 1;
  } else if (crouch) {
    target[moving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop'] = 1;
  } else if (!moving) {
    target[m.working ? 'Interact' : 'Idle_Loop'] = 1;
  } else if (speed < 2.4) {
    target.Walk_Loop = 1;
  } else if (speed < 3.8) {
    // Шаг переходит в бег: клипы смешиваются, пока боец разгоняется.
    const k = T.MathUtils.smoothstep(speed, 2.4, 3.8);
    target.Walk_Loop = 1 - k;
    target.Jog_Fwd_Loop = k;
  } else if (speed < 6) {
    target.Jog_Fwd_Loop = 1;
  } else {
    const k = T.MathUtils.smoothstep(speed, 6, 8);
    target.Jog_Fwd_Loop = 1 - k;
    target.Sprint_Loop = k;
  }
  // Клип плавания держит тело у поверхности воды, на уровне корня: лёжа его приподнимаем над землёй.
  r.proneLift = follow(r.proneLift, prone && !dead ? 0.13 : 0, 8);
  r.group.position.y = GROUND_OFFSET + r.proneLift;
  const blend = 1 - Math.exp(-10 * dt);
  for (const [name, layer] of r.layers) {
    layer.weight += ((target[name] ?? 0) - layer.weight) * blend;
    if (layer.weight < 0.001) layer.weight = 0;
    layer.action.setEffectiveWeight(dead ? 0 : layer.weight);
    const rate = rates[name];
    layer.action.setEffectiveTimeScale(rate ? (backwards ? -rate : rate) : 1);
  }
  for (const b of r.rest) {
    b.bone.quaternion.copy(b.quaternion);
    b.bone.position.copy(b.position);
  }
  r.mixer.update(dt);
  for (const b of r.rest) {
    b.quaternion.copy(b.bone.quaternion);
    b.position.copy(b.bone.position);
  }
  if (dead) return;

  // Процедурный слой: ноги — в сторону шага, корпус — к прицелу.
  const b = r.bones;
  const avatarUp = _v3.copy(UP);
  rotateWorld(b.pelvis, avatarUp, r.hipYaw);
  for (const s of b.spine) rotateWorld(s, avatarUp, -r.hipYaw / 3);
  const tool = m.tool;
  const armed = ARMED.has(tool) && !m.working && !m.inventory;
  const holding = armed || tool === 'grenade' || !!m.working || !!m.inventory || tool === 'pointer';
  r.aimPitch = follow(r.aimPitch, m.pitch, 14);
  // Правая ось аватара в мире: вокруг неё корпус наклоняется к прицелу.
  avatar.getWorldQuaternion(_q);
  const right = new T.Vector3(1, 0, 0).applyQuaternion(_q);
  const lean = prone ? 0 : -r.aimPitch;
  const spineShare = armed ? 0.22 : 0.1;
  for (const s of b.spine) rotateWorld(s, right, lean * spineShare);
  rotateWorld(b.neck, right, lean * 0.15);
  rotateWorld(b.head, right, lean * (armed ? 0.1 : 0.35));

  r.recoil = Math.max(0, r.recoil - dt * 7);
  r.throwing = Math.max(0, r.throwing - dt * 2.6);
  holdItem(avatar, r, m, armed, holding, dt);
  if (r.landing > 0) b.pelvis.position.z -= r.landing * 0.04;
  void time;
}

/**
 * Руки на предмете. Держатель оружия — в пространстве аватара: у правого плеча,
 * ствол по прицелу; кисти тянутся к рукоятке и цевью. Планшет — перед грудью,
 * граната — у плеча, при броске рука проходит дугу вперёд.
 */
function holdItem(avatar: T.Group, r: HumanRig, m: AvatarMotion, armed: boolean, holding: boolean, dt: number) {
  const b = r.bones;
  const { gun, tablet, grenade } = r.sockets;
  gun.visible = armed;
  tablet.visible = !!m.working || !!m.inventory || m.tool === 'pointer';
  grenade.visible = m.tool === 'grenade';
  if (!holding) return;
  avatar.updateWorldMatrix(true, false);
  const toAvatar = _m.copy(avatar.matrixWorld).invert();
  // Плечевой пояс в координатах аватара — точка вращения прицела.
  const chest = b.spine[2].getWorldPosition(new T.Vector3()).applyMatrix4(toAvatar);
  const pitch = -r.aimPitch;
  const aim = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), pitch + r.recoil * 0.08);
  const at = (x: number, y: number, z: number) =>
    new T.Vector3(x, y, z).applyQuaternion(aim).add(chest);
  const reload = m.reload ? Math.sin(m.reload * Math.PI) : 0;

  if (armed) {
    // Хват у плеча: приклад в плечо, ствол вперёд по прицелу.
    const pos = at(0.17, -0.05 - reload * 0.08, -0.34 + r.recoil * 0.07);
    gun.position.copy(pos);
    gun.quaternion.copy(aim).multiply(_q.setFromAxisAngle(new T.Vector3(0, 0, 1), reload * 0.5));
  }
  if (tablet.visible) {
    tablet.position.copy(at(-0.02, -0.28, -0.34));
    tablet.quaternion.copy(aim).multiply(_q.setFromAxisAngle(new T.Vector3(1, 0, 0), 0.6));
  }
  if (grenade.visible) {
    // Замах: граната уходит назад за плечо и проходит дугу вперёд.
    const t = r.throwing;
    const swing = t > 0 ? Math.sin((1 - t) * Math.PI) : 0;
    grenade.position.copy(at(0.22, 0.12 + swing * 0.25, -0.18 - swing * 0.35 + (t > 0.7 ? (t - 0.7) * 1.2 : 0)));
    grenade.quaternion.copy(aim);
  }
  gun.updateMatrixWorld(true);
  tablet.updateMatrixWorld(true);
  grenade.updateMatrixWorld(true);

  // Кисти: правая на рукоятку, левая на цевьё (или на край планшета).
  const world = (o: T.Object3D, x: number, y: number, z: number) => o.localToWorld(new T.Vector3(x, y, z));
  const aimWorld = avatar.getWorldQuaternion(new T.Quaternion()).multiply(aim);
  const fwd = new T.Vector3(0, 0, -1).applyQuaternion(aimWorld);
  const up = new T.Vector3(0, 1, 0).applyQuaternion(aimWorld);
  const rightDir = new T.Vector3(1, 0, 0).applyQuaternion(aimWorld);
  let rightTarget: T.Vector3 | null = null,
    leftTarget: T.Vector3 | null = null;
  if (armed) {
    rightTarget = world(gun, 0, -0.02, 0.02);
    leftTarget =
      m.tool === 'flashlight'
        ? null
        : world(gun, -0.01, -0.03 - reload * 0.12, -0.24 + reload * 0.18);
  } else if (tablet.visible) {
    rightTarget = world(tablet, 0.17, 0.02, -0.1);
    leftTarget = world(tablet, -0.17, 0.02, -0.1);
  } else if (grenade.visible) {
    rightTarget = world(grenade, 0, -0.02, 0.02);
  }
  const poles = [
    new T.Vector3().copy(b.upper[0].getWorldPosition(new T.Vector3())).addScaledVector(up, -1).addScaledVector(rightDir, -0.6),
    new T.Vector3().copy(b.upper[1].getWorldPosition(new T.Vector3())).addScaledVector(up, -1).addScaledVector(rightDir, 0.6),
  ];
  const targets = [leftTarget, rightTarget];
  for (let i = 0; i < 2; i++) {
    const t = targets[i];
    if (!t) continue;
    reach(b.upper[i], b.lower[i], b.hand[i], t, poles[i]);
    // Кисть: пальцы вдоль ствола, большой палец вверх; левая ладонь снизу цевья.
    const fingers = fwd.clone().applyAxisAngle(rightDir, i ? -0.5 : -0.2);
    const thumb = i ? up.clone() : up.clone().applyAxisAngle(fwd, 0.9);
    const side = new T.Vector3().crossVectors(fingers, thumb.sub(fingers.clone().multiplyScalar(thumb.dot(fingers))).normalize());
    const upOrtho = new T.Vector3().crossVectors(side, fingers);
    const basis = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(side, upOrtho, fingers));
    setWorldQuaternion(b.hand[i], basis.multiply(r.handBasis[i].clone().invert()));
  }
  void dt;
}
