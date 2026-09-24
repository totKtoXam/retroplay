/**
 * Материалы боевых карт: процедурные текстуры по виду поверхности (`SurfaceMaterial` в
 * lib/maps/types.ts) — паркет, плитка, обои, ковёр и т. д. Текстуры рисуются на canvas один
 * раз и почти белые: цвет даёт сама коробка, текстура добавляет доски, швы и ворс. Так сезонная
 * перекраска (lib/season-colors.ts) и дальше меняет только цвет материала.
 *
 * UV проецируются в мировых метрах (`projectUV`), поэтому доска паркета одной ширины на любой
 * коробке, а соседние плиты пола стыкуются без шва.
 */
import * as T from 'three';
import type { SurfaceMaterial } from '@/lib/maps/types';

type Painter = (
  ctx: CanvasRenderingContext2D,
  size: number,
  rand: () => number,
) => void;
type Spec = {
  size: number;
  /** Метров на один повтор текстуры. */
  repeat: number;
  roughness: number;
  metalness?: number;
  bump: number;
  paint: Painter;
  /**
   * UV берутся из самой геометрии, а не из мировой проекции: у ящика каждая грань — одна
   * стенка с рамкой, у бревна кора обвивает ствол и идёт вдоль него (components/world-arena-scene.ts).
   */
  faceUV?: boolean;
};

const rng = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

const gray = (v: number, a = 1) => {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return `rgba(${c},${c},${c},${a})`;
};

/** Мелкий шум поверх уже нарисованного. */
function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  rand: () => number,
  amount: number,
) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** Волокна дерева вдоль x в прямоугольнике. */
function grain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rand: () => number,
  base: number,
) {
  ctx.fillStyle = gray(base);
  ctx.fillRect(x, y, w, h);
  const lines = Math.max(3, Math.round(h / 3));
  for (let i = 0; i < lines; i++) {
    const yy = y + rand() * h;
    const wave = rand() * 6;
    ctx.strokeStyle = gray(base - 18 - rand() * 22, 0.35 + rand() * 0.3);
    ctx.lineWidth = 0.6 + rand() * 1.2;
    ctx.beginPath();
    for (let xx = x; xx <= x + w; xx += 8) {
      const dy = Math.sin((xx + wave * 40) * 0.02) * wave * 0.4;
      if (xx === x) ctx.moveTo(xx, yy + dy);
      else ctx.lineTo(xx, yy + dy);
    }
    ctx.stroke();
  }
}

/**
 * Рисует фигуру и её копии, сдвинутые на размер текстуры, если она заходит за край: так
 * пятна, трещины и камни переходят через шов и повтор текстуры на большой земле не виден.
 */
function tiled(s: number, x: number, y: number, reach: number, draw: (x: number, y: number) => void) {
  for (const dx of [-s, 0, s])
    for (const dy of [-s, 0, s]) {
      const px = x + dx,
        py = y + dy;
      if (px + reach < 0 || px - reach > s || py + reach < 0 || py - reach > s) continue;
      draw(px, py);
    }
}

/** Мягкие пятна тона вокруг `base`: основа для камня, штукатурки, снега. */
function blotches(ctx: CanvasRenderingContext2D, s: number, rand: () => number, n: number, r0: number, r1: number, v0: number, v1: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const r = r0 + rand() * (r1 - r0);
    ctx.fillStyle = gray(v0 + rand() * (v1 - v0), alpha);
    tiled(s, rand() * s, rand() * s, r, (x, y) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

/** Ломаная трещина из точки (x, y) в общем направлении `angle`, с переносом через края. */
function crack(ctx: CanvasRenderingContext2D, s: number, rand: () => number, x: number, y: number, angle: number, length: number, v: number, alpha: number, width = 1) {
  const pts: [number, number][] = [[x, y]];
  let a = angle;
  for (let run = 0; run < length; ) {
    const step = 5 + rand() * 9;
    a += (rand() - 0.5) * 0.9;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push([x, y]);
    run += step;
  }
  ctx.strokeStyle = gray(v, alpha);
  ctx.lineWidth = width;
  tiled(s, 0, 0, s, (ox, oy) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + ox, py + oy) : ctx.moveTo(px + ox, py + oy)));
    ctx.stroke();
  });
}

