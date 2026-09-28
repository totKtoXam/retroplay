import * as T from 'three';

/**
 * Слой спрайтовых частиц: вспышки, искры, дым, кольца. Все частицы слоя —
 * одни `Points` с фиксированным буфером: один draw call, ни одного объекта
 * на частицу, ни одной аллокации в кадре. Состояние лежит в типизированных
 * массивах, умершая частица замещается последней живой.
 *
 * Спрайт всегда смотрит в камеру (это точка), а искры (`stretch > 0`)
 * вытягиваются вдоль экранной проекции скорости — получается штрих с хвостом.
 * Слоёв два: аддитивный (свечение, искры) и обычный (дым, туман краски).
 */

/** Флаги частицы. */
export const SPRITE_HOT = 1; // искра: рождается белой и остывает до своего цвета
export const SPRITE_TWINKLE = 2; // мерцает к концу жизни, как искры салюта
export const SPRITE_SMOKE = 4; // плавно проявляется и медленно тает, крутится
export const SPRITE_NO_NEAR_FADE = 8; // не гаснет у самых глаз: вспышка своего ствола

const VERTEX = /* glsl */ `
uniform float uScale;
attribute vec4 aColor;
attribute vec4 aParams;
attribute vec3 aVel;
varying vec4 vColor;
varying vec2 vTile;
varying float vRot;
varying float vStretch;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = max(-mvPosition.z, 0.01);
  float t = aParams.y;
  float keepNear = step(3.5, t);
  t -= keepNear * 4.0;
  // Частица вплотную к глазам закрывала бы пол-экрана: гасим её, кроме вспышки своего ствола.
  float nearFade = mix(clamp((dist - 0.45) / 0.85, 0.0, 1.0), 1.0, keepNear);
  vColor = vec4(aColor.rgb, aColor.a * nearFade);
  vTile = vec2(mod(t, 2.0), 1.0 - floor(t / 2.0)) * 0.5;
  float px = aParams.x * uScale / dist;
  float e = 1.0;
  vRot = aParams.z;
  if (aParams.w > 0.0) {
    vec4 ahead = modelViewMatrix * vec4(position + aVel * 0.035, 1.0);
    vec2 d = (ahead.xy / max(-ahead.z, 0.01) - mvPosition.xy / dist) * uScale;
    e = clamp(length(d) * aParams.w / max(px, 0.5), 1.0, 14.0);
    vRot = atan(d.y, d.x);
  }
  vStretch = e;
  gl_PointSize = min(px * e, 1024.0);
  if (vColor.a <= 0.002) gl_PointSize = 0.0;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
varying vec2 vTile;
varying float vRot;
varying float vStretch;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord - 0.5;
  p.y = -p.y;
  float c = cos(vRot), s = sin(vRot);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  q.y *= vStretch;
  if (abs(q.x) > 0.5 || abs(q.y) > 0.5) discard;
  vec4 tex = texture2D(uMap, (q + 0.5) * 0.5 + vTile);
  gl_FragColor = vec4(vColor.rgb * tex.rgb, vColor.a * tex.a);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    #ifdef ADDITIVE
      // Свечение в тумане не красится в его цвет, а тонет в нём.
      gl_FragColor.a *= 1.0 - fogFactor;
    #else
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
    #endif
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export type SpriteLayer = ReturnType<typeof createSpriteLayer>;

export function createSpriteLayer({
  capacity,
  additive,
  map,
}: {
  capacity: number;
  additive: boolean;
  map: T.Texture;
}) {
  const pos = new Float32Array(capacity * 3),
    vel = new Float32Array(capacity * 3),
    col = new Float32Array(capacity * 3),
    // alpha0, size0, size1, age, life, drag, gravity, rot, rotVel, stretch, tile, flags, seed
    prm = new Float32Array(capacity * 13);
  const P = 13;
  const geometry = new T.BufferGeometry();
  const aPos = new T.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(T.DynamicDrawUsage),
    aColor = new T.BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(T.DynamicDrawUsage),
    aParams = new T.BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(T.DynamicDrawUsage),
    aVel = new T.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('position', aPos);
  geometry.setAttribute('aColor', aColor);
  geometry.setAttribute('aParams', aParams);
  geometry.setAttribute('aVel', aVel);
  geometry.setDrawRange(0, 0);
  const attributes = [aPos, aColor, aParams, aVel];
  const uniforms = T.UniformsUtils.merge([
    T.UniformsLib.fog,
    { uScale: { value: 500 }, uMap: { value: null } },
  ]);
  uniforms.uMap.value = map;
  const material = new T.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: additive ? T.AdditiveBlending : T.NormalBlending,
    defines: additive ? { ADDITIVE: '' } : {},
  });
  const points = new T.Points(geometry, material);
  points.frustumCulled = false;
  // Дым рисуется после свечения: светящееся ядро взрыва просвечивает сквозь край клуба.
  points.renderOrder = additive ? 2 : 1;
  points.userData.projectileCollision = 'ignore';
  points.userData.cameraCollision = 'ignore';
  points.raycast = () => {};
  const size = new T.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    const target = renderer.getRenderTarget();
    const height = target ? target.height : renderer.getDrawingBufferSize(size).y;
    uniforms.uScale.value = height * camera.projectionMatrix.elements[5] * 0.5;
  };
  let count = 0,
    cursor = 0;

  const move = (from: number, to: number) => {
    pos.copyWithin(to * 3, from * 3, from * 3 + 3);
    vel.copyWithin(to * 3, from * 3, from * 3 + 3);
    col.copyWithin(to * 3, from * 3, from * 3 + 3);
    prm.copyWithin(to * P, from * P, from * P + P);
  };

  /**
   * Новая частица. `delay` — через сколько секунд она появится (до того
   * невидима и стоит на месте): так рассыпаются поздние искорки салюта.
   */
  const emit = (
    at: T.Vector3,
    vx: number,
    vy: number,
    vz: number,
    color: T.Color,
    alpha: number,
    size0: number,
    size1: number,
    life: number,
    tile: number,
    drag = 0,
    gravity = 0,
    stretch = 0,
    flags = 0,
    delay = 0,
  ) => {
    let i: number;
    if (count < capacity) i = count++;
    else {
      // Буфер полон: новое важнее старого, вытесняем по кругу.
      i = cursor;
      cursor = (cursor + 1) % capacity;
    }
    pos[i * 3] = at.x;
    pos[i * 3 + 1] = at.y;
    pos[i * 3 + 2] = at.z;
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
    const o = i * P;
    prm[o] = alpha;
    prm[o + 1] = size0;
    prm[o + 2] = size1;
    prm[o + 3] = -delay;
    prm[o + 4] = life;
    prm[o + 5] = drag;
    prm[o + 6] = gravity;
    prm[o + 7] = Math.random() * Math.PI * 2;
    prm[o + 8] = flags & SPRITE_SMOKE ? (Math.random() - 0.5) * 1.6 : 0;
    prm[o + 9] = stretch;
    prm[o + 10] = tile + (flags & SPRITE_NO_NEAR_FADE ? 4 : 0);
    prm[o + 11] = flags;
    prm[o + 12] = Math.random() * 100;
  };

  const update = (dt: number) => {
    const ap = aPos.array as Float32Array,
      ac = aColor.array as Float32Array,
      aq = aParams.array as Float32Array,
      av = aVel.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const o = i * P;
      const age = (prm[o + 3] += dt),
        life = prm[o + 4];
      if (age >= life) {
        count--;
        if (i !== count) move(count, i);
        if (cursor >= count) cursor = 0;
        i--;
        continue;
      }
      const j = i * 3;
      let alpha = 0;
      if (age >= 0) {
        const drag = Math.max(0, 1 - prm[o + 5] * dt);
        vel[j] *= drag;
        vel[j + 1] = vel[j + 1] * drag - prm[o + 6] * dt;
        vel[j + 2] *= drag;
        pos[j] += vel[j] * dt;
        pos[j + 1] += vel[j + 1] * dt;
        pos[j + 2] += vel[j + 2] * dt;
        prm[o + 7] += prm[o + 8] * dt;
        const t = age / life,
          flags = prm[o + 11];
        if (flags & SPRITE_SMOKE) alpha = Math.min(1, t / 0.12) * (1 - t) ** 1.4;
        else if (flags & SPRITE_TWINKLE)
          alpha = (1 - t) * (t < 0.45 ? 1 : 0.35 + 0.65 * Math.abs(Math.sin(age * 23 + prm[o + 12])));
        else if (flags & SPRITE_HOT) alpha = (1 - t) ** 1.3;
        else alpha = (1 - t) ** 2;
        alpha *= prm[o];
        const grow = 1 - (1 - t) * (1 - t);
        aq[i * 4] = prm[o + 1] + (prm[o + 2] - prm[o + 1]) * grow;
        // Искра рождается белой и остывает до своего цвета.
        const hot = flags & SPRITE_HOT ? Math.max(0, 1 - t * 3.5) : 0;
        ac[i * 4] = col[j] + (Math.max(col[j], 1.6) - col[j]) * hot;
        ac[i * 4 + 1] = col[j + 1] + (Math.max(col[j + 1], 1.5) - col[j + 1]) * hot;
        ac[i * 4 + 2] = col[j + 2] + (Math.max(col[j + 2], 1.3) - col[j + 2]) * hot;
      } else aq[i * 4] = 0;
      ac[i * 4 + 3] = alpha;
      ap[j] = pos[j];
      ap[j + 1] = pos[j + 1];
      ap[j + 2] = pos[j + 2];
      av[j] = vel[j];
      av[j + 1] = vel[j + 1];
      av[j + 2] = vel[j + 2];
      aq[i * 4 + 1] = prm[o + 10];
      aq[i * 4 + 2] = prm[o + 7];
      aq[i * 4 + 3] = prm[o + 9];
    }
    geometry.setDrawRange(0, count);
    for (const a of attributes) {
      a.clearUpdateRanges();
      if (count) {
        a.addUpdateRange(0, count * a.itemSize);
        a.needsUpdate = true;
      }
    }
    points.visible = count > 0;
  };

  const dispose = () => {
    points.removeFromParent();
    geometry.dispose();
    material.dispose();
  };

  return {
    points,
    emit,
    update,
    dispose,
    get count() {
      return count;
    },
    capacity,
  };
}
