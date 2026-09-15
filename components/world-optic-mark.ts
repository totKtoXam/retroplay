import * as T from 'three';

/**
 * Подсветка бойца в окне коллиматора.
 *
 * Голубое стекло прицела само по себе ничего не даёт: оно лишь слегка красит
 * картинку. Смысл оптике добавляет то, ради чего в неё смотрят, — цель.
 * Пойманный в рамку боец обводится синим, и решение «он или не он» принимается
 * боковым зрением, а не разглядыванием силуэтов в полумраке.
 *
 * Обводка сделана френелем поверх капсулы размером с бойца: свет собирается по
 * краю силуэта, а центр остаётся прозрачным — подсветка не закрывает того, в
 * кого целятся. Цена — один меш и один материал на бойца, без света и теней,
 * как у щита (world-shield.ts) и по тем же причинам.
 *
 * Синий взят гуще, чем бледно-голубой щита: это разные вещи, и спутать их в
 * бою нельзя.
 */

const MARK_COLOR = new T.Color('#3f8bff');

const cornerScratch = new T.Vector3();
const pointScratch = new T.Vector2();
const ndcScratch = new T.Vector3();

/**
 * Прямоугольник стекла прицела в координатах экрана (NDC).
 *
 * Считаем по углам самой модели, а не по подобранным числам: стоит подвинуть
 * коллиматор на стволе — и рамка подсветки поедет за ним сама. В прицеливании
 * стекло смотрит прямо на камеру, поэтому описанный прямоугольник совпадает с
 * окном, а не приблизительно очерчивает его.
 */
export function opticNdcBox(mesh: T.Mesh, camera: T.Camera, out: T.Box2) {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  out.makeEmpty();
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y]) {
      cornerScratch.set(x, y, 0);
      mesh.localToWorld(cornerScratch).project(camera);
      out.expandByPoint(pointScratch.set(cornerScratch.x, cornerScratch.y));
    }
  return out;
}

/**
 * Попала ли точка в рамку прицела. Проверка чисто экранная: стены здесь не
 * учитываются — этим занимается вызывающий, у которого под рукой коллайдеры
 * карты.
 */
export function opticCatches(point: T.Vector3, box: T.Box2, camera: T.Camera) {
  ndcScratch.copy(point).project(camera);
  // z > 1 — точка за спиной: её проекция попадает в кадр зеркально.
  if (ndcScratch.z > 1) return false;
  return box.containsPoint(pointScratch.set(ndcScratch.x, ndcScratch.y));
}

export type OpticMark = {
  group: T.Group;
  /**
   * @param active боец сейчас в рамке прицела
   * @param timeSec общее время сцены, секунды: по нему идёт лёгкое дыхание
   */
  set(active: boolean, timeSec: number): void;
  dispose(): void;
};

export function createOpticMark(): OpticMark {
  const group = new T.Group();
  // Чистая декорация: не ловит пули, не обрывает дугу гранаты и не отодвигает
  // камеру от игрока.
  group.userData.projectileCollision = 'ignore';
  group.userData.noCameraCollision = true;
  group.userData.presentationOnly = true;
  group.visible = false;

  const material = new T.ShaderMaterial({
    uniforms: {
      uColor: { value: MARK_COLOR },
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
      uniform float uStrength;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        // К краю силуэта нормаль уходит от камеры — там обводка и светится.
        float fresnel = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir)));
        float rim = pow(fresnel, 3.0);
        // Капсула аддитивная и двусторонняя, каждый пиксель складывается
        // дважды — коэффициенты подобраны уже с этим.
        float alpha = (rim * 0.85 + 0.03) * uStrength;
        gl_FragColor = vec4(uColor * (0.7 + rim), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    blending: T.AdditiveBlending,
  });

  // Размер капсулы взят от боевой: тот же радиус и рост, по которым считаются
  // попадания, — обводка обязана совпадать с тем, во что попадёт краска.
  const geometry = new T.CapsuleGeometry(0.34, 1.12, 4, 14);
  const shell = new T.Mesh(geometry, material);
  shell.position.y = 0.92;
  // Рисуем после аватара: полупрозрачная обводка должна ложиться поверх него.
  shell.renderOrder = 4;
  shell.userData.projectileCollision = 'ignore';
  shell.userData.noCameraCollision = true;
  shell.userData.presentationOnly = true;
  group.add(shell);

  return {
    group,
    set(active, timeSec) {
      group.visible = active;
      if (!active) return;
      material.uniforms.uStrength.value = 0.82 + 0.18 * Math.sin(timeSec * 4.2);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
