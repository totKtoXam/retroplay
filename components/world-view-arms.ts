import * as T from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { findBones, handBasis, humanAssets, loadHumanAssets, reach, setWorldQuaternion, suitMaterial } from './world-human.ts';
import { viewModelMaterial } from './world-hands.ts';

/*
 * Руки от первого лица — руки той же модели человека, что и боец в мире
 * (world-human.ts): рукава костюма цвета игрока, перчатки, пальцы из клипа
 * «пистолет в прицеле». Тело целиком не нужно: из его треугольников оставлены
 * только руки от плеча до пальцев, остальное не рисуется вовсе (своя выборка
 * индексов, геометрия вершин общая с моделью). Кисти каждый кадр ставятся на
 * рукоятку и цевьё ствола двухзвенной IK — вслед за отдачей, покачиванием и
 * перезарядкой, которые считает world-hands.ts.
 */

type Hands = {
  group: T.Group;
  grips(): { right: T.Vector3; left: T.Vector3 } | null;
  itemHold(tool: string): T.Vector3 | null;
  humanArms: boolean;
};

/** Облик рук: тело (у женского тоньше руки) и цвета костюма и перчаток. */
export type ArmsLook = { female: boolean; suit: T.ColorRepresentation; gear: T.ColorRepresentation };

/** Кости рук: их вершины остаются, остальное тело отбрасывается. */
const ARM_BONE = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/;
/**
 * Где кость головы относительно глаза (камеры), в метрах: ниже и позади. От
 * неё зависит, откуда растут плечи; подобрано так, чтобы локти уходили за
 * край кадра, как у человека с оружием у плеча.
 */
const HEAD_FROM_EYE = new T.Vector3(0.05, -0.08, 0.06);
/**
 * Стойка по оружию. С винтовкой корпус развёрнут вправо, как у стрелка:
 * левое плечо выходит вперёд, и левая рука достаёт до цевья. С пистолетом
 * плечи прямо и подаются вперёд — руки вытянуты. `forward` — сдвиг плеч к
 * цели, м. Корпус в кадр не попадает, видны только руки.
 */
const STANCE: Record<string, { blade: number; forward: number }> = {
  rifle: { blade: -0.5, forward: 0.14 },
  pistol: { blade: 0, forward: 0.16 },
};
/** Руки чуть крупнее настоящих: модель набора невысокая, а плечо дальше глаза, чем у живого стрелка. */
const ARMS_SCALE = 1.12;

/** Выборка треугольников рук у тела — одна на шаблон. */
const armIndex = new WeakMap<T.BufferGeometry, T.BufferAttribute>();

function armsOnly(body: T.SkinnedMesh) {
  const source = body.geometry;
  let index = armIndex.get(source);
  if (!index) {
    const bones = body.skeleton.bones;
    const skinIndex = source.getAttribute('skinIndex');
    const skinWeight = source.getAttribute('skinWeight');
    const onArm = new Uint8Array(skinIndex.count);
    for (let v = 0; v < skinIndex.count; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++)
        if (ARM_BONE.test(bones[skinIndex.getComponent(v, k)]?.name ?? '')) w += skinWeight.getComponent(v, k);
      onArm[v] = w >= 0.5 ? 1 : 0;
    }
    const all = source.getIndex()!;
    const kept: number[] = [];
    for (let i = 0; i < all.count; i += 3) {
      const a = all.getX(i),
        b = all.getX(i + 1),
        c = all.getX(i + 2);
      if (onArm[a] && onArm[b] && onArm[c]) kept.push(a, b, c);
    }
    index = new T.BufferAttribute(new Uint32Array(kept), 1);
    armIndex.set(source, index);
  }
  const geometry = new T.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(index);
  geometry.userData.viewArms = true;
  return geometry;
}

/**
 * Сгибает пальцы кисти (в клипах набора обхвата оружия нет: статичные позы
 * выкинуты при сборке). Ось сгиба — линия костяшек от указательного к мизинцу;
 * знак — в сторону ладони, куда смотрит основание большого пальца.
 */