const SPECS: Record<SurfaceMaterial, Spec> = {
  plaster: {
    size: 256,
    repeat: 2.2,
    roughness: 0.95,
    bump: 0.006,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(236);
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 140; i++) {
        ctx.fillStyle = gray(222 + rand() * 26, 0.18);
        ctx.beginPath();
        ctx.arc(rand() * s, rand() * s, 6 + rand() * 26, 0, Math.PI * 2);
        ctx.fill();
      }
      speckle(ctx, s, rand, 10);
    },
  },
  wallpaper: {
    size: 256,
    repeat: 0.9,
    roughness: 0.9,
    bump: 0.002,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(238);
      ctx.fillRect(0, 0, s, s);
      // Полосы и ромбы дамаска.
      for (let x = 0; x < s; x += 64) {
        ctx.fillStyle = gray(214, 0.55);
        ctx.fillRect(x + 28, 0, 8, s);
      }
      ctx.fillStyle = gray(206, 0.5);
      for (let x = 0; x < s; x += 64)
        for (let y = 0; y < s; y += 64) {
          const cx = x + (y % 128 === 0 ? 0 : 32) + 0,
            cy = y + 32;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 14);
          ctx.lineTo(cx + 9, cy);
          ctx.lineTo(cx, cy + 14);
          ctx.lineTo(cx - 9, cy);
          ctx.closePath();
          ctx.fill();
        }
      speckle(ctx, s, rand, 6);
    },
  },
  wood: {
    size: 256,
    repeat: 1.2,
    roughness: 0.62,
    bump: 0.004,
    paint: (ctx, s, rand) => {
      grain(ctx, 0, 0, s, s, rand, 225);
      speckle(ctx, s, rand, 8);
    },
  },
  parquet: {
    size: 512,
    repeat: 2.4,
    roughness: 0.48,
    bump: 0.006,
    paint: (ctx, s, rand) => {
      // Доски ~20 см шириной вразбежку, каждая своего тона, с тёмным швом.
      const rows = 12,
        h = s / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rand() * s * 0.5;
        while (x < s) {
          const len = s * (0.35 + rand() * 0.4);
          const tone = 196 + rand() * 44;
          grain(ctx, x, r * h, len, h, rand, tone);
          // Та же доска, перенесённая через правый край: текстура бесшовная.
          if (x + len > s) grain(ctx, x - s, r * h, len, h, rand, tone);
          if (x < 0) grain(ctx, x + s, r * h, len, h, rand, tone);
          ctx.fillStyle = gray(120, 0.8);
          ctx.fillRect(((x % s) + s) % s, r * h, 2, h);
          x += len;
        }
        ctx.fillStyle = gray(110, 0.85);
        ctx.fillRect(0, r * h, s, 2);
      }
      speckle(ctx, s, rand, 6);
    },
  },
  tile: {
    size: 256,
    repeat: 0.9,
    roughness: 0.35,
    bump: 0.004,
    paint: (ctx, s, rand) => {
      const n = 3,
        t = s / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          ctx.fillStyle = gray(228 + rand() * 18);
          ctx.fillRect(i * t, j * t, t, t);
        }
      ctx.fillStyle = gray(150);
      for (let i = 0; i < n; i++) {
        ctx.fillRect(i * t, 0, 3, s);
        ctx.fillRect(0, i * t, s, 3);
      }
      speckle(ctx, s, rand, 6);
    },
  },
  checker: {
    size: 256,
    repeat: 1.6,
    roughness: 0.25,
    bump: 0.003,
    paint: (ctx, s, rand) => {
      const t = s / 2;
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const dark = (i + j) % 2 === 1;
          ctx.fillStyle = gray(dark ? 92 : 242);
          ctx.fillRect(i * t, j * t, t, t);
          // Прожилки мрамора.
          for (let k = 0; k < 4; k++) {
            ctx.strokeStyle = gray(dark ? 130 : 200, 0.45);
            ctx.lineWidth = 0.8 + rand();
            ctx.beginPath();
            let x = i * t + rand() * t,
              y = j * t;
            ctx.moveTo(x, y);
            while (y < (j + 1) * t) {
              x += (rand() - 0.5) * 18;
              y += 10 + rand() * 12;
              ctx.lineTo(
                Math.max(i * t, Math.min((i + 1) * t, x)),
                Math.min((j + 1) * t, y),
              );
            }
            ctx.stroke();
          }
        }
      ctx.fillStyle = gray(170);
      ctx.fillRect(0, 0, s, 2);
      ctx.fillRect(0, t, s, 2);
      ctx.fillRect(0, 0, 2, s);
      ctx.fillRect(t, 0, 2, s);
      speckle(ctx, s, rand, 5);
    },
  },
  marble: {
    size: 256,
    repeat: 1.8,
    roughness: 0.2,
    bump: 0.002,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(240);
      ctx.fillRect(0, 0, s, s);
      for (let k = 0; k < 9; k++) {
        ctx.strokeStyle = gray(185 + rand() * 30, 0.5);
        ctx.lineWidth = 0.6 + rand() * 1.6;
        ctx.beginPath();
        let x = rand() * s,
          y = 0;
        ctx.moveTo(x, y);
        while (y < s) {
          x += (rand() - 0.5) * 30;
          y += 12 + rand() * 18;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      speckle(ctx, s, rand, 5);
    },
  },
  carpet: {
    size: 256,
    repeat: 1.1,
    roughness: 1,
    bump: 0.01,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(200);
      ctx.fillRect(0, 0, s, s);
      // Восточный узор: ромбическая решётка и медальоны.
      ctx.strokeStyle = gray(250, 0.7);
      ctx.lineWidth = 5;
      for (let k = -s; k <= s * 2; k += 64) {
        ctx.beginPath();
        ctx.moveTo(k, 0);
        ctx.lineTo(k + s, s);
        ctx.moveTo(k, s);
        ctx.lineTo(k + s, 0);
        ctx.stroke();
      }
      ctx.fillStyle = gray(120, 0.75);
      for (let x = 0; x <= s; x += 64)
        for (let y = 32; y <= s; y += 64) {
          ctx.beginPath();
          ctx.arc(x, y, 9, 0, Math.PI * 2);
          ctx.fill();
        }
      // Ворс.
      const img = ctx.getImageData(0, 0, s, s);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rand() - 0.5) * 46;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  fabric: {
    size: 128,
    repeat: 0.35,
    roughness: 1,
    bump: 0.004,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(222);
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < s; i += 4) {
        ctx.fillStyle = gray(200, 0.6);
        ctx.fillRect(i, 0, 2, s);
        ctx.fillStyle = gray(244, 0.5);
        ctx.fillRect(0, i + 2, s, 2);
      }
      speckle(ctx, s, rand, 16);
    },
  },
  leather: {
    size: 256,
    repeat: 0.6,
    roughness: 0.55,
    bump: 0.006,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(215);
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 600; i++) {
        ctx.fillStyle = gray(180 + rand() * 60, 0.25);
        ctx.fillRect(rand() * s, rand() * s, 3 + rand() * 6, 2 + rand() * 4);
      }
      speckle(ctx, s, rand, 14);
    },
  },
  metal: {
    size: 256,
    repeat: 1,
    roughness: 0.35,
    metalness: 0.7,
    bump: 0.002,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(225);
      ctx.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y++) {
        ctx.fillStyle = gray(205 + rand() * 45, 0.35);
        ctx.fillRect(0, y, s, 1);
      }
    },
  },
  brick: {
    size: 256,
    repeat: 1.2,
    roughness: 0.95,
    bump: 0.012,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(165);
      ctx.fillRect(0, 0, s, s);
      const rows = 8,
        h = s / rows,
        w = s / 4;
      for (let r = 0; r < rows; r++)
        for (let c = -1; c < 5; c++) {
          const x = c * w + (r % 2 ? w / 2 : 0);
          ctx.fillStyle = gray(205 + rand() * 45);
          ctx.fillRect(x + 3, r * h + 3, w - 6, h - 6);
        }
      speckle(ctx, s, rand, 22);
    },
  },
  books: {
    size: 256,
    repeat: 1,
    roughness: 0.8,
    bump: 0.008,
    paint: (ctx, s, rand) => {
      // Корешки на трёх полках: разная ширина, высота и яркость.
      const shelf = s / 3;
      for (let r = 0; r < 3; r++) {
        ctx.fillStyle = gray(70);
        ctx.fillRect(0, r * shelf, s, shelf);
        let x = 0;
        while (x < s) {
          const w = 8 + rand() * 14,
            top = r * shelf + 8 + rand() * 18;
          ctx.fillStyle = gray(120 + rand() * 135);
          ctx.fillRect(x, top, w - 1.5, (r + 1) * shelf - top - 6);
          ctx.fillStyle = gray(250, 0.45);
          ctx.fillRect(x + 1, top + 10, w - 4, 3);
          x += w;
        }
        ctx.fillStyle = gray(150);
        ctx.fillRect(0, (r + 1) * shelf - 6, s, 6);
      }
    },
  },
  grass: {
    size: 256,
    repeat: 2.5,
    roughness: 1,
    bump: 0.012,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(200);
      ctx.fillRect(0, 0, s, s);
      // Пятна гуще и реже, потом травинки: короткие штрихи разной яркости и наклона.
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = gray(170 + rand() * 70, 0.25);
        ctx.beginPath();
        ctx.arc(rand() * s, rand() * s, 8 + rand() * 30, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 2600; i++) {
        const x = rand() * s,
          y = rand() * s,
          len = 4 + rand() * 9,
          lean = (rand() - 0.5) * 5;
        ctx.strokeStyle = gray(150 + rand() * 105, 0.7);
        ctx.lineWidth = 0.8 + rand() * 0.9;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + lean, y - len);
        ctx.stroke();
      }
      speckle(ctx, s, rand, 18);
    },
  },
  foliage: {
    size: 256,
    repeat: 1.1,
    roughness: 0.9,
    bump: 0.03,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(150);
      ctx.fillRect(0, 0, s, s);
      // Листья — вытянутые эллипсы под разными углами, сверху светлее, в глубине темнее.
      for (let i = 0; i < 1500; i++) {
        const x = rand() * s,
          y = rand() * s,
          r = 3 + rand() * 6;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rand() * Math.PI);
        ctx.fillStyle = gray(165 + rand() * 90, 0.9);
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = gray(130, 0.4);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.lineTo(r, 0);
        ctx.stroke();
        ctx.restore();
      }
      speckle(ctx, s, rand, 20);
    },
  },
  paving: {
    size: 256,
    repeat: 2.4,
    roughness: 0.9,
    bump: 0.014,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(150);
      ctx.fillRect(0, 0, s, s);
      // Брусчатка: ряды камней разной длины со скруглёнными краями и швами.
      const rows = 8,
        h = s / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rand() * 30;
        while (x < s) {
          const w = 22 + rand() * 20;
          const v = 200 + rand() * 50;
          ctx.fillStyle = gray(v);
          ctx.beginPath();
          ctx.roundRect(x + 2, r * h + 2, w - 4, h - 4, 5);
          ctx.fill();
          ctx.fillStyle = gray(v + 12, 0.6);
          ctx.fillRect(x + 5, r * h + 4, w - 12, 3);
          // Кусок, вылезающий за край, повторяем с другой стороны: текстура без шва.
          if (x + w > s) {
            ctx.fillStyle = gray(v);
            ctx.beginPath();
            ctx.roundRect(x - s + 2, r * h + 2, w - 4, h - 4, 5);
            ctx.fill();
          }
          x += w;
        }
      }
      speckle(ctx, s, rand, 22);
    },
  },
  soil: {
    size: 256,
    repeat: 1.5,
    roughness: 1,
    bump: 0.02,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(170);
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = gray(110 + rand() * 120, 0.55);
        ctx.beginPath();
        ctx.arc(rand() * s, rand() * s, 1 + rand() * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      speckle(ctx, s, rand, 30);
    },
  },
  planks: {
    size: 256,
    repeat: 1.6,
    roughness: 0.8,
    bump: 0.012,
    paint: (ctx, s, rand) => {
      // Вагонка: горизонтальные доски внахлёст, под каждой — тень от нижней кромки верхней.
      const boards = 8,
        h = s / boards;
      for (let b = 0; b < boards; b++) {
        grain(ctx, 0, b * h, s, h, rand, 205 + rand() * 30);
        ctx.fillStyle = gray(95, 0.8);
        ctx.fillRect(0, b * h, s, 3);
        ctx.fillStyle = gray(250, 0.35);
        ctx.fillRect(0, b * h + 3, s, 2);
      }
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = gray(120, 0.8);
        ctx.fillRect(rand() * s, Math.floor(rand() * boards) * h + h / 2, 3, 3);
      }
      speckle(ctx, s, rand, 10);
    },
  },
  'roof-tiles': {
    size: 256,
    repeat: 1.6,
    roughness: 0.85,
    bump: 0.02,
    paint: (ctx, s, rand) => {
      // Черепица: ряды полукруглых чешуек, каждый ряд сдвинут на половину.
      ctx.fillStyle = gray(120);
      ctx.fillRect(0, 0, s, s);
      const rows = 8,
        h = s / rows,
        w = s / 8;
      for (let r = 0; r < rows; r++)
        for (let c = -1; c <= 8; c++) {
          const x = c * w + (r % 2 ? w / 2 : 0),
            y = r * h;
          const grad = ctx.createLinearGradient(0, y, 0, y + h);
          const v = 190 + rand() * 50;
          grad.addColorStop(0, gray(v - 40));
          grad.addColorStop(0.7, gray(v));
          grad.addColorStop(1, gray(v - 70));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(x + 1, y);
          ctx.lineTo(x + 1, y + h * 0.55);
          ctx.arc(x + w / 2, y + h * 0.55, w / 2 - 1, Math.PI, 0, true);
          ctx.lineTo(x + w - 1, y);
          ctx.closePath();
          ctx.fill();
        }
      speckle(ctx, s, rand, 14);
    },
  },
  sewer: {
    size: 256,
    repeat: 1.4,
    roughness: 0.55,
    bump: 0.016,
    paint: (ctx, s, rand) => {
      // Старый кирпич: неровные ряды, выкрошенный раствор и потёки грязи.
      ctx.fillStyle = gray(95);
      ctx.fillRect(0, 0, s, s);
      const rows = 10,
        h = s / rows,
        w = s / 4;
      for (let r = 0; r < rows; r++)
        for (let c = -1; c < 5; c++) {
          const x = c * w + (r % 2 ? w / 2 : 0) + (rand() - 0.5) * 3;
          ctx.fillStyle = gray(150 + rand() * 70);
          ctx.fillRect(x + 3, r * h + 3, w - 5 - rand() * 3, h - 5);
          if (rand() < 0.2) {
            ctx.fillStyle = gray(90, 0.6);
            ctx.fillRect(x + 4 + rand() * (w - 20), r * h + 4, 6 + rand() * 10, 5 + rand() * 6);
          }
        }
      for (let i = 0; i < 26; i++) {
        const x = rand() * s,
          len = 40 + rand() * 180;
        const grad = ctx.createLinearGradient(0, 0, 0, len);
        grad.addColorStop(0, gray(50, 0.45));
        grad.addColorStop(1, gray(50, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(x, 0, 3 + rand() * 9, len);
      }
      speckle(ctx, s, rand, 26);
    },
  },
  snow: {
    size: 256,
    repeat: 3.2,
    roughness: 0.82,
    bump: 0.02,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(244);
      ctx.fillRect(0, 0, s, s);
      // Надувы: мягкие тени и светлые бугры, потом застругы — пологие волны ветра.
      blotches(ctx, s, rand, 40, 20, 60, 226, 255, 0.22);
      for (let i = 0; i < 9; i++) {
        const y0 = rand() * s,
          amp = 4 + rand() * 8,
          k = 1 + Math.floor(rand() * 3),
          phase = rand() * Math.PI * 2;
        ctx.strokeStyle = gray(212, 0.28);
        ctx.lineWidth = 1.5 + rand() * 2;
        ctx.beginPath();
        for (let x = 0; x <= s; x += 4) {
          const y = y0 + Math.sin((x / s) * Math.PI * 2 * k + phase) * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Искры наста.
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = gray(255, 0.9);
        ctx.fillRect(rand() * s, rand() * s, 1, 1);
      }
      speckle(ctx, s, rand, 6);
    },
  },
  ice: {
    size: 256,
    repeat: 2.2,
    roughness: 0.16,
    metalness: 0.05,
    bump: 0.005,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(232);
      ctx.fillRect(0, 0, s, s);
      // Мутные слои и иней, пузырьки воздуха, трещины со светлой каймой.
      blotches(ctx, s, rand, 30, 18, 55, 214, 255, 0.2);
      for (let i = 0; i < 140; i++) {
        const r = 0.8 + rand() * 2.4;
        ctx.strokeStyle = gray(255, 0.55);
        ctx.lineWidth = 0.8;
        tiled(s, rand() * s, rand() * s, r, (x, y) => {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
        });
      }
      for (let i = 0; i < 7; i++) {
        const x = rand() * s,
          y = rand() * s,
          a = rand() * Math.PI * 2,
          len = 60 + rand() * 140;
        crack(ctx, s, rand, x, y, a, len, 255, 0.35, 3);
        crack(ctx, s, rand, x, y, a, len, 168, 0.55, 1);
      }
      speckle(ctx, s, rand, 5);
    },
  },
  rock: {
    size: 256,
    repeat: 2.8,
    roughness: 0.95,
    bump: 0.035,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(196);
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, s, rand, 70, 8, 40, 150, 240, 0.22);
      // Пласты породы: пологие волнистые полосы (на стенах идут поперёк высоты).
      for (let i = 0; i < 11; i++) {
        const y0 = rand() * s,
          amp = 3 + rand() * 7,
          k = 1 + Math.floor(rand() * 2),
          phase = rand() * Math.PI * 2,
          v = rand() < 0.5 ? 150 : 232;
        ctx.strokeStyle = gray(v, 0.35);
        ctx.lineWidth = 1 + rand() * 4;
        ctx.beginPath();
        for (let x = 0; x <= s; x += 4) {
          const y = y0 + Math.sin((x / s) * Math.PI * 2 * k + phase) * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Трещины: тёмная щель и светлый скол рядом.
      for (let i = 0; i < 8; i++) {
        const x = rand() * s,
          y = rand() * s,
          a = Math.PI / 2 + (rand() - 0.5) * 1.4,
          len = 25 + rand() * 70;
        crack(ctx, s, rand, x + 1.5, y, a, len, 236, 0.3, 1);
        crack(ctx, s, rand, x, y, a, len, 92, 0.5, 1.1);
      }
      // Лишайник: мелкие светлые пятнышки гроздьями.
      for (let i = 0; i < 9; i++) {
        const cx = rand() * s,
          cy = rand() * s;
        for (let k = 0; k < 14; k++) {
          const r = 1 + rand() * 2.5;
          ctx.fillStyle = gray(240, 0.25);
          tiled(s, cx + (rand() - 0.5) * 18, cy + (rand() - 0.5) * 18, r, (x, y) => {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
          });
        }
      }
      speckle(ctx, s, rand, 26);
    },
  },
  bark: {
    size: 256,
    repeat: 0.9,
    roughness: 0.95,
    bump: 0.03,
    faceUV: true,
    paint: (ctx, s, rand) => {
      // Кора: вытянутые вдоль ствола пластины, между ними глубокие тёмные борозды.
      ctx.fillStyle = gray(78);
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 70; i++) {
        const w = 10 + rand() * 18,
          h = 40 + rand() * 90,
          v = 165 + rand() * 70;
        ctx.fillStyle = gray(v);
        tiled(s, rand() * s, rand() * s, h, (x, y) => {
          ctx.beginPath();
          ctx.roundRect(x - w / 2, y - h / 2, w, h, w / 2.5);
          ctx.fill();
        });
      }
      for (let i = 0; i < 90; i++) {
        ctx.strokeStyle = gray(100, 0.5);
        ctx.lineWidth = 0.8;
        const x = rand() * s,
          y = rand() * s,
          dx = (rand() - 0.5) * 3,
          dy = 8 + rand() * 12;
        tiled(s, x, y, 20, (px, py) => {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + dx, py + dy);
          ctx.stroke();
        });
      }
      speckle(ctx, s, rand, 24);
    },
  },
  logs: {
    size: 256,
    repeat: 1.6,
    roughness: 0.85,
    bump: 0.03,
    paint: (ctx, s, rand) => {
      // Сруб: шесть круглых брёвен друг на друге — к краям бревна темнеют, между ними пакля.
      const n = 6,
        h = s / n;
      for (let i = 0; i < n; i++) {
        const y = i * h;
        const tone = 190 + rand() * 40;
        const grad = ctx.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, gray(tone - 70));
        grad.addColorStop(0.3, gray(tone));
        grad.addColorStop(0.55, gray(tone + 12));
        grad.addColorStop(1, gray(tone - 80));
        ctx.fillStyle = grad;
        ctx.fillRect(0, y, s, h);
        for (let k = 0; k < 6; k++) {
          const yy = y + 5 + rand() * (h - 10),
            periods = 1 + Math.floor(rand() * 3),
            phase = rand() * Math.PI * 2;
          ctx.strokeStyle = gray(tone - 45, 0.35);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          for (let x = 0; x <= s; x += 6) {
            const dy = Math.sin((x / s) * Math.PI * 2 * periods + phase) * 1.5;
            if (x === 0) ctx.moveTo(x, yy + dy);
            else ctx.lineTo(x, yy + dy);
          }
          ctx.stroke();
        }
        // Сучок.
        if (rand() < 0.7) {
          ctx.fillStyle = gray(tone - 60, 0.8);
          const rx = 4 + rand() * 3;
          tiled(s, rand() * s, y + h * (0.35 + rand() * 0.3), 8, (x, yy) => {
            ctx.beginPath();
            ctx.ellipse(x, yy, rx, 3, 0, 0, Math.PI * 2);
            ctx.fill();
          });
        }
        ctx.fillStyle = gray(58, 0.9);
        ctx.fillRect(0, y + h - 3, s, 3);
      }
      speckle(ctx, s, rand, 12);
    },
  },
  adobe: {
    size: 256,
    repeat: 3.4,
    roughness: 0.96,
    bump: 0.014,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(226);
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, s, rand, 60, 10, 45, 200, 250, 0.2);
      // Солома в глине.
      for (let i = 0; i < 380; i++) {
        const x = rand() * s,
          y = rand() * s,
          a = rand() * Math.PI,
          len = 3 + rand() * 7;
        ctx.strokeStyle = gray(rand() < 0.5 ? 196 : 250, 0.6);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
      for (let i = 0; i < 6; i++) crack(ctx, s, rand, rand() * s, rand() * s, rand() * Math.PI * 2, 30 + rand() * 50, 140, 0.45, 0.8);
      speckle(ctx, s, rand, 14);
    },
  },
  ashlar: {
    size: 256,
    repeat: 2.4,
    roughness: 0.9,
    bump: 0.022,
    paint: (ctx, s, rand) => {
      // Тёсаный камень: ряды блоков разной длины, в каждом — своя фактура скола.
      ctx.fillStyle = gray(118);
      ctx.fillRect(0, 0, s, s);
      const rows = 4,
        h = s / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rand() * 60;
        while (x < s) {
          const w = 50 + rand() * 50,
            v = 185 + rand() * 55;
          for (const ox of x + w > s ? [0, -s] : [0]) {
            ctx.fillStyle = gray(v);
            ctx.beginPath();
            ctx.roundRect(x + ox + 2, r * h + 2, w - 4, h - 4, 3);
            ctx.fill();
            ctx.fillStyle = gray(v + 14, 0.5);
            ctx.fillRect(x + ox + 4, r * h + 4, w - 8, 3);
            ctx.fillStyle = gray(v - 30, 0.4);
            ctx.fillRect(x + ox + 4, r * h + h - 7, w - 8, 3);
          }
          x += w;
        }
      }
      speckle(ctx, s, rand, 24);
    },
  },
  felt: {
    size: 256,
    repeat: 1.3,
    roughness: 1,
    bump: 0.01,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(222);
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, s, rand, 50, 10, 34, 200, 248, 0.22);
      // Свалянная шерсть: короткие изогнутые волоски во все стороны.
      for (let i = 0; i < 1800; i++) {
        const x = rand() * s,
          y = rand() * s,
          a = rand() * Math.PI * 2,
          len = 2 + rand() * 5;
        ctx.strokeStyle = gray(rand() < 0.5 ? 190 : 248, 0.35);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(a + 1) * len, y + Math.sin(a + 1) * len, x + Math.cos(a) * len * 2, y + Math.sin(a) * len * 2);
        ctx.stroke();
      }
      speckle(ctx, s, rand, 16);
    },
  },
  sand: {
    size: 256,
    repeat: 3,
    roughness: 1,
    bump: 0.016,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(222);
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, s, rand, 50, 12, 50, 196, 246, 0.2);
      // Рябь от ветра и ног.
      for (let i = 0; i < 14; i++) {
        const y0 = rand() * s,
          k = 1 + Math.floor(rand() * 3),
          phase = rand() * Math.PI * 2;
        ctx.strokeStyle = gray(rand() < 0.5 ? 196 : 246, 0.3);
        ctx.lineWidth = 1 + rand() * 2;
        ctx.beginPath();
        for (let x = 0; x <= s; x += 4) {
          const y = y0 + Math.sin((x / s) * Math.PI * 2 * k + phase) * 5;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Галька.
      for (let i = 0; i < 70; i++) {
        const r = 1 + rand() * 2.6,
          turn = rand() * Math.PI;
        ctx.fillStyle = gray(140 + rand() * 60, 0.75);
        tiled(s, rand() * s, rand() * s, r, (x, y) => {
          ctx.beginPath();
          ctx.ellipse(x, y, r, r * 0.75, turn, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      speckle(ctx, s, rand, 30);
    },
  },
  rust: {
    size: 256,
    repeat: 1.4,
    roughness: 0.78,
    metalness: 0.3,
    bump: 0.012,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(222);
      ctx.fillRect(0, 0, s, s);
      // Облупленная краска, рыжие пятна и подтёки вниз.
      blotches(ctx, s, rand, 34, 8, 36, 130, 175, 0.45);
      blotches(ctx, s, rand, 60, 3, 12, 110, 160, 0.5);
      for (let i = 0; i < 22; i++) {
        const x = rand() * s,
          len = 30 + rand() * 120,
          y = rand() * s,
          w = 2 + rand() * 6;
        tiled(s, x, y, len, (px, py) => {
          const grad = ctx.createLinearGradient(0, py, 0, py + len);
          grad.addColorStop(0, gray(120, 0.45));
          grad.addColorStop(1, gray(120, 0));
          ctx.fillStyle = grad;
          ctx.fillRect(px, py, w, len);
        });
      }
      for (let i = 0; i < 30; i++) {
        ctx.strokeStyle = gray(250, 0.45);
        ctx.lineWidth = 0.7;
        const x = rand() * s,
          y = rand() * s,
          a = rand() * Math.PI;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18);
        ctx.stroke();
      }
      speckle(ctx, s, rand, 22);
    },
  },
  canvas: {
    size: 256,
    repeat: 1.6,
    roughness: 1,
    bump: 0.006,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(226);
      ctx.fillRect(0, 0, s, s);
      // Грубое полотно, два шва на повтор и пятна от непогоды.
      for (let i = 0; i < s; i += 3) {
        ctx.fillStyle = gray(206, 0.35);
        ctx.fillRect(i, 0, 1, s);
        ctx.fillStyle = gray(244, 0.3);
        ctx.fillRect(0, i + 1, s, 1);
      }
      blotches(ctx, s, rand, 16, 10, 40, 190, 215, 0.2);
      for (const x of [0, s / 2]) {
        ctx.fillStyle = gray(170, 0.8);
        ctx.fillRect(x, 0, 3, s);
        ctx.fillStyle = gray(248, 0.5);
        ctx.fillRect(x + 3, 0, 2, s);
        for (let y = 2; y < s; y += 8) {
          ctx.fillStyle = gray(150, 0.7);
          ctx.fillRect(x + 7, y, 1, 4);
        }
      }
      speckle(ctx, s, rand, 14);
    },
  },
  awning: {
    size: 256,
    repeat: 1.2,
    roughness: 0.95,
    bump: 0.004,
    paint: (ctx, s, rand) => {
      // Полосатый тент: светлые и насыщенные полосы, по краю каждой — шов.
      const n = 8,
        w = s / n;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = gray(i % 2 ? 150 : 250);
        ctx.fillRect(i * w, 0, w, s);
        ctx.fillStyle = gray(120, 0.35);
        ctx.fillRect(i * w, 0, 1, s);
      }
      for (let i = 0; i < s; i += 3) {
        ctx.fillStyle = gray(0, 0.05);
        ctx.fillRect(0, i, s, 1);
      }
      speckle(ctx, s, rand, 12);
    },
  },
  concrete: {
    size: 256,
    repeat: 2.6,
    roughness: 0.93,
    bump: 0.012,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = gray(212);
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, s, rand, 50, 8, 40, 180, 236, 0.18);
      // Швы опалубки, подтёки от воды, раковины и трещины.
      for (let y = 0; y < s; y += 64) {
        ctx.fillStyle = gray(160, 0.55);
        ctx.fillRect(0, y, s, 2);
      }
      for (let i = 0; i < 14; i++) {
        const x = rand() * s,
          y = Math.floor(rand() * 4) * 64,
          len = 20 + rand() * 90;
        const grad = ctx.createLinearGradient(0, y, 0, y + len);
        grad.addColorStop(0, gray(140, 0.35));
        grad.addColorStop(1, gray(140, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, 3 + rand() * 10, len);
      }
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = gray(120, 0.6);
        ctx.fillRect(rand() * s, rand() * s, 1.5, 1.5);
      }
      for (let i = 0; i < 5; i++) crack(ctx, s, rand, rand() * s, rand() * s, rand() * Math.PI * 2, 40 + rand() * 80, 110, 0.55, 1);
      speckle(ctx, s, rand, 20);
    },
  },
  crate: {
    size: 256,
    repeat: 1,
    roughness: 0.8,
    bump: 0.02,
    faceUV: true,
    paint: (ctx, s, rand) => {
      // Одна стенка ящика: вертикальные доски, рамка по краю, раскос из угла в угол и гвозди.
      const boards = 5,
        bw = s / boards;
      for (let i = 0; i < boards; i++) {
        ctx.save();
        ctx.translate(i * bw, s);
        ctx.rotate(-Math.PI / 2);
        grain(ctx, 0, 0, s, bw, rand, 200 + rand() * 30);
        ctx.restore();
        ctx.fillStyle = gray(90, 0.9);
        ctx.fillRect(i * bw, 0, 2, s);
      }
      const t = 30;
      /** Накладная доска: сначала её тень на досках под ней, потом она сама. */
      const batten = (x: number, y: number, w: number, h: number, tone: number) => {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 7;
        ctx.fillStyle = gray(tone);
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        grain(ctx, x, y, w, h, rand, tone);
      };
      ctx.save();
      ctx.translate(s / 2, s / 2);
      ctx.rotate(Math.PI / 4);
      batten(-s * 0.7, -t / 2, s * 1.4, t, 214);
      ctx.restore();
      batten(0, 0, s, t, 222);
      batten(0, s - t, s, t, 222);
      batten(0, 0, t, s, 226);
      batten(s - t, 0, t, s, 226);
      ctx.fillStyle = gray(70);
      for (const x of [t / 2, s - t / 2])
        for (const y of [t / 2, s - t / 2]) {
          ctx.beginPath();
          ctx.arc(x - 5, y, 2.2, 0, Math.PI * 2);
          ctx.arc(x + 5, y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      speckle(ctx, s, rand, 12);
    },
  },
  sack: {
    size: 128,
    repeat: 0.5,
    roughness: 1,
    bump: 0.012,
    paint: (ctx, s, rand) => {
      // Мешковина: толстые нити в полотняном переплетении.
      ctx.fillStyle = gray(170);
      ctx.fillRect(0, 0, s, s);
      const step = 8;
      for (let y = 0; y < s; y += step)
        for (let x = 0; x < s; x += step) {
          const over = (x / step + y / step) % 2 === 0;
          ctx.fillStyle = gray(over ? 236 : 214);
          ctx.fillRect(x + 1, y + (over ? 1 : 2), step - 2, step - (over ? 2 : 4));
        }
      speckle(ctx, s, rand, 30);
    },
  },
};

function paintTexture(spec: Spec, seed: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = spec.size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  spec.paint(ctx, spec.size, rng(seed));
  const map = new T.CanvasTexture(canvas);
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 8;
  const bump = map.clone();
  bump.colorSpace = T.NoColorSpace;
  bump.needsUpdate = true;
  return { map, bump };
}

/** Нормали ряби для воды: сумма синусов, бесшовная по обеим осям. */
function rippleNormals(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const rand = rng(90127);
  const waves = Array.from({ length: 7 }, () => ({
    kx: Math.round(1 + rand() * 5) * (rand() < 0.5 ? -1 : 1),
    ky: Math.round(1 + rand() * 5) * (rand() < 0.5 ? -1 : 1),
    phase: rand() * Math.PI * 2,
    amp: 0.4 + rand() * 0.6,
  }));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let dx = 0,
        dy = 0;
      for (const w of waves) {
        const a = ((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.phase;
        dx += Math.cos(a) * w.kx * w.amp;
        dy += Math.cos(a) * w.ky * w.amp;
      }
      const n = new T.Vector3(-dx * 0.08, -dy * 0.08, 1).normalize();
      const i = (y * size + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new T.CanvasTexture(canvas);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.colorSpace = T.NoColorSpace;
  return t;
}

export function createArenaMaterials() {
  const textures = new Map<
    SurfaceMaterial,
    { map: T.Texture; bump: T.Texture }
  >();
  const texture = (kind: SurfaceMaterial) => {
    let t = textures.get(kind);
    if (!t) {
      t = paintTexture(
        SPECS[kind],
        1000 + Object.keys(SPECS).indexOf(kind) * 7919,
      );
      textures.set(kind, t);
    }
    return t;
  };
  const ripples = rippleNormals();
  const waterTime = { value: 0 };
  const waters: T.MeshStandardMaterial[] = [];

  return {
    /** Материал вида `kind` цвета `color`. */
    material(color: string, kind: SurfaceMaterial) {
      const spec = SPECS[kind];
      const { map, bump } = texture(kind);
      return new T.MeshStandardMaterial({
        color,
        map,
        bumpMap: bump,
        bumpScale: spec.bump,
        roughness: spec.roughness,
        metalness: spec.metalness ?? 0,
      });
    },

    /** Берёт ли этот вид UV из геометрии (ящик, кора), а не из проекции в метрах мира. */
    faceUV: (kind: SurfaceMaterial) => !!SPECS[kind].faceUV,

    /** Метров на один повтор текстуры: геометрии со своими UV масштабируют их по нему. */
    repeat: (kind: SurfaceMaterial) => SPECS[kind].repeat,

    /** UV в метрах мира: верх и низ коробки — по x/z, стены — по длине и высоте. */
    projectUV(geometry: T.BufferGeometry, kind: SurfaceMaterial) {
      if (SPECS[kind].faceUV) return;
      const scale = 1 / SPECS[kind].repeat;
      const p = geometry.getAttribute('position'),
        n = geometry.getAttribute('normal'),
        uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        const top = Math.abs(n.getY(i)) > 0.55;
        uv[i * 2] = (Math.abs(n.getX(i)) > 0.7 ? p.getZ(i) : p.getX(i)) * scale;
        uv[i * 2 + 1] = (top ? p.getZ(i) : p.getY(i)) * scale;
      }
      geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    },

    /**
     * Вода: почти зеркальная, рябь из двух слоёв нормалей, бегущих в разные стороны, — одна
     * текстура, смещённая по-разному, не даёт заметного повтора.
     *
     * Непрозрачная намеренно. Оружие в руках рисуется без теста глубины (components/world-hands.ts)
     * и потому глубину не пишет, а прозрачные материалы three.js рисует после всех непрозрачных —
     * полупрозрачная вода ложилась поверх ствола.
     */
    water(color: string) {
      const m = new T.MeshStandardMaterial({
        color,
        roughness: 0.06,
        metalness: 0.15,
        normalMap: ripples,
        normalScale: new T.Vector2(0.45, 0.45),
      });
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uWaterTime = waterTime;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform float uWaterTime;',
          )
          .replace(
            'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
            `vec3 mapN = normalize(
              texture2D( normalMap, vNormalMapUv * 0.9 + vec2( uWaterTime * 0.031, uWaterTime * 0.017 ) ).xyz * 2.0 - 1.0 +
              texture2D( normalMap, vNormalMapUv * 1.7 + vec2( -uWaterTime * 0.023, uWaterTime * 0.041 ) ).xyz * 2.0 - 1.0 );`,
          );
      };
      waters.push(m);
      return m;
    },

    /** Кадр: время для ряби воды, с. */
    animate(seconds: number) {
      waterTime.value = seconds;
    },

    /** Лёд вместо воды (для материала из `water`): матовый и неподвижный. */
    setFrozen(m: T.MeshStandardMaterial, frozen: boolean) {
      m.roughness = frozen ? 0.55 : 0.06;
      m.metalness = frozen ? 0.05 : 0.15;
      m.normalScale.setScalar(frozen ? 0.08 : 0.45);
    },

    dispose() {
      for (const { map, bump } of textures.values()) {
        map.dispose();
        bump.dispose();
      }
      ripples.dispose();
      waters.forEach((m) => m.dispose());
    },
  };
}
