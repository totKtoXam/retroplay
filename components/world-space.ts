import * as T from 'three';

/**
 * Космос за иллюминаторами корабля (режим «Предатель»).
 *
 * Стекло иллюминатора — не картинка, а окно в бесконечность: шейдер берёт направление от камеры
 * к точке стекла и по нему считает, что видно снаружи. Звёзды, туманность, Млечный Путь, планеты
 * с атмосферой и кольцами и само солнце посчитаны прямо в этом направлении. Поэтому вид остаётся
 * резким на любом разрешении и честно смещается, когда подходишь к окну и смотришь вбок: космос
 * бесконечно далеко, и параллакса у него нет. Геометрию в стенах вырезать не нужно.
 *
 * Солнце здесь — единственное светило. Его направление `SPACE_SUN` общее для окна и для света в
 * отсеках: иллюминаторы, смотрящие на солнце, пускают внутрь луч и кладут на пол светлое пятно
 * с тенью от переплёта. Остальные окна смотрят на планеты.
 *
 * Лучи рисуются в непрозрачном проходе, с аддитивным смешением, без записи глубины и с порядком
 * 990: после всего мира, но до предмета в руках (порядок 1000, без теста глубины). Прозрачный
 * проход идёт после предмета — луч в нём лёг бы поверх фонарика (та же беда была с водой фонтана).
 */

/** Откуда светит солнце: северо-восток, на тридцать градусов над горизонтом корабля. */
export const SPACE_SUN = new T.Vector3(0.62, 0.52, -0.6).normalize();

type Planet = {
  /** Направление на центр. */
  dir: T.Vector3;
  /** Угловой радиус, рад. */
  radius: number;
  /** Ось вращения: от неё полосы, полюса и плоскость колец. */
  axis: T.Vector3;
  /** 0 — газовый гигант, 1 — землеподобная, 2 — ржавая пустыня, 3 — ледяная луна. */
  kind: number;
  /** Кольца: внутренний и внешний радиус в радиусах планеты; 0 — колец нет. */
  rings: [number, number];
  /** Цвет атмосферы по краю диска. */
  haze: T.Color;
};

const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z).normalize();

/**
 * Планеты расставлены так, чтобы из каждой стороны корабля было на что посмотреть. На юге —
 * окольцованный гигант с луной, на востоке — голубая планета рядом с солнцем, на западе — ржавая
 * пустыня, на севере — далёкая ледяная точка.
 */
const PLANETS: Planet[] = [
  { dir: v(-0.28, -0.04, 0.96), radius: 0.23, axis: v(0.25, 1, 0.35), kind: 0, rings: [1.35, 2.25], haze: new T.Color('#f3c98b') },
  { dir: v(0.2, 0.14, 0.97), radius: 0.035, axis: v(0, 1, 0), kind: 3, rings: [0, 0], haze: new T.Color('#c9d6e8') },
  { dir: v(0.95, -0.12, 0.29), radius: 0.12, axis: v(0.2, 1, -0.1), kind: 1, rings: [0, 0], haze: new T.Color('#6fb7ff') },
  { dir: v(-0.97, 0.1, -0.22), radius: 0.075, axis: v(-0.15, 1, 0.1), kind: 2, rings: [0, 0], haze: new T.Color('#ff9d6b') },
  { dir: v(-0.22, 0.3, -0.93), radius: 0.028, axis: v(0, 1, 0), kind: 3, rings: [0, 0], haze: new T.Color('#b9a7ff') },
];

const SPACE_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uPlanetDir[${PLANETS.length}];
uniform vec3 uPlanetAxis[${PLANETS.length}];
uniform vec3 uPlanetHaze[${PLANETS.length}];
uniform vec4 uPlanetInfo[${PLANETS.length}]; // радиус (рад), вид, кольца от, кольца до

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * noise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}

// Слой звёзд: в каждой клетке сетки на сфере — не больше одной звезды. Звезда ставится прямо на
// сферу, не ближе пятой части клетки к её краю, и принимается, только если попала в свою клетку.
// Свечение гаснет раньше, чем доходит до края клетки, — иначе граница резала бы его квадратом.
vec3 starLayer(vec3 d, float scale, float density, float size, float bright) {
  vec3 cell = floor(d * scale);
  vec3 h = hash33(cell);
  if (h.x > density) return vec3(0.0);
  vec3 star = normalize(cell + 0.2 + 0.6 * hash33(cell + 17.0));
  if (any(notEqual(floor(star * scale), cell))) return vec3(0.0);
  float ang = acos(clamp(dot(d, star), -1.0, 1.0));
  float reach = min(size * 3.0, 0.19 / scale);
  float core = smoothstep(size, size * 0.15, ang);
  float glow = exp(-ang / (size * 0.9)) * 0.3 * smoothstep(reach, reach * 0.4, ang);
  float twinkle = 0.78 + 0.22 * sin(uTime * (1.5 + h.y * 4.0) + h.z * 6.283);
  vec3 tint = mix(vec3(0.62, 0.74, 1.0), vec3(1.0, 0.84, 0.62), h.y);
  return tint * (core + glow) * bright * twinkle * (0.5 + h.z);
}

