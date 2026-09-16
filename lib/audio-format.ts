/**
 * Во что превратить загруженный аудиофайл, чтобы он играл у всех.
 *
 * MP3 без потерь не бывает, поэтому правило такое:
 * - MP3, AAC и FLAC браузеры играют везде — храним оригинал байт в байт;
 * - несжатое и сжатое без потерь (WAV, AIFF, ALAC…) — в FLAC: тоже без потерь,
 *   но играет и в Chrome, и в Safari;
 * - остальное сжато с потерями (Ogg, Opus, WMA…) — без потерь его уже никуда не
 *   переложить, поэтому MP3 320 кбит/с как наименьшее зло.
 *
 * Здесь только решения, без ffmpeg: их можно проверить тестами.
 */

export type AudioTarget = 'flac' | 'mp3';

/** Решение без ffmpeg: `keep` — хранить как есть, `probe` — узнать кодек и конвертировать. */
export type AudioPlan = 'keep' | 'probe';

const KEEP_EXT = /\.(mp3|aac|flac)$/i;
const KEEP_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
]);
const MP4_EXT = /\.(m4a|mp4|m4b)$/i;
const MP4_TYPES = new Set(['audio/mp4', 'audio/x-m4a', 'audio/m4a']);

/**
 * Кодек звука в MP4/M4A по первой записи `stsd`: `mp4a` — AAC, `alac` — Apple
 * Lossless. Контейнер один, а играют их браузеры по-разному, поэтому по
 * расширению не решить. `null` — запись не нашлась.
 */
export function mp4AudioCodec(bytes: Uint8Array): string | null {
  // [размер 4][«stsd» 4][версия и флаги 4][число записей 4][размер записи 4][тип 4]
  for (let i = 4; i + 16 <= bytes.length; i++) {
    if (
      bytes[i] !== 0x73 ||
      bytes[i + 1] !== 0x74 ||
      bytes[i + 2] !== 0x73 ||
      bytes[i + 3] !== 0x64
    )
      continue;
    const at = i + 16;
    return String.fromCharCode(...bytes.subarray(at, at + 4));
  }
  return null;
}

export function isMp4Audio(name: string, type: string) {
  return MP4_EXT.test(name) || MP4_TYPES.has(type);
}

export function planAudio(
  name: string,
  type: string,
  bytes: Uint8Array,
): AudioPlan {
  if (KEEP_EXT.test(name) || KEEP_TYPES.has(type)) return 'keep';
  if (isMp4Audio(name, type))
    return mp4AudioCodec(bytes) === 'mp4a' ? 'keep' : 'probe';
  return 'probe';
}

/** Кодеки без потерь: их переводим в FLAC, всё прочее — в MP3. */
const LOSSLESS = /^(pcm_|flac$|alac$|wavpack$|ape$|tta$|truehd$|mlp$|shorten$|als$)/;

/** Кодек первой звуковой дорожки из вывода `ffmpeg -i`, например `aac` или `pcm_s16le`. */
export function codecFromLog(log: string): string | null {
  const m = /Stream #\d+:\d+[^:]*: Audio: ([a-z0-9_]+)/i.exec(log);
  return m ? m[1].toLowerCase() : null;
}

export function targetForCodec(codec: string): AudioTarget {
  return LOSSLESS.test(codec) ? 'flac' : 'mp3';
}

/** Аргументы ffmpeg: обложку (видеодорожку) отбрасываем, теги переносим. */
export function ffmpegArgs(input: string, output: string, target: AudioTarget) {
  const codec =
    target === 'flac'
      ? ['-c:a', 'flac', '-compression_level', '5']
      : ['-c:a', 'libmp3lame', '-b:a', '320k'];
  return ['-i', input, '-vn', '-map_metadata', '0', ...codec, output];
}

/** Имя файла после конвертации: то же, с новым расширением. */
export function renameForTarget(name: string, target: AudioTarget) {
  const base = name.replace(/\.[^.\\/]{1,5}$/, '') || 'track';
  return `${base}.${target}`;
}
