import * as T from 'three';

/**
 * Фонарик игрока (клавиша F).
 *
 * Разделение на «свет» и «луч» — сознательное и про производительность.
 * В сцене уже разбирали падение FPS от лишней динамики, а WebGL пересобирает
 * шейдеры от каждого нового источника света: N включённых фонариков у N игроков
 * — это N динамических пятен и перекомпиляция материалов на каждое включение.
 * Поэтому:
 *
 * - настоящий `SpotLight` есть только у своего игрока, то есть ровно один на
 *   сцену независимо от числа участников — на любом качестве;
 * - всем остальным фонарик виден как луч: аддитивный конус с затуханием и
 *   светящаяся линза у дула оружия. Это два меша без освещения и без теней, они
 *   стоят почти ничего, но в ночном бою чужой фонарик видно за десятки метров —
 *   а именно это и важно, чтобы включённый свет не давал бесплатного
 *   преимущества.
 *
 * Тени фонарик не отбрасывает никогда: вторая теневая карта на кадр дороже
 * всего остального фонарика вместе взятого.
 */

/** Длина видимого луча в метрах и радиус пятна на его конце. */
const BEAM_LENGTH = 11;
const BEAM_RADIUS = 2.4;

/**
 * Фонарик подствольный: светит от дула, а не из груди. Точки — в координатах
 * пивота `gun` аватара (components/world-avatar.ts), у каждой модели своя длина
 * ствола. Без оружия в руках (граната, планшет) свет идёт из кисти.
 */
const AVATAR_MUZZLE: Record<string, [number, number, number]> = {
  paint: [0, 0.18, -0.37],
  confetti: [0, 0.17, -0.39],
  sniper: [0, 0.17, -0.75],
  flashlight: [0, 0.08, -0.31],
};
const AVATAR_HAND: [number, number, number] = [0, 0.05, -0.08];
const muzzleScratch = new T.Vector3();

/** Где у аватара дуло: точка в мире по пивоту `gun`. */
export function avatarMuzzle(gun: T.Object3D, tool: string, target = new T.Vector3()) {
  gun.updateWorldMatrix(true, false);
  const [x, y, z] = gun.visible ? (AVATAR_MUZZLE[tool] ?? AVATAR_HAND) : AVATAR_HAND;
  return gun.localToWorld(target.set(x, y, z));
}

function beamGeometry() {
  const geo = new T.ConeGeometry(BEAM_RADIUS, BEAM_LENGTH, 18, 1, true);
  // Вершина конуса — в начале координат (там «лампа»), раструб смотрит в −Z:
  // у аватара и у камеры вперёд — это именно −Z.
  geo.translate(0, -BEAM_LENGTH / 2, 0);
  geo.rotateX(Math.PI / 2);
  // Затухание вдоль луча вершинными цветами: при аддитивном смешивании чёрный
  // прозрачен, поэтому дальний край конуса растворяется без второй текстуры.
  const position = geo.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const fade = 1 - Math.min(1, -position.getZ(i) / BEAM_LENGTH);
    colors[i * 3] = fade;
    colors[i * 3 + 1] = fade * 0.96;
    colors[i * 3 + 2] = fade * 0.82;
  }
  geo.setAttribute('color', new T.BufferAttribute(colors, 3));
  return geo;
}

export type FlashlightBeam = {
  group: T.Group;
  /**
   * Включить/выключить и довернуть луч туда, куда смотрит игрок. Начало луча —
   * у дула оружия `tool` в руке аватара, на который луч повешен.
   */
  set(on: boolean, pitch: number, tool?: string): void;
  dispose(): void;
};

/**
 * Видимый луч на аватаре. Вешается на группу аватара, поэтому едет и
 * поворачивается вместе с ним, а в первом лице пропадает заодно со своим
 * аватаром (`avatar.visible`) — светить себе в лицо не надо. Начало луча
 * каждый кадр ставится к дулу: руки с оружием качаются при ходьбе и
 * поднимаются за прицелом, и луч из неподвижной точки у плеча от них отрывался.
 */
