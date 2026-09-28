import * as T from 'three';

/**
 * Процедурные текстуры эффектов: рисуются на canvas при первом обращении, без
 * загрузки картинок. Все белые — цвет даёт частица или материал.
 *
 * Атлас спрайтов — 2×2 плитки по 128 пикселей (номера — `SPRITE_TILE`):
 * мягкое свечение, клуб дыма, звезда вспышки и кольцо. Один атлас на все
 * частицы: один материал, одна программа, один draw call на слой.
 */
export const SPRITE_TILE = { glow: 0, smoke: 1, star: 2, ring: 3 } as const;

/** Детерминированный генератор: одни и те же кляксы у всех игроков и между запусками. */
function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function texture(c: HTMLCanvasElement, srgb = true) {
  const t = new T.CanvasTexture(c);
  if (srgb) t.colorSpace = T.SRGBColorSpace;
  return t;
}

/** Плитка атласа: начало координат в центре плитки, `r` — половина её стороны. */
function tile(g: CanvasRenderingContext2D, index: number, size: number, draw: (r: number) => void) {
  g.save();
  g.translate((index % 2) * size + size / 2, Math.floor(index / 2) * size + size / 2);
  g.beginPath();
  g.rect(-size / 2, -size / 2, size, size);
  g.clip();
  draw(size / 2);
  g.restore();
}

function radial(g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, number][]) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

export function spriteAtlas() {
  const size = 128;
  const c = canvas(size * 2);
  const g = c.getContext('2d')!;
  // Свечение: яркое ядро и длинный мягкий хвост — так вспышка «светит», а не лежит кружком.
  tile(g, SPRITE_TILE.glow, size, (r) =>
    radial(g, 0, 0, r * 0.94, [
      [0, 1],
      [0.12, 0.85],
      [0.3, 0.38],
      [0.6, 0.1],
      [1, 0],
    ]),
  );
  // Дым: несколько мягких клубов внахлёст, сверху светлее — будто освещён сверху.
  tile(g, SPRITE_TILE.smoke, size, (r) => {
    const rnd = random(7);
    radial(g, 0, 0, r * 0.62, [
      [0, 0.55],
      [0.7, 0.3],
      [1, 0],
    ]);
    for (let i = 0; i < 11; i++) {
      const a = rnd() * Math.PI * 2,
        d = r * (0.08 + rnd() * 0.3),
        br = r * (0.26 + rnd() * 0.2);
      radial(g, Math.cos(a) * d, Math.sin(a) * d, br, [
        [0, 0.32 + rnd() * 0.2],
        [0.55, 0.16],
        [1, 0],
      ]);
    }
    g.globalCompositeOperation = 'source-atop';
    const shade = g.createLinearGradient(0, -r, 0, r);
    shade.addColorStop(0, 'rgba(255,255,255,0)');
    shade.addColorStop(0.55, 'rgba(160,160,170,0.25)');
    shade.addColorStop(1, 'rgba(110,110,125,0.55)');
    g.fillStyle = shade;
    g.fillRect(-r, -r, r * 2, r * 2);
    g.globalCompositeOperation = 'source-over';
  });
  // Звезда вспышки: ядро и лучи — четыре длинных и четыре коротких.
  tile(g, SPRITE_TILE.star, size, (r) => {
    radial(g, 0, 0, r * 0.5, [
      [0, 1],
      [0.25, 0.7],
      [1, 0],
    ]);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const long = i % 2 === 0;
      const len = r * (long ? 0.95 : 0.55),
        w = r * (long ? 0.075 : 0.05);
      g.save();
      g.rotate((i / 8) * Math.PI * 2 + 0.2);
      const grad = g.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, -w);
      g.lineTo(len, 0);
      g.lineTo(0, w);
      g.closePath();
      g.fill();
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
  });
  // Кольцо: ударная волна и «хлопок» конфетти.
  tile(g, SPRITE_TILE.ring, size, (r) =>
    radial(g, 0, 0, r * 0.94, [
      [0, 0],
      [0.55, 0],
      [0.8, 0.35],
      [0.9, 1],
      [0.96, 0.25],
      [1, 0],
    ]),
  );
  const t = texture(c);
  t.anisotropy = 1;
  return t;
}