vec3 sky(vec3 d) {
  // Млечный Путь — полоса вдоль большого круга, в ней гуще звёзды и туманность.
  vec3 galaxy = normalize(vec3(0.3, 0.82, 0.48));
  float band = exp(-pow(dot(d, galaxy) / 0.28, 2.0));
  float dust = fbm(d * 5.0 + 7.0);
  vec3 col = vec3(0.004, 0.006, 0.014);
  col += band * (0.02 + 0.12 * dust) * vec3(0.55, 0.52, 0.85);
  // Туманности: пурпурная и бирюзовая, рваные по краям.
  float n1 = fbm(d * 2.2 + 3.0);
  float n2 = fbm(d * 3.4 + 11.0);
  col += smoothstep(0.52, 0.92, n1) * vec3(0.32, 0.08, 0.36) * 0.55;
  col += smoothstep(0.58, 0.95, n2) * vec3(0.03, 0.2, 0.3) * 0.5;
  // Тёмные пылевые прожилки поверх полосы.
  col *= 1.0 - band * smoothstep(0.55, 0.8, fbm(d * 9.0 + 2.0)) * 0.6;
  col += starLayer(d, 18.0, 0.16 + band * 0.2, 0.0032, 1.7);
  col += starLayer(d, 46.0, 0.14 + band * 0.4, 0.0016, 0.8);
  col += starLayer(d, 115.0, 0.12 + band * 0.55, 0.0008, 0.42);
  return col;
}

vec3 sunLight(vec3 d) {
  float ang = acos(clamp(dot(d, uSun), -1.0, 1.0));
  vec3 t = normalize(cross(uSun, vec3(0.0, 1.0, 0.0)));
  vec3 b = cross(uSun, t);
  float phi = atan(dot(d, b), dot(d, t));
  float rays = pow(0.5 + 0.5 * sin(phi * 11.0 + sin(phi * 3.0) * 2.0), 6.0) * exp(-ang * 7.0) * 0.5;
  vec3 col = smoothstep(0.046, 0.041, ang) * vec3(7.0, 6.4, 5.2);
  col += exp(-ang * 26.0) * vec3(2.2, 1.6, 0.9);
  col += exp(-ang * 9.0) * vec3(0.5, 0.33, 0.18) * 0.35;
  col += rays * vec3(1.0, 0.8, 0.5) * 0.7;
  return col;
}

// Поверхность планеты в локальных координатах: n — нормаль, a — ось.
vec3 surface(int kind, vec3 n, vec3 a) {
  float lat = dot(n, a);
  if (kind == 0) {
    float turb = fbm(n * 3.0) * 1.6;
    float bands = sin(lat * 17.0 + turb * 2.2);
    vec3 col = mix(vec3(0.78, 0.6, 0.42), vec3(0.93, 0.83, 0.66), 0.5 + 0.5 * bands);
    col = mix(col, vec3(0.62, 0.36, 0.22), smoothstep(0.55, 0.9, fbm(n * 6.0 + 4.0)) * 0.5);
    // Большое красное пятно — вихрь в южном поясе.
    vec3 spot = normalize(vec3(0.5, -0.35, 0.8));
    float storm = smoothstep(0.22, 0.05, length(n - spot) + fbm(n * 12.0) * 0.08);
    return mix(col, vec3(0.75, 0.3, 0.2), storm * 0.8);
  }
  if (kind == 1) {
    float land = fbm(n * 2.6 + 1.3);
    vec3 ocean = mix(vec3(0.02, 0.1, 0.28), vec3(0.04, 0.22, 0.42), fbm(n * 5.0));
    vec3 ground = mix(vec3(0.16, 0.34, 0.12), vec3(0.5, 0.42, 0.24), smoothstep(0.55, 0.75, land));
    vec3 col = mix(ocean, ground, smoothstep(0.5, 0.53, land));
    col = mix(col, vec3(0.92, 0.95, 1.0), smoothstep(0.78, 0.86, abs(lat)));
    float clouds = smoothstep(0.55, 0.75, fbm(n * 4.5 + vec3(uTime * 0.004, 0.0, 0.0)));
    return mix(col, vec3(0.95), clouds * 0.85);
  }
  if (kind == 2) {
    float r = fbm(n * 3.5 + 8.0);
    vec3 col = mix(vec3(0.45, 0.17, 0.08), vec3(0.78, 0.42, 0.22), r);
    col *= 0.75 + 0.35 * smoothstep(0.4, 0.7, fbm(n * 14.0));
    return mix(col, vec3(0.9, 0.85, 0.8), smoothstep(0.86, 0.93, abs(lat)));
  }
  float craters = fbm(n * 9.0);
  return vec3(0.62, 0.64, 0.7) * (0.65 + 0.5 * craters);
}

