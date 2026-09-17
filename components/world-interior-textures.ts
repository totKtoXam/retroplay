import * as T from 'three';
import type { Bounds, MapZone } from '@/lib/maps/types';

/**
 * Процедурные текстуры интерьера корабля: рисуются на canvas при загрузке карты, без
 * файлов и сети. Цвета в рисунке настоящие — материал их только слегка подкрашивает.
 */

type Ctx = CanvasRenderingContext2D;
type Rnd = () => number;

const random = (seed: number): Rnd => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

function paint(w: number, h: number, draw: (g: Ctx, w: number, h: number, rnd: Rnd) => void, seed = 7) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  draw(g, w, h, random(seed));
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = T.SRGBColorSpace;
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const fill = (g: Ctx, color: string, x: number, y: number, w: number, h: number) => {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
};
/** Фаска: светлая кромка сверху-слева, тень снизу-справа. */
function bevel(g: Ctx, x: number, y: number, w: number, h: number, light: string, dark: string, t = 3) {
  fill(g, light, x, y, w, t);
  fill(g, light, x, y, t, h);
  fill(g, dark, x, y + h - t, w, t);
  fill(g, dark, x + w - t, y, t, h);
}
function bolt(g: Ctx, x: number, y: number, r = 5) {
  const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  grad.addColorStop(0, '#f2f4f6');
  grad.addColorStop(0.6, '#8d949c');
  grad.addColorStop(1, '#4a5058');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}
/** Зерно и грязь поверх рисунка. */
function grain(g: Ctx, w: number, h: number, rnd: Rnd, strength: number) {
  const img = g.getImageData(0, 0, w, h),
    d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * strength;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}
function stains(g: Ctx, w: number, h: number, rnd: Rnd, count: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w,
      y = rnd() * h,
      r = 6 + rnd() * 40;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() < 0.7;
    grad.addColorStop(0, dark ? `rgba(40,36,30,${alpha})` : `rgba(255,255,255,${alpha})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function text(g: Ctx, value: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center') {
  g.fillStyle = color;
  g.font = `700 ${size}px system-ui, "Segoe UI", sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(value, x, y);
}
function scanlines(g: Ctx, w: number, h: number) {
  for (let y = 0; y < h; y += 3) fill(g, 'rgba(0,0,0,0.16)', 0, y, w, 1);
}
function screenBase(g: Ctx, w: number, h: number, bg = '#05161d', edge = '#123e4b') {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, '#020709');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = edge;
  g.lineWidth = 6;
  g.strokeRect(3, 3, w - 6, h - 6);
}

/** Стеновая панель: карниз со световой полосой, филёнка, пояс и плинтус. Тайл 2,4 × 3,2 м. */
export const wallTexture = () =>
  paint(512, 512, (g, w, h, rnd) => {
    fill(g, '#2b313b', 0, 0, w, 70);
    fill(g, '#eaf5ff', 0, 24, w, 16);
    fill(g, '#56606d', 0, 64, w, 6);
    fill(g, '#c2c9d2', 0, 70, w, 262);
    fill(g, '#d5dbe2', 18, 90, w - 36, 222);
    bevel(g, 18, 90, w - 36, 222, '#eef2f6', '#98a1ac', 4);
    fill(g, '#aeb6c0', 60, 200, w - 120, 4);
    for (const [x, y] of [
      [34, 106],
      [w - 34, 106],
      [34, 296],
      [w - 34, 296],
    ])
      bolt(g, x, y, 6);
    fill(g, '#78808c', 0, 70, 4, 262);
    fill(g, '#e6ebf0', 4, 70, 2, 262);
    fill(g, '#d9ae34', 0, 332, w, 8);
    fill(g, '#7b8491', 0, 340, w, 112);
    for (let y = 352; y < 446; y += 18) {
      fill(g, '#636c78', 0, y, w, 3);
      fill(g, '#939ba6', 0, y + 3, w, 1);
    }
    fill(g, '#343a44', 0, 452, w, 60);
    fill(g, '#5b636e', 0, 452, w, 3);
    stains(g, w, h, rnd, 26, 0.06);
    grain(g, w, h, rnd, 14);
  }, 11);

