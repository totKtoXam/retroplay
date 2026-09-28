import * as T from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { CONFETTI, FIREWORKS, GRENADES } from '../lib/game-items.ts';
import { partyGeometry, grenadeParty, fireworkParty } from './party-geometry.ts';
import { createMaterialPool } from './material-pool.ts';
import { atlasTileUv, splatAtlas, spriteAtlas, SPRITE_TILE } from './world-vfx-textures.ts';
import {
  createSpriteLayer,
  SPRITE_HOT,
  SPRITE_NO_NEAR_FADE,
  SPRITE_SMOKE,
  SPRITE_TWINKLE,
} from './world-vfx-sprites.ts';

/** Как летят осколки вспышки: конфетти парит, капля и обломок падают по баллистике. */
type PieceKind = 'flutter' | 'drop' | 'debris';

type Particle = {
  mesh: T.InstancedMesh;
  velocity: T.Vector3[];
  positions: T.Vector3[];
  rotations: T.Euler[];
  /** Размер каждой частицы: одинаковые конфетти выглядят как штамп. */
  sizes: Float32Array;
  born: number;
  lifetime?: number;
  kind: PieceKind;
  /** Высота пола под вспышкой: конфетти ложится на него, а не проваливается. */
  floor: number;
};

/**
 * Эффекты мира: вспышки выстрелов, попадания, взрывы, салюты, кляксы краски.
 *
 * Три вида частиц:
 * - спрайты (world-vfx-sprites.ts) — свечение, искры со шлейфом, дым, кольца:
 *   два слоя `Points` на весь мир, без объектов на частицу;
 * - объёмные осколки — `InstancedMesh` на вспышку: конфетти, сердечки, капли
 *   краски, осколки гранаты; освещаются сценой и слегка светятся своим цветом,
 *   чтобы читаться и на тёмной карте;
 * - кляксы — плоскости с текстурой-атласом и рельефом свежей краски.
 *
 * Количество частиц, свет вспышки и шлейфы зависят от качества графики.
 */
/** Сколько вспышек живёт одновременно: больше — экран превращается в стену частиц. */
const MAX_LIVE_BURSTS = 12;
/** Краска на бойце держится дольше, чем на стенах: пока её не смыла смерть. */
const BODY_PAINT_SECONDS = 25;
/** Больше пятен на одном бойце не держим: старые уступают место новым. */
const BODY_PAINT_LIMIT = 24;
/** Глубина проекции пятна: хватает на изгиб корпуса, но не пробивает руку насквозь. */
const BODY_PAINT_DEPTH = 0.2;
/** Сколько колец ударной волны может идти одновременно. */
const MAX_SHOCKWAVES = 4;

/**
 * Пятно краски: клякса с неровным краем, брызги вокруг и потёк вниз. Белая —
 * цвет даёт материал. Одна текстура на все пятна.
 */
function paintStainTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  const c = size / 2;
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = size * (0.24 + Math.sin(a * 5 + 1) * 0.035 + Math.cos(a * 9) * 0.025 + Math.sin(a * 13) * 0.012);
    const x = c + Math.cos(a) * r,
      y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.fill();
  // Брызги: мелкие капли вокруг, чем дальше — тем мельче.
  for (let i = 0; i < 11; i++) {
    const a = i * 2.39996 + 0.4,
      d = size * (0.3 + ((i * 37) % 11) / 60);
    g.beginPath();
    g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, size * (0.045 - d / size / 14), 0, Math.PI * 2);
    g.fill();
  }
  // Потёк: краска стекает вниз по ткани. Верх пятна смотрит вверх по миру
  // (paintBody), а с flipY верх canvas — это верх текстуры: потёк рисуем вниз.
  for (const [dx, len, w] of [
    [-0.08, 0.2, 0.05],
    [0.07, 0.13, 0.04],
  ] as const) {
    const x = c + dx * size,
      end = c + (0.2 + len) * size;
    g.fillRect(x - (w * size) / 2, c, w * size, end - c);
    g.beginPath();
    g.arc(x, end, w * size * 0.75, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Ближе этого расстояния до камеры частица не рисуется. */
const PARTICLE_NEAR_CULL = 0.45;
/** До этого расстояния частица уменьшается, чтобы не закрывать обзор. */
const PARTICLE_NEAR_FADE = 1.3;

/** Уровень качества → ступень 0…3 (низкое, сбалансированное, высокое, кино). */
export function vfxTier(quality: string) {
  return quality === 'low' ? 0 : quality === 'cinematic' ? 3 : quality === 'high' ? 2 : 1;
}

/** Праздничная палитра: насыщенные цвета, а не пастель — на экране они читаются издалека. */
const PARTY = ['#ff3d7f', '#ffc93c', '#29c5ff', '#7dff6b', '#b36bff', '#ff7a2e', '#ffffff'];
/** Цвета искр салюта по его виду. */
const FIREWORK_COLORS: Record<string, string[]> = {
  salute: ['#ffcb65', '#ffffff', '#ff5c5c'],
  sparkler: ['#64d4ef', '#ffffff', '#b8f3ff'],
  dragon: ['#ff4a4a', '#ff9d2e', '#ffd166'],
  comet: ['#bc91f5', '#e2ccff', '#ffffff'],
  aurora: ['#5dffb0', '#3ad7ff', '#b6ffe5'],
  solar: ['#fff06a', '#ffa640', '#ffffff'],
  galaxy: ['#ff6ec4', '#9b6bff', '#58b8ff'],
  flower: ['#ff8fcf', '#ffffff', '#ffd166'],
};

export function createWorldVfx({
  scene,
  quality,
  camera,
}: {
  scene: T.Scene;
  quality: string;
  /** Нужна, чтобы гасить частицы, пролетающие вплотную к глазам игрока. */
  camera?: T.Camera;
}) {
  const tier = vfxTier(quality);
  /** Число частиц по качеству: [низкое, сбалансированное, высокое, кино]. */
  const byTier = (counts: readonly [number, number, number, number]) => counts[tier];
  /** Пятна краски; `owner` — на ком или на чём пятно (сцена, боец, экран). */
  const splats: { mesh: T.Mesh; born: number; owner: T.Object3D; life: number }[] = [],
    bursts: Particle[] = [];
  const nearCameraScale = (p: T.Vector3) => {
    if (!camera) return 1;
    const d = p.distanceTo(camera.position);
    if (d >= PARTICLE_NEAR_FADE) return 1;
    if (d <= PARTICLE_NEAR_CULL) return 0;
    return (d - PARTICLE_NEAR_CULL) / (PARTICLE_NEAR_FADE - PARTICLE_NEAR_CULL);
  };
  const dummy = new T.Object3D(),
    paintDropletGeo = new T.SphereGeometry(0.04, 8, 6),
    confettiGeo = new T.PlaneGeometry(0.07, 0.13),
    normalUp = new T.Vector3(0, 0, 1);
  // Скретч-объекты: эффекты рождаются десятками за кадр, без аллокаций на частицу.
  const v1 = new T.Vector3(),
    v2 = new T.Vector3(),
    v3 = new T.Vector3(),
    axisA = new T.Vector3(),
    axisB = new T.Vector3(),
    c1 = new T.Color(),
    c2 = new T.Color(),
    c3 = new T.Color(),
    white = new T.Color(1, 1, 1),
    warmSpark = new T.Color(1, 0.8, 0.45),
    hsl = { h: 0, s: 0, l: 0 },
    worldUp = new T.Vector3(0, 1, 0);
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const pick = <V>(list: readonly V[]) => list[Math.floor(Math.random() * list.length)];
  /** Насыщенный вариант цвета: пастель предметов в эффекте выглядит блёкло. */
  const vivid = (out: T.Color, color: string | T.Color) => {
    out.set(color);
    out.getHSL(hsl);
    return out.setHSL(hsl.h, Math.max(hsl.s, 0.82), T.MathUtils.clamp(hsl.l, 0.5, 0.62));
  };
  /** Два перпендикуляра к нормали: в их плоскости частицы разлетаются вбок. */
  const tangents = (n: T.Vector3) => {
    axisA.crossVectors(n, Math.abs(n.y) > 0.9 ? v3.set(1, 0, 0) : worldUp).normalize();
    axisB.crossVectors(n, axisA).normalize();
  };
  /**
   * Случайное направление в конусе вокруг `n`: `spread` 0 — строго по нормали,
   * 1 — полусфера. Пишет в `out`; `tangents(n)` должен быть уже вызван.
   */
  const cone = (out: T.Vector3, n: T.Vector3, spread: number) => {
    const a = Math.random() * Math.PI * 2,
      s = Math.sqrt(Math.random()) * spread;
    return out
      .copy(n)
      .multiplyScalar(Math.sqrt(Math.max(0, 1 - s * s)))
      .addScaledVector(axisA, Math.cos(a) * s)
      .addScaledVector(axisB, Math.sin(a) * s)
      .normalize();
  };

  // --- Спрайты: свечение и искры (аддитивно), дым и туман краски (обычное смешивание).
  const atlas = spriteAtlas();
  const glow = createSpriteLayer({
    capacity: byTier([320, 900, 1600, 2200]),
    additive: true,
    map: atlas,
  });
  const smoke = createSpriteLayer({
    capacity: byTier([96, 260, 480, 640]),
    additive: false,
    map: atlas,
  });
  scene.add(smoke.points, glow.points);

  // --- Свет вспышек: только на высоком качестве и только постоянные источники.
  // Новый источник в сцене пересобирает шейдеры всех материалов, поэтому свет
  // создаётся один раз и в покое горит с нулевой яркостью.
  const flashLights = Array.from({ length: tier >= 2 ? 1 : 0 }, () => {
    const light = new T.PointLight('#ffffff', 0, 9, 2);
    light.castShadow = false;
    scene.add(light);
    return { light, born: 0, peak: 0, life: 1 };
  });
  let clock = 0;
  const flashLight = (at: T.Vector3, color: T.Color, peak: number, life: number) => {
    if (!flashLights.length) return;
    // Занят — отдаём тот, что уже почти погас.
    let slot = flashLights[0];
    for (const f of flashLights) if (f.light.intensity < slot.light.intensity) slot = f;
    slot.light.position.copy(at);
    slot.light.color.copy(color);
    slot.born = clock;
    slot.peak = peak;
    slot.life = life;
    slot.light.intensity = peak;
  };

  // --- Кольца ударной волны: плоскость на земле с плиткой кольца из атласа.
  const ringGeo = atlasTileUv(new T.PlaneGeometry(1, 1), SPRITE_TILE.ring);
  const shockwaves: { mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>; born: number; life: number; size: number }[] = [];
  const shockwave = (at: T.Vector3, n: T.Vector3, color: T.Color, size: number, life: number) => {
    let ring = shockwaves.find((r) => !r.mesh.parent);
    if (!ring && shockwaves.length < MAX_SHOCKWAVES) {
      const mesh = new T.Mesh(
        ringGeo,
        new T.MeshBasicMaterial({
          map: atlas,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending,
          side: T.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        }),
      );
      mesh.userData.projectileCollision = 'ignore';
      mesh.userData.cameraCollision = 'ignore';
      mesh.raycast = () => {};
      const created = { mesh, born: 0, life: 1, size: 1 };
      shockwaves.push(created);
      ring = created;
    }
    // Все кольца заняты — забираем самое старое.
    ring ??= shockwaves.reduce((a, b) => (a.born < b.born ? a : b));
    ring.mesh.position.copy(at).addScaledVector(n, 0.04);
    ring.mesh.quaternion.setFromUnitVectors(normalUp, n);
    ring.mesh.material.color.copy(color);
    ring.mesh.scale.setScalar(0.01);
    ring.born = clock;
    ring.life = life;
    ring.size = size;
    scene.add(ring.mesh);
  };

  // --- Объёмные осколки. Материал освещается сценой и светится цветом частицы
  // (`uGlow`), поэтому конфетти на тёмной карте не проваливается в черноту, а
  // при вращении ловит свет и «мерцает».
  const pieceMaterials = createMaterialPool(() => {
    const material = new T.MeshStandardMaterial({
      side: T.DoubleSide,
      transparent: true,
      roughness: 0.45,
      metalness: 0.1,
    });
    const uGlow = { value: 0.25 };
    material.userData.glow = uGlow;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = uGlow;
      shader.fragmentShader =
        'uniform float uGlow;\n' +
        shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uGlow;',
        );
    };
    material.customProgramCacheKey = () => 'vfx-piece-glow';
    return material;
  });
  const retireBurst = (b: Particle) => {
    b.mesh.removeFromParent();
    // Geometry is shared (paintDropletGeo / partyGeometries / confettiGeo);
    // dispose() frees only this burst's instanceMatrix/instanceColor buffers.
    b.mesh.dispose();
    pieceMaterials.release(b.mesh.material as T.MeshStandardMaterial);
  };
  const partyGeometries = new Map([
    ...[...CONFETTI, ...FIREWORKS].map(
      (c) => [c.id, partyGeometry(c.id)] as [string, T.BufferGeometry],
    ),
    ['ribbon', partyGeometry('ribbon')],
    ['shard', partyGeometry('shard')],
  ]);
  /**
   * Вспышка объёмных частиц: `count` штук вылетают из `at` в конусе вокруг
   * `n` со скоростью `speed`. `colors` — палитра по кругу.
   */
  const pieces = (
    geo: T.BufferGeometry,
    count: number,
    at: T.Vector3,
    n: T.Vector3,
    now: number,
    {
      kind = 'flutter' as PieceKind,
      lifetime = 2,
      speed = [1.5, 3.5] as readonly [number, number],
      spread = 0.85,
      lift = 0,
      colors = PARTY as readonly string[],
      glow = 0.25,
      roughness = 0.45,
      metalness = 0.1,
      size = [0.8, 1.25] as readonly [number, number],
      floor = -Infinity,
    } = {},
  ) => {
    if (count <= 0) return;
    const material = pieceMaterials.acquire();
    material.opacity = 1;
    material.roughness = roughness;
    material.metalness = metalness;
    (material.userData.glow as { value: number }).value = glow;
    const mesh = new T.InstancedMesh(geo, material, count);
    mesh.userData.projectileCollision = 'ignore';
    mesh.frustumCulled = false;
    const velocity: T.Vector3[] = [],
      positions: T.Vector3[] = [],
      rotations: T.Euler[] = [],
      sizes = new Float32Array(count);
    tangents(n);
    for (let i = 0; i < count; i++) {
      const dir = cone(v1, n, spread);
      const v = dir.multiplyScalar(rand(speed[0], speed[1]));
      v.y += lift;
      velocity.push(v.clone());
      positions.push(at.clone());
      const a = Math.random() * Math.PI * 2;
      rotations.push(new T.Euler(a, a * 0.7, a * 1.3));
      sizes[i] = rand(size[0], size[1]);
      mesh.setColorAt(i, c1.set(colors[i % colors.length]));
      dummy.position.copy(at);
      dummy.rotation.copy(rotations[i]);
      dummy.scale.setScalar(0.001);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.userData.transientProjectile = true;
    scene.add(mesh);
    bursts.push({ mesh, velocity, positions, rotations, sizes, born: now, lifetime, kind, floor });
    // В перестрелке десяти стрелков вспышки идут непрерывно: без потолка
    // на экране копятся тысячи частиц, они закрывают бой и роняют FPS.
    while (bursts.length > MAX_LIVE_BURSTS) {
      const oldest = bursts.shift();
      if (!oldest) break;
      retireBurst(oldest);
    }
  };
  /** Пол под точкой: если эффект пришёлся на пол, осколки на нём и останавливаются. */
  const floorUnder = (at: T.Vector3, n: T.Vector3) => (n.y > 0.6 ? at.y + 0.015 : -Infinity);

  // --- Рецепты эффектов.
  /** Искры: горячие штрихи, остывающие до цвета палитры. */
  const sparks = (
    at: T.Vector3,
    n: T.Vector3,
    count: number,
    colors: readonly string[],
    {
      speed = [5, 10] as readonly [number, number],
      spread = 1,
      life = [0.4, 0.8] as readonly [number, number],
      size = 0.05,
      gravity = 9.8,
      drag = 1.2,
      intensity = 2,
      stretch = 1.2,
      flags = SPRITE_HOT,
      delay = 0,
    } = {},
  ) => {
    tangents(n);
    for (let i = 0; i < count; i++) {
      const v = cone(v1, n, spread).multiplyScalar(rand(speed[0], speed[1]));
      c1.set(colors[i % colors.length]).multiplyScalar(intensity);
      glow.emit(at, v.x, v.y, v.z, c1, 1, size, size * 0.6, rand(life[0], life[1]), SPRITE_TILE.glow, drag, gravity, stretch, flags, delay ? rand(0, delay) : 0);
    }
  };
  /** Клубы дыма или цветной пыли. */
  const puffs = (
    at: T.Vector3,
    n: T.Vector3,
    count: number,
    color: T.Color,
    {
      speed = [1, 2.5] as readonly [number, number],
      spread = 1,
      size = [0.5, 2] as readonly [number, number],
      life = [1.2, 2] as readonly [number, number],
      alpha = 0.7,
      rise = 0.25,
      drag = 2.4,
      jitter = 0.25,
      tint = 0.25,
    } = {},
  ) => {
    const tone = c3.copy(color);
    // Дым не светится сам: на тёмной карте он темнее, как освещённый ею.
    const light = ambient();
    tangents(n);
    for (let i = 0; i < count; i++) {
      const v = cone(v1, n, spread).multiplyScalar(rand(speed[0], speed[1]));
      v2.set(rand(-jitter, jitter), rand(-jitter, jitter), rand(-jitter, jitter)).add(at);
      // Каждый клуб чуть светлее или темнее соседа: облако не выглядит одной кляксой.
      c2.copy(tone).lerp(white, rand(0, tint)).multiplyScalar(rand(0.82, 1.05) * light);
      const s = rand(0.8, 1.2);
      smoke.emit(v2, v.x, v.y, v.z, c2, alpha, size[0] * s, size[1] * s, rand(life[0], life[1]), SPRITE_TILE.smoke, drag, -rise, 0, SPRITE_SMOKE);
    }
  };
  /**
   * Примерная освещённость сцены по её источникам верхнего уровня — для дыма,
   * который рисуется без освещения. Считается раз в полсекунды, дёшево.
   */
  let ambientLevel = 1,
    ambientAt = -1;
  const ambient = () => {
    if (ambientAt >= 0 && clock - ambientAt < 0.5) return ambientLevel;
    ambientAt = clock;
    let sum = 0;
    for (const o of scene.children) {
      if (o instanceof T.HemisphereLight || o instanceof T.AmbientLight) sum += o.intensity;
      else if (o instanceof T.DirectionalLight) sum += o.intensity * 0.5;
    }
    ambientLevel = T.MathUtils.clamp(sum / 2.2, 0.22, 1);
    return ambientLevel;
  };
  /** Одиночная вспышка: свечение или звезда. */
  const flash = (at: T.Vector3, color: T.Color, size0: number, size1: number, life: number, tile: number = SPRITE_TILE.glow, flags = 0, alpha = 1) =>
    glow.emit(at, 0, 0, 0, color, alpha, size0, size1, life, tile, 0, 0, 0, flags);

  /** Шарик краски разбился: капли летят от поверхности, облачко брызг, короткий блик. */
  const paintHit = (at: T.Vector3, color: string, now: number, normal?: T.Vector3) => {
    const nn = (normal && normal.lengthSq() > 1e-6 ? normal : worldUp).clone().normalize();
    const base = at.clone().addScaledVector(nn, 0.04);
    vivid(c1, color);
    flash(base, c2.copy(c1).multiplyScalar(1.6), 0.25, 0.5, 0.1);
    pieces(paintDropletGeo, byTier([5, 8, 12, 14]), base, nn, now, {
      kind: 'drop',
      lifetime: 0.8,
      speed: [1.4, 3.6],
      spread: 0.8,
      lift: 0.8,
      colors: [color],
      glow: 0.3,
      roughness: 0.12,
      size: [0.5, 1.15],
      floor: floorUnder(at, nn),
    });
    puffs(base, nn, byTier([1, 2, 3, 4]), vivid(c1, color), {
      speed: [0.5, 1.2],
      spread: 0.7,
      size: [0.12, 0.55],
      life: [0.35, 0.55],
      alpha: 0.45,
      rise: 0,
      drag: 4,
      jitter: 0.05,
      tint: 0.4,
    });
  };

  /** Хлопок конфетти: вспышка, кольцо, кружащиеся блестящие бумажки. */
  const pop = (at: T.Vector3, color: string, now: number, style: string, normal?: T.Vector3) => {
    const hearts = style === 'hearts';
    const n = (normal && normal.lengthSq() > 1e-6 ? normal : worldUp).clone().normalize();
    // Конфетти вылетает скорее вверх, чем в стену: смешиваем нормаль с «вверх».
    n.lerp(worldUp, 0.5).normalize();
    vivid(c1, hearts ? '#ff4d6d' : color);
    flash(at, c2.setRGB(1.5, 1.35, 1.2), 0.4, 0.6, 0.08, SPRITE_TILE.star);
    flash(at, c2.copy(c1).multiplyScalar(1.3), 0.1, 0.75, 0.2, SPRITE_TILE.ring, 0, 0.8);
    const colors = hearts
      ? ['#ff3b64', '#ff8fab', '#ff5c8a', '#ffd1dc']
      : style === 'snow'
        ? ['#ffffff', '#d7f1ff', '#aee3ff']
        : style === 'digital'
          ? ['#5dffb0', '#b6ffe5', '#29c5ff']
          : [color, ...PARTY];
    // Сердечко «лайка» одно на выстрел, конфетти — по хлопку на каждую из восьми дробин.
    pieces(partyGeometries.get(style) || confettiGeo, byTier(hearts ? [8, 12, 16, 20] : [5, 8, 12, 14]), at, n, now, {
      kind: 'flutter',
      lifetime: 1.8,
      size: [1, 1.5],
      speed: [1.4, 3.2],
      spread: 0.9,
      colors,
      glow: style === 'snow' ? 0.5 : 0.28,
      metalness: 0.25,
      roughness: 0.35,
      floor: normal ? floorUnder(at, normal) : -Infinity,
    });
    sparks(at, n, byTier([1, 3, 5, 6]), hearts ? ['#ff8fab', '#ffffff'] : PARTY, {
      speed: [1.5, 3.5],
      life: [0.35, 0.6],
      size: 0.035,
      gravity: 2,
      drag: 3,
      flags: SPRITE_HOT | SPRITE_TWINKLE,
      stretch: 0.8,
    });
  };

  /** Салют из снайперки: белая вспышка, шар горячих искр, поздние блёстки. */
  const firework = (at: T.Vector3, color: string, now: number, variant: string) => {
    const colors = FIREWORK_COLORS[variant] ?? [color, '#ffffff', '#ffd166'];
    vivid(c1, colors[0]);
    flash(at, c2.setRGB(1.6, 1.5, 1.3), 1.2, 2.2, 0.18);
    flash(at, c2.copy(c1).multiplyScalar(1.4), 0.8, 3, 0.35);
    flash(at, c2.setRGB(2, 1.9, 1.7), 1.3, 1.8, 0.12, SPRITE_TILE.star);
    flashLight(at, c1, 16, 0.4);
    const count = byTier([40, 80, 140, 180]);
    // Шар из искр: направления по сфере Фибоначчи — ровно, без пустот и сгустков.
    for (let i = 0; i < count; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / count),
        theta = Math.PI * (1 + 5 ** 0.5) * i;
      const spd = rand(6.5, 8.5);
      c1.set(colors[i % colors.length]).multiplyScalar(1.7);
      glow.emit(
        at,
        Math.sin(phi) * Math.cos(theta) * spd,
        Math.cos(phi) * spd + 0.6,
        Math.sin(phi) * Math.sin(theta) * spd,
        c1,
        1,
        0.1,
        0.06,
        rand(1.1, 1.6),
        SPRITE_TILE.glow,
        2,
        1.4,
        1.3,
        SPRITE_HOT | SPRITE_TWINKLE,
      );
    }
    // Поздние блёстки: вспыхивают там, куда долетел шар, и гаснут.
    const glitter = byTier([0, 20, 40, 60]);
    for (let i = 0; i < glitter; i++) {
      v1.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.2, 2.8)).add(at);
      c1.set(i % 2 ? '#ffe9a8' : colors[1]).multiplyScalar(2.5);
      glow.emit(v1, 0, -0.4, 0, c1, 1, 0.06, 0.02, rand(0.35, 0.6), SPRITE_TILE.star, 0, 0.6, 0, SPRITE_TWINKLE, rand(0.45, 0.9));
    }
    pieces(partyGeometries.get(fireworkParty(variant)) || confettiGeo, byTier([6, 10, 14, 18]), at, worldUp, now, {
      kind: 'flutter',
      lifetime: 2.2,
      speed: [2, 4.5],
      spread: 1,
      colors,
      glow: 0.9,
      metalness: 0.3,
      roughness: 0.3,
    });
    puffs(at, worldUp, byTier([0, 1, 2, 3]), c1.setRGB(0.55, 0.55, 0.6), {
      speed: [0.2, 0.6],
      size: [1, 2.6],
      life: [1.6, 2.4],
      alpha: 0.25,
      rise: 0.1,
      jitter: 0.6,
    });
  };

  /** Взрыв праздничной гранаты: вспышка, свет, огненное ядро, клубы цвета, волна, искры, конфетти. */
  const explosion = (at: T.Vector3, color: string, now: number, variant: string, normal?: T.Vector3) => {
    const n = (normal && normal.lengthSq() > 1e-6 ? normal : worldUp).clone().normalize();
    const base = at.clone().addScaledVector(n, 0.12);
    const floor = floorUnder(at, n);
    const tone = GRENADES.find((g) => g.id === variant)?.color ?? color;
    const hue = vivid(new T.Color(), variant === 'snowglobe' ? '#8fd8ff' : tone);
    const accents: Record<string, string[]> = {
      pinata: [tone, '#ffc93c', '#29c5ff', '#7dff6b', '#ff3d7f'],
      paintburst: ['#29c5ff', '#ff3d7f', '#ffc93c', '#7dff6b', '#b36bff'],
      snowglobe: ['#ffffff', '#d7f1ff', '#8fd8ff'],
      heartburst: ['#ff3b64', '#ff8fab', '#ffffff', '#ff5c8a'],
      pixel: ['#5dffb0', '#29c5ff', '#b6ffe5', '#ffffff'],
      meteor: ['#ffb851', '#ff6a2e', '#ffe29b', '#ffffff'],
    };
    const colors = accents[variant] ?? [tone, ...PARTY];
    // Вспышка: белое ядро, звезда и цветной ореол — первые 150 мс.
    flash(base, c1.setRGB(1.5, 1.35, 1.1), 0.9, 2.6, 0.16);
    flash(base, c1.setRGB(1.4, 1.25, 1), 1.2, 2, 0.1, SPRITE_TILE.star);
    flash(base, c1.copy(hue).multiplyScalar(1.4), 0.8, 3.2, 0.4);
    flashLight(base, c1.copy(hue).lerp(c2.setRGB(1, 0.85, 0.6), 0.5), 35, 0.35);
    // Огненное ядро: несколько горячих шаров цвета гранаты расходятся и гаснут.
    tangents(n);
    for (let i = 0, k = byTier([2, 3, 5, 6]); i < k; i++) {
      const v = cone(v1, n, 1).multiplyScalar(rand(1, 2.5));
      c1.copy(hue).multiplyScalar(rand(1.6, 2.4));
      glow.emit(base, v.x, v.y, v.z, c1, 0.9, 0.5, rand(1.4, 2.2), rand(0.3, 0.45), SPRITE_TILE.glow, 3, 0);
    }
    shockwave(at, n, c1.copy(hue).multiplyScalar(1.1), variant === 'meteor' ? 4.8 : 4, 0.45);
    // Клубы: цвет гранаты, белёсые, у метеора — тёмная гарь.
    const smokeTone = variant === 'meteor' ? c2.set('#6b5a50') : variant === 'snowglobe' ? c2.set('#eef8ff') : c2.copy(hue).lerp(c1.setRGB(1, 1, 1), 0.3);
    puffs(v2.copy(base).addScaledVector(n, 0.3).clone(), n, byTier([5, 8, 12, 16]), smokeTone, {
      speed: [1.8, 4.2],
      spread: 1,
      size: [0.8, 3],
      life: [1.3, 2.2],
      alpha: 0.78,
      rise: 0.35,
      jitter: 0.3,
      tint: variant === 'meteor' ? 0.1 : 0.45,
    });
    sparks(base, n, Math.round(byTier([10, 22, 36, 48]) * (variant === 'meteor' ? 1.5 : 1)), variant === 'meteor' ? accents.meteor : ['#ffd166', '#ffffff', ...colors], {
      speed: [6, 13],
      life: [0.45, 0.85],
      size: 0.05,
      stretch: 1.3,
    });
    if (variant === 'snowglobe')
      sparks(base, n, byTier([10, 20, 30, 40]), accents.snowglobe, {
        speed: [1.5, 4],
        life: [1.6, 2.4],
        size: 0.045,
        gravity: 0.35,
        drag: 2.2,
        intensity: 1.3,
        stretch: 0,
        flags: SPRITE_TWINKLE,
      });
    pieces(partyGeometries.get('shard')!, byTier([6, 10, 14, 18]), base, n, now, {
      kind: 'debris',
      lifetime: 1.6,
      speed: [3.5, 7.5],
      spread: 1,
      lift: 1.5,
      colors,
      glow: 0.55,
      metalness: 0.4,
      roughness: 0.3,
      size: [0.35, 0.8],
      floor,
    });
    pieces(partyGeometries.get(grenadeParty(variant)) || confettiGeo, byTier([8, 14, 22, 28]), base, n, now, {
      kind: 'flutter',
      lifetime: 2.6,
      speed: [2.5, 5.5],
      spread: 1,
      lift: 1.2,
      colors,
      glow: variant === 'snowglobe' ? 0.5 : 0.3,
      metalness: 0.25,
      roughness: 0.35,
      floor,
    });
    pieces(partyGeometries.get('ribbon')!, byTier([3, 6, 9, 12]), base, n, now, {
      kind: 'flutter',
      lifetime: 2.6,
      speed: [2.5, 5],
      spread: 1,
      lift: 1.5,
      colors: ['#ffd166', ...colors],
      glow: 0.3,
      metalness: 0.5,
      roughness: 0.3,
      floor,
    });
    if (variant === 'paintburst')
      pieces(paintDropletGeo, byTier([10, 16, 24, 30]), base, n, now, {
        kind: 'drop',
        lifetime: 1,
        speed: [3, 7],
        spread: 1,
        lift: 1.5,
        colors: accents.paintburst,
        glow: 0.3,
        roughness: 0.12,
        size: [1, 2],
        floor,
      });
  };

  /**
   * Вспышка у ствола: звезда и ядро на 60–90 мс, конус горячих штрихов вперёд
   * и облачко цветного тумана. У снайперки крупнее и с дымком.
   */
  const muzzleFlash = (at: T.Vector3, dir: T.Vector3, color: string, _now: number, kind: string) => {
    if (kind === 'grenade') return;
    const sniper = kind === 'sniper',
      like = kind === 'like',
      shotgun = kind === 'confetti';
    let scale = sniper ? 1.9 : shotgun ? 1.3 : 1,
      flags = 0;
    if (camera) {
      const d = at.distanceTo(camera.position);
      // Выстрел из-за стены (ствол спрятан в камере): вспышка была бы во весь экран.
      if (d < 0.3) return;
      // Свой ствол у самых глаз: вспышка меньше и не гаснет как «частица у лица».
      if (d < 1.6) {
        flags = SPRITE_NO_NEAR_FADE;
        scale *= 0.6;
      }
    }
    const f = v2.copy(dir).normalize().clone();
    const tip = at.clone().addScaledVector(f, 0.05 * scale);
    vivid(c1, like ? '#ff4d6d' : color);
    const warm = c2.setRGB(2, 1.7, 1.25).lerp(c1, like ? 0.7 : 0.25);
    flash(tip, warm, 0.3 * scale, 0.42 * scale, sniper ? 0.09 : 0.065, SPRITE_TILE.star, flags);
    flash(tip, c2.copy(c1).multiplyScalar(1.8), 0.2 * scale, 0.3 * scale, 0.06, SPRITE_TILE.glow, flags);
    tangents(f);
    for (let i = 0, k = byTier([2, 3, 4, 5]) * (sniper ? 2 : 1); i < k; i++) {
      const v = cone(v1, f, 0.22).multiplyScalar(rand(7, 12));
      c2.setRGB(2, 1.6, 1.1);
      glow.emit(tip, v.x, v.y, v.z, c2, 1, 0.03 * scale, 0.02 * scale, rand(0.05, 0.09), SPRITE_TILE.glow, 6, 0, 1.4, SPRITE_HOT | flags);
    }
    if (shotgun)
      sparks(tip, f, byTier([0, 2, 4, 6]), PARTY, {
        speed: [3, 5.5],
        spread: 0.35,
        life: [0.25, 0.45],
        size: 0.025,
        gravity: 2,
        drag: 4,
        stretch: 0.6,
        flags: SPRITE_HOT | SPRITE_TWINKLE,
      });
    for (let i = 0, k = byTier([1, 1, 2, 3]) + (sniper ? 2 : 0); i < k; i++) {
      const v = cone(v1, f, 0.4).multiplyScalar(rand(0.8, 2));
      vivid(c2, like ? '#ff4d6d' : color).lerp(white, sniper ? 0.6 : 0.35).multiplyScalar(ambient());
      smoke.emit(tip, v.x, v.y, v.z, c2, sniper ? 0.4 : 0.32, 0.05 * scale, (sniper ? 0.45 : 0.28) * scale, rand(0.3, sniper ? 0.9 : 0.45), SPRITE_TILE.smoke, 3, -0.2, 0, SPRITE_SMOKE | flags);
    }
  };

  /**
   * След снаряда за кадр: от `from` до `to`. Ракета салюта оставляет искры и
   * дымную нить, у гранаты искрит запал.
   */
  const trail = (from: T.Vector3, to: T.Vector3, color: string, _now: number, kind: string) => {
    if (kind === 'sniper') {
      const length = from.distanceTo(to);
      const step = byTier([0.9, 0.45, 0.3, 0.22]);
      const count = Math.min(byTier([6, 14, 24, 32]), Math.ceil(length / step));
      vivid(c1, color);
      for (let i = 0; i < count; i++) {
        v2.lerpVectors(from, to, (i + Math.random()) / count);
        c2.copy(c1).lerp(warmSpark, 0.5).multiplyScalar(2.2);
        glow.emit(v2, rand(-0.6, 0.6), rand(-0.4, 0.6), rand(-0.6, 0.6), c2, 1, 0.045, 0.02, rand(0.25, 0.5), SPRITE_TILE.glow, 1.5, 2.5, 0, SPRITE_HOT | SPRITE_TWINKLE);
        if (tier >= 1 && i % 2 === 0) {
          c2.setRGB(0.85, 0.85, 0.9).lerp(c1, 0.2).multiplyScalar(ambient());
          smoke.emit(v2, rand(-0.15, 0.15), rand(0, 0.2), rand(-0.15, 0.15), c2, 0.28, 0.08, rand(0.35, 0.55), rand(0.7, 1.1), SPRITE_TILE.smoke, 1.5, -0.15, 0, SPRITE_SMOKE);
        }
      }
    } else if (kind === 'grenade') {
      for (let i = 0, k = byTier([0, 1, 1, 2]); i < k; i++) {
        c2.setRGB(2, 1.5, 0.8);
        glow.emit(to, rand(-1.4, 1.4), rand(0, 1.6), rand(-1.4, 1.4), c2, 1, 0.03, 0.01, rand(0.2, 0.35), SPRITE_TILE.glow, 2, 5, 0.8, SPRITE_HOT);
      }
    }
  };

  /**
   * Эффект в точке. `style` — вид частиц: 'paint' (клякса разбилась), вид
   * конфетти, 'hearts', а также 'grenade:<вид>', 'firework:<вид>',
   * 'pop:<вид конфетти>'. `normal` — нормаль поверхности: от неё летят капли
   * и под ней лежит пол, на который оседают конфетти.
   */
  const burst = (
    at: T.Vector3,
    color: string,
    now: number,
    style = 'classic',
    normal?: T.Vector3,
  ) => {
    if (style === 'paint') return paintHit(at, color, now, normal);
    if (style.startsWith('grenade:')) return explosion(at, color, now, style.slice(8), normal);
    if (style.startsWith('firework:')) return firework(at, color, now, style.slice(9));
    if (FIREWORKS.some((f) => f.id === style)) return firework(at, color, now, style);
    if (style.startsWith('pop:')) return pop(at, color, now, style.slice(4), normal);
    if (style === 'shard' || style === 'ribbon') {
      pieces(partyGeometries.get(style)!, byTier([6, 10, 14, 18]), at, worldUp, now, {
        kind: style === 'shard' ? 'debris' : 'flutter',
        lifetime: 2,
        speed: [2.5, 5],
        colors: [color, ...PARTY],
        glow: 0.35,
      });
      return;
    }
    pop(at, color, now, style, normal);
  };

  // --- Кляксы на стенах: четыре формы в атласе, рельеф свежей краски.
  const splatGeometries = [0, 1, 2, 3].map((i) => atlasTileUv(new T.PlaneGeometry(1, 1), i));
  let splatTextures: ReturnType<typeof splatAtlas> | null = null;
  const splatMaterials = createMaterialPool(() => {
    splatTextures ??= splatAtlas();
    return new T.MeshStandardMaterial({
      map: splatTextures.map,
      bumpMap: splatTextures.bump,
      bumpScale: 3,
      transparent: true,
      side: T.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      roughness: 0.22,
      metalness: 0,
    });
  });
  let stainTexture: T.Texture | null = null;
  // Краска на теле освещается как само тело: влажный блеск, а не плоская наклейка.
  const bodyPaintMaterials = createMaterialPool(
    () =>
      new T.MeshStandardMaterial({
        map: (stainTexture ??= paintStainTexture()),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        roughness: 0.32,
        metalness: 0,
      }),
  );
  const retireSplat = (p: (typeof splats)[number]) => {
    p.mesh.removeFromParent();
    // Геометрия клякс общая (splatGeometries), у пятен на теле — своя.
    if (!p.mesh.userData.sharedGeometry) p.mesh.geometry.dispose();
    const material = p.mesh.material as T.MeshStandardMaterial;
    if (p.mesh.userData.paintStain) bodyPaintMaterials.release(material);
    else splatMaterials.release(material);
  };
  const splat = (
    at: T.Vector3,
    normal: T.Vector3,
    color: string,
    now: number,
    parent: T.Object3D = scene,
    scale = 1,
    /**
     * `at` уже задано в координатах родителя.
     *
     * Ветка ниже писалась под кляксы на бойце: туда приходит мировая точка
     * попадания, её переводят в координаты аватара и прижимают по высоте к
     * корпусу. Брызгам на своём экране этот перевод не нужен и вреден — они и
     * так заданы относительно камеры, а «прижать к корпусу» уносило их в
     * произвольное место, вплоть до середины прицела.
     */
    inParentSpace = false,
  ) => {
    const material = splatMaterials.acquire();
    material.color.set(color);
    // Лёгкое свечение своим цветом: на тёмной карте клякса не превращается в дыру.
    material.emissive.copy(material.color).multiplyScalar(0.12);
    material.opacity = 0.9;
    const decal = new T.Mesh(pick(splatGeometries), material);
    decal.userData.projectileCollision = 'ignore';
    decal.userData.sharedGeometry = true;
    const size = 1.1 * scale * rand(0.85, 1.2);
    decal.userData.size = size;
    decal.scale.setScalar(size * 0.55);

    if (inParentSpace) {
      decal.position.copy(at);
      decal.quaternion.setFromUnitVectors(
        normalUp,
        normal.clone().normalize(),
      );
    } else if (parent !== scene) {
      parent.updateMatrixWorld(true);
      const localPos = parent.worldToLocal(at.clone());
      localPos.y = Math.max(0.35, Math.min(1.65, localPos.y));
      const localNorm = new T.Vector3(localPos.x, 0, localPos.z).normalize();
      if (localNorm.lengthSq() < 0.05) localNorm.set(0, 0, 1);
      decal.position.copy(localPos).addScaledVector(localNorm, 0.04);
      decal.quaternion.setFromUnitVectors(normalUp, localNorm);
    } else {
      // Вплотную к стене: отступ только против мерцания, остальное делает polygonOffset.
      decal.position.copy(at).addScaledVector(normal, 0.012);
      decal.quaternion.setFromUnitVectors(normalUp, normal.normalize());
    }
    // Случайный поворот вокруг нормали: одинаковые кляксы в ряд выдают штамп.
    decal.rotateZ(Math.random() * Math.PI * 2);
    parent.add(decal);
    splats.push({ mesh: decal, born: now, owner: parent, life: 12 });
  };
  /**
   * Треугольники кожи со скелетом вокруг точки — в текущей позе и мировых
   * координатах, как сетка для DecalGeometry; и кость с наибольшим весом у
   * ближайшей вершины: к ней пятно и крепится.
   */
  const posedNear = (mesh: T.SkinnedMesh, at: T.Vector3, size: number) => {
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    const count = position.count;
    const posed = new Float32Array(count * 3);
    const v = new T.Vector3();
    const near = size * 1.2;
    let closest = -1,
      best = Infinity;
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      posed[i * 3] = v.x;
      posed[i * 3 + 1] = v.y;
      posed[i * 3 + 2] = v.z;
      const d = v.distanceToSquared(at);
      if (d < best) {
        best = d;
        closest = i;
      }
    }
    // Вершины общие, как у самого тела: нормали сглажены, и пятно не выглядит гранёным.
    const out: number[] = [];
    const faces: number[] = [];
    const remap = new Map<number, number>();
    const vertex = (k: number) => {
      let n = remap.get(k);
      if (n === undefined) {
        n = remap.size;
        remap.set(k, n);
        out.push(posed[k * 3], posed[k * 3 + 1], posed[k * 3 + 2]);
      }
      return n;
    };
    const tris = index ? index.count : count;
    const idx = (k: number) => (index ? index.getX(k) : k);
    const n2 = near * near;
    for (let t = 0; t < tris; t += 3) {
      const a = idx(t),
        b = idx(t + 1),
        c = idx(t + 2);
      const inside = [a, b, c].some((k) => {
        const dx = posed[k * 3] - at.x,
          dy = posed[k * 3 + 1] - at.y,
          dz = posed[k * 3 + 2] - at.z;
        return dx * dx + dy * dy + dz * dz < n2;
      });
      if (!inside) continue;
      faces.push(vertex(a), vertex(b), vertex(c));
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(out, 3));
    geometry.setIndex(faces);
    geometry.computeVertexNormals();
    let bone = mesh.skeleton.bones[0];
    if (closest >= 0 && skinIndex && skinWeight) {
      let top = -1;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(closest, k);
        if (w > top) {
          top = w;
          bone = mesh.skeleton.bones[skinIndex.getComponent(closest, k)] ?? bone;
        }
      }
    }
    return { proxy: { geometry, matrixWorld: new T.Matrix4() }, bone };
  };
  const raycaster = new T.Raycaster();
  const bodyParts: T.Mesh[] = [];
  const projector = new T.Object3D();
  /** Видна ли часть тела: невидимый предок (первое лицо, скрытый призрак) прячет и её. */
  const shown = (o: T.Object3D, owner: T.Object3D) => {
    for (let q: T.Object3D | null = o; q; q = q.parent) {
      if (!q.visible || q.userData.presentationOnly) return false;
      if (q === owner) return true;
    }
    return false;
  };
  /**
   * Пятно краски прямо на теле бойца. Луч идёт от `from` к `toward`; там, где он
   * встретил часть тела, на её поверхность проецируется пятно (DecalGeometry) и
   * становится дочерним у этой части — клякса облегает форму, двигается с рукой
   * или головой и падает вместе с телом. Тело дальше `reach` от точки попадания
   * `impact` не красим: краска не ляжет туда, куда шарик не долетал.
   */
  const paintBody = (
    owner: T.Object3D,
    from: T.Vector3,
    toward: T.Vector3,
    impact: T.Vector3,
    color: string,
    now: number,
    size: number,
    reach: number,
  ) => {
    if (!owner.visible) return false;
    owner.updateMatrixWorld(true);
    bodyParts.length = 0;
    owner.traverse((o) => {
      if (
        o instanceof T.Mesh &&
        !(o instanceof T.InstancedMesh) &&
        !o.userData.paintStain &&
        o.geometry.getAttribute('position') &&
        // Невидимый материал — мишень для попаданий (упрощённое тело человека), а не кожа.
        (o.material as T.Material).visible !== false &&
        shown(o, owner)
      )
        bodyParts.push(o);
    });
    const direction = toward.clone().sub(from);
    const distance = direction.length();
    if (!bodyParts.length || distance < 1e-4) return false;
    raycaster.set(from, direction.divideScalar(distance));
    raycaster.far = distance + reach;
    const hit = raycaster.intersectObjects(bodyParts, false)[0];
    if (!hit || !hit.face || hit.point.distanceTo(impact) > reach) return false;
    const part = hit.object as T.Mesh;
    const normal = hit.face.normal.clone().transformDirection(part.matrixWorld);
    // Проектор смотрит в поверхность; «верх» пятна — вверх по миру, так потёк
    // стекает вниз. Небольшой случайный поворот, чтобы пятна не были одинаковыми.
    projector.position.copy(hit.point);
    projector.up.set(0, 1, 0);
    if (Math.abs(normal.y) > 0.95) projector.up.set(0, 0, 1);
    projector.lookAt(hit.point.clone().add(normal));
    projector.rotateZ((Math.random() - 0.5) * 0.5);
    // Кожа со скелетом (боец-человек): DecalGeometry не знает про кости и
    // проецировала бы пятно на позу покоя. Даём ей тело в текущей позе и
    // вешаем пятно на кость, ближе всех к месту попадания.
    const skinned = part instanceof T.SkinnedMesh ? posedNear(part, hit.point, size) : null;
    const geometry = new DecalGeometry(
      (skinned?.proxy ?? part) as T.Mesh,
      hit.point,
      projector.rotation,
      new T.Vector3(size, size, BODY_PAINT_DEPTH),
    );
    skinned?.proxy.geometry.dispose();
    if (!geometry.getAttribute('position')?.count) {
      geometry.dispose();
      return false;
    }
    // DecalGeometry отдаёт мировые координаты; пятно живёт в координатах части тела (или кости).
    const holder: T.Object3D = skinned?.bone ?? part;
    holder.updateMatrixWorld(true);
    geometry.applyMatrix4(holder.matrixWorld.clone().invert());
    const material = bodyPaintMaterials.acquire();
    material.color.set(color);
    material.opacity = 0.95;
    const stain = new T.Mesh(geometry, material);
    stain.userData.paintStain = true;
    stain.userData.projectileCollision = 'ignore';
    // Общая чистка аватара (world-remote-players.ts) пятна не трогает: их
    // материалы — из пула, освобождает их retireSplat.
    stain.userData.presentationOnly = true;
    stain.castShadow = false;
    holder.add(stain);
    splats.push({ mesh: stain, born: now, owner, life: BODY_PAINT_SECONDS });
    let count = 0;
    for (let i = splats.length - 1; i >= 0; i--) {
      if (splats[i].owner !== owner || !splats[i].mesh.userData.paintStain) continue;
      if (++count > BODY_PAINT_LIMIT) {
        retireSplat(splats[i]);
        splats.splice(i, 1);
      }
    }
    return true;
  };
  /**
   * Попадание краской по бойцу: пятно на том месте тела, куда пришёлся шарик
   * (луч от `from` через точку прицела `toward`), и брызги. Если по пути к точке
   * прицела тела не оказалось — например, боец успел сдвинуться, — ищем его
   * поверхность не дальше `near` от точки, со стороны центра тела. Возвращает,
   * прилипла ли краска: если нет, пусть ляжет на стену позади.
   */
  const smearPlayerWithPaint = (
    playerGroup: T.Object3D,
    from: T.Vector3,
    toward: T.Vector3,
    color: string,
    now: number,
    size = 0.3,
    near = 0.35,
  ) => {
    playerGroup.updateMatrixWorld(true);
    const center = new T.Vector3(0, 0.95, 0).applyMatrix4(playerGroup.matrixWorld);
    const stuck =
      paintBody(playerGroup, from, toward, toward, color, now, size, 0.45) ||
      paintBody(playerGroup, toward, center, toward, color, now, size, near);
    // Брызги летят обратно к стрелку; у взрыва (from = toward) — от центра тела.
    const away = from.distanceToSquared(toward) > 1e-4 ? from.clone().sub(toward) : toward.clone().sub(center);
    burst(toward, color, now, 'paint', away.normalize());
    return stuck;
  };
  /** Смыть краску с бойца (или с экрана): пятна не переживают смерть. */
  const clearPaint = (owner: T.Object3D) => {
    for (let i = splats.length - 1; i >= 0; i--) {
      if (splats[i].owner !== owner) continue;
      retireSplat(splats[i]);
      splats.splice(i, 1);
    }
  };
  const flutterDrag = (dt: number) => Math.max(0, 1 - 0.75 * dt);
  const update = (now: number, dt: number) => {
    // После свёрнутой вкладки dt бывает в секунды: частицы не должны улетать за карту.
    const step = Math.min(dt, 0.1);
    clock += step;
    for (let i = splats.length - 1; i >= 0; i--) {
      const p = splats[i],
        age = (now - p.born) / 1000;
      (p.mesh.material as T.MeshStandardMaterial).opacity =
        (p.mesh.userData.paintStain ? 0.95 : 0.9) * Math.min(1, (p.life - age) / 3);
      // Клякса «растекается» первые 80 мс: удар читается, а не появляется наклейка.
      const size = p.mesh.userData.size as number | undefined;
      if (size) p.mesh.scale.setScalar(size * (age >= 0.08 ? 1 : 0.55 + (Math.max(0, age) / 0.08) * 0.45));
      // Боец ушёл из комнаты — его аватара уже нет в сцене, и пятна с ним.
      if (age >= p.life || (p.mesh.userData.paintStain && !p.owner.parent)) {
        retireSplat(p);
        splats.splice(i, 1);
      }
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i],
        age = (now - b.born) / 1000,
        maxAge = b.lifetime || 4,
        t = Math.min(1, Math.max(0, age / maxAge));
      for (let j = 0; j < b.positions.length; j++) {
        const v = b.velocity[j],
          p = b.positions[j];
        if (b.kind === 'flutter') {
          const drag = flutterDrag(step);
          v.x *= drag;
          v.z *= drag;
          if (v.y > -1.8) v.y -= 2.6 * step;
          else v.y = T.MathUtils.lerp(v.y, -1.8, 2.5 * step);
          // Бумажка парит: снос по синусу, и чем медленнее падает, тем сильнее.
          const flutter = Math.sin(age * 5.5 + j * 1.7) * 0.45;
          const swirl = Math.cos(age * 4.2 + j * 2.1) * 0.35;
          p.x += (v.x + flutter) * step;
          p.y += v.y * step;
          p.z += (v.z + swirl) * step;
        } else {
          const drag = Math.max(0, 1 - (b.kind === 'drop' ? 0.4 : 0.9) * step);
          v.x *= drag;
          v.z *= drag;
          v.y = v.y * drag - 9.8 * step;
          p.addScaledVector(v, step);
        }
        const grounded = p.y <= b.floor;
        if (grounded) {
          // Легло на пол: лежит плашмя и больше не кружится.
          p.y = b.floor;
          v.set(0, 0, 0);
        } else {
          b.rotations[j].x += step * (3.8 + (j % 4) * 0.9);
          b.rotations[j].y += step * (2.4 + (j % 3) * 0.7);
          b.rotations[j].z += step * ((j % 2 ? 3.2 : -3.2) + (j % 5) * 0.4);
        }
        dummy.position.copy(p);
        // Частица размером 10 см в 20 см от глаза закрывает пол-экрана: то, что
        // подлетело вплотную к камере, схлопываем, а рядом плавно уменьшаем.
        const s = nearCameraScale(p) * b.sizes[j];
        if (b.kind === 'drop') {
          // Капля вытянута по скорости и тает к концу жизни.
          const speed = v.length();
          if (speed > 1e-3) dummy.quaternion.setFromUnitVectors(normalUp, v1.copy(v).divideScalar(speed));
          const k = s * (1 - t * t);
          dummy.scale.set(k, k, k * (1 + Math.min(2.2, speed * 0.28)));
        } else {
          if (grounded) b.rotations[j].x = -Math.PI / 2;
          dummy.rotation.copy(b.rotations[j]);
          // Появляется не точкой, а за первые 50 мс: без мигания в центре вспышки.
          dummy.scale.setScalar(s * Math.min(1, Math.max(0, age) / 0.05 + 0.2));
        }
        dummy.updateMatrix();
        b.mesh.setMatrixAt(j, dummy.matrix);
      }
      b.mesh.instanceMatrix.needsUpdate = true;
      (b.mesh.material as T.MeshStandardMaterial).opacity = Math.min(
        1,
        (maxAge - age) / (maxAge * 0.35),
      );
      if (age > maxAge) {
        retireBurst(b);
        bursts.splice(i, 1);
      }
    }
    glow.update(step);
    smoke.update(step);
    for (const f of flashLights) {
      const t = (clock - f.born) / f.life;
      f.light.intensity = t >= 1 ? 0 : f.peak * (1 - t) * (1 - t);
    }
    for (const r of shockwaves) {
      if (!r.mesh.parent) continue;
      const t = (clock - r.born) / r.life;
      if (t >= 1) {
        r.mesh.removeFromParent();
        continue;
      }
      r.mesh.scale.setScalar(0.3 + r.size * (1 - (1 - t) ** 3));
      r.mesh.material.opacity = (1 - t) ** 1.5;
    }
  };
  const dispose = () => {
    // Живые вспышки уходят вместе с движком: их меши и буферы — свои у каждой.
    for (const b of bursts.splice(0)) retireBurst(b);
    paintDropletGeo.dispose();
    confettiGeo.dispose();
    partyGeometries.forEach((g) => g.dispose());
    splatGeometries.forEach((g) => g.dispose());
    ringGeo.dispose();
    pieceMaterials.dispose();
    splatMaterials.dispose();
    bodyPaintMaterials.dispose();
    stainTexture?.dispose();
    splatTextures?.map.dispose();
    splatTextures?.bump.dispose();
    glow.dispose();
    smoke.dispose();
    atlas.dispose();
    for (const f of flashLights) f.light.removeFromParent();
    for (const r of shockwaves) {
      r.mesh.removeFromParent();
      r.mesh.material.dispose();
    }
  };
  /** Сколько сейчас живёт частиц и чего: для тестов и отладки бюджета. */
  const stats = () => ({
    bursts: bursts.length,
    pieces: bursts.reduce((n, b) => n + b.positions.length, 0),
    glow: glow.count,
    smoke: smoke.count,
    capacity: glow.capacity + smoke.capacity,
    lights: flashLights.length,
    shockwaves: shockwaves.filter((r) => r.mesh.parent).length,
    splats: splats.length,
  });
  return {
    paintDropletGeo,
    burst,
    splat,
    smearPlayerWithPaint,
    clearPaint,
    muzzleFlash,
    trail,
    update,
    dispose,
    stats,
  };
}
