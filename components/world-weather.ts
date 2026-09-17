import * as T from 'three';
import type { RoomState } from '@/lib/model';
import { OPEN_VISIBILITY, weatherLook, windFromLook, type WeatherLook, type Wind } from '@/lib/weather';
import { roofAt, type RoofMap } from '@/lib/weather-shelter';

/**
 * Погода в 3D-мире: дождь, снег, метель, град и пыль вокруг камеры, туман,
 * затянутое небо и молнии. Уровни и их физика — в lib/weather.ts, здесь только
 * картинка.
 *
 * Работает поверх любой сцены (хаб, арены, визуальные пакеты): она не знает, кто
 * и когда выставил туман и солнце, поэтому запоминает «базовые» значения и
 * пересчитывает их только тогда, когда их переписал кто-то другой (смена фазы
 * суток, пакет). Иначе множители погоды накладывались бы сами на себя каждый кадр.
 *
 * Осадки — буферы частиц в коробке вокруг камеры. Крыши берутся из карты
 * укрытий (lib/weather-shelter.ts): она лежит текстурой высот, и шейдер прячет
 * каждую частицу ниже перекрытия над ней — дождь не идёт внутри домов, а из
 * дома виден за окном. Всё движение считает шейдер:
 * CPU лишь копит смещение от ветра и падения, поэтому даже буран в десятки тысяч
 * снежинок не нагружает кадр. Плотность уровня — доля частиц, которую шейдер
 * оставляет видимой.
 */

/** Коробка с осадками вокруг камеры, м. */
const BOX = new T.Vector3(44, 26, 44);
/** Затянутое небо — полупрозрачный купол; ближе дальней плоскости камеры. */
const DOME_RADIUS = 140;

const PRECIP_VERTEX = /* glsl */ `
uniform vec3 uOffset;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uStreak;
uniform float uDensity;
uniform float uTime;
uniform float uSway;
uniform float uSize;
uniform float uMaxSize;
uniform float uPointScale;
uniform float uLayer;
uniform float uGround;
uniform float uLayerHeight;
uniform sampler2D uRoof;
uniform vec4 uRoofRect;
attribute float aTail;
attribute float aSeed;
varying float vAlpha;
void main() {
  vec3 rel = mod(position + uOffset - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  // Снежинки и пыль кружатся, капли и град летят прямо.
  rel.x += uSway * sin(uTime * 0.9 + aSeed * 61.0) * 0.35;
  rel.z += uSway * cos(uTime * 0.7 + aSeed * 43.0) * 0.35;
  vec3 world = uCenter + rel;
  if (uLayer > 0.5) {
    // Метель у земли: слой заданной высоты над ногами игрока, гуще всего внизу.
    float h = mod(position.y / uBox.y * uLayerHeight + uOffset.y, uLayerHeight);
    world.y = uGround + h * h / uLayerHeight + uSway * sin(uTime * 2.3 + aSeed * 17.0) * 0.12;
  }
  world -= uStreak * aTail;
  float edge = 1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, length(rel.xz));
  // Перекрытие над частицей: ниже его низа частица под крышей и не видна.
  vec2 roofUv = (world.xz - uRoofRect.xy) / uRoofRect.zw;
  float inside = step(0.0, roofUv.x) * step(roofUv.x, 1.0) * step(0.0, roofUv.y) * step(roofUv.y, 1.0);
  float roof = mix(-1000.0, texture2D(uRoof, clamp(roofUv, 0.0, 1.0)).r, inside);
  vAlpha = edge * step(aSeed, uDensity) * step(roof, world.y);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * fract(aSeed * 13.7)) * uPointScale / max(0.1, -mv.z), 1.5, uMaxSize);
}`;

const LINE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) discard;
  gl_FragColor = vec4(uColor, uOpacity * vAlpha);
}`;

const POINT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSoft;
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) discard;
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, mix(0.4, 0.08, uSoft), d);
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, uOpacity * vAlpha * a);
}`;

function randomBox(count: number, perParticle: number) {
  const position = new Float32Array(count * perParticle * 3);
  const seed = new Float32Array(count * perParticle);
  const tail = new Float32Array(count * perParticle);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * BOX.x,
      y = Math.random() * BOX.y,
      z = Math.random() * BOX.z,
      s = Math.random();
    for (let v = 0; v < perParticle; v++) {
      const k = i * perParticle + v;
      position.set([x, y, z], k * 3);
      seed[k] = s;
      tail[k] = v;
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(position, 3));
  geometry.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
  geometry.setAttribute('aTail', new T.BufferAttribute(tail, 1));
  // Частицы всегда вокруг камеры: отсечение по исходной коробке их бы теряло.
  geometry.boundingSphere = new T.Sphere(new T.Vector3(), 1e6);
  return geometry;
}