/** Потолок: плиты метр на метр и по светильнику на тайл 4 × 4 м. */
export const ceilingTexture = () =>
  paint(512, 512, (g, w, h, rnd) => {
    fill(g, '#7d8692', 0, 0, w, h);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) bevel(g, i * 128, j * 128, 128, 128, '#96a0ab', '#5c646f', 3);
    fill(g, '#3a414b', 170, 226, 172, 60);
    fill(g, '#f4faff', 180, 236, 152, 40);
    stains(g, w, h, rnd, 20, 0.05);
    grain(g, w, h, rnd, 10);
  }, 29);

/** Светильники горят ярко, а сами плиты чуть подсвечены: снизу до потолка свет почти не доходит. */
export const ceilingGlowTexture = () =>
  paint(512, 512, (g, w, h) => {
    fill(g, '#1c1c1c', 0, 0, w, h);
    fill(g, '#ffffff', 180, 236, 152, 40);
  });

/** Светится только полоса в карнизе стены. */
export const wallGlowTexture = () =>
  paint(4, 512, (g, w, h) => {
    fill(g, '#000000', 0, 0, w, h);
    fill(g, '#ffffff', 0, 24, w, 16);
  });

export type FloorKind = 'tile' | 'medical' | 'plate' | 'panel' | 'grate' | 'concrete' | 'carpet';

/** Размер тайла пола в метрах. */
export const FLOOR_TILE: Record<FloorKind, number> = {
  tile: 2,
  medical: 2,
  plate: 2,
  panel: 3,
  grate: 2,
  concrete: 4,
  carpet: 3,
};

export function floorTexture(kind: FloorKind) {
  return paint(512, 512, (g, w, h, rnd) => {
    if (kind === 'tile' || kind === 'medical') {
      const n = kind === 'tile' ? 4 : 8,
        s = w / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const color =
            kind === 'tile'
              ? (i + j) % 2
                ? '#aeb8c3'
                : '#eceff2'
              : rnd() < 0.12
                ? '#c9eadb'
                : '#f2f5f5';
          fill(g, color, i * s, j * s, s, s);
          bevel(g, i * s, j * s, s, s, 'rgba(255,255,255,0.5)', 'rgba(0,0,0,0.12)', 3);
          fill(g, kind === 'tile' ? '#848d97' : '#b3c1bf', i * s, j * s, s, 3);
          fill(g, kind === 'tile' ? '#848d97' : '#b3c1bf', i * s, j * s, 3, s);
        }
      stains(g, w, h, rnd, 30, 0.05);
      grain(g, w, h, rnd, 12);
    } else if (kind === 'plate') {
      fill(g, '#a2a9b2', 0, 0, w, h);
      for (let y = 0, row = 0; y < h + 32; y += 32, row++)
        for (let x = row % 2 ? 16 : 0; x < w + 32; x += 32) {
          g.save();
          g.translate(x, y);
          g.rotate(row % 2 ? 0.7 : -0.7);
          fill(g, '#7c838c', -9, -1, 20, 7);
          fill(g, '#cfd4da', -10, -3, 20, 5);
          g.restore();
        }
      fill(g, '#5c636c', 0, 0, w, 5);
      fill(g, '#5c636c', 0, 0, 5, h);
      fill(g, '#5c636c', 0, 256, w, 3);
      for (const [x, y] of [
        [16, 16],
        [w - 16, 16],
        [16, 272],
        [w - 16, 272],
      ])
        bolt(g, x, y, 5);
      stains(g, w, h, rnd, 40, 0.07);
      grain(g, w, h, rnd, 16);
    } else if (kind === 'panel') {
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const x = i * 256,
            y = j * 256;
          fill(g, (i + j) % 2 ? '#aab2bc' : '#b8bfc8', x, y, 256, 256);
          bevel(g, x + 2, y + 2, 252, 252, '#d8dde3', '#7e8791', 4);
          g.strokeStyle = '#8f98a2';
          g.lineWidth = 3;
          g.strokeRect(x + 44, y + 44, 168, 168);
          for (const [bx, by] of [
            [20, 20],
            [236, 20],
            [20, 236],
            [236, 236],
          ])
            bolt(g, x + bx, y + by, 6);
          if (i === 1 && j === 0) for (let k = 0; k < 6; k++) fill(g, '#5d656e', x + 80, y + 86 + k * 16, 96, 7);
        }
      stains(g, w, h, rnd, 30, 0.06);
      grain(g, w, h, rnd, 14);
    } else if (kind === 'grate') {
      fill(g, '#1f2328', 0, 0, w, h);
      for (let x = 0; x < w; x += 24) {
        fill(g, '#6f767f', x, 0, 7, h);
        fill(g, '#9aa1a9', x, 0, 2, h);
      }
      for (let y = 0; y < h; y += 24) {
        fill(g, '#646b74', 0, y, w, 7);
        fill(g, '#8d949c', 0, y, w, 2);
      }
      for (const v of [0, 256]) {
        fill(g, '#4f555d', v, 0, 14, h);
        fill(g, '#4f555d', 0, v, w, 14);
        fill(g, '#caa42f', 0, v + 14, w, 3);
      }
      stains(g, w, h, rnd, 30, 0.1);
      grain(g, w, h, rnd, 18);
    } else if (kind === 'concrete') {
      fill(g, '#bab5ab', 0, 0, w, h);
      stains(g, w, h, rnd, 120, 0.07);
      fill(g, '#8d887e', 0, 0, w, 4);
      fill(g, '#8d887e', 0, 0, 4, h);
      fill(g, '#8d887e', 256, 0, 3, h);
      fill(g, '#8d887e', 0, 256, w, 3);
      fill(g, '#d8b43a', 30, 0, 10, h);
      grain(g, w, h, rnd, 30);
    } else {
      fill(g, '#76849f', 0, 0, w, h);
      for (let y = 0; y < h; y += 4) fill(g, y % 8 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)', 0, y, w, 2);
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 6;
      for (let i = -1; i < 3; i++) {
        g.beginPath();
        g.moveTo(i * 256, 0);
        g.lineTo(i * 256 + 256, 256);
        g.lineTo(i * 256, 512);
        g.stroke();
      }
      grain(g, w, h, rnd, 34);
    }
  }, kind.length * 31);
}

