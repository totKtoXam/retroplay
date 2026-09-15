import * as T from 'three';

/**
 * Щит возрождения, видимый на чужом бойце.
 *
 * Значок 🛡️ в подписи над головой отвечал на вопрос «почему по нему не
 * проходит урон» только тогда, когда подпись вообще читают: в бою её закрывают
 * стены, она гаснет при `hidePlayerStatus` и теряется среди других меток. А
 * решение «стрелять или подождать» принимается за доли секунды и боковым
 * зрением. Поэтому щит показан самим силуэтом — светящимся пузырём вокруг
 * бойца, который видно и не вчитываясь.
 *
 * Пузырь сделан френелем, а не заливкой: свечение собирается по краю сферы, а
 * центр остаётся прозрачным — иначе щит закрывал бы того, кого защищает, и по
 * нему нельзя было бы прицелиться в момент, когда щит спадёт.
 *
 * Цена — один меш и один материал на бойца, без света и теней: как у луча
 * фонарика (world-flashlight.ts) и по тем же причинам, что описаны там.
 */

/** Цвет щита: тот же голубой, что у индикатора щита в HUD (app/globals.css). */
const SHIELD_COLOR = new T.Color('#7fd8ff');
/** Последняя секунда щита мигает чаще — это предупреждение, а не украшение. */
const WARN_MS = 1200;

export type ShieldBubble = {
  group: T.Group;
  /**
   * @param active щит держится прямо сейчас
   * @param remainingMs сколько его осталось (0 — щит «до первого шага»)
   * @param timeSec общее время сцены, секунды: по нему идёт пульсация
   */
  set(active: boolean, remainingMs: number, timeSec: number): void;
  dispose(): void;
};

export function createShieldBubble(): ShieldBubble {
  const group = new T.Group();
  // Пузырь — чистая декорация: он не ловит пули, не обрывает дугу гранаты и не
  // отодвигает камеру от игрока.
  group.userData.projectileCollision = 'ignore';
  group.userData.noCameraCollision = true;
  group.userData.presentationOnly = true;
  group.visible = false;

  const material = new T.ShaderMaterial({
    uniforms: {
      uColor: { value: SHIELD_COLOR },
      uTime: { value: 0 },
      // Общая яркость: ею и гасим щит, и мигаем на исходе.
      uStrength: { value: 1 },
    },
    vertexShader: `
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uStrength;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        // Френель: к краю силуэта нормаль уходит от камеры — там щит и светится.
        float fresnel = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir)));
        float rim = pow(fresnel, 2.4);
        // Ползущие вверх полосы: без них пузырь читается как застывшая плёнка,
        // а щит — штука временная, и двигаться он должен.
        float bands = 0.5 + 0.5 * sin(vNormalW.y * 24.0 - uTime * 2.6);
        // Сфера аддитивная и двусторонняя, поэтому каждый пиксель складывается
        // дважды — коэффициенты подобраны уже с этим. Ровная подсветка внутри
        // (последнее слагаемое) намеренно слабая: она выдаёт объём пузыря, но
        // не забеливает бойца, по которому через секунду придётся стрелять.
        float alpha = (rim * 0.65 + rim * bands * 0.3 + 0.02) * uStrength;
        gl_FragColor = vec4(uColor * (0.6 + rim * 0.85), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    blending: T.AdditiveBlending,
  });

  // Вытянутая по росту сфера: чуть больше метра в поперечнике и метр восемьдесят
  // от пяток до макушки — боец помещается целиком и в полный рост, и сидя.
  const geometry = new T.SphereGeometry(0.58, 20, 14);
  const bubble = new T.Mesh(geometry, material);
  bubble.scale.set(1, 1.58, 1);
  bubble.position.y = 0.92;
  // Рисуем после аватара: полупрозрачная сфера должна ложиться поверх него.
  bubble.renderOrder = 5;
  bubble.userData.projectileCollision = 'ignore';
  bubble.userData.noCameraCollision = true;
  bubble.userData.presentationOnly = true;
  group.add(bubble);

  return {
    group,
    set(active, remainingMs, timeSec) {
      group.visible = active;
      if (!active) return;
      material.uniforms.uTime.value = timeSec;
      // Ровное дыхание, пока время есть; частое мигание — в последнюю секунду.
      const hurry = remainingMs > 0 && remainingMs < WARN_MS;
      const pulse = hurry
        ? 0.45 + 0.55 * Math.abs(Math.sin(timeSec * 9))
        : 0.78 + 0.22 * Math.sin(timeSec * 3.2);
      material.uniforms.uStrength.value = pulse;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
