import * as T from 'three';
import type { RoomState } from '@/lib/model';
import {
  WEATHER_LOOKS,
  weatherLook,
  weatherMix,
  windFromLook,
  type WeatherLook,
  type Wind,
} from '@/lib/weather';

/**
 * Погода в 3D-мире: дождь и снег вокруг камеры, туман, затянутое небо и молнии.
 * Работает поверх любой сцены (хаб, арены, визуальные пакеты): она не знает, кто
 * и когда выставил туман и солнце, поэтому запоминает «базовые» значения и
 * пересчитывает их только тогда, когда их переписал кто-то другой (смена фазы
 * суток, пакет). Иначе множители погоды накладывались бы сами на себя каждый кадр.
 *
 * Осадки — два буфера частиц в коробке вокруг камеры. Всё движение считает
 * шейдер: CPU лишь копит смещение от ветра и гравитации, поэтому даже метель в
 * 30 000 снежинок не нагружает кадр.
 */

const RAIN_COUNT = 16000;
const SNOW_COUNT = 30000;
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
uniform float uSnow;
uniform float uPointScale;
attribute float aTail;
attribute float aSeed;
varying float vAlpha;
void main() {
  vec3 rel = mod(position + uOffset - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  // Снежинки кружатся, капли летят прямо.
  rel.x += uSnow * sin(uTime * 0.9 + aSeed * 61.0) * 0.35;
  rel.z += uSnow * cos(uTime * 0.7 + aSeed * 43.0) * 0.35;
  vec3 world = uCenter + rel - uStreak * aTail;
  float edge = 1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, length(rel.xz));
  vAlpha = edge * step(aSeed, uDensity);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.055 * (0.6 + 0.8 * fract(aSeed * 13.7)) * uPointScale / max(0.1, -mv.z), 1.5, 22.0);
}`;

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) discard;
  gl_FragColor = vec4(uColor, uOpacity * vAlpha);
}`;

const SNOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) discard;
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d);
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, uOpacity * vAlpha * a);
}`;

function precipUniforms(color: string, opacity: number, snow: number) {
  return {
    uOffset: { value: new T.Vector3() },
    uCenter: { value: new T.Vector3() },
    uBox: { value: BOX.clone() },
    uStreak: { value: new T.Vector3() },
    uDensity: { value: 0 },
    uTime: { value: 0 },
    uSnow: { value: snow },
    uPointScale: { value: 600 },
    uColor: { value: new T.Color(color) },
    uOpacity: { value: opacity },
  };
}

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

const damp = (from: number, to: number, lambda: number, dt: number) => to + (from - to) * Math.exp(-lambda * dt);

export function createWorldWeather({
  scene,
  sunlight,
  sheltered,
}: {
  scene: T.Scene;
  sunlight: T.DirectionalLight;
  /** Над камерой крыша: дождь внутри не идёт. */
  sheltered: (at: T.Vector3) => boolean;
}) {
  const group = new T.Group();
  group.name = 'weather';
  // Ни пули, ни камера третьего лица не должны упираться в капли и купол.
  group.userData.projectileCollision = 'ignore';
  group.userData.cameraCollision = 'ignore';
  scene.add(group);

  const rainUniforms = precipUniforms('#b9c6d2', 0.34, 0);
  const rain = new T.LineSegments(
    randomBox(RAIN_COUNT, 2),
    new T.ShaderMaterial({
      uniforms: rainUniforms,
      vertexShader: PRECIP_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  const snowUniforms = precipUniforms('#f4f8fc', 0.9, 1);
  const snow = new T.Points(
    randomBox(SNOW_COUNT, 1),
    new T.ShaderMaterial({
      uniforms: snowUniforms,
      vertexShader: PRECIP_VERTEX,
      fragmentShader: SNOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  for (const o of [rain, snow]) {
    o.frustumCulled = false;
    o.renderOrder = 5;
    o.userData.transientProjectile = true;
    group.add(o);
  }
  const domeMaterial = new T.MeshBasicMaterial({
    color: '#8a939b',
    side: T.BackSide,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const dome = new T.Mesh(new T.SphereGeometry(DOME_RADIUS, 24, 12), domeMaterial);
  dome.userData.transientProjectile = true;
  dome.renderOrder = -1;
  group.add(dome);

  // Погода меняется плавно даже при ручном переключении: значения тянутся к цели.
  const look: WeatherLook = { ...WEATHER_LOOKS.clear };
  let initialized = false;
  let shelter = 0;
  let wind: Wind = { x: 0, z: 0, speed: 0 };
  const rainOffset = new T.Vector3(),
    snowOffset = new T.Vector3();
  let time = 0;
  // Молния: вспышка затухает за доли секунды, иногда с повторным мерцанием.
  let flash = 0,
    nextFlash = 4,
    flicker = 0;

  // Что туман и солнце были до погоды (см. комментарий к модулю).
  let fogRef: T.Fog | null = null;
  const baseFog = { color: new T.Color(), near: 0, far: 0 };
  const writtenFog = { color: new T.Color(), near: -1, far: -1 };
  let baseSun = sunlight.intensity,
    writtenSun = Number.NaN;
  const overcastRain = new T.Color('#747f88');
  const overcastSnow = new T.Color('#c3ccd4');
  const scratch = new T.Color();

  const wrap = (v: T.Vector3) => {
    v.x %= BOX.x;
    v.y %= BOX.y;
    v.z %= BOX.z;
  };

  const applyAtmosphere = () => {
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
      scratch
        .copy(look.snow > look.rain ? overcastSnow : overcastRain)
        .multiplyScalar(Math.max(0.15, brightness));
      fog.color.copy(baseFog.color).lerp(scratch, Math.min(1, look.overcast * 0.85));
      fog.far = Math.max(18, baseFog.far * (1 - look.fog * 0.85));
      fog.near = Math.min(fog.far - 4, baseFog.near * (1 - look.fog * 0.95));
      writtenFog.color.copy(fog.color);
      writtenFog.near = fog.near;
      writtenFog.far = fog.far;
      domeMaterial.color.copy(fog.color);
    }
    domeMaterial.opacity = look.overcast * 0.82;
    dome.visible = domeMaterial.opacity > 0.01;
    if (sunlight.intensity !== writtenSun) baseSun = sunlight.intensity;
    sunlight.intensity = baseSun * look.sun;
    writtenSun = sunlight.intensity;
    return brightness;
  };

  return {
    group,
    /** Текущий ветер, сглаженный вместе с погодой: его же видят индикатор, игрок и пули. */
    get wind() {
      return wind;
    },
    /** Множитель экспозиции: в пасмурную погоду мир темнее. */
    get exposure() {
      return look.exposure;
    },
    /** Вспышка молнии: множитель поверх экспозиции, 1 — вспышки нет. */
    get flash() {
      return 1 + flash * 1.6;
    },
    /**
     * Кадр погоды. `now` — серверное время (мс): по нему у всех одна погода и
     * один ветер. `interior` — хаб в режиме «внутри».
     */
    update(dt: number, now: number, camera: T.Camera, state: RoomState, interior: boolean) {
      const target = weatherLook(weatherMix(state, now));
      if (!initialized) {
        Object.assign(look, target);
        initialized = true;
      } else
        for (const key of Object.keys(target) as (keyof WeatherLook)[])
          look[key] = damp(look[key], target[key], 0.6, dt);
      wind = windFromLook(look, now);
      time += dt;

      shelter = damp(shelter, interior || sheltered(camera.position) ? 1 : 0, 5, dt);
      const open = 1 - shelter;

      const brightness = applyAtmosphere();

      // Дождь: скорость падения + ветер, капля вытянута вдоль своей скорости.
      const rainVel = scratchVel.set(wind.x * 0.9, -21, wind.z * 0.9);
      rainOffset.addScaledVector(rainVel, dt);
      wrap(rainOffset);
      rainUniforms.uOffset.value.copy(rainOffset);
      rainUniforms.uStreak.value.copy(rainVel).multiplyScalar(0.026);
      rainUniforms.uDensity.value = look.rain * open;
      rainUniforms.uColor.value.setScalar(0.45 + 0.4 * brightness).lerp(scratch.set('#b9c6d2'), 0.5 * brightness);
      rain.visible = rainUniforms.uDensity.value > 0.003;

      const snowVel = scratchVel.set(wind.x * 0.75, -1.4 - wind.speed * 0.06, wind.z * 0.75);
      snowOffset.addScaledVector(snowVel, dt);
      wrap(snowOffset);
      snowUniforms.uOffset.value.copy(snowOffset);
      snowUniforms.uDensity.value = look.snow * open;
      snowUniforms.uTime.value = time;
      snowUniforms.uColor.value.setRGB(0.55 + 0.45 * brightness, 0.6 + 0.4 * brightness, 0.68 + 0.32 * brightness);
      snow.visible = snowUniforms.uDensity.value > 0.003;

      for (const u of [rainUniforms, snowUniforms]) u.uCenter.value.copy(camera.position);
      dome.position.copy(camera.position);

      flash = Math.max(0, flash - dt * 5);
      if (flicker > 0) {
        flicker -= dt;
        if (flicker <= 0) flash = Math.max(flash, 0.7);
      }
      if (look.lightning > 0.2 && open > 0.3) {
        nextFlash -= dt * look.lightning;
        if (nextFlash <= 0) {
          flash = 1;
          flicker = Math.random() < 0.5 ? 0.12 + Math.random() * 0.1 : 0;
          nextFlash = 4 + Math.random() * 12;
        }
      }
    },
    /** Экранный размер снежинок зависит от высоты кадра и угла обзора. */
    resize(height: number, fov: number) {
      snowUniforms.uPointScale.value = height / (2 * Math.tan(T.MathUtils.degToRad(fov) / 2));
    },
    dispose() {
      group.removeFromParent();
      rain.geometry.dispose();
      (rain.material as T.Material).dispose();
      snow.geometry.dispose();
      (snow.material as T.Material).dispose();
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

const scratchVel = new T.Vector3();
