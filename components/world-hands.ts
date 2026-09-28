import { ZONES } from '../lib/model.ts';
import { makeGrenade, setGrenadeStyle, partyGeometry } from './party-geometry.ts';
import {
  WEAPON_SIGHTS,
  HIP_HOLD,
  DEFAULT_PAINT_SIGHT,
  type PaintSight,
  type WeaponSight,
} from '../lib/weapon-sights.ts';
import { WEAPON_MODEL, WEAPON_SUPPORT, preloadWeaponModels, weaponModel } from './world-weapon-models.ts';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
 * Оружие в руках рисуется поверх мира, иначе ствол протыкал бы стену, к
 * которой прижался игрок. Раньше для этого выключали проверку глубины, но тогда
 * внутри самой модели нет сортировки: детали перекрывают друг друга в
 * произвольном порядке, и настоящая модель оружия превращается в кашу. Поэтому
 * глубина у рук своя: вершинный шейдер сжимает её в самый ближний сотый слой
 * буфера. Мир дальше этого слоя (ближе 6 см к глазу — только ближняя плоскость
 * камеры), а между собой детали оружия сортируются как обычно.
 */
const VIEW_DEPTH = 0.01;

/** Материал для рук и оружия от первого лица: своя ближняя глубина (см. выше). */
const viewModels = new WeakSet<T.Material>();
export function viewModelMaterial<M extends T.Material>(material: M): M {
  // По самому материалу, а не по userData: копия материала метку унаследует, а шейдер — нет.
  if (viewModels.has(material)) return material;
  viewModels.add(material);
  const previous = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
      gl_Position.z = -gl_Position.w + (gl_Position.z + gl_Position.w) * ${VIEW_DEPTH.toFixed(3)};`,
    );
  };
  material.customProgramCacheKey = () => `${key()}|view-model`;
  material.depthTest = true;
  material.userData.viewModel = true;
  material.needsUpdate = true;
  return material;
}

/** Всё, что рисуется в руках: ближняя глубина, поверх мира, мимо лучей прицеливания. */
function asViewModel(root: T.Object3D, order = 1000) {
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    o.renderOrder = order;
    o.raycast = () => {};
    o.castShadow = false;
    o.receiveShadow = false;
    o.frustumCulled = false;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    list.forEach(viewModelMaterial);
  });
}

export function createFirstPersonHands(camera: T.Camera) {
  const group = new T.Group();
  group.name = 'first-person-hands';
  camera.add(group);
  const weapon = new T.Group();
  group.add(weapon);
  // В браузере: в тестах под Node загружать нечего и некуда.
  if (typeof window !== 'undefined') void preloadWeaponModels();

  const metal = new T.MeshStandardMaterial({ color: '#b9c3c9', metalness: 0.72, roughness: 0.3 });
  const polymer = new T.MeshStandardMaterial({ color: '#2c333a', metalness: 0.18, roughness: 0.74 });
  const grip = new T.MeshStandardMaterial({ color: '#131a20', roughness: 0.86 });
  const sleeve = new T.MeshStandardMaterial({ color: '#263d49', roughness: 0.9 });
  const skin = new T.MeshStandardMaterial({ color: '#1d2126', roughness: 0.7 });
  const paint = new T.MeshStandardMaterial({ color: '#aa86f6', roughness: 0.25, metalness: 0.1 });
  const accent = new T.MeshStandardMaterial({ color: '#ed646d', metalness: 0.5, roughness: 0.31 });
  const gold = new T.MeshStandardMaterial({ color: '#f5c358', metalness: 0.85, roughness: 0.2 });
  const lensGlow = new T.MeshBasicMaterial({ color: '#64d4ef' });
  /*
   * Точка коллиматора. Почти прозрачная: непрозрачная точка на тёмном фоне
   * превращается в кляксу и закрывает собой то, во что целятся, — а в оптике
   * она должна лежать на цели, не пряча её. Смешивание идёт в линейном
   * пространстве, где яркий красный почти единица, поэтому пяти процентов
   * хватает, чтобы точку было видно.
   */
  const dotGlow = new T.MeshBasicMaterial({
    color: '#ff5566',
    transparent: true,
    opacity: 0.0425,
    depthWrite: false,
  });
  /*
   * Стекло коллиматора и окуляра. Прозрачные материалы три рисует последними,
   * поэтому блик всегда ложится поверх корпуса и точки — как и в жизни.
   *
   * Доля намеренно крошечная. Смешивание идёт в линейном пространстве, а не в
   * sRGB: яркий голубой там почти единица, тёмная комната — сотые доли, и даже
   * «двенадцать процентов» превращали окно прицела в сплошную голубую заливку,
   * сквозь которую не было видно ничего. Пять процентов дают оттенок стекла,
   * оставляя картинку за ним.
   */
  const glass = new T.MeshBasicMaterial({
    color: '#8fe3ff',
    transparent: true,
    opacity: 0.05,
    side: T.DoubleSide,
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

  const guns: Record<string, T.Group> = {
    paint: paintGun,
    confetti: shotgun,
    sniper: sniperRifle,
    like: likeBlaster,
  };

  const part = (geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, parent: T.Group) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number, mat: T.Material, x: number, y: number, z: number, parent: T.Group) =>
    part(new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.25), mat, x, y, z, parent);
  const disc = (r: number, mat: T.Material, x: number, y: number, z: number, parent: T.Group) => {
    const m = part(new T.CircleGeometry(r, 24), mat, x, y, z, parent);
    return m;
  };
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

  /*
   * Сами стволы — модели из файла (world-weapon-models.ts), они приходят через
   * мгновение после старта. Здесь — только то, чего в моделях нет: прицелы
   * краскомёта, бункер с краской, патроны-хлопушки, линзы оптики, сердце.
   */

  // --- 1. КРАСКОМЁТ: карабин с бункером краски и двумя прицелами ---
  const paintSight = WEAPON_SIGHTS.paint;
  // Бункер сбоку на ствольной коробке, цвета выбранной краски: сверху он
  // закрыл бы прицельную линию.
  const hopper = part(new T.CapsuleGeometry(0.016, 0.05, 6, 14), paint, 0.043, 0.045, -0.1, paintGun);
  hopper.rotation.x = Math.PI / 2;
  const feed = part(new T.CylinderGeometry(0.006, 0.006, 0.03, 10), polymer, 0.026, 0.045, -0.1, paintGun);
  feed.rotation.z = Math.PI / 2;
  /*
   * Два прицела на одной линии, переключаются колесом (СКМ). Мушка — штатная
   * у карабина, она стоит всегда; поднимается целик или коллиматор. Сложенный
   * целик не торчит в окне коллиматора, а снятый коллиматор не закрывает
   * механику рамкой.
   *
   * Целик — диоптр, как на настоящем карабине: кольцо на стойке у глаза.
   * Смотришь сквозь кольцо, и мушка сама встаёт в его центр.
   */
  const paintIrons = new T.Group();
  paintIrons.name = 'paint-irons';
  paintGun.add(paintIrons);
  const peep = part(new T.TorusGeometry(0.0075, 0.0022, 8, 24), metal, 0, paintSight.y, paintSight.rear, paintIrons);
  peep.renderOrder = 1002;
  box(0.006, 0.012, 0.006, metal, 0, paintSight.y - 0.013, paintSight.rear, paintIrons);
  /*
   * Коллиматор на планке. Окно широкое намеренно: узкая щель превращает
   * прицеливание в подглядывание через прорезь, а смысл коллиматора в том,
   * чтобы видеть поле боя целиком и держать точку на цели.
   */
  const paintOptic = new T.Group();
  paintOptic.name = 'paint-optic';
  paintGun.add(paintOptic);
  // Коллиматор стоит на планке карабина (её верх — 0,118 над хватом).
  const opticZ = -0.17;
  const rail = 0.118;
  box(0.034, 0.016, 0.05, polymer, 0, rail + 0.008, opticZ, paintOptic);
  const housing = part(new T.TorusGeometry(0.024, 0.0045, 10, 28), polymer, 0, paintSight.y, opticZ, paintOptic);
  housing.renderOrder = 1001;
  const hood = part(new T.CylinderGeometry(0.0285, 0.0285, 0.03, 28, 1, true), polymer, 0, paintSight.y, opticZ - 0.015, paintOptic);
  hood.rotation.x = Math.PI / 2;
  /*
   * Точка мелкая намеренно. С прежним радиусом она перекрывала около восьми
   * тысячных от расстояния до цели: на десяти метрах это восемь сантиметров —
   * голова бойца целиком. Прицеливаться по кляксе, которая больше того, во что
   * целишься, нельзя.
   */
  const paintDot = part(new T.SphereGeometry(0.0032, 8, 8), dotGlow, 0, paintSight.y, opticZ - 0.003, paintOptic);
  paintDot.renderOrder = 1002;
  const paintGlass = part(new T.CircleGeometry(0.023, 28), glass, 0, paintSight.y, opticZ + 0.004, paintOptic);
  paintGlass.renderOrder = 1003;
  sightLine(paintGun, paintSight);

  // --- 2. КОНФЕТТИ-ДРОБОВИК: помповое ружьё, хлопушки-патроны на прикладе ---
  const shotgunSight = WEAPON_SIGHTS.confetti;
  for (let s = 0; s < 3; s++) {
    const shell = part(
      new T.CylinderGeometry(0.0105, 0.0105, 0.05, 12),
      s === 0 ? accent : s === 1 ? paint : gold,
      -0.022,
      0.0,
      0.07 + s * 0.026,
      shotgun,
    );
    shell.rotation.x = Math.PI / 2;
  }
  sightLine(shotgun, shotgunSight);

  // --- 3. СНАЙПЕРКА: линзы оптики модели ---
  const sniperSight = WEAPON_SIGHTS.sniper;
  const sniperLens = disc(0.017, lensGlow, 0, sniperSight.y, sniperSight.front - 0.001, sniperRifle);
  sniperLens.rotation.y = Math.PI;
  sniperLens.renderOrder = 1002;
  const ocular = disc(0.016, glass, 0, sniperSight.y, sniperSight.rear + 0.001, sniperRifle);
  ocular.renderOrder = 1003;
  sightLine(sniperRifle, sniperSight);

  // --- 4. ЛАЙКОМЁТ: пистолет с сердцем на затворе ---
  const likeSight = WEAPON_SIGHTS.like;
  // Сердце — сбоку на затворе: по центру над стволом оно закрыло бы целик.
  const likeHeartCrystal = part(partyGeometry('hearts'), accent, 0.0155, 0.064, -0.06, likeBlaster);
  likeHeartCrystal.rotation.y = Math.PI / 2;
  likeHeartCrystal.scale.setScalar(0.16);
  sightLine(likeBlaster, likeSight);

  /** Модели из файла вставляются, как только загрузятся. */
  let modelsIn = false;
  const insertModels = () => {
    if (modelsIn) return;
    const loaded = Object.entries(guns).map(([tool, gun]) => [gun, weaponModel(WEAPON_MODEL[tool])] as const);
    if (loaded.some(([, model]) => !model)) return;
    modelsIn = true;
    for (const [gun, model] of loaded) {
      // Материалы общие с моделями в мире — у рук свои копии, с ближней глубиной.
      model!.traverse((o) => {
        if (o instanceof T.Mesh) o.material = viewMaterial(o.material as T.Material);
      });
      asViewModel(model!);
      gun.add(model!);
    }
  };
  const viewCopies = new Map<T.Material, T.Material>();
  const viewMaterial = (m: T.Material) => {
    let copy = viewCopies.get(m);
    if (!copy) {
      copy = m.clone();
      // Копия своя у рук: при закрытии мира её освобождают вместе с руками.
      copy.userData.fighterShared = false;
      viewCopies.set(m, copy);
    }
    return copy;
  };

  /*
   * Кисти, пока нет рук человека (world-view-arms.ts): рукав и перчатка на
   * рукоятке и на цевье. Ставятся по точкам хвата выбранного ствола.
   */
  const fallbackArms = new T.Group();
  fallbackArms.name = 'fallback-arms';
  weapon.add(fallbackArms);
  const fallbackHand = (x: number) => {
    const g = new T.Group();
    box(0.07, 0.085, 0.1, skin, 0, 0, 0, g);
    const arm = part(new T.CylinderGeometry(0.045, 0.05, 0.3, 14), sleeve, 0, -0.02, 0.19, g);
    arm.rotation.x = Math.PI / 2 - 0.25;
    g.position.x = x;
    fallbackArms.add(g);
    return g;
  };
  const fallbackRight = fallbackHand(0);
  const fallbackLeft = fallbackHand(0);

  const tablet = new T.Group();
  group.add(tablet);
  const frame = new T.Mesh(new RoundedBoxGeometry(0.48, 0.34, 0.024, 2, 0.018), grip);
  tablet.add(frame);
  const screen = new T.Mesh(new T.PlaneGeometry(0.435, 0.285), new T.MeshBasicMaterial({ color: '#91c3c3' }));
  screen.position.z = 0.014;
  tablet.add(screen);
  for (let i = 0; i < 3; i++) {
    const card = new T.Mesh(
      new RoundedBoxGeometry(0.112, 0.16, 0.006, 1, 0.006),
      new T.MeshBasicMaterial({ color: ['#fff0c9', '#e3b6b0', '#deedf0'][i] }),
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

  // Sticky Note Pad model in hands
  const stickyPad = new T.Group();
  group.add(stickyPad);
  const padBack = new T.Mesh(new RoundedBoxGeometry(0.24, 0.26, 0.016, 2, 0.012), grip);
  stickyPad.add(padBack);
  const padPaperStack = new T.Mesh(
    new RoundedBoxGeometry(0.21, 0.22, 0.018, 1, 0.008),
    new T.MeshBasicMaterial({ color: '#fef3c7' }),
  );
  padPaperStack.position.z = 0.012;
  stickyPad.add(padPaperStack);
  const padTopNote = new T.Mesh(
    new RoundedBoxGeometry(0.19, 0.2, 0.005, 1, 0.006),
    new T.MeshBasicMaterial({ color: '#8db9a1' }),
  );
  padTopNote.position.z = 0.022;
  stickyPad.add(padTopNote);
  const pencil = part(new T.CylinderGeometry(0.012, 0.012, 0.22, 16), metal, 0.13, 0, 0.015, stickyPad);
  pencil.rotation.z = Math.PI / 2;
  stickyPad.rotation.x = -0.25;
  stickyPad.position.set(-0.06, -0.06, -0.19);

  let turnYaw = 0,
    turnPitch = 0,
    lagYaw = 0,
    lagPitch = 0;
  let recoil = 0,
    equip = 0,
    lastTool = '';
  // Кисти для гранаты и фонарика: те же перчатка и рукав, что у ствола.
  const grenadeHands = new T.Group();
  group.add(grenadeHands);
  const grenadeHand = fallbackRight.clone();
  grenadeHand.position.set(0.03, -0.07, -0.19);
  grenadeHands.add(grenadeHand);
  const grenade = makeGrenade('#f49fd6');
  grenade.position.set(0.03, -0.02, -0.2);
  group.add(grenade);
  // Фонарик (режим «Предатель»): корпус, головка с отражателем и линза. Луч и свет рисует
  // world-flashlight.ts из точки линзы — `muzzle('flashlight')`.
  const torch = new T.Group();
  group.add(torch);
  const torchBody = new T.Mesh(new T.CylinderGeometry(0.019, 0.022, 0.2, 16), grip);
  torchBody.rotation.x = Math.PI / 2;
  torch.add(torchBody);
  const torchHead = new T.Mesh(new T.CylinderGeometry(0.036, 0.024, 0.06, 20), metal);
  torchHead.rotation.x = Math.PI / 2;
  torchHead.position.z = -0.12;
  torch.add(torchHead);
  const torchLens = new T.Mesh(new T.CircleGeometry(0.031, 20), new T.MeshBasicMaterial({ color: '#fff6d8' }));
  torchLens.position.z = -0.151;
  torchLens.rotation.y = Math.PI;
  torch.add(torchLens);
  const torchButton = new T.Mesh(new T.BoxGeometry(0.012, 0.008, 0.024), polymer);
  torchButton.position.set(0, 0.022, -0.01);
  torch.add(torchButton);
  torch.position.set(0.02, -0.03, -0.2);
  torch.rotation.x = 0.06;

  asViewModel(group);
  // Предметы поверх оружия и рук, стекло и точка — поверх корпуса.
  for (const item of [tablet, stickyPad, grenade, torch]) asViewModel(item, 1001);
  paintDot.renderOrder = 1002;
  sniperLens.renderOrder = 1002;
  paintGlass.renderOrder = 1003;
  ocular.renderOrder = 1003;

  /** Где сейчас лежат кисти: для рук человека (world-view-arms.ts). */
  const holdScratch = { right: new T.Vector3(), left: new T.Vector3() };
  let heldTool = '';

  const muzzleScratch = new T.Vector3();
  return {
    group,
    /**
     * Точка вылета снаряда в мире. Раньше здесь стояла одна константа на все
     * стволы, и у снайперки выстрел рождался в середине ствола, а у пистолета
     * — в воздухе перед дулом.
     */
    muzzle(tool: string) {
      if (tool === 'flashlight') {
        torchLens.updateWorldMatrix(true, false);
        return torchLens.getWorldPosition(new T.Vector3());
      }
      const spec = WEAPON_SIGHTS[tool];
      muzzleScratch.set(spec ? spec.muzzle[0] : 0, spec ? spec.muzzle[1] : 0.025, spec ? spec.muzzle[2] : -0.69);
      return group.localToWorld(muzzleScratch.clone());
    },
    /** Взгляд повернулся: оружие отстаёт от него, как настоящее с весом. */
    look(yaw: number, pitch: number) {
      turnYaw += yaw;
      turnPitch += pitch;
    },
    /**
     * Точки хвата в координатах группы рук: правая ладонь на рукоятке, левая на
     * цевье. null — в руках не ствол (кисти рисует сам предмет).
     */
    grips() {
      const id = WEAPON_MODEL[heldTool];
      if (!id || !group.visible || !weapon.visible) return null;
      holdScratch.right.set(0, 0, 0);
      holdScratch.left.fromArray(WEAPON_SUPPORT[id]);
      return holdScratch;
    },
    /** Руки человека взяли кисти на себя: запасные перчатки не нужны. */
    set humanArms(on: boolean) {
      fallbackArms.userData.hidden = on;
      grenadeHand.userData.hidden = on;
    },
    shoot: (weaponType = 'paint') => {
      recoil = weaponType === 'sniper' ? 1.4 : weaponType === 'confetti' ? 1.2 : weaponType === 'like' ? 0.75 : 0.85;
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
      paintSight: PaintSight = DEFAULT_PAINT_SIGHT,
    ) {
      insertModels();
      heldTool = tool;
      group.visible = active && !(tool === 'sniper' && aim > 0.12);
      weapon.visible = tool === 'paint' || tool === 'confetti' || tool === 'sniper' || tool === 'like';
      paintGun.visible = tool === 'paint';
      // Поднят ровно один прицел: второй сложен и не лезет в картинку.
      paintIrons.visible = paintSight === 'irons';
      paintOptic.visible = paintSight === 'dot';
      shotgun.visible = tool === 'confetti';
      sniperRifle.visible = tool === 'sniper' && aim <= 0.12;
      likeBlaster.visible = tool === 'like';
      tablet.visible = tool === 'pointer';
      stickyPad.visible = tool === 'sticky';
      torch.visible = tool === 'flashlight';
      fallbackArms.visible = !fallbackArms.userData.hidden;
      const support = WEAPON_SUPPORT[WEAPON_MODEL[tool] ?? ''];
      if (support) {
        fallbackRight.position.set(0.005, -0.03, 0.02);
        fallbackLeft.position.fromArray(support).add(new T.Vector3(-0.01, -0.03, 0));
        fallbackLeft.rotation.y = tool === 'like' ? 0.4 : 0.55;
      }
      if (lastTool !== tool) {
        lastTool = tool;
        equip = 1;
      }
      equip = Math.max(0, equip - dt * 5);
      recoil *= Math.exp(-15 * dt);
      // Инерция: рывок мышью отбрасывает оружие назад, пружина возвращает его на место.
      lagYaw = T.MathUtils.clamp(lagYaw + turnYaw * 0.6, -0.08, 0.08);
      lagPitch = T.MathUtils.clamp(lagPitch + turnPitch * 0.6, -0.06, 0.06);
      turnYaw = 0;
      turnPitch = 0;
      lagYaw *= Math.exp(-11 * dt);
      lagPitch *= Math.exp(-11 * dt);

      // Перезарядка: ствол уходит вниз и внутрь, рука досылает, затем возврат.
      let reloadRotX = 0,
        reloadRotY = 0,
        reloadRotZ = 0;
      let reloadPosY = 0,
        reloadPosZ = 0;
      if (reload > 0) {
        if (reload < 0.25) {
          const t1 = reload / 0.25;
          reloadRotZ = -0.42 * t1;
          reloadRotY = 0.25 * t1;
          reloadRotX = -0.15 * t1;
          reloadPosY = -0.06 * t1;
        } else if (reload < 0.62) {
          const t2 = (reload - 0.25) / 0.37;
          reloadRotZ = -0.42 * (1 - t2 * 0.2);
          reloadRotY = 0.25;
          reloadRotX = -0.12;
          if (reload >= 0.52 && reload <= 0.62) {
            const slap = Math.sin(((reload - 0.52) / 0.1) * Math.PI);
            reloadPosY = slap * 0.045;
            reloadPosZ = slap * 0.03;
            reloadRotX += slap * 0.12;
          }
        } else if (reload < 0.86) {
          const t3 = (reload - 0.62) / 0.24;
          const rack = Math.sin(t3 * Math.PI);
          reloadRotZ = -0.33 * (1 - t3);
          reloadRotY = 0.2 * (1 - t3);
          reloadPosZ = -rack * 0.04;
          // Помпа и затвор: левая рука дёргает цевьё на себя.
          if (tool === 'confetti' || tool === 'sniper') fallbackLeft.position.z += rack * 0.08;
        } else {
          const t4 = (reload - 0.86) / 0.14;
          reloadPosY = Math.sin(t4 * Math.PI) * 0.015;
        }
      }

      grenade.visible = tool === 'grenade';
      // Те же кисти держат и фонарик.
      grenadeHands.visible = (grenade.visible || torch.visible) && !grenadeHand.userData.hidden;
      if (grenade.visible) {
        setGrenadeStyle(grenade, variant, true);
        asViewModel(grenade, 1001);
      }
      if (tool === 'sticky') {
        (padTopNote.material as T.MeshBasicMaterial).color.set(ZONES.find((z) => z.id === variant)?.color || '#8db9a1');
      }
      if (tool === 'pointer') {
        if (tabletInspect > 0) {
          tablet.position.x = T.MathUtils.lerp(-0.1, 0, tabletInspect);
          tablet.position.y = T.MathUtils.lerp(-0.03, -0.01, tabletInspect);
          tablet.position.z = T.MathUtils.lerp(-0.17, -0.22, tabletInspect);
          tablet.rotation.x = T.MathUtils.lerp(-0.22, 0.04, tabletInspect);
          const bootColor = new T.Color('#38bdf8').lerp(new T.Color('#ffffff'), Math.min(1, tabletInspect * 1.3));
          (screen.material as T.MeshBasicMaterial).color.copy(bootColor);
        } else {
          tablet.position.set(-0.1, -0.03, -0.17);
          tablet.rotation.set(-0.22, 0, 0);
          (screen.material as T.MeshBasicMaterial).color.set('#527982');
        }
      }
      paint.color.set(color);

      /*
       * Прицеливание. Рука уезжает не в подобранную на глаз точку, а ровно на
       * -y прицельной линии этого ствола: тогда целик и мушка ложатся на ось
       * камеры, и центр экрана — это то, что видно сквозь прицел. Предметы без
       * прицельных приспособлений держатся по-прежнему.
       */
      const sight = WEAPON_SIGHTS[tool];
      const isItem = tool === 'pointer' || tool === 'sticky' || tool === 'flashlight' || tool === 'grenade';
      const hipX = isItem ? 0.08 : HIP_HOLD.x;
      const hipY = isItem ? -0.3 : HIP_HOLD.y;
      const hipZ = isItem ? -0.52 : tool === 'like' ? -0.42 : HIP_HOLD.z;
      const aimX = sight ? 0 : hipX;
      const aimY = sight ? -sight.y : -0.115;
      const aimZ = sight ? sight.z : hipZ;
      const targetX = tabletInspect > 0 ? T.MathUtils.lerp(hipX, 0, tabletInspect) : T.MathUtils.lerp(hipX, aimX, aim);
      const targetY = tabletInspect > 0 ? T.MathUtils.lerp(-0.3, -0.16, tabletInspect) : T.MathUtils.lerp(hipY, aimY, aim);
      const targetZ =
        tabletInspect > 0
          ? T.MathUtils.lerp(-0.52, -0.38, tabletInspect)
          : T.MathUtils.lerp(hipZ, aimZ, aim) + recoil * 0.05 + reloadPosZ;

      /*
       * Покачивание глушится прицеливанием до нуля. Раньше оставалась десятая
       * часть, и с нарисованным поверх перекрестием это было незаметно. Со
       * сквозным прицеливанием любой остаток уводит мушку с центра экрана —
       * ровно тогда, когда точность и нужна.
       */
      const sway = (1 - aim) * (1 - tabletInspect);
      // Через прицел инерция слабее, но есть: при резком повороте мушка догоняет взгляд.
      const inertia = (1 - aim * 0.7) * (1 - tabletInspect);
      group.position.set(
        targetX + Math.sin(time * speed * 2.4) * Math.min(speed, 0.9) * 0.009 * sway + lagYaw * 0.35 * inertia,
        targetY +
          Math.cos(time * speed * 4.8) * Math.min(speed, 1) * 0.011 * sway +
          reloadPosY -
          equip * 0.22 +
          lagPitch * 0.3 * inertia,
        targetZ,
      );
      // От бедра ствол чуть завален внутрь, как у держащего оружие у пояса; в прицеле — ровно.
      const cant = (1 - aim) * (1 - tabletInspect) * (isItem ? 0 : 1);
      group.rotation.set(
        recoil * 0.07 +
          equip * 0.25 +
          reloadRotX +
          (tabletInspect > 0 ? -0.15 * tabletInspect : 0) +
          lagPitch * 0.8 * inertia,
        reloadRotY - lagYaw * 0.9 * inertia,
        reloadRotZ + Math.sin(time * 0.8) * 0.005 * sway + cant * 0.05 - lagYaw * 0.6 * inertia,
      );
    },
  };
}
