import { ZONES } from '../lib/model.ts';
import { makeGrenade, setGrenadeStyle, partyGeometry } from './party-geometry.ts';
import {
  WEAPON_SIGHTS,
  HIP_HOLD,
  type WeaponSight,
} from '../lib/weapon-sights.ts';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createFirstPersonHands(camera: T.Camera) {
  const group = new T.Group();
  group.name = 'first-person-hands';
  camera.add(group);
  const weapon = new T.Group();
  group.add(weapon);
  /*
   * Оружие рисуется поверх мира (`depthTest: false`), иначе ствол протыкал бы
   * стену, к которой прижался игрок. Плата за это — внутри самой модели нет
   * сортировки по глубине: детали одного материала перекрывают друг друга в
   * произвольном порядке, а детали разных материалов — в порядке создания
   * материалов. Поэтому порядок ниже не случайный: то, что должно лежать
   * сверху (накладки, кольца, мушки, линзы), объявлено позже того, на чём оно
   * лежит.
   */
  const metal = new T.MeshStandardMaterial({
    color: '#d1dcd7',
    metalness: 0.72,
    roughness: 0.28,
    depthTest: false,
  });
  const polymer = new T.MeshStandardMaterial({
    color: '#39424b',
    metalness: 0.18,
    roughness: 0.74,
    depthTest: false,
  });
  const grip = new T.MeshStandardMaterial({
    color: '#131a20',
    roughness: 0.86,
    depthTest: false,
  });
  const rubber = new T.MeshStandardMaterial({
    color: '#1c2228',
    roughness: 0.98,
    depthTest: false,
  });
  const sleeve = new T.MeshStandardMaterial({
    color: '#263d49',
    roughness: 0.9,
    depthTest: false,
  });
  const skin = new T.MeshStandardMaterial({
    color: '#bd8c68',
    roughness: 0.8,
    depthTest: false,
  });
  const paint = new T.MeshStandardMaterial({
    color: '#aa86f6',
    roughness: 0.3,
    metalness: 0.2,
    depthTest: false,
  });
  const accent = new T.MeshStandardMaterial({
    color: '#ed646d',
    metalness: 0.5,
    roughness: 0.31,
    depthTest: false,
  });
  const gold = new T.MeshStandardMaterial({
    color: '#f5c358',
    metalness: 0.85,
    roughness: 0.2,
    depthTest: false,
  });
  const lensGlow = new T.MeshBasicMaterial({
    color: '#64d4ef',
    depthTest: false,
  });
  const dotGlow = new T.MeshBasicMaterial({
    color: '#ff5566',
    depthTest: false,
  });
  // Стекло коллиматора и окуляра: прозрачные материалы три рисует последними,
  // поэтому блик всегда ложится поверх корпуса и точки — как и в жизни.
  const glass = new T.MeshBasicMaterial({
    color: '#8fe3ff',
    transparent: true,
    opacity: 0.17,
    depthTest: false,
    depthWrite: false,
  });

  const paintGun = new T.Group();
  paintGun.name = 'paint-launcher';
  weapon.add(paintGun);

  const shotgun = new T.Group();
  shotgun.name = 'confetti-shotgun';
  weapon.add(shotgun);

  const sniperRifle = new T.Group();
  sniperRifle.name = 'sniper-rifle';
  weapon.add(sniperRifle);

  const likeBlaster = new T.Group();
  likeBlaster.name = 'like-blaster';
  weapon.add(likeBlaster);

  const part = (
    geo: T.BufferGeometry,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
    parent: T.Group = weapon,
  ) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.renderOrder = 1000;
    m.raycast = () => {};
    parent.add(m);
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
    parent: T.Group = weapon,
  ) => part(new RoundedBoxGeometry(w, h, d, 2, 0.012), mat, x, y, z, parent);
  const barrel = (
    r: number,
    length: number,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
    parent: T.Group = weapon,
  ) => {
    const m = part(new T.CylinderGeometry(r, r, length, 16), mat, x, y, z, parent);
    m.rotation.x = Math.PI / 2;
    return m;
  };
  /** Кольцо вокруг ствола или трубы прицела. */
  const ring = (
    r: number,
    thickness: number,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
    parent: T.Group,
  ) => part(new T.TorusGeometry(r, thickness, 6, 18), mat, x, y, z, parent);
  /**
   * Метки прицельной линии. Пустышки, а не меши: они ничего не рисуют, но
   * именно по ним тест проверяет, что при прицеливании целик и мушка вышли на
   * ось камеры. Модель строится вокруг них, а не наоборот.
   */
  const sightLine = (parent: T.Group, spec: WeaponSight) => {
    for (const marker of [
      { name: 'sight-rear', z: spec.rear },
      { name: 'sight-front', z: spec.front },
    ]) {
      const anchor = new T.Object3D();
      anchor.name = marker.name;
      anchor.position.set(0, spec.y, marker.z);
      parent.add(anchor);
    }
  };

  // --- 1. КРАСКОМЁТ: маркер с боковым бункером и коллиматором ---
  const paintSight = WEAPON_SIGHTS.paint;
  box(0.112, 0.13, 0.44, metal, 0, 0, -0.17, paintGun);
  box(0.118, 0.045, 0.16, metal, 0, 0.045, -0.06, paintGun);
  barrel(0.034, 0.3, metal, 0, 0.018, -0.52, paintGun);
  box(0.052, 0.026, 0.3, polymer, 0, 0.079, -0.19, paintGun);
  barrel(0.044, 0.2, polymer, 0, 0.018, -0.47, paintGun);
  // Рёбра кожуха: ими маркер отличается силуэтом от дробовика даже боковым
  // зрением, когда разглядывать оружие некогда.
  for (let i = 0; i < 5; i++)
    box(0.098, 0.008, 0.012, polymer, 0, 0.018, -0.55 + i * 0.037, paintGun);
  for (let i = 0; i < 7; i++)
    box(0.062, 0.012, 0.012, metal, 0, 0.094, -0.3 + i * 0.036, paintGun);
  box(0.072, 0.185, 0.095, grip, 0, -0.135, -0.03, paintGun).rotation.x = -0.2;
  for (let i = 0; i < 4; i++)
    box(0.076, 0.008, 0.012, rubber, 0, -0.09 - i * 0.032, -0.008 - i * 0.006, paintGun);
  const paintGuard = part(
    new T.TorusGeometry(0.042, 0.008, 6, 14),
    metal,
    0,
    -0.052,
    -0.115,
    paintGun,
  );
  paintGuard.rotation.x = Math.PI / 2;
  box(0.012, 0.038, 0.014, rubber, 0, -0.05, -0.122, paintGun);
  const cartridge = box(0.082, 0.175, 0.105, grip, 0, -0.12, -0.235, paintGun);
  const hopper = part(
    new RoundedBoxGeometry(0.062, 0.05, 0.19, 2, 0.008),
    paint,
    0.084,
    0.012,
    -0.17,
    paintGun,
  );
  const feed = barrel(0.019, 0.05, paint, 0.05, 0.012, -0.17, paintGun);
  feed.rotation.set(0, 0, Math.PI / 2);
  barrel(0.046, 0.055, accent, 0, 0.018, -0.685, paintGun);
  /*
   * Механический прицел. Целик с прорезью на планке и мушка в защитных «ушах»
   * у дула — вершина мушки и плечи целика стоят на одной высоте, и она же
   * высота линии прицела. Уши выше мушки: они прикрывают её от ударов и
   * обрамляют картинку, не закрывая цель.
   */
  box(0.056, 0.06, 0.055, polymer, 0, 0.055, paintSight.front, paintGun);
  box(0.046, 0.018, 0.05, metal, 0, 0.092, paintSight.front, paintGun);
  for (const side of [-1, 1])
    box(0.008, 0.042, 0.016, metal, side * 0.019, 0.122, paintSight.front, paintGun);
  box(0.0055, 0.022, 0.0055, metal, 0, 0.107, paintSight.front, paintGun);
  box(0.042, 0.014, 0.032, polymer, 0, 0.088, paintSight.rear, paintGun);
  for (const side of [-1, 1])
    box(0.009, 0.026, 0.014, metal, side * 0.011, 0.105, paintSight.rear, paintGun);
  /*
   * Коллиматор поверх той же линии. Окно широкое намеренно: узкая щель
   * превращает прицеливание в подглядывание через прорезь, а смысл коллиматора
   * в том, чтобы видеть поле боя целиком и держать точку на цели.
   */
  box(0.082, 0.02, 0.085, polymer, 0, 0.099, -0.175, paintGun);
  for (const side of [-1, 1])
    box(0.009, 0.058, 0.014, polymer, side * 0.039, 0.129, -0.175, paintGun);
  box(0.092, 0.01, 0.09, polymer, 0, 0.161, -0.175, paintGun);
  const paintDot = part(
    new T.SphereGeometry(0.0055, 8, 8),
    dotGlow,
    0,
    paintSight.y,
    -0.178,
    paintGun,
  );
  paintDot.renderOrder = 1002;
  const paintGlass = part(
    new T.PlaneGeometry(0.072, 0.052),
    glass,
    0,
    0.129,
    -0.163,
    paintGun,
  );
  paintGlass.rotation.x = 0.16;
  paintGlass.renderOrder = 1003;
  sightLine(paintGun, paintSight);

  // --- 2. КОНФЕТТИ-ДРОБОВИК: помпа с вентилируемой планкой ---
  const shotgunSight = WEAPON_SIGHTS.confetti;
  box(0.125, 0.145, 0.38, metal, 0, 0, -0.13, shotgun);
  barrel(0.048, 0.5, metal, 0, 0.045, -0.56, shotgun);
  barrel(0.036, 0.42, polymer, 0, -0.022, -0.52, shotgun);
  box(0.03, 0.014, 0.5, polymer, 0, 0.098, -0.56, shotgun);
  for (let i = 0; i < 9; i++)
    box(0.034, 0.02, 0.008, polymer, 0, 0.09, -0.76 + i * 0.05, shotgun);
  const shotgunPump = box(0.105, 0.09, 0.19, grip, 0, -0.022, -0.41, shotgun);
  for (let i = 0; i < 5; i++)
    box(0.112, 0.012, 0.012, rubber, 0, -0.022, -0.48 + i * 0.035, shotgun);
  box(0.072, 0.175, 0.1, grip, 0, -0.13, -0.01, shotgun).rotation.x = -0.22;
  box(0.078, 0.095, 0.13, grip, 0, -0.075, 0.14, shotgun).rotation.x = 0.32;
  box(0.082, 0.12, 0.04, rubber, 0, -0.105, 0.21, shotgun).rotation.x = 0.32;
  const shotgunGuard = part(
    new T.TorusGeometry(0.04, 0.008, 6, 14),
    metal,
    0,
    -0.058,
    -0.09,
    shotgun,
  );
  shotgunGuard.rotation.x = Math.PI / 2;
  for (let s = 0; s < 3; s++) {
    const shellMat = s === 0 ? accent : s === 1 ? paint : gold;
    const shell = part(
      new T.CylinderGeometry(0.017, 0.017, 0.07, 12),
      shellMat,
      -0.082,
      0.02 - s * 0.036,
      -0.1,
      shotgun,
    );
    shell.rotation.z = Math.PI / 2;
  }
  box(0.13, 0.055, 0.2, gold, 0, 0.002, -0.13, shotgun);
  barrel(0.056, 0.06, gold, 0, 0.045, -0.79, shotgun);
  // Кольцевой целик на коробке и золотая бусина на планке: смотришь сквозь
  // кольцо, ловишь в него бусину — по этой паре и выставляется рука.
  const ghostRing = ring(0.02, 0.005, gold, 0, shotgunSight.y, shotgunSight.rear, shotgun);
  ghostRing.renderOrder = 1002;
  box(0.01, 0.026, 0.01, gold, 0, 0.1, shotgunSight.front, shotgun);
  const bead = part(
    new T.SphereGeometry(0.0095, 10, 10),
    gold,
    0,
    shotgunSight.y,
    shotgunSight.front,
    shotgun,
  );
  bead.renderOrder = 1002;
  sightLine(shotgun, shotgunSight);

  // --- 3. СНАЙПЕРКА: продольно-скользящий затвор и настоящая оптика ---
  const sniperSight = WEAPON_SIGHTS.sniper;
  box(0.1, 0.115, 0.3, metal, 0, 0.02, -0.16, sniperRifle);
  barrel(0.028, 0.76, metal, 0, 0.035, -0.62, sniperRifle);
  barrel(0.042, 0.1, metal, 0, 0.035, -1.03, sniperRifle);
  for (let i = 0; i < 3; i++)
    box(0.096, 0.014, 0.012, metal, 0, 0.035, -1.06 + i * 0.03, sniperRifle);
  box(0.09, 0.12, 0.5, grip, 0, -0.005, -0.06, sniperRifle);
  box(0.085, 0.05, 0.22, grip, 0, 0.07, 0.03, sniperRifle);
  box(0.07, 0.17, 0.09, grip, 0, -0.12, -0.02, sniperRifle).rotation.x = -0.25;
  const sniperMag = box(0.062, 0.155, 0.125, grip, 0, -0.13, -0.19, sniperRifle);
  box(0.09, 0.15, 0.04, rubber, 0, -0.01, 0.21, sniperRifle);
  const sniperGuard = part(
    new T.TorusGeometry(0.04, 0.008, 6, 14),
    metal,
    0,
    -0.05,
    -0.11,
    sniperRifle,
  );
  sniperGuard.rotation.x = Math.PI / 2;
  // Сошки сложены под стволом, а не торчат в поле зрения оптики.
  for (const side of [-1, 1]) {
    const leg = part(
      new T.CylinderGeometry(0.008, 0.008, 0.22, 8),
      polymer,
      side * 0.022,
      -0.05,
      -0.78,
      sniperRifle,
    );
    leg.rotation.x = 1.36;
  }
  barrel(0.03, 0.32, polymer, 0, sniperSight.y, -0.19, sniperRifle);
  barrel(0.044, 0.09, polymer, 0, sniperSight.y, -0.39, sniperRifle);
  barrel(0.04, 0.075, polymer, 0, sniperSight.y, -0.005, sniperRifle);
  const sniperBolt = box(0.02, 0.02, 0.055, metal, 0.058, 0.045, -0.06, sniperRifle);
  part(new T.SphereGeometry(0.018, 10, 10), metal, 0.086, 0.045, -0.06, sniperRifle);
  for (const z of [-0.1, -0.28])
    ring(0.033, 0.009, gold, 0, sniperSight.y, z, sniperRifle).renderOrder = 1002;
  const turretTop = part(
    new T.CylinderGeometry(0.019, 0.019, 0.034, 12),
    gold,
    0,
    sniperSight.y + 0.04,
    -0.19,
    sniperRifle,
  );
  turretTop.renderOrder = 1002;
  const turretSide = part(
    new T.CylinderGeometry(0.019, 0.019, 0.034, 12),
    gold,
    0.048,
    sniperSight.y,
    -0.19,
    sniperRifle,
  );
  turretSide.rotation.z = Math.PI / 2;
  turretSide.renderOrder = 1002;
  const sniperLens = part(
    new T.CylinderGeometry(0.038, 0.038, 0.006, 20),
    lensGlow,
    0,
    sniperSight.y,
    sniperSight.front,
    sniperRifle,
  );
  sniperLens.rotation.x = Math.PI / 2;
  sniperLens.renderOrder = 1002;
  const ocular = part(
    new T.CylinderGeometry(0.033, 0.033, 0.005, 20),
    glass,
    0,
    sniperSight.y,
    sniperSight.rear,
    sniperRifle,
  );
  ocular.rotation.x = Math.PI / 2;
  ocular.renderOrder = 1003;
  sightLine(sniperRifle, sniperSight);

  // --- 4. ЛАЙКОМЁТ: пистолет с открытым целиком ---
  const likeSight = WEAPON_SIGHTS.like;
  box(0.075, 0.125, 0.24, accent, 0, 0.015, -0.13, likeBlaster);
  barrel(0.03, 0.2, gold, 0, 0.04, -0.27, likeBlaster);
  box(0.06, 0.028, 0.2, gold, 0, 0.078, -0.14, likeBlaster);
  barrel(0.04, 0.035, metal, 0, 0.04, -0.375, likeBlaster);
  box(0.062, 0.145, 0.085, grip, 0, -0.105, -0.045, likeBlaster).rotation.x = -0.2;
  const likeMag = barrel(0.028, 0.11, lensGlow, 0, -0.07, -0.16, likeBlaster);
  likeMag.rotation.x = 0;
  const likeHeartCrystal = part(
    partyGeometry('hearts'),
    accent,
    0.055,
    0.062,
    -0.1,
    likeBlaster,
  );
  likeHeartCrystal.scale.setScalar(0.5);
  // Сердце ушло вбок: на прежнем месте, по центру над стволом, украшение
  // закрывало ровно то, ради чего целятся.
  for (const side of [-1, 1])
    box(0.009, 0.02, 0.012, metal, side * 0.014, likeSight.y, likeSight.rear, likeBlaster);
  box(0.008, 0.024, 0.01, gold, 0, likeSight.y, likeSight.front, likeBlaster);
  ring(0.018, 0.004, metal, 0, likeSight.y, likeSight.front, likeBlaster).renderOrder = 1002;
  sightLine(likeBlaster, likeSight);

  // Arms and sleeves (attached to shared weapon group)
  barrel(0.08, 0.28, sleeve, 0.07, -0.23, 0.17).rotation.z = -0.14;
  box(0.1, 0.12, 0.14, skin, 0.055, -0.12, 0.03).rotation.z = -0.15;
  barrel(0.075, 0.34, sleeve, -0.21, -0.21, -0.08).rotation.y = -0.85;
  box(0.12, 0.09, 0.16, skin, -0.09, -0.09, -0.25);
  for (let i = 0; i < 4; i++)
    box(0.024, 0.06, 0.045, skin, -0.069 + i * 0.026, -0.055, -0.29);
  const tablet = new T.Group();
  group.add(tablet);
  const frame = new T.Mesh(
    new RoundedBoxGeometry(0.48, 0.34, 0.024, 2, 0.018),
    grip,
  );
  tablet.add(frame);
  const screen = new T.Mesh(
    new T.PlaneGeometry(0.435, 0.285),
    new T.MeshBasicMaterial({ color: '#91c3c3', depthTest: false }),
  );
  screen.position.z = 0.014;
  tablet.add(screen);
  for (let i = 0; i < 3; i++) {
    const card = new T.Mesh(
      new RoundedBoxGeometry(0.112, 0.16, 0.006, 1, 0.006),
      new T.MeshBasicMaterial({
        color: ['#fff0c9', '#e3b6b0', '#deedf0'][i],
        depthTest: false,
      }),
    );
    card.position.set(-0.143 + i * 0.143, -0.016, 0.022);
    tablet.add(card);
    for (let j = 0; j < 3; j++) {
      const line = new T.Mesh(new T.BoxGeometry(0.077, 0.005, 0.003), grip);
      line.position.set(-0.143 + i * 0.143, 0.025 - j * 0.021, 0.027);
      tablet.add(line);
    }
  }
  tablet.rotation.x = -0.22;
  tablet.position.set(-0.1, -0.03, -0.17);
  tablet.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.renderOrder = 1001;
      o.raycast = () => {};
    }
  });

  // Sticky Note Pad model in hands
  const stickyPad = new T.Group();
  group.add(stickyPad);
  const padBack = new T.Mesh(
    new RoundedBoxGeometry(0.24, 0.26, 0.016, 2, 0.012),
    grip,
  );
  stickyPad.add(padBack);
  const padPaperStack = new T.Mesh(
    new RoundedBoxGeometry(0.21, 0.22, 0.018, 1, 0.008),
    new T.MeshBasicMaterial({ color: '#fef3c7', depthTest: false }),
  );
  padPaperStack.position.z = 0.012;
  stickyPad.add(padPaperStack);
  const padTopNote = new T.Mesh(
    new RoundedBoxGeometry(0.19, 0.20, 0.005, 1, 0.006),
    new T.MeshBasicMaterial({ color: '#8db9a1', depthTest: false }),
  );
  padTopNote.position.z = 0.022;
  stickyPad.add(padTopNote);
  const pencil = barrel(0.012, 0.22, metal, 0.13, 0, 0.015, stickyPad);
  pencil.rotation.z = Math.PI / 2;
  stickyPad.rotation.x = -0.25;
  stickyPad.position.set(-0.06, -0.06, -0.19);
  stickyPad.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.renderOrder = 1001;
      o.raycast = () => {};
    }
  });

  let recoil = 0,
    equip = 0,
    lastTool = '';
  const grenadeHands = new T.Group();
  group.add(grenadeHands);
  for (const child of weapon.children) {
    if (
      child instanceof T.Mesh &&
      [skin, sleeve].includes(child.material as T.MeshStandardMaterial)
    )
      grenadeHands.add(child.clone());
  }
  const grenade = makeGrenade('#f49fd6');
  grenade.position.set(0.03, -0.02, -0.2);
  group.add(grenade);
  grenade.traverse((o) => {
    if (o instanceof T.Mesh) {
      (o.material as T.Material).depthTest = false;
      o.renderOrder = 1001;
    }
  });
  const muzzleScratch = new T.Vector3();
  return {
    group,
    /**
     * Точка вылета снаряда в мире. Раньше здесь стояла одна константа на все
     * стволы, и у снайперки выстрел рождался в середине ствола, а у пистолета
     * — в воздухе перед дулом.
     */
    muzzle(tool: string) {
      const spec = WEAPON_SIGHTS[tool];
      muzzleScratch.set(
        spec ? spec.muzzle[0] : 0,
        spec ? spec.muzzle[1] : 0.025,
        spec ? spec.muzzle[2] : -0.69,
      );
      return group.localToWorld(muzzleScratch.clone());
    },
    shoot: (weaponType = 'paint') => {
      recoil =
        weaponType === 'sniper'
          ? 1.4
          : weaponType === 'confetti'
            ? 1.2
            : weaponType === 'like'
              ? 0.75
              : 0.85;
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
      variant = 'pinata',
      tabletInspect = 0,
    ) {
      group.visible = active && !(tool === 'sniper' && aim > 0.12);
      weapon.visible =
        tool === 'paint' ||
        tool === 'confetti' ||
        tool === 'sniper' ||
        tool === 'like';
      paintGun.visible = tool === 'paint';
      shotgun.visible = tool === 'confetti';
      sniperRifle.visible = tool === 'sniper' && aim <= 0.12;
      likeBlaster.visible = tool === 'like';
      tablet.visible = tool === 'pointer';
      stickyPad.visible = tool === 'sticky';
      if (lastTool !== tool) {
        lastTool = tool;
        equip = 1;
      }
      equip = Math.max(0, equip - dt * 5);
      recoil *= Math.exp(-15 * dt);

      // Multi-phase procedural reload choreography
      let reloadRotX = 0,
        reloadRotY = 0,
        reloadRotZ = 0;
      let reloadPosY = 0,
        reloadPosZ = 0;

      if (reload > 0) {
        if (reload < 0.25) {
          // Phase 1: Tilt inward and drop empty magazine
          const t1 = reload / 0.25;
          reloadRotZ = -0.42 * t1;
          reloadRotY = 0.25 * t1;
          reloadRotX = -0.15 * t1;
          reloadPosY = -0.06 * t1;
          cartridge.position.y = -0.12 - t1 * 0.24;
          sniperMag.position.y = -0.13 - t1 * 0.24;
          likeMag.position.y = -0.07 - t1 * 0.22;
        } else if (reload < 0.62) {
          // Phase 2: Insert fresh magazine and palm-slap lock
          const t2 = (reload - 0.25) / 0.37;
          reloadRotZ = -0.42 * (1 - t2 * 0.2);
          reloadRotY = 0.25;
          reloadRotX = -0.12;
          const insert = Math.min(1, t2 * 1.35);
          cartridge.position.y = -0.36 + insert * 0.24;
          sniperMag.position.y = -0.37 + insert * 0.24;
          likeMag.position.y = -0.29 + insert * 0.22;
          if (reload >= 0.52 && reload <= 0.62) {
            const slap = Math.sin(((reload - 0.52) / 0.1) * Math.PI);
            reloadPosY = slap * 0.045;
            reloadPosZ = slap * 0.03;
            reloadRotX += slap * 0.12;
          }
        } else if (reload < 0.86) {
          // Phase 3: Cocking handle / pump action / bolt cycle
          const t3 = (reload - 0.62) / 0.24;
          const rack = Math.sin(t3 * Math.PI);
          cartridge.position.y = -0.12;
          sniperMag.position.y = -0.13;
          likeMag.position.y = -0.07;
          reloadRotZ = -0.33 * (1 - t3);
          reloadRotY = 0.2 * (1 - t3);
          reloadPosZ = -rack * 0.04;
          shotgunPump.position.z = -0.41 + rack * 0.09;
          sniperBolt.position.z = -0.06 + rack * 0.07;
          sniperBolt.rotation.z = rack * 0.5;
        } else {
          // Phase 4: Smooth return to ready stance
          const t4 = (reload - 0.86) / 0.14;
          cartridge.position.y = -0.12;
          sniperMag.position.y = -0.13;
          likeMag.position.y = -0.07;
          shotgunPump.position.z = -0.41;
          sniperBolt.position.z = -0.06;
          sniperBolt.rotation.z = 0;
          const settle = Math.sin(t4 * Math.PI) * 0.015;
          reloadPosY = settle;
        }
      } else {
        cartridge.position.y = -0.12;
        sniperMag.position.y = -0.13;
        likeMag.position.y = -0.07;
        shotgunPump.position.z = -0.41;
        sniperBolt.position.z = -0.06;
        sniperBolt.rotation.z = 0;
      }

      grenade.visible = tool === 'grenade';
      grenadeHands.visible = grenade.visible;
      if (grenade.visible) setGrenadeStyle(grenade, variant, true);
      if (tool === 'sticky') {
        (padTopNote.material as T.MeshBasicMaterial).color.set(
          ZONES.find((z) => z.id === variant)?.color || '#8db9a1',
        );
      }
      if (tool === 'pointer') {
        if (tabletInspect > 0) {
          tablet.position.x = T.MathUtils.lerp(-0.1, 0, tabletInspect);
          tablet.position.y = T.MathUtils.lerp(-0.03, -0.01, tabletInspect);
          tablet.position.z = T.MathUtils.lerp(-0.17, -0.22, tabletInspect);
          tablet.rotation.x = T.MathUtils.lerp(-0.22, 0.04, tabletInspect);
          const bootColor = new T.Color('#38bdf8').lerp(
            new T.Color('#ffffff'),
            Math.min(1, tabletInspect * 1.3),
          );
          (screen.material as T.MeshBasicMaterial).color.copy(bootColor);
        } else {
          tablet.position.set(-0.1, -0.03, -0.17);
          tablet.rotation.set(-0.22, 0, 0);
          (screen.material as T.MeshBasicMaterial).color.set('#527982');
        }
      }
      paint.color.set(color);
      (hopper.material as T.MeshStandardMaterial).color.set(color);

      /*
       * Прицеливание. Рука уезжает не в подобранную на глаз точку, а ровно на
       * -y прицельной линии этого ствола: тогда целик и мушка ложатся на ось
       * камеры, и центр экрана — это то, что видно сквозь прицел. Предметы без
       * прицельных приспособлений держатся по-прежнему.
       */
      const sight = WEAPON_SIGHTS[tool];
      const isItem = tool === 'pointer' || tool === 'sticky';
      const hipX = isItem ? 0.08 : HIP_HOLD.x;
      const aimX = sight ? 0 : hipX;
      const aimY = sight ? -sight.y : -0.115;
      const aimZ = sight ? sight.z : HIP_HOLD.z;
      const targetX =
        tabletInspect > 0
          ? T.MathUtils.lerp(hipX, 0, tabletInspect)
          : T.MathUtils.lerp(hipX, aimX, aim);
      const targetY =
        tabletInspect > 0
          ? T.MathUtils.lerp(-0.3, -0.16, tabletInspect)
          : T.MathUtils.lerp(HIP_HOLD.y, aimY, aim);
      const targetZ =
        tabletInspect > 0
          ? T.MathUtils.lerp(-0.52, -0.38, tabletInspect)
          : T.MathUtils.lerp(HIP_HOLD.z, aimZ, aim) +
            recoil * 0.075 +
            reloadPosZ;

      /*
       * Покачивание глушится прицеливанием до нуля. Раньше оставалась десятая
       * часть, и с нарисованным поверх перекрестием это было незаметно. Со
       * сквозным прицеливанием любой остаток уводит мушку с центра экрана —
       * ровно тогда, когда точность и нужна.
       */
      const sway = (1 - aim) * (1 - tabletInspect);
      group.position.set(
        targetX +
          Math.sin(time * speed * 2.4) * Math.min(speed, 0.9) * 0.009 * sway,
        targetY +
          Math.cos(time * speed * 4.8) * Math.min(speed, 1) * 0.011 * sway +
          reloadPosY -
          equip * 0.22,
        targetZ,
      );
      group.rotation.set(
        recoil * 0.095 +
          equip * 0.25 +
          reloadRotX +
          (tabletInspect > 0 ? -0.15 * tabletInspect : 0),
        reloadRotY,
        reloadRotZ + Math.sin(time * 0.8) * 0.005 * sway,
      );
    },
  };
}