/** Шлифованный металл для корпусов пультов и мебели. */
export const metalTexture = () =>
  paint(256, 256, (g, w, h, rnd) => {
    fill(g, '#c3c9d0', 0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)';
      g.fillRect(rnd() * w, rnd() * h, 10 + rnd() * 70, 1);
    }
    stains(g, w, h, rnd, 10, 0.05);
    grain(g, w, h, rnd, 10);
  }, 3);

export const crateTexture = () =>
  paint(256, 256, (g, w, h, rnd) => {
    fill(g, '#b0864f', 0, 0, w, h);
    for (let y = 0; y < h; y += 64) {
      fill(g, '#5e4526', 0, y, w, 3);
      for (let k = 0; k < 7; k++) {
        g.strokeStyle = `rgba(90,60,30,${0.15 + rnd() * 0.2})`;
        g.lineWidth = 1 + rnd() * 2;
        g.beginPath();
        const base = y + 6 + rnd() * 54;
        g.moveTo(0, base);
        for (let x = 0; x <= w; x += 32) g.lineTo(x, base + Math.sin(x * 0.05 + k) * 3);
        g.stroke();
      }
    }
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(Math.PI / 4);
    fill(g, '#8e6a3b', -190, -14, 380, 28);
    bevel(g, -190, -14, 380, 28, '#c19a63', '#5e4526', 3);
    g.restore();
    for (const r of [0, w - 24]) {
      fill(g, '#8a6538', r, 0, 24, h);
      fill(g, '#8a6538', 0, r, w, 24);
    }
    bevel(g, 0, 0, w, h, '#c9a26b', '#4d3820', 4);
    bevel(g, 24, 24, w - 48, h - 48, '#4d3820', '#c9a26b', 3);
    for (const [x, y] of [
      [12, 12],
      [w - 12, 12],
      [12, h - 12],
      [w - 12, h - 12],
    ])
      bolt(g, x, y, 4);
    text(g, 'ГРУЗ 07', w / 2, h / 2 + 34, 20, 'rgba(40,28,14,0.45)');
    grain(g, w, h, rnd, 22);
  }, 5);