/**
 * Клякса краски: пятно с неровным краем, лучи-выплески и брызги вокруг.
 * Рисуется в плитку атласа 2×2; `seed` делает все четыре разными.
 */
function drawSplat(g: CanvasRenderingContext2D, r: number, seed: number) {
  const rnd = random(seed * 977 + 13);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  const phase = [rnd() * 6, rnd() * 6, rnd() * 6];
  const core = r * (0.36 + rnd() * 0.06);
  g.beginPath();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const k =
      1 +
      Math.sin(a * 3 + phase[0]) * 0.1 +
      Math.sin(a * 7 + phase[1]) * 0.07 +
      Math.sin(a * 13 + phase[2]) * 0.035;
    const x = Math.cos(a) * core * k,
      y = Math.sin(a) * core * k;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.fill();
  // Выплески: краска, разлетевшаяся от удара, — сужающиеся лучи с каплей на конце.
  const arms = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rnd() * 0.6,
      len = r * (0.55 + rnd() * 0.3),
      w = r * (0.07 + rnd() * 0.05);
    const ca = Math.cos(a),
      sa = Math.sin(a);
    g.beginPath();
    g.moveTo(-sa * w * 1.6 + ca * core * 0.6, ca * w * 1.6 + sa * core * 0.6);
    g.quadraticCurveTo(ca * len * 0.7 - sa * w * 0.5, sa * len * 0.7 + ca * w * 0.5, ca * len, sa * len);
    g.quadraticCurveTo(ca * len * 0.7 + sa * w * 0.5, sa * len * 0.7 - ca * w * 0.5, sa * w * 1.6 + ca * core * 0.6, -ca * w * 1.6 + sa * core * 0.6);
    g.fill();
    g.beginPath();
    g.arc(ca * len, sa * len, w * 0.9, 0, Math.PI * 2);
    g.fill();
  }
  // Брызги: мелкие капли, чем дальше — тем мельче.
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2,
      d = r * (0.5 + rnd() * 0.42),
      s = r * (0.05 - (d / r) * 0.035) * (0.6 + rnd() * 0.8);
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, Math.max(1, s), 0, Math.PI * 2);
    g.fill();
  }
}

/**
 * Атлас клякс на стенах: `map` — сама форма (белая, в альфе), `bump` — её
 * рельеф: размытая копия, поэтому край кляксы выпуклый и ловит блик, как
 * толстый слой свежей краски.
 */
export function splatAtlas() {
  const size = 256;
  const shape = canvas(size * 2);
  const g = shape.getContext('2d')!;
  for (let i = 0; i < 4; i++) tile(g, i, size, (r) => drawSplat(g, r * 0.98, i + 1));
  // Размытие без ctx.filter (его нет в Safari): уменьшить и растянуть обратно.
  const small = canvas(size / 2);
  const sg = small.getContext('2d')!;
  sg.fillStyle = '#000';
  sg.fillRect(0, 0, small.width, small.height);
  sg.imageSmoothingEnabled = true;
  sg.drawImage(shape, 0, 0, small.width, small.height);
  const height = canvas(size * 2);
  const hg = height.getContext('2d')!;
  hg.fillStyle = '#000';
  hg.fillRect(0, 0, height.width, height.height);
  hg.imageSmoothingEnabled = true;
  hg.imageSmoothingQuality = 'high';
  hg.drawImage(small, 0, 0, height.width, height.height);
  // Поверх — чёткая форма наполовину: у кляксы и плавный бортик, и ровная середина.
  hg.globalAlpha = 0.45;
  hg.drawImage(shape, 0, 0);
  hg.globalAlpha = 1;
  const map = texture(shape);
  map.anisotropy = 4;
  const bump = texture(height, false);
  return { map, bump };
}

/** Прямоугольник UV плитки атласа 2×2: для геометрий, которые берут одну плитку. */
export function atlasTileUv(geometry: T.BufferGeometry, index: number) {
  const uv = geometry.getAttribute('uv') as T.BufferAttribute;
  const u0 = (index % 2) * 0.5,
    v0 = (1 - Math.floor(index / 2)) * 0.5;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5);
  uv.needsUpdate = true;
  return geometry;
}
