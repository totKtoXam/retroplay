// Времена года для боевых карт. Хаб перекрашивает свою рукотворную сцену сам
// (components/world-scene.ts), а арены собраны из цветных коробок
// (lib/maps) — у них нет «листвы» и «травы» как отдельных объектов. Поэтому
// сезон здесь — правило перекраски цвета: зелень желтеет осенью и уходит под
// снег зимой, земля белеет, вода замерзает. Модуль чистый, чтобы его можно было
// проверить тестом без three.js.

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
/** Как цвет используется: земля белеет сильнее стен, вода замерзает. */
export type ColorRole = 'ground' | 'surface' | 'water';

type Rgb = [number, number, number];
type Hsl = [number, number, number];

const parse = (hex: string): Rgb => {
  let digits = hex.replace('#', '');
  if (digits.length === 3) digits = digits.replace(/./g, (c) => c + c);
  const n = parseInt(digits.slice(0, 6).padEnd(6, '0'), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const format = ([r, g, b]: Rgb) =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

function toHsl([r, g, b]: Rgb): Hsl {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

/** Тон 0…360, насыщенность и светлота 0…1 — для классификации цветов вне этого модуля. */
export const hexToHsl = (hex: string): Hsl => toHsl(parse(hex));

function fromHsl([h, s, l]: Hsl): Rgb {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
    p = 2 * l - q;
  const channel = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)];
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Зелень: трава, кусты, листва, изгороди. */
export const isVegetation = (hex: string) => {
  const [h, s, l] = toHsl(parse(hex));
  return h >= 60 && h <= 170 && s > 0.12 && l > 0.08 && l < 0.85;
};
/**
 * Снег и лёд: светлое и почти бесцветное. У почти белого насыщенность по HSL раздувается
 * (у голубоватого наста `#f6fafd` она 0,64), поэтому бесцветность проверяется ещё и по
 * размаху каналов — иначе такие сугробы летом не таяли и хрустели бы как камень.
 */
export const isSnowy = (hex: string) => {
  const rgb = parse(hex);
  const [, s, l] = toHsl(rgb);
  const chroma = Math.max(...rgb) - Math.min(...rgb);
  return l > 0.8 && (s < 0.4 || chroma < 0.12);
};

const SNOW = parse('#e6edf2');
const ICE = parse('#cfe2ea');
const MEADOW = parse('#8d9a78');
const THAW = parse('#9fb08e');
const DRY_GRASS = parse('#9a8a68');

/**
 * Цвет `hex` в сезоне `season` на карте, чей исходный облик — `native`.
 * В родном сезоне цвет не меняется: карта выглядит ровно так, как её нарисовали.
 */
export function seasonColor(hex: string, season: string, native: Season = 'summer', role: ColorRole = 'surface'): string {
  if (season === native || !['spring', 'summer', 'autumn', 'winter'].includes(season)) return hex;
  const rgb = parse(hex);
  if (native === 'winter') {
    // Заснеженная карта в тёплый сезон: снег на земле тает до луга или сухой травы.
    if (role === 'water' || !isSnowy(hex)) return hex;
    const ground = role === 'ground';
    if (season === 'summer') return format(mix(rgb, MEADOW, ground ? 0.75 : 0.45));
    if (season === 'spring') return format(mix(rgb, THAW, ground ? 0.55 : 0.3));
    return format(mix(rgb, DRY_GRASS, ground ? 0.6 : 0.35));
  }
  if (role === 'water') return season === 'winter' ? format(mix(rgb, ICE, 0.65)) : hex;
  const vegetation = isVegetation(hex);
  if (season === 'winter') {
    if (vegetation) return format(mix(rgb, SNOW, role === 'ground' ? 0.85 : 0.55));
    return format(mix(rgb, SNOW, role === 'ground' ? 0.7 : 0.08));
  }
  if (!vegetation) {
    // Осенью открытая земля чуть темнеет от сырости, весной остаётся как есть.
    return season === 'autumn' && role === 'ground' ? format(mix(rgb, DRY_GRASS, 0.12)) : hex;
  }
  const [h, s, l] = toHsl(rgb);
  if (season === 'spring') return format(fromHsl([h + (105 - h) * 0.4, clamp01(s * 1.12), clamp01(l * 1.06)]));
  // Осень: зелень уходит в охру и рыжину.
  return format(fromHsl([h + (32 - h) * 0.8, clamp01(Math.max(s, 0.35) * 1.05), clamp01(l * 1.02)]));
}
