import * as T from 'three';

/**
 * Облик призрака в «Предателе» — такой, каким призраки видят друг друга: полупрозрачное
 * светящееся тело-капсула с визором, вместо ног — извивающийся хвост, над головой нимб. Призрак
 * парит над полом и покачивается, а наклоняется туда, куда летит.
 *
 * Живые призраков не видят вовсе (сервер не присылает их позы), поэтому этот облик — только для
 * глаз других призраков и для самого погибшего в третьем лице.
 *
 * Призрак полупрозрачный, но рисуется в непрозрачном проходе: со своим смешением, без записи
 * глубины и с порядком 995 — после всего мира и до предмета в руках (порядок 1000, без теста
 * глубины). Обычный прозрачный проход идёт после предмета, и призрак ложился бы поверх фонарика.
 */

const GHOST_VERTEX = /* glsl */ `
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform float uWave;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vHeight;
  void main() {
    vec3 p = position;
    // Хвост вьётся: чем ниже, тем сильнее, волна бежит сверху вниз.
    float tail = 1.0 - smoothstep(0.25, 0.95, p.y);
    float angle = atan(p.z, p.x);
    p.x += sin(uTime * 3.2 + p.y * 9.0 + angle) * 0.07 * tail * uWave;
    p.z += cos(uTime * 2.7 + p.y * 7.0 - angle) * 0.07 * tail * uWave;
    vHeight = position.y;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const GHOST_FRAGMENT = /* glsl */ `
  #include <fog_pars_fragment>
  uniform vec3 uColor;
  uniform vec3 uGlow;
  uniform float uAlpha;
  uniform float uFadeFrom;
  uniform float uFadeTo;
  uniform float uTime;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vHeight;
  void main() {
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 2.2);
    vec3 col = uColor * (0.32 + 0.25 * facing) + uGlow * rim * 1.4;
    // Край ярче середины, хвост растворяется к кончику, по телу бежит слабая рябь.
    float shimmer = 0.9 + 0.1 * sin(vHeight * 18.0 - uTime * 4.0);
    float alpha = uAlpha * (0.38 + 0.62 * rim) * shimmer * smoothstep(uFadeFrom, uFadeTo, vHeight);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function ghostMaterial(color: T.Color, glow: T.Color, alpha: number, fadeFrom: number, fadeTo: number, wave: number) {
  return new T.ShaderMaterial({
    uniforms: T.UniformsUtils.merge([
      T.UniformsLib.fog,
      {
        uColor: { value: color },
        uGlow: { value: glow },
        uAlpha: { value: alpha },
        uFadeFrom: { value: fadeFrom },
        uFadeTo: { value: fadeTo },
        uTime: { value: 0 },
        uWave: { value: wave },
      },
    ]),
    vertexShader: GHOST_VERTEX,
    fragmentShader: GHOST_FRAGMENT,
    fog: true,
    // Не `transparent`: иначе three отнесёт призрака в прозрачный проход (см. комментарий к модулю).
    // Своё смешение включает его и в непрозрачном.
    blending: T.CustomBlending,
    blendSrc: T.SrcAlphaFactor,
    blendDst: T.OneMinusSrcAlphaFactor,
    depthWrite: false,
  });
}

/** Профиль тела: округлый верх как у скафандра экипажа и сужение в хвост книзу. */
const PROFILE = [
  [0, 1.74],
  [0.12, 1.72],
  [0.22, 1.66],
  [0.29, 1.55],
  [0.32, 1.4],
  [0.33, 1.22],
  [0.32, 1.02],
  [0.28, 0.82],
  [0.22, 0.62],
  [0.15, 0.45],
  [0.08, 0.32],
  [0.02, 0.22],
  [0, 0.2],
].map(([r, y]) => new T.Vector2(r, y));

export type GhostForm = {
  group: T.Group;
  /** Перекрасить под цвет игрока. */
  setColor(color: string): void;
  /** Кадр: `moving` — летит ли, `heading` — поворот тела, чтобы клониться вперёд по ходу. */
  animate(seconds: number, moving: boolean): void;
  dispose(): void;
};