function curlFingers(hand: T.Bone, side: 'l' | 'r', angles: [number, number, number]) {
  const at = (name: string) => hand.getObjectByName(`${name}_${side}`)!.getWorldPosition(new T.Vector3());
  const wrist = hand.getWorldPosition(new T.Vector3());
  const axis = at('pinky_01').sub(at('index_01')).normalize();
  const finger = at('middle_01').sub(wrist).normalize();
  const plane = new T.Vector3().crossVectors(finger, axis).normalize();
  const palm = plane.multiplyScalar(Math.sign(at('thumb_03').sub(wrist).dot(plane)) || 1);
  const sign = Math.sign(new T.Vector3().crossVectors(axis, finger).dot(palm)) || 1;
  const turn = new T.Quaternion(),
    parent = new T.Quaternion();
  for (const name of ['index', 'middle', 'ring', 'pinky'])
    for (let j = 0; j < 3; j++) {
      const bone = hand.getObjectByName(`${name}_0${j + 1}_${side}`);
      if (!bone) continue;
      bone.parent!.getWorldQuaternion(parent);
      turn.setFromAxisAngle(axis, sign * angles[j]);
      bone.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent));
      bone.updateMatrixWorld(true);
    }
}

type Rig = {
  female: boolean;
  head: T.Vector3;
  stance: { blade: number; forward: number };
  root: T.Group;
  body: T.SkinnedMesh;
  bones: ReturnType<typeof findBones>;
  basis: [T.Quaternion, T.Quaternion];
  suit: ReturnType<typeof suitMaterial>;
};

function build(camera: T.Camera, female: boolean): Rig | null {
  const assets = humanAssets();
  if (!assets) return null;
  const template = female ? assets.bodies.female : assets.bodies.male;
  const scene = cloneSkinned(template.scene);
  let body: T.SkinnedMesh | null = null;
  scene.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    if (o.name === 'body' && o instanceof T.SkinnedMesh) body = o;
    else o.visible = false;
  });
  const found = body as T.SkinnedMesh | null;
  if (!found) return null;
  const suit = suitMaterial(found.material as T.MeshStandardMaterial);
  viewModelMaterial(suit.material);
  found.material = suit.material;
  found.geometry = armsOnly(found);
  found.castShadow = false;
  found.receiveShadow = false;
  found.frustumCulled = false;
  found.renderOrder = 999;
  found.raycast = () => {};
  const root = new T.Group();
  root.name = 'first-person-arms';
  root.rotation.y = Math.PI;
  root.scale.setScalar(ARMS_SCALE);
  root.add(scene);
  camera.add(root);
  const bones = findBones(scene);
  scene.updateMatrixWorld(true);
  // Правая сжимает рукоятку, левая обхватывает цевьё мягче.
  curlFingers(bones.hand[1], 'r', [0.95, 1.15, 0.75]);
  curlFingers(bones.hand[0], 'l', [0.85, 1.0, 0.65]);
  // Глаз — в камере: голова модели ставится чуть ниже и позади него.
  camera.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  // Голова в координатах самой модели: от неё ставится стойка (см. stand).
  const head = scene.worldToLocal(bones.head.getWorldPosition(new T.Vector3()));
  return {
    head,
    stance: { blade: 0, forward: 0 },
    female,
    root,
    body: found,
    bones,
    basis: [handBasis(bones.hand[0], 'l'), handBasis(bones.hand[1], 'r')],
    suit,
  };
}

/** Разворот и сдвиг корпуса к стойке оружия; голова остаётся у глаза. */
function stand(rig: Rig, want: { blade: number; forward: number }, dt: number) {
  const k = 1 - Math.exp(-12 * dt);
  rig.stance.blade += (want.blade - rig.stance.blade) * k;
  rig.stance.forward += (want.forward - rig.stance.forward) * k;
  rig.root.rotation.y = Math.PI + rig.stance.blade;
  const head = rig.head.clone().multiplyScalar(ARMS_SCALE).applyAxisAngle(_yAxis, rig.root.rotation.y);
  rig.root.position.copy(HEAD_FROM_EYE).sub(head);
  rig.root.position.z -= rig.stance.forward;
}

function dispose(rig: Rig) {
  rig.root.removeFromParent();
  rig.body.geometry.dispose();
  rig.suit.material.dispose();
}

const _yAxis = new T.Vector3(0, 1, 0),
  _fwd = new T.Vector3(),
  _up = new T.Vector3(),
  _right = new T.Vector3(),
  _q = new T.Quaternion(),
  _m = new T.Matrix4();

/**
 * Ставит кисть: пальцы — `fingers`, большой палец — к `thumb` (мировые
 * направления); запястье — так, чтобы середина ладони легла в `palm`.
 */
function placeHand(rig: Rig, i: 0 | 1, palm: T.Vector3, fingers: T.Vector3, thumb: T.Vector3, pole: T.Vector3, palmDepth: number) {
  const b = rig.bones;
  const f = fingers.clone().normalize();
  const t = thumb.clone().sub(f.clone().multiplyScalar(thumb.dot(f))).normalize();
  const side = new T.Vector3().crossVectors(t, f);
  const wrist = palm.clone().addScaledVector(f, -palmDepth);
  reach(b.upper[i], b.lower[i], b.hand[i], wrist, pole);
  const basis = _q.setFromRotationMatrix(_m.makeBasis(side, t, f));
  setWorldQuaternion(b.hand[i], basis.clone().multiply(rig.basis[i].clone().invert()));
}