export const hazardTexture = () =>
  paint(256, 64, (g, w, h, rnd) => {
    fill(g, '#f0bf2e', 0, 0, w, h);
    g.fillStyle = '#1d1f22';
    for (let x = -64; x < w + 64; x += 64) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 32, 0);
      g.lineTo(x - 32, h);
      g.lineTo(x - 64, h);
      g.fill();
    }
    grain(g, w, h, rnd, 20);
  });

export const fabricTexture = (base: string, stripe?: string) =>
  paint(128, 128, (g, w, h, rnd) => {
    fill(g, base, 0, 0, w, h);
    for (let y = 0; y < h; y += 2) fill(g, 'rgba(0,0,0,0.04)', 0, y, w, 1);
    for (let x = 0; x < w; x += 2) fill(g, 'rgba(255,255,255,0.04)', x, 0, 1, h);
    if (stripe) {
      fill(g, stripe, 0, 18, w, 10);
      fill(g, stripe, 0, 34, w, 4);
    }
    grain(g, w, h, rnd, 14);
  }, base.length);

export const grilleTexture = () =>
  paint(256, 192, (g, w, h, rnd) => {
    fill(g, '#353b43', 0, 0, w, h);
    bevel(g, 0, 0, w, h, '#6a727c', '#1b1f24', 6);
    for (let y = 24; y < h - 24; y += 16) {
      fill(g, '#0c0e11', 22, y, w - 44, 10);
      fill(g, '#5a616a', 22, y + 10, w - 44, 2);
    }
    for (const [x, y] of [
      [12, 12],
      [w - 12, 12],
      [12, h - 12],
      [w - 12, h - 12],
    ])
      bolt(g, x, y, 5);
    grain(g, w, h, rnd, 16);
  });