type LayerOptions = {
  /** Частиц при плотности 1. */
  count: number;
  lines?: boolean;
  color: string;
  opacity: number;
  /** Мировой размер частицы, м (для точек). */
  size?: number;
  maxSize?: number;
  sway?: number;
  soft?: number;
  ground?: boolean;
};

/** Карта крыш текстурой: одна клетка — один тексель с высотой перекрытия. */
function roofTexture(roof: RoofMap) {
  const texture = new T.DataTexture(roof.heights, roof.cols, roof.rows, T.RedFormat, T.FloatType);
  texture.magFilter = T.NearestFilter;
  texture.minFilter = T.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Один слой осадков: буфер частиц, его смещение и материал. */
function createLayer(group: T.Group, o: LayerOptions, roof: T.DataTexture, rect: T.Vector4) {
  const uniforms = {
    uOffset: { value: new T.Vector3() },
    uCenter: { value: new T.Vector3() },
    uBox: { value: BOX.clone() },
    uStreak: { value: new T.Vector3() },
    uDensity: { value: 0 },
    uTime: { value: 0 },
    uSway: { value: o.sway ?? 0 },
    uSize: { value: o.size ?? 0.05 },
    uMaxSize: { value: o.maxSize ?? 22 },
    uPointScale: { value: 600 },
    uLayer: { value: o.ground ? 1 : 0 },
    uGround: { value: 0 },
    uLayerHeight: { value: 1 },
    uRoof: { value: roof },
    uRoofRect: { value: rect },
    uColor: { value: new T.Color(o.color) },
    uOpacity: { value: o.opacity },
    uSoft: { value: o.soft ?? 1 },
  };
  const material = new T.ShaderMaterial({
    uniforms,
    vertexShader: PRECIP_VERTEX,
    fragmentShader: o.lines ? LINE_FRAGMENT : POINT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const object = o.lines
    ? new T.LineSegments(randomBox(o.count, 2), material)
    : new T.Points(randomBox(o.count, 1), material);
  object.frustumCulled = false;
  object.renderOrder = 5;
  object.userData.transientProjectile = true;
  object.visible = false;
  group.add(object);
  const offset = new T.Vector3();
  return {
    uniforms,
    /** Кадр слоя: скорость частиц, плотность и центр коробки. */
    step(dt: number, velocity: T.Vector3, density: number, center: T.Vector3, time: number) {
      offset.addScaledVector(velocity, dt);
      offset.x %= BOX.x;
      offset.y %= BOX.y;
      offset.z %= BOX.z;
      uniforms.uOffset.value.copy(offset);
      uniforms.uDensity.value = density;
      uniforms.uCenter.value.copy(center);
      uniforms.uTime.value = time;
      object.visible = density > 0.003;
    },
    dispose() {
      object.geometry.dispose();
      material.dispose();
    },
  };
}

const damp = (from: number, to: number, lambda: number, dt: number) => to + (from - to) * Math.exp(-lambda * dt);

export function createWorldWeather({
  scene,
  sunlight,
  roof,
}: {
  scene: T.Scene;
  sunlight: T.DirectionalLight;
  /** Где над головой перекрытия (lib/weather-shelter.ts). */
  roof: RoofMap;
}) {
  const group = new T.Group();
  group.name = 'weather';
  // Ни пули, ни камера третьего лица не должны упираться в капли и купол.
  group.userData.projectileCollision = 'ignore';
  group.userData.cameraCollision = 'ignore';
  scene.add(group);

  const roofMap = roofTexture(roof);
  const roofRect = new T.Vector4(roof.minX, roof.minZ, roof.cols * roof.cell, roof.rows * roof.cell);
  const layer = (o: LayerOptions) => createLayer(group, o, roofMap, roofRect);
  const rain = layer({ count: 16000, lines: true, color: '#b9c6d2', opacity: 0.34 });
  const snow = layer({ count: 30000, color: '#f4f8fc', opacity: 0.9, size: 0.055, sway: 1 });
  const drift = layer({ count: 26000, color: '#f2f6fa', opacity: 0.75, size: 0.04, sway: 1, ground: true });
  const hail = layer({ count: 5000, color: '#e6eef3', opacity: 0.95, size: 0.03, maxSize: 40, soft: 0 });
  const dust = layer({ count: 22000, color: '#b99b6c', opacity: 0.55, size: 0.035, sway: 1.4 });
  const layers = [rain, snow, drift, hail, dust];

  const domeMaterial = new T.MeshBasicMaterial({
    color: '#8a939b',
    side: T.BackSide,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    vertexColors: true,
  });
  const domeGeometry = new T.SphereGeometry(DOME_RADIUS, 24, 12);
  {
    // Облака закрывают небо, а не горизонт: у горизонта купол прозрачный, иначе
    // пасмурное небо серой пеленой ложилось на дальние дома и выглядело туманом.
    // Дымку у земли даёт только видимость (туман сцены).
    const position = domeGeometry.getAttribute('position');
    const colors = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      const up = position.getY(i) / DOME_RADIUS;
      const t = Math.min(1, Math.max(0, (up - 0.04) / 0.3));
      colors.set([1, 1, 1, t * t * (3 - 2 * t)], i * 4);
    }
    domeGeometry.setAttribute('color', new T.BufferAttribute(colors, 4));
  }
  const dome = new T.Mesh(domeGeometry, domeMaterial);
  dome.userData.transientProjectile = true;
  dome.renderOrder = -1;
  group.add(dome);

  // Погода меняется плавно даже при ручном переключении: значения тянутся к цели.
  let look: WeatherLook | null = null;
  let shelter = 0;
  let wind: Wind = { x: 0, z: 0, speed: 0 };
  let time = 0;
  // Молния: вспышка затухает за доли секунды, иногда с повторным мерцанием.
  let flash = 0,
    nextFlash = 3,
    flicker = 0;

  // Что туман и солнце были до погоды (см. комментарий к модулю).
  let fogRef: T.Fog | null = null;
  const baseFog = { color: new T.Color(), near: 0, far: 0 };
  const writtenFog = { color: new T.Color(), near: -1, far: -1 };
  let baseSun = sunlight.intensity,
    writtenSun = Number.NaN;
  const overcastRain = new T.Color('#747f88');
  const overcastSnow = new T.Color('#c3ccd4');
  const dustHaze = new T.Color('#a8895a');
  const scratch = new T.Color();
  const velocity = new T.Vector3();

  const applyAtmosphere = (l: WeatherLook) => {
    const fog = scene.fog;
    let brightness = 1;
    if (fog instanceof T.Fog) {
      if (
        fog !== fogRef ||
        !fog.color.equals(writtenFog.color) ||
        fog.near !== writtenFog.near ||
        fog.far !== writtenFog.far
      ) {
        fogRef = fog;
        baseFog.color.copy(fog.color);
        baseFog.near = fog.near;
        baseFog.far = fog.far;
      }
      // Серость облаков подстраивается под освещённость: ночная буря тёмная, а
      // не светло-серая.
      const luminance = baseFog.color.r * 0.3 + baseFog.color.g * 0.59 + baseFog.color.b * 0.11;
      brightness = Math.min(1, luminance / 0.5);
      const light = Math.max(0.15, brightness);
      const murk = 1 - Math.min(1, l.visibility / Math.max(1, baseFog.far));
      scratch.copy(l.snow + l.drift > l.rain ? overcastSnow : overcastRain).multiplyScalar(light);
      // Серее туман карты делает прежде всего плохая видимость; одни облака лишь
      // слегка приглушают его цвет, но не превращают дальний план в пелену.
      fog.color.copy(baseFog.color).lerp(scratch, Math.min(1, Math.max(l.overcast * 0.35, murk) * 0.85));
      fog.color.lerp(scratch.copy(dustHaze).multiplyScalar(light), Math.min(0.85, l.dust * 0.85));
      // Видимость по шкалам — это дальняя граница тумана; ближнюю сдвигаем в той же пропорции.
      const far = Math.max(12, Math.min(baseFog.far, l.visibility));
      fog.far = far;
      fog.near = Math.max(0, Math.min(far - 4, baseFog.near * (far / Math.max(1, baseFog.far)) * (far < baseFog.far ? 0.4 : 1)));
      writtenFog.color.copy(fog.color);
      writtenFog.near = fog.near;
      writtenFog.far = fog.far;
      domeMaterial.color.copy(fog.color);
    }
    domeMaterial.opacity = Math.min(0.9, Math.max(l.overcast * 0.82, l.dust * 0.7));
    dome.visible = domeMaterial.opacity > 0.01;
    if (sunlight.intensity !== writtenSun) baseSun = sunlight.intensity;
    sunlight.intensity = baseSun * l.sun;
    writtenSun = sunlight.intensity;
    return brightness;
  };

  return {
    group,
    /** Текущий ветер, сглаженный вместе с погодой: его же видят индикатор, игрок и пули. */
    get wind() {
      return wind;
    },
    /** Множитель экспозиции: в плохую погоду мир темнее. */
    get exposure() {
      return look?.exposure ?? 1;
    },
    /** Вспышка молнии: множитель поверх экспозиции, 1 — вспышки нет. */
    get flash() {
      return 1 + flash * 1.6;
    },
    /**
     * Кадр погоды. `now` — серверное время (мс): по нему у всех одна погода и
     * один ветер. `interior` — хаб в режиме «внутри», `ground` — высота ног
     * игрока: у неё метёт позёмок.
     */
    update(dt: number, now: number, camera: T.Camera, state: RoomState, interior: boolean, ground: number) {
      const target = weatherLook(state, now);
      if (!look) look = { ...target };
      else
        for (const key of Object.keys(target) as (keyof WeatherLook)[]) {
          // Видимость сглаживаем в обратных метрах: иначе переход с 1000 м на 20 м
          // проскакивал бы густой туман почти мгновенно.
          if (key === 'visibility') look.visibility = 1 / damp(1 / look.visibility, 1 / target.visibility, 0.6, dt);
          else look[key] = damp(look[key], target[key], 0.6, dt);
        }
      const l = look;
      wind = windFromLook(l, now);
      time += dt;

      // Осадки режет по крышам шейдер; целиком погода пропадает только в интерьере хаба.
      const open = interior ? 0 : 1;
      // Под крышей туман и пыль реже, чем на улице: воздух в доме не метёт.
      const indoors = interior || camera.position.y < roofAt(roof, camera.position.x, camera.position.z);
      shelter = damp(shelter, indoors ? 1 : 0, 3, dt);
      const brightness = applyAtmosphere(
        shelter > 0.001
          ? { ...l, visibility: 1 / (1 / l.visibility + (1 / OPEN_VISIBILITY - 1 / l.visibility) * shelter * 0.7) }
          : l,
      );
      const center = camera.position;

      // Дождь: скорость падения + ветер, капля вытянута вдоль своей скорости.
      velocity.set(wind.x * 0.9, -21, wind.z * 0.9);
      rain.uniforms.uStreak.value.copy(velocity).multiplyScalar(0.026);
      rain.uniforms.uColor.value.setScalar(0.45 + 0.4 * brightness).lerp(scratch.set('#b9c6d2'), 0.5 * brightness);
      rain.step(dt, velocity, l.rain * open, center, time);

      const shade = (u: { value: T.Color }, r: number, g: number, b: number) =>
        u.value.setRGB(r * (0.55 + 0.45 * brightness), g * (0.6 + 0.4 * brightness), b * (0.68 + 0.32 * brightness));

      velocity.set(wind.x * 0.75, -1.4 - wind.speed * 0.06, wind.z * 0.75);
      shade(snow.uniforms.uColor, 1, 1, 1);
      snow.step(dt, velocity, l.snow * open, center, time);

      // Метель несёт снег почти горизонтально и чуть быстрее ветра у земли.
      velocity.set(wind.x * 1.1, 0.4, wind.z * 1.1);
      drift.uniforms.uGround.value = ground;
      drift.uniforms.uLayerHeight.value = Math.max(0.5, l.driftHeight);
      shade(drift.uniforms.uColor, 1, 1, 1);
      drift.step(dt, velocity, l.drift * open, center, time);

      velocity.set(wind.x * 0.3, -15, wind.z * 0.3);
      hail.uniforms.uSize.value = Math.max(0.01, l.hailSize);
      shade(hail.uniforms.uColor, 0.9, 0.93, 0.95);
      hail.step(dt, velocity, l.hail * open, center, time);

      velocity.set(wind.x * 0.95, -0.15, wind.z * 0.95);
      shade(dust.uniforms.uColor, 0.72, 0.6, 0.42);
      dust.step(dt, velocity, l.dust * open, center, time);

      dome.position.copy(center);

      flash = Math.max(0, flash - dt * 5);
      if (flicker > 0) {
        flicker -= dt;
        if (flicker <= 0) flash = Math.max(flash, 0.7);
      }
      // Молнии — пуассоновский поток с частотой по шкале LAL.
      if (l.lightningPerMinute > 0.05 && open > 0) {
        nextFlash -= dt;
        if (nextFlash <= 0) {
          flash = 1;
          flicker = Math.random() < 0.5 ? 0.12 + Math.random() * 0.1 : 0;
          nextFlash = (-Math.log(1 - Math.random()) * 60) / l.lightningPerMinute;
        }
      }
      if (l.visibility >= OPEN_VISIBILITY && l.overcast <= 0 && l.dust <= 0) dome.visible = false;
    },
    /** Экранный размер частиц зависит от высоты кадра и угла обзора. */
    resize(height: number, fov: number) {
      const scale = height / (2 * Math.tan(T.MathUtils.degToRad(fov) / 2));
      for (const layer of layers) layer.uniforms.uPointScale.value = scale;
    },
    dispose() {
      group.removeFromParent();
      layers.forEach((item) => item.dispose());
      roofMap.dispose();
      dome.geometry.dispose();
      domeMaterial.dispose();
      // Вернуть туману и солнцу то, что было до погоды.
      if (fogRef && scene.fog === fogRef) {
        fogRef.color.copy(baseFog.color);
        fogRef.near = baseFog.near;
        fogRef.far = baseFog.far;
      }
      if (sunlight.intensity === writtenSun) sunlight.intensity = baseSun;
    },
  };
}