export function createViewArms(camera: T.Camera, hands: Hands) {
  let rig: Rig | null = null;
  let requested = false;
  const scratch = { right: new T.Vector3(), left: new T.Vector3() };
  return {
    /**
     * Каждый кадр после hands.update. `look` — облик своего бойца; null — руки
     * не нужны (не первое лицо, в руках планшет или стикеры).
     */
    update(tool: string, look: ArmsLook | null, dt = 1 / 60) {
      if (!look) {
        if (rig) rig.root.visible = false;
        hands.humanArms = false;
        return;
      }
      if (!humanAssets()) {
        if (!requested) {
          requested = true;
          void loadHumanAssets().catch(() => (requested = false));
        }
        hands.humanArms = false;
        return;
      }
      if (rig && look && rig.female !== look.female) {
        dispose(rig);
        rig = null;
      }
      if (!rig && look) rig = build(camera, look.female);
      if (!rig) return;
      const grips = hands.grips();
      const item = tool === 'grenade' || tool === 'flashlight' || tool === 'melee';
      const show = !!look && hands.group.visible && (!!grips || item);
      rig.root.visible = show;
      hands.humanArms = show;
      if (!show || !look) return;
      rig.suit.uniforms.suitColor.value.set(look.suit);
      rig.suit.uniforms.gearColor.value.set(look.gear);

      stand(rig, STANCE[tool === 'like' || !grips ? 'pistol' : 'rifle'], dt);
      rig.root.updateMatrixWorld(true);
      hands.group.updateMatrixWorld(true);
      // Оси ствола в мире: вперёд — к дулу, вверх, вправо.
      hands.group.getWorldQuaternion(_q);
      _fwd.set(0, 0, -1).applyQuaternion(_q);
      _up.set(0, 1, 0).applyQuaternion(_q);
      _right.set(1, 0, 0).applyQuaternion(_q);
      const shoulder = (i: number) => rig!.bones.upper[i].getWorldPosition(new T.Vector3());
      // Локти — вниз и в стороны, как у держащего оружие у плеча.
      const poleRight = shoulder(1).addScaledVector(_up, -1).addScaledVector(_right, 0.5).addScaledVector(_fwd, -0.2);
      const poleLeft = shoulder(0).addScaledVector(_up, -1.4).addScaledVector(_right, -0.6);

      if (grips) {
        const right = hands.group.localToWorld(scratch.right.copy(grips.right));
        const left = hands.group.localToWorld(scratch.left.copy(grips.left));
        // Правая: пальцы вниз-вперёд вокруг рукоятки, большой палец вверх, ладонь
        // на правой щёчке рукоятки.
        const rFingers = _fwd.clone().multiplyScalar(0.55).addScaledVector(_up, -0.8).addScaledVector(_right, -0.25);
        const rThumb = _up.clone().addScaledVector(_fwd, 0.4).addScaledVector(_right, -0.3);
        right.addScaledVector(_right, 0.018);
        placeHand(rig, 1, right, rFingers, rThumb, poleRight, 0.04);
        // Левая: ладонь снизу цевья, пальцы вперёд и вверх по левому боку.
        const lFingers = _fwd.clone().addScaledVector(_right, 0.2).addScaledVector(_up, -0.1);
        const lThumb = _up.clone().addScaledVector(_right, 0.2);
        left.addScaledVector(_up, -0.025);
        placeHand(rig, 0, left, lFingers, lThumb, poleLeft, 0.05);
      } else {
        // Граната и фонарик: правая держит предмет, левая опущена за кадр.
        // Граната, фонарик и оружие ближнего боя: правая держит предмет и идёт за ним
        // в замахе и ударе, левая опущена за кадр.
        const held = hands.itemHold(tool) ?? hands.group.localToWorld(scratch.right.set(0.03, -0.045, -0.19));
        placeHand(rig, 1, held, _fwd.clone().addScaledVector(_up, -0.5), _up.clone(), poleRight, 0.04);
        const rest = camera.localToWorld(scratch.left.set(-0.28, -0.6, 0.05));
        placeHand(rig, 0, rest, _up.clone().negate(), _fwd.clone(), poleLeft, 0.05);
      }
    },
    /** Для стенда и тестов: текущая сборка рук. */
    get rig() {
      return rig;
    },
    dispose() {
      if (rig) dispose(rig);
      rig = null;
    },
  };
}