/** Экраны пультов: у каждого вида задания свой рисунок, у аварийной панели — тревога. */
export function screenTexture(kind: string) {
  return paint(256, 160, (g, w, h, rnd) => {
    const [family, variant] = kind.split(':');
    if (family === 'panel') {
      screenBase(g, w, h, '#2a0508', '#6b1016');
      g.fillStyle = '#ffcf33';
      g.beginPath();
      g.moveTo(64, 26);
      g.lineTo(106, 104);
      g.lineTo(22, 104);
      g.fill();
      text(g, '!', 64, 78, 50, '#2a0508');
      const title: Record<string, string> = { lights: 'СВЕТ', comms: 'СВЯЗЬ', reactor: 'РЕАКТОР', o2: 'O2' };
      text(g, 'АВАРИЯ', 184, 52, 26, '#ff5a5a');
      text(g, title[variant] ?? '', 184, 88, 22, '#ffd0d0');
      for (let x = 0; x < w; x += 24) {
        fill(g, '#ffcf33', x, 128, 12, 20);
      }
    } else {
      screenBase(g, w, h);
      text(g, variant === 'wires' ? 'ПРОВОДКА' : variant === 'code' ? 'КОД' : variant === 'hold' ? 'СИСТЕМА' : variant === 'calibrate' ? 'КАЛИБРОВКА' : 'ДАННЫЕ', 14, 20, 15, '#6fdcff', 'left');
      if (variant === 'wires') {
        const colors = ['#ff4b4b', '#3aa0ff', '#ffd23f', '#ff5ce1'];
        const to = [2, 0, 3, 1];
        g.lineWidth = 8;
        colors.forEach((c, i) => {
          const y0 = 48 + i * 28,
            y1 = 48 + to[i] * 28;
          g.strokeStyle = c;
          g.beginPath();
          g.moveTo(28, y0);
          g.bezierCurveTo(110, y0, 146, y1, 228, y1);
          g.stroke();
          fill(g, c, 14, y0 - 7, 16, 14);
          fill(g, c, 226, y1 - 7, 16, 14);
        });
      } else if (variant === 'code') {
        fill(g, '#0a2d38', 14, 34, 110, 34);
        text(g, '7 3 1 _', 69, 52, 22, '#7ff0ff');
        for (let i = 0; i < 9; i++) {
          const x = 142 + (i % 3) * 36,
            y = 34 + Math.floor(i / 3) * 38;
          g.strokeStyle = '#2fb5d6';
          g.lineWidth = 2;
          g.strokeRect(x, y, 30, 30);
          text(g, String(i + 1), x + 15, y + 16, 16, '#aef4ff');
        }
        fill(g, '#1ea672', 14, 84, 110, 60);
        text(g, 'ВВОД', 69, 114, 20, '#dfffee');
      } else if (variant === 'hold') {
        g.lineWidth = 14;
        g.strokeStyle = '#16424c';
        g.beginPath();
        g.arc(80, 92, 44, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = '#43f08f';
        g.beginPath();
        g.arc(80, 92, 44, -Math.PI / 2, Math.PI);
        g.stroke();
        text(g, '75%', 80, 94, 22, '#c9ffe0');
        for (let i = 0; i < 5; i++) {
          fill(g, '#16424c', 150, 44 + i * 22, 90, 12);
          fill(g, i < 3 ? '#43f08f' : '#ffcf33', 150, 44 + i * 22, 30 + rnd() * 60, 12);
        }
      } else if (variant === 'calibrate') {
        for (let i = 0; i < 3; i++) {
          const y = 48 + i * 36;
          fill(g, '#0f3440', 20, y, 216, 20);
          fill(g, 'rgba(67,240,143,0.35)', 90 + i * 20, y, 40, 20);
          fill(g, '#ffd23f', 60 + rnd() * 140, y - 4, 6, 28);
        }
      } else {
        fill(g, '#ffcf33', 20, 44, 44, 34);
        fill(g, '#ffcf33', 20, 38, 20, 8);
        fill(g, '#ffcf33', 190, 44, 44, 34);
        fill(g, '#ffcf33', 190, 38, 20, 8);
        g.strokeStyle = '#6fdcff';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(80, 61);
        g.lineTo(172, 61);
        g.lineTo(160, 51);
        g.moveTo(172, 61);
        g.lineTo(160, 71);
        g.stroke();
        fill(g, '#0f3440', 20, 100, 216, 22);
        fill(g, '#39b6ff', 20, 100, 140, 22);
        text(g, '64%', 128, 138, 16, '#aee6ff');
      }
    }
    scanlines(g, w, h);
  }, kind.length * 13);
}

/** Окно в космос: туманность, звёзды и край планеты. */
export const starfieldTexture = () =>
  paint(512, 256, (g, w, h, rnd) => {
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#01030a');
    bg.addColorStop(1, '#071234');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    for (const [x, y, r, c] of [
      [120, 80, 140, 'rgba(120,70,190,0.28)'],
      [380, 170, 160, 'rgba(40,110,200,0.22)'],
      [260, 40, 90, 'rgba(200,80,150,0.14)'],
    ] as const) {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, c);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < 420; i++) {
      const s = rnd() < 0.93 ? 1 : 2 + rnd() * 1.5;
      g.fillStyle = `rgba(255,255,${220 + Math.floor(rnd() * 35)},${0.4 + rnd() * 0.6})`;
      g.fillRect(rnd() * w, rnd() * h, s, s);
    }
    const planet = g.createRadialGradient(430, 220, 10, 460, 250, 130);
    planet.addColorStop(0, '#e2a35c');
    planet.addColorStop(0.7, '#8a4b2a');
    planet.addColorStop(1, '#1a0d08');
    g.fillStyle = planet;
    g.beginPath();
    g.arc(470, 260, 120, 0, Math.PI * 2);
    g.fill();
  }, 99);

/** Табличка над дверью с названием отсека. */
export const signTexture = (label: string) =>
  paint(512, 96, (g, w, h) => {
    fill(g, '#1b2129', 0, 0, w, h);
    bevel(g, 0, 0, w, h, '#4a5563', '#0b0e12', 5);
    fill(g, '#39b6ff', 18, 20, 8, h - 40);
    fill(g, '#39b6ff', w - 26, 20, 8, h - 40);
    text(g, label.toUpperCase(), w / 2, h / 2 + 2, label.length > 12 ? 36 : 44, '#f2f7ff');
  }, label.length);