export function createFlashlightBeam(): FlashlightBeam {
  const group = new T.Group();
  // Луч не участвует ни в подборе целей, ни в столкновениях камеры.
  group.userData.projectileCollision = 'ignore';
  group.userData.noCameraCollision = true;
  group.userData.presentationOnly = true;
  group.position.set(0.2, 1.5, -0.12);
  group.visible = false;
  const cone = new T.Mesh(
    beamGeometry(),
    new T.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
      fog: false,
    }),
  );
  cone.renderOrder = 4;
  const lens = new T.Mesh(
    new T.SphereGeometry(0.07, 8, 6),
    new T.MeshBasicMaterial({ color: '#fff6dc', fog: false }),
  );
  // Луч — чистая декорация: он не должен ни ловить пули, ни обрывать дугу
  // броска гранаты (world.tsx фильтрует цели по этому флагу), ни попадать под
  // общую чистку аватара — своей `dispose` он освобождается сам.
  for (const part of [cone, lens]) part.userData.presentationOnly = true;
  group.add(cone, lens);
  let gun: T.Object3D | null = null,
    gunOwner: T.Object3D | null = null;
  return {
    group,
    set(on, pitch, tool = '') {
      group.visible = on;
      // Пивот оружия ищется один раз на аватар: скелет аватара не пересобирается.
      if (group.parent !== gunOwner) {
        gunOwner = group.parent;
        gun = gunOwner?.getObjectByName('gun') ?? null;
      }
      if (on && gun && group.parent) {
        // Матрицы аватара и оружия — с одного кадра, поэтому точка в
        // координатах аватара верна, даже если сам аватар ещё не перерисован.
        avatarMuzzle(gun, tool, muzzleScratch);
        group.position.copy(group.parent.worldToLocal(muzzleScratch));
      }
      // Вперёд у группы — −Z; поворот на −pitch совпадает с viewDirection()
      // из lib/game-camera.ts, по которой считается взгляд игрока.
      group.rotation.x = -pitch;
    },
    dispose() {
      cone.geometry.dispose();
      (cone.material as T.Material).dispose();
      lens.geometry.dispose();
      (lens.material as T.Material).dispose();
    },
  };
}

export type PlayerFlashlight = {
  on: boolean;
  /** Переключить фонарик; возвращает новое состояние. */
  toggle(): boolean;
  /** Поставить свет к дулу (`origin`, мир) и направить туда, куда смотрит игрок. */
  aim(origin: T.Vector3, direction: T.Vector3): void;
  dispose(): void;
};

/**
 * Свой фонарик: единственный динамический источник света в сцене. Светит от
 * дула оружия туда, куда смотрит игрок: от первого лица — от оружия в руках,
 * от третьего — от оружия аватара. Раньше он висел на камере, и в третьем
 * лице свет шёл из-за спины персонажа, а в первом — из переносицы.
 */
export function createPlayerFlashlight(scene: T.Object3D): PlayerFlashlight {
  // Свет создаётся на любом качестве, включая `low`. Раньше на слабых
  // настройках SpotLight не создавался вовсе, а от первого лица свой луч скрыт
  // вместе с аватаром — и фонарик там не делал ровно ничего: нажатие F
  // выглядело как сломанная клавиша. Экономия того не стоила: источник ровно
  // один независимо от числа игроков, теней он не отбрасывает, а создаётся один
  // раз при сборке сцены — включение и выключение шейдеры не пересобирает.
  //
  // Затухание 1 вместо физического 2: с квадратом пятно гаснет уже через пару
  // метров и фонарик бесполезен, а линейное даёт ровный «луч» на всю дальность
  // 30 м.
  const light = new T.SpotLight('#fff3d2', 0, 30, Math.PI / 7, 0.6, 1);
  light.castShadow = false;
  scene.add(light, light.target);
  let on = false;
  return {
    get on() {
      return on;
    },
    toggle() {
      on = !on;
      light.intensity = on ? 28 : 0;
      return on;
    },
    aim(origin, direction) {
      light.position.copy(origin);
      light.target.position.copy(origin).addScaledVector(direction, 20);
    },
    dispose() {
      light.removeFromParent();
      light.target.removeFromParent();
      light.dispose();
    },
  };
}
