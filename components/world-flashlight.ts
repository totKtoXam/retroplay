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
 * - настоящий `SpotLight` есть только у своего игрока и висит на камере, то есть
 *   ровно один на сцену независимо от числа участников — на любом качестве;
 * - всем остальным фонарик виден как луч: аддитивный конус с затуханием и
 *   светящаяся линза на плече. Это два меша без освещения и без теней, они
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
  /** Включить/выключить и довернуть луч туда, куда смотрит игрок. */
  set(on: boolean, pitch: number): void;
  dispose(): void;
};

/**
 * Видимый луч на аватаре. Вешается на группу аватара, поэтому едет и
 * поворачивается вместе с ним, а в первом лице пропадает заодно со своим
 * аватаром (`avatar.visible`) — светить себе в лицо не надо.
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
  return {
    group,
    set(on, pitch) {
      group.visible = on;
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
  dispose(): void;
};

/**
 * Свой фонарик: единственный динамический источник света в сцене. Висит на
 * камере — светит туда, куда смотрит игрок, и в первом, и в третьем лице.
 */
export function createPlayerFlashlight(camera: T.Camera): PlayerFlashlight {
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
  light.position.set(0.12, -0.1, 0);
  light.target.position.set(0, 0, -1);
  camera.add(light, light.target);
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
    dispose() {
      light.removeFromParent();
      light.target.removeFromParent();
      light.dispose();
    },
  };
}