/** Фасад торгового автомата: витрина с банками или пачками, кнопки и лоток. */
export const vendingTexture = (snack: boolean) =>
  paint(256, 428, (g, w, h, rnd) => {
    fill(g, snack ? '#2f5f9e' : '#b3313a', 0, 0, w, h);
    bevel(g, 0, 0, w, h, 'rgba(255,255,255,0.35)', 'rgba(0,0,0,0.4)', 6);
    fill(g, '#f7f3ea', 12, 12, w - 24, 52);
    text(g, snack ? 'СНЕКИ' : 'КОЛА', w / 2, 40, 34, snack ? '#2f5f9e' : '#b3313a');
    fill(g, '#0d1a24', 14, 76, 162, 256);
    const palette = snack ? ['#f5b72c', '#e0524a', '#48b36a', '#9a5fd0'] : ['#e53b3b', '#f2f2f2', '#3a8ee6', '#f5a623'];
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 5; col++) {
        const x = 22 + col * 31,
          y = 84 + row * 50;
        g.fillStyle = palette[(row + col * 3) % palette.length];
        if (snack) g.fillRect(x, y + 6, 24, 34);
        else {
          g.fillRect(x + 3, y + 8, 18, 32);
          fill(g, 'rgba(255,255,255,0.5)', x + 6, y + 10, 3, 28);
        }
        fill(g, '#9aa3ad', x - 4, y + 42, 31, 3);
      }
    fill(g, 'rgba(255,255,255,0.08)', 14, 76, 60, 256);
    fill(g, '#1a1d22', 186, 90, 56, 120);
    for (let i = 0; i < 9; i++) fill(g, rnd() < 0.3 ? '#7ff0a0' : '#c9ced6', 194 + (i % 3) * 16, 100 + Math.floor(i / 3) * 18, 10, 10);
    fill(g, '#39b6ff', 194, 164, 42, 18);
    fill(g, '#0a0b0d', 30, 350, 130, 48);
    bevel(g, 30, 350, 130, 48, '#000', '#555', 3);
    grain(g, w, h, rnd, 12);
  }, snack ? 21 : 22);

/** Передняя панель серверной стойки с огоньками. */
export const rackTexture = () =>
  paint(256, 512, (g, w, h, rnd) => {
    fill(g, '#111418', 0, 0, w, h);
    for (let y = 8; y < h - 8; y += 50) {
      fill(g, '#22272e', 10, y, w - 20, 44);
      bevel(g, 10, y, w - 20, 44, '#3a414b', '#0b0d10', 2);
      for (let k = 0; k < 8; k++) fill(g, '#0b0d10', 120 + k * 12, y + 10, 6, 24);
      for (let k = 0; k < 6; k++) {
        const on = rnd() < 0.65;
        const color = on ? ['#3dff8a', '#39b6ff', '#ffcc33', '#ff5555'][Math.floor(rnd() * 4)] : '#2a2f36';
        fill(g, color, 22 + k * 14, y + 16, 8, 8);
      }
      fill(g, '#39b6ff', 22, y + 32, 40 + rnd() * 50, 3);
    }
  }, 17);

/** Столешница-голограмма администрации: план корабля по отсекам карты. */
export const holoMapTexture = (zones: MapZone[], bounds: Bounds) =>
  paint(512, 330, (g, w, h) => {
    const bg = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.6);
    bg.addColorStop(0, '#0a3a4d');
    bg.addColorStop(1, '#03121a');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,200,255,0.12)';
    g.lineWidth = 1;
    for (let x = 0; x < w; x += 20) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 0; y < h; y += 20) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    const pad = 24,
      sx = (w - pad * 2) / (bounds.maxX - bounds.minX),
      sz = (h - pad * 2) / (bounds.maxZ - bounds.minZ);
    for (const z of zones) {
      const x = pad + (z.minX - bounds.minX) * sx,
        y = pad + (z.minZ - bounds.minZ) * sz,
        zw = (z.maxX - z.minX) * sx,
        zh = (z.maxZ - z.minZ) * sz;
      fill(g, 'rgba(90,220,255,0.22)', x, y, zw, zh);
      g.strokeStyle = '#7ff0ff';
      g.lineWidth = 2;
      g.strokeRect(x, y, zw, zh);
    }
    for (let i = 0; i < 5; i++) fill(g, i % 2 ? '#ff5a5a' : '#ffd23f', 60 + i * 90, 60 + ((i * 53) % 200), 6, 6);
  }, 23);

