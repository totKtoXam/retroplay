/**
 * Конвертация загруженных треков в браузере через ffmpeg.wasm.
 *
 * На сервере конвертировать негде: в Cloudflare Workers нет ffmpeg и мало
 * процессорного времени. Ядро ffmpeg (~30 МБ) берётся с jsDelivr, а не из
 * нашей статики: у Workers предел 25 МиБ на файл. Скачивается оно только при
 * первом файле, которому нужна конвертация, — MP3 и AAC его не требуют.
 *
 * Однопоточная сборка ядра выбрана намеренно: многопоточной нужен
 * SharedArrayBuffer, а значит заголовки COOP/COEP на всём сайте, которые
 * сломали бы встраивания и сторонние ресурсы ради пары секунд на трек.
 *
 * Воркер свой и лежит в public/ffmpeg-worker.js — почему не из пакета
 * @ffmpeg/ffmpeg, объяснено там.
 */
import {
  codecFromLog,
  ffmpegArgs,
  isMp4Audio,
  planAudio,
  renameForTarget,
  targetForCodec,
  type AudioTarget,
} from './audio-format';

type Reply = { id?: number; ok?: boolean; payload?: unknown; error?: string; type?: string };

/** Тонкая обёртка над воркером: команда → промис с ответом. */
class FFmpegWorker {
  private worker = new Worker('/ffmpeg-worker.js');
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  onLog: (message: string) => void = () => {};
  onProgress: (progress: number) => void = () => {};

  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      if (data.type === 'log') return this.onLog(String(data.payload));
      if (data.type === 'progress') return this.onProgress(Number(data.payload));
      const call = data.id === undefined ? undefined : this.pending.get(data.id);
      if (!call) return;
      this.pending.delete(data.id!);
      if (data.ok) call.resolve(data.payload);
      else call.reject(new Error(data.error));
    };
    // Воркер упал целиком (например, CDN недоступен) — ждать ответов бессмысленно.
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.fail(new Error(e.message || 'ffmpeg worker failed'));
    };
  }

  call<T>(type: string, payload?: unknown, transfer: Transferable[] = []) {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, type, payload }, transfer);
    });
  }

  fail(error: Error) {
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }
}

let loading: Promise<FFmpegWorker> | null = null;

function loadFFmpeg(): Promise<FFmpegWorker> {
  loading ??= (async () => {
    const ffmpeg = new FFmpegWorker();
    try {
      await ffmpeg.call('load');
    } catch (e) {
      ffmpeg.fail(e as Error);
      throw e;
    }
    return ffmpeg;
  })().catch((e) => {
    // Сеть моргнула — следующая попытка должна загрузить заново.
    loading = null;
    throw e;
  });
  return loading;
}

export type PreparedTrack = {
  blob: Blob;
  name: string;
  /** `null` — файл сохранён как есть. */
  target: AudioTarget | null;
};

/** Что сейчас происходит с файлом — для подписи в плеере. */
export type ConvertStage = 'loading' | 'converting';

/** Сколько байт начала файла хватает, чтобы найти `stsd`, если `moov` в начале. */
const HEAD_BYTES = 4 * 1024 * 1024;

export async function prepareTrack(
  file: File,
  onStage: (stage: ConvertStage, progress: number) => void,
): Promise<PreparedTrack> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  let plan = planAudio(file.name, file.type, head);
  // `moov` бывает в конце файла — тогда кодек ищем по всему файлу (он до 50 МБ).
  if (plan === 'probe' && file.size > HEAD_BYTES && isMp4Audio(file.name, file.type))
    plan = planAudio(file.name, file.type, new Uint8Array(await file.arrayBuffer()));
  if (plan === 'keep') return { blob: file, name: file.name, target: null };

  onStage('loading', 0);
  const ffmpeg = await loadFFmpeg();
  const id = crypto.randomUUID();
  const ext = /\.[a-z0-9]{1,5}$/i.exec(file.name)?.[0] ?? '';
  const input = `in-${id}${ext}`;
  let log = '';
  ffmpeg.onLog = (message) => {
    log += message + '\n';
  };
  ffmpeg.onProgress = (progress) =>
    onStage('converting', Math.max(0, Math.min(1, progress)));
  let output = '';
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await ffmpeg.call('write', { path: input, data: bytes }, [bytes.buffer]);
    // `ffmpeg -i` без выхода завершается с ошибкой, но успевает напечатать дорожки.
    await ffmpeg.call<number>('exec', ['-hide_banner', '-i', input]);
    const codec = codecFromLog(log);
    if (!codec) throw new Error('no audio stream');
    const target = targetForCodec(codec);
    output = `out-${id}.${target}`;
    onStage('converting', 0);
    const code = await ffmpeg.call<number>('exec', ffmpegArgs(input, output, target));
    if (code !== 0) throw new Error(`ffmpeg exit ${code}`);
    const data = await ffmpeg.call<Uint8Array<ArrayBuffer>>('read', { path: output });
    return {
      blob: new Blob([data], {
        type: target === 'flac' ? 'audio/flac' : 'audio/mpeg',
      }),
      name: renameForTarget(file.name, target),
      target,
    };
  } finally {
    ffmpeg.onLog = () => {};
    ffmpeg.onProgress = () => {};
    // Виртуальная ФС ffmpeg живёт в памяти вкладки — чистим сразу.
    await ffmpeg.call('delete', { path: input }).catch(() => {});
    if (output) await ffmpeg.call('delete', { path: output }).catch(() => {});
  }
}