// Всё, что видно в направлении d: небо, солнце и планеты поверх них.
vec3 space(vec3 d) {
  vec3 col = sky(d) + sunLight(d);
  for (int i = 0; i < ${PLANETS.length}; i++) {
    vec3 c = uPlanetDir[i];
    vec4 info = uPlanetInfo[i];
    float R = sin(info.x);
    vec3 a = uPlanetAxis[i];
    int kind = int(info.y + 0.5);
    float b = dot(d, c);
    float h2 = b * b - (dot(c, c) - R * R);
    float tPlanet = h2 > 0.0 && b > 0.0 ? b - sqrt(h2) : 1e9;
    // Атмосфера: свечение у края диска, со стороны солнца.
    float miss = length(cross(d, c));
    vec3 haze = uPlanetHaze[i];
    if (b > 0.0 && tPlanet > 1e8) {
      float rim = smoothstep(R * 1.09, R, miss);
      vec3 side = normalize(d * b - c);
      col += haze * rim * rim * 0.6 * smoothstep(-0.3, 0.6, dot(side, uSun));
    }
    if (tPlanet < 1e8) {
      vec3 n = normalize(d * tPlanet - c);
      float ndl = dot(n, uSun);
      float light = smoothstep(-0.06, 0.35, ndl) * 1.15 + 0.012;
      vec3 surf = surface(kind, n, a) * light;
      // Край диска подсвечен атмосферой, ночная сторона — чуть-чуть, отражённым светом.
      float fres = pow(1.0 - max(dot(n, -d), 0.0), 3.0);
      surf += haze * fres * 0.55 * smoothstep(-0.2, 0.5, ndl);
      col = surf;
    }
    if (info.w > 0.0) {
      float denom = dot(d, a);
      if (abs(denom) > 1e-4) {
        float tr = dot(c, a) / denom;
        if (tr > 0.0) {
          vec3 p = d * tr - c;
          float r = length(p) / R;
          if (r > info.z && r < info.w && tr < tPlanet) {
            float k = (r - info.z) / (info.w - info.z);
            float bands = 0.55 + 0.45 * sin(r * 46.0) * sin(r * 13.0 + 1.3);
            float alpha = bands * smoothstep(0.0, 0.08, k) * smoothstep(1.0, 0.85, k) * (k > 0.42 && k < 0.47 ? 0.15 : 1.0);
            // Тень планеты на кольцах.
            vec3 w = c - d * tr;
            float along = dot(w, uSun);
            float shadow = along > 0.0 && length(w - uSun * along) < R ? 0.15 : 1.0;
            vec3 ring = mix(vec3(0.72, 0.62, 0.5), vec3(0.95, 0.88, 0.76), bands) * shadow;
            col = mix(col, ring, clamp(alpha * 0.85, 0.0, 1.0));
          }
        }
      }
    }
  }
  return col;
}
`;

/** Юниформы с планетами и солнцем: общие для всех окон, время тикает у одного объекта. */
function spaceUniforms() {
  return {
    uTime: { value: 0 },
    uSun: { value: SPACE_SUN.clone() },
    uPlanetDir: { value: PLANETS.map((p) => p.dir.clone()) },
    uPlanetAxis: { value: PLANETS.map((p) => p.axis.clone()) },
    uPlanetHaze: { value: PLANETS.map((p) => p.haze.clone()) },
    uPlanetInfo: { value: PLANETS.map((p) => new T.Vector4(p.radius, p.kind, p.rings[0], p.rings[1])) },
  };
}

/**
 * Стекло иллюминатора. У краёв стекло чуть темнее рамы, сверху по нему идёт слабый блик от ламп
 * отсека: без этого окно выглядело бы дырой в стене, а не стеклом.
 */
export function createSpaceWindowMaterial() {
  const material = new T.ShaderMaterial({
    uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, spaceUniforms()]),
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      varying vec3 vWorld;
      varying vec2 vUv;
      ${SPACE_GLSL}
      void main() {
        vec3 d = normalize(vWorld - cameraPosition);
        vec3 col = space(d);
        float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        col *= 0.72 + 0.28 * smoothstep(0.0, 0.07, edge);
        // Слабое отражение ламп отсека в нижней части стекла.
        col += vec3(0.05, 0.07, 0.09) * pow(1.0 - vUv.y, 3.0) * 0.25;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  material.name = 'space-window';
  return material;
}

/**
 * Лучи солнца через иллюминатор. `center` — середина стекла, `normal` — куда смотрит стекло
 * внутрь отсека, `right` — вдоль ширины окна. Возвращает null, если солнце в это окно не
 * заглядывает: тогда за ним видны только планеты и звёзды.
 *
 * Луч — это «коробка» из четырёх полупрозрачных листов от стекла до пола, пятно — четырёхугольник
 * на полу, куда стекло проецируется вдоль света. В пятне видна тень от переплёта (`bars` стоек).
 */
export function sunbeamGeometry(center: T.Vector3, normal: T.Vector3, right: T.Vector3, w: number, h: number, bars: number) {
  const outward = normal.clone().negate();
  // Солнце должно быть по ту сторону стекла и хоть немного над горизонтом.
  if (SPACE_SUN.dot(outward) < 0.15 || SPACE_SUN.y < 0.05) return null;
  const light = SPACE_SUN.clone().negate();
  const up = new T.Vector3(0, 1, 0);
  const corner = (sx: number, sy: number) => center.clone().addScaledVector(right, (sx * w) / 2).addScaledVector(up, (sy * h) / 2);
  const toFloor = (c: T.Vector3) => c.clone().addScaledVector(light, (c.y - 0.025) / -light.y);
  // Порядок: низ-лево, низ-право, верх-право, верх-лево.
  const glass = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const floor = glass.map(toFloor);
  const patch = new T.BufferGeometry();
  patch.setAttribute('position', new T.Float32BufferAttribute(floor.flatMap((p) => [p.x, p.y, p.z]), 3));
  patch.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  patch.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
  // Листы луча: каждое ребро стекла тянется к своему следу на полу; v = 0 у стекла, 1 у пола.
  const pos: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = glass[i],
      b = glass[(i + 1) % 4],
      fa = floor[i],
      fb = floor[(i + 1) % 4];
    const base = pos.length / 3;
    for (const p of [a, b, fb, fa]) pos.push(p.x, p.y, p.z);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const shaft = new T.BufferGeometry();
  shaft.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  shaft.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  shaft.setIndex(index);
  return { patch, shaft, bars };
}

/** Светлое пятно на полу: тёплое, с мягкими краями и тенью от стоек переплёта. */
export function createSunPatchMaterial(bars: number) {
  const material = new T.ShaderMaterial({
    uniforms: { uBars: { value: bars } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBars;
      varying vec2 vUv;
      void main() {
        float soft = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
        float shade = 1.0;
        for (int i = 1; i <= 6; i++) {
          if (float(i) > uBars) break;
          shade *= smoothstep(0.006, 0.02, abs(vUv.x - float(i) / (uBars + 1.0)));
        }
        vec3 col = vec3(1.0, 0.82, 0.56) * 0.3 * soft * shade;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    blending: T.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.name = 'sun-patch';
  return material;
}

/**
 * Лист луча: ярче у стекла, гаснет к полу и к краям листа, в нём медленно плывёт пыль. Листы
 * пересекаются, поэтому свет каждого совсем слабый — вместе они дают объём.
 */
export function createSunShaftMaterial() {
  const material = new T.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorld;
      float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float noise3(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        // Ярче всего луч чуть отступив от стекла; у самого стекла и к полу он гаснет, чтобы, подойдя
        // к окну, не смотреть на космос сквозь светлую пелену.
        float fade = smoothstep(0.0, 0.18, vUv.y) * pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
        float haze = 0.75 + 0.5 * noise3(vWorld * 1.4 + vec3(0.0, uTime * 0.12, uTime * 0.05));
        float motes = smoothstep(0.93, 0.99, noise3(vWorld * 9.0 + vec3(uTime * 0.2, uTime * 0.08, 0.0))) * 0.6;
        vec3 col = vec3(1.0, 0.86, 0.62) * (0.03 * haze + motes * 0.14) * fade;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    blending: T.AdditiveBlending,
    depthWrite: false,
    side: T.DoubleSide,
  });
  material.name = 'sun-shaft';
  return material;
}

/** Анимация окон и лучей: у всех общий ход времени. */
export function animateSpace(materials: T.ShaderMaterial[], seconds: number) {
  for (const m of materials) if (m.uniforms.uTime) m.uniforms.uTime.value = seconds;
}