export const breakerTexture = () =>
  paint(256, 256, (g, w, h, rnd) => {
    fill(g, '#9aa1a8', 0, 0, w, h);
    bevel(g, 0, 0, w, h, '#d4d9de', '#5a6068', 6);
    fill(g, '#2a2e34', 20, 60, w - 40, 170);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 6; col++) {
        const x = 30 + col * 34,
          y = 72 + row * 54;
        fill(g, '#e9ecef', x, y, 24, 40);
        const up = rnd() < 0.7;
        fill(g, up ? '#2bb673' : '#e0524a', x + 6, up ? y + 4 : y + 20, 12, 16);
      }
    g.fillStyle = '#f0bf2e';
    g.beginPath();
    g.moveTo(128, 8);
    g.lineTo(160, 52);
    g.lineTo(96, 52);
    g.fill();
    text(g, 'ϟ', 128, 36, 26, '#1d1f22');
    grain(g, w, h, rnd, 14);
  });

/** Настенные мониторы: графики, кардиограмма или сетка камер. */
export function monitorTexture(variant: number) {
  return paint(256, 144, (g, w, h, rnd) => {
    screenBase(g, w, h);
    if (variant === 0) {
      for (let i = 0; i < 8; i++) fill(g, '#2fb5d6', 20 + i * 18, 120 - (20 + rnd() * 70), 12, 20 + rnd() * 70);
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 3;
      g.beginPath();
      for (let x = 170; x < 240; x += 10) g.lineTo(x, 50 + Math.sin(x * 0.12) * 25);
      g.stroke();
    } else if (variant === 1) {
      g.strokeStyle = '#43f08f';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(10, 80);
      for (let x = 10; x < w - 10; x += 6) {
        const k = x % 80;
        g.lineTo(x, k > 36 && k < 44 ? 30 : k > 44 && k < 50 ? 110 : 80);
      }
      g.stroke();
      text(g, '72', 220, 30, 22, '#43f08f');
    } else {
      for (let i = 0; i < 4; i++) {
        const x = 10 + (i % 2) * 120,
          y = 10 + Math.floor(i / 2) * 64;
        fill(g, '#0f2a30', x, y, 116, 60);
        g.strokeStyle = 'rgba(160,220,230,0.35)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, y + 60);
        g.lineTo(x + 40, y + 30);
        g.lineTo(x + 76, y + 30);
        g.lineTo(x + 116, y + 60);
        g.moveTo(x + 40, y + 30);
        g.lineTo(x + 40, y);
        g.moveTo(x + 76, y + 30);
        g.lineTo(x + 76, y);
        g.stroke();
        fill(g, '#ff4b4b', x + 100, y + 6, 8, 8);
      }
    }
    scanlines(g, w, h);
  }, 40 + variant);
}

/** Светящиеся полосы: сердечник реактора и сопла двигателей. */
export const glowTexture = (inner: string, outer: string) =>
  paint(64, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    for (let i = 0; i <= 8; i++) grad.addColorStop(i / 8, i % 2 ? inner : outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });

/** Площадка сканера: концентрические светящиеся кольца. */
export const scannerTexture = () =>
  paint(256, 256, (g, w, h) => {
    fill(g, '#06140f', 0, 0, w, h);
    for (let r = 120; r > 10; r -= 22) {
      g.strokeStyle = r > 100 ? '#56ffaa' : 'rgba(86,255,170,0.55)';
      g.lineWidth = r > 100 ? 10 : 4;
      g.beginPath();
      g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = 'rgba(86,255,170,0.4)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(w / 2 - 110, h / 2);
    g.lineTo(w / 2 + 110, h / 2);
    g.moveTo(w / 2, h / 2 - 110);
    g.lineTo(w / 2, h / 2 + 110);
    g.stroke();
  });