export function createGhostForm(color: string): GhostForm {
  const group = new T.Group();
  group.name = 'ghost-form';
  // Облик рисуется своим шейдером: пакеты ресурсов его не перекрашивают, тени он не бросает.
  group.userData.presentationOnly = true;
  const base = new T.Color(color);
  const glow = new T.Color(color).lerp(new T.Color('#ffffff'), 0.45);
  const body = ghostMaterial(base, glow, 0.55, 0.2, 0.75, 1);
  const visorColor = new T.Color('#9fe3ff');
  const visor = ghostMaterial(visorColor, new T.Color('#e8fbff'), 0.9, -10, -9, 0);
  const haloColor = new T.Color('#fff2b0');
  const halo = ghostMaterial(haloColor, new T.Color('#ffffff'), 0.95, -10, -9, 0);
  const materials = [body, visor, halo];
  const geometries: T.BufferGeometry[] = [];
  const keep = <G extends T.BufferGeometry>(g: G) => {
    geometries.push(g);
    return g;
  };

  const bodyMesh = new T.Mesh(keep(new T.LatheGeometry(PROFILE, 22)), body);
  group.add(bodyMesh);
  // Визор смотрит туда же, куда лицо рига, — в −Z.
  const visorMesh = new T.Mesh(keep(new T.SphereGeometry(1, 18, 12)), visor);
  visorMesh.scale.set(0.2, 0.11, 0.1);
  visorMesh.position.set(0, 1.43, -0.27);
  group.add(visorMesh);
  const haloMesh = new T.Mesh(keep(new T.TorusGeometry(0.17, 0.024, 8, 28)), halo);
  haloMesh.rotation.x = Math.PI / 2;
  haloMesh.position.y = 1.97;
  group.add(haloMesh);
  // Тело — первым, визор и нимб — поверх него.
  [bodyMesh, visorMesh, haloMesh].forEach((mesh, i) => {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.noCameraCollision = true;
    mesh.renderOrder = 995 + i;
  });

  const phase = Math.random() * Math.PI * 2;
  let lean = 0;
  return {
    group,
    setColor(next: string) {
      // UniformsUtils.merge копирует значения, поэтому красим именно юниформы материала.
      (body.uniforms.uColor.value as T.Color).set(next);
      (body.uniforms.uGlow.value as T.Color).set(next).lerp(new T.Color('#ffffff'), 0.45);
    },
    animate(seconds: number, moving: boolean) {
      for (const m of materials) m.uniforms.uTime.value = seconds;
      // Парит на ладонь над полом и медленно качается; в полёте клонится вперёд.
      group.position.y = 0.28 + Math.sin(seconds * 2.1 + phase) * 0.09;
      lean += ((moving ? 0.22 : 0) - lean) * 0.08;
      group.rotation.x = -lean;
      group.rotation.z = Math.sin(seconds * 1.3 + phase) * 0.05;
      haloMesh.position.y = 1.97 + Math.sin(seconds * 3.1 + phase) * 0.025;
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

/**
 * Переключить аватар в облик призрака и обратно. Прячутся только прямые потомки аватара, кроме
 * перечисленных `keep` (подпись, луч и т. п.) и самого призрака; запоминаются те, что были
 * спрятаны именно здесь, — чтобы при воскрешении в новой партии вернуть ровно их и не спорить
 * с остальным кодом, который тоже управляет видимостью частей.
 */
export function setGhostLook(
  avatar: T.Group,
  ghost: GhostForm | null,
  on: boolean,
  keep: Iterable<T.Object3D | undefined>,
) {
  const hidden: Set<T.Object3D> = (avatar.userData.ghostHidden ??= new Set<T.Object3D>());
  const spared = new Set<T.Object3D | undefined>([...keep, ghost?.group]);
  if (on) {
    if (ghost && ghost.group.parent !== avatar) avatar.add(ghost.group);
    for (const child of avatar.children) {
      if (spared.has(child) || !child.visible) continue;
      child.visible = false;
      hidden.add(child);
    }
    if (ghost) ghost.group.visible = true;
  } else {
    for (const child of hidden) child.visible = true;
    hidden.clear();
    if (ghost) ghost.group.visible = false;
  }
}
