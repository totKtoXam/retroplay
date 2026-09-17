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

    /** UV в метрах мира: верх и низ коробки — по x/z, стены — по длине и высоте. */
    projectUV(geometry: T.BufferGeometry, kind: SurfaceMaterial) {
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
     * Вода: полупрозрачная, почти зеркальная, рябь из двух слоёв нормалей, бегущих в разные
     * стороны, — одна текстура, смещённая по-разному, не даёт заметного повтора.
     */
    water(color: string) {
      const m = new T.MeshStandardMaterial({
        color,
        roughness: 0.06,
        metalness: 0.15,
        transparent: true,
        opacity: 0.82,
        normalMap: ripples,
        normalScale: new T.Vector2(0.45, 0.45),
        depthWrite: false,
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

    /** Лёд вместо воды (для материала из `water`): матовый, непрозрачный и неподвижный. */
    setFrozen(m: T.MeshStandardMaterial, frozen: boolean) {
      m.roughness = frozen ? 0.55 : 0.06;
      m.metalness = frozen ? 0.05 : 0.15;
      m.opacity = frozen ? 1 : 0.82;
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
