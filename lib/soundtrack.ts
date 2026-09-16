import { musicGain, trackTitleFromFile } from './music-mix';
import { SETTINGS_APPLIED_EVENT } from './settings-sync';
import {
  deleteStoredTrack,
  loadStoredTracks,
  saveStoredTrack,
} from './music-library';

export const TRACKS = [
  {
    id: 'evening',
    title: 'Afterglow',
    subtitle: 'Мягкое пианино · 72 BPM',
    bpm: 72,
    roots: [48, 45, 53, 55],
    melody: [72, 76, 79, 76, 74, 72, 69, 67, 65, 69, 72, 76, 74, 71, 67, 71],
  },
  {
    id: 'steppe',
    title: 'Steppe Breeze',
    subtitle: 'Воздушные струны · 84 BPM',
    bpm: 84,
    roots: [50, 57, 55, 53],
    melody: [74, 77, 81, 77, 76, 74, 69, 72, 74, 79, 77, 74, 72, 69, 65, 69],
  },
  {
    id: 'rain',
    title: 'Rainy Garden',
    subtitle: 'Спокойный эмбиент · 66 BPM',
    bpm: 66,
    roots: [45, 53, 48, 55],
    melody: [69, 72, 76, 72, 77, 76, 72, 69, 67, 72, 76, 79, 77, 74, 71, 67],
  },
  {
    id: 'sora',
    title: 'Sky Letters',
    subtitle: 'Аниме-пианино · 88 BPM',
    bpm: 88,
    roots: [48, 55, 57, 53],
    melody: [76, 79, 84, 83, 79, 76, 74, 79, 81, 79, 76, 72, 77, 76, 74, 72],
  },
];

/** Небольшие оригинальные аранжировки: пианино, бас, мягкая перкуссия и стереозадержка. */
export class Soundtrack {
  private context: AudioContext;
  private master: GainNode;
  private dry: GainNode;
  private delay: DelayNode;
  private noise: AudioBuffer;
  private timer: ReturnType<typeof setInterval> | undefined;
  private generation = 0;
  private step = 0;
  private next = 0;
  private track = TRACKS[0];
  private voices = new Set<AudioScheduledSourceNode>();
  /** Плеер загруженных файлов: идёт через тот же master, чтобы громкость и приглушение были общими. */
  private element: HTMLAudioElement | null = null;
  constructor() {
    const c = (this.context = new AudioContext());
    this.master = c.createGain();
    this.master.gain.value = 0.3;
    const compressor = c.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;
    this.master.connect(compressor);
    compressor.connect(c.destination);
    this.dry = c.createGain();
    this.dry.gain.value = 0.65;
    this.dry.connect(this.master);
    this.delay = c.createDelay(2);
    this.delay.delayTime.value = 0.42;
    const feedback = c.createGain();
    feedback.gain.value = 0.21;
    this.delay.connect(feedback);
    feedback.connect(this.delay);
    const wet = c.createGain();
    wet.gain.value = 0.23;
    this.delay.connect(wet);
    wet.connect(this.master);
    this.noise = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  private voice(
    midi: number,
    at: number,
    duration: number,
    volume: number,
    kind: 'piano' | 'bass' = 'piano',
  ) {
    const c = this.context,
      osc = c.createOscillator(),
      gain = c.createGain(),
      filter = c.createBiquadFilter(),
      pan = c.createStereoPanner();
    osc.type = kind === 'bass' ? 'sine' : 'triangle';
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    filter.type = 'lowpass';
    filter.frequency.value = kind === 'bass' ? 500 : 1800;
    pan.pan.value = kind === 'bass' ? 0 : Math.sin(midi) * 0.3;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.dry);
    pan.connect(this.delay);
    this.voices.add(osc);
    osc.onended = () => {
      this.voices.delete(osc);
      osc.disconnect();
      gain.disconnect();
      filter.disconnect();
      pan.disconnect();
    };
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }
  private hat(at: number, volume: number) {
    const c = this.context,
      src = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      gain = c.createGain();
    src.buffer = this.noise;
    filter.type = 'highpass';
    filter.frequency.value = 6500;
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.075);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.dry);
    this.voices.add(src);
    src.onended = () => {
      this.voices.delete(src);
      src.disconnect();
      gain.disconnect();
      filter.disconnect();
    };
    src.start(at);
    src.stop(at + 0.09);
  }
  private schedule() {
    const c = this.context,
      beat = 60 / this.track.bpm;
    // Не воспроизводим пропущенные такты залпом после фоновой вкладки.
    if (this.next < c.currentTime - 0.2) this.next = c.currentTime + 0.04;
    while (this.next < c.currentTime + 0.2) {
      const step = this.step++,
        bar = Math.floor(step / 8),
        root = this.track.roots[bar % 4],
        at = this.next;
      if (step % 8 === 0) {
        this.voice(root - 12, at, beat * 3, 0.16, 'bass');
        [0, 7, 12, 16].forEach((n, i) =>
          this.voice(root + n, at + i * 0.028, beat * 3, 0.055),
        );
      }
      if (step % 2 === 0)
        this.voice(
          this.track.melody[Math.floor(step / 2) % 16],
          at,
          beat * 1.9,
          0.13,
        );
      if (step % 2 === 1) this.hat(at, 0.022);
      if (step % 8 === 0 || step % 8 === 4)
        this.voice(30, at, 0.19, 0.14, 'bass');
      this.next += beat / 2 + (step % 2 === 0 ? 0.02 : -0.02);
    }
  }
  async play(id: string) {
    this.stop();
    this.track = TRACKS.find((t) => t.id === id) || TRACKS[0];
    const generation = this.generation;
    await this.context.resume();
    if (generation !== this.generation) return;
    this.step = 0;
    this.next = this.context.currentTime + 0.06;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 75);
  }
  /** Загруженный файл. `onEnded` зовётся, только если трек доиграл сам, а не был остановлен. */
  async playFile(url: string, onEnded: () => void) {
    this.stop();
    const generation = this.generation;
    if (!this.element) {
      this.element = new Audio();
      this.element.preload = 'auto';
      this.context.createMediaElementSource(this.element).connect(this.master);
    }
    const element = this.element;
    element.onended = () => {
      if (generation === this.generation) onEnded();
    };
    element.src = url;
    await this.context.resume();
    if (generation !== this.generation) return;
    await element.play();
  }
  volume(value: number) {
    this.master.gain.setTargetAtTime(
      Math.max(0, Math.min(1, value)),
      this.context.currentTime,
      0.12,
    );
  }
  stop() {
    this.generation++;
    clearInterval(this.timer);
    this.timer = undefined;
    for (const v of this.voices) {
      try {
        v.stop();
      } catch {}
    }
    this.voices.clear();
    if (this.element) {
      this.element.onended = null;
      this.element.pause();
    }
  }
  async dispose() {
    this.stop();
    await this.context.close();
  }
}

/** Трек плейлиста: встроенная аранжировка или файл, загруженный игроком. */
export type PlaylistTrack = {
  id: string;
  title: string;
  subtitle: string;
  custom: boolean;
};

export type MusicState = {
  playing: boolean;
  track: string;
  volume: number;
  /** Музыка на фоне: тише и уступает голосам. Включено по умолчанию. */
  background: boolean;
  /** Кто-то сейчас говорит в голосовой чат. */
  voiceActive: boolean;
  playlist: PlaylistTrack[];
  error?: string;
};

const BUILTIN_PLAYLIST: PlaylistTrack[] = TRACKS.map((t) => ({
  id: t.id,
  title: t.title,
  subtitle: t.subtitle,
  custom: false,
}));

/** Потолок одного файла: IndexedDB выдержит и больше, но это уже не песня, а альбом. */
export const MAX_TRACK_BYTES = 50 * 1024 * 1024;
const MAX_CUSTOM_TRACKS = 50;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
const PREFS_KEY = 'jinaly-music-prefs';

let sharedPlayer: Soundtrack | null = null;
let currentMusicState: MusicState = {
  playing: false,
  track: 'evening',
  volume: 0.5,
  background: true,
  voiceActive: false,
  playlist: BUILTIN_PLAYLIST,
};
const musicListeners = new Set<() => void>();
/** Blob-ссылки загруженных треков: живут, пока открыта страница. */
const customUrls = new Map<string, string>();
let libraryLoaded = false;
/** Сохранённый свой трек: применяется, когда его файл подгрузится из IndexedDB. */
let savedCustomTrack = '';
/** Растёт на каждый запуск и паузу: ответ устаревшего `play()` не должен перетирать новый. */
let playToken = 0;

function setState(patch: Partial<MusicState>) {
  currentMusicState = { ...currentMusicState, ...patch };
  musicListeners.forEach((l) => l());
}

function applyGain() {
  const { volume, background, voiceActive } = currentMusicState;
  sharedPlayer?.volume(musicGain(volume, background, voiceActive));
}

function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        volume: currentMusicState.volume,
        background: currentMusicState.background,
        track: currentMusicState.track,
      }),
    );
  } catch {
    // Настройки удобства: без хранилища просто не запомнятся.
  }
}

function customTrack(id: string, name: string): PlaylistTrack {
  return {
    id,
    title: trackTitleFromFile(name),
    subtitle: 'Ваш файл',
    custom: true,
  };
}

function loadPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    const patch: Partial<MusicState> = {};
    if (typeof prefs.volume === 'number')
      patch.volume = Math.max(0, Math.min(1, prefs.volume));
    if (typeof prefs.background === 'boolean')
      patch.background = prefs.background;
    if (typeof prefs.track === 'string') {
      // Играющий трек не переключаем; свой трек — только если его файл уже здесь.
      if (currentMusicState.playlist.some((t) => t.id === prefs.track)) {
        if (!currentMusicState.playing) patch.track = prefs.track;
      } else savedCustomTrack = prefs.track;
    }
    if (Object.keys(patch).length) {
      setState(patch);
      applyGain();
    }
  } catch {
    // Повреждённые настройки — остаёмся на значениях по умолчанию.
  }
}

/** Настройки и свои треки подтягиваются при первой подписке — только в браузере. */
function loadLibrary() {
  if (libraryLoaded || typeof window === 'undefined') return;
  libraryLoaded = true;
  loadPrefs();
  // Настройки с аккаунта пришли уже после загрузки страницы (lib/settings-sync.ts).
  window.addEventListener(SETTINGS_APPLIED_EVENT, loadPrefs);
  void loadStoredTracks()
    .then((stored) => {
      const added = stored.filter((t) => !customUrls.has(t.id));
      for (const t of added) customUrls.set(t.id, URL.createObjectURL(t.blob));
      if (!added.length) return;
      setState({
        playlist: [
          ...currentMusicState.playlist,
          ...added.map((t) => customTrack(t.id, t.name)),
        ],
        // Свой трек выбирается, только когда его файл нашёлся на устройстве.
        ...(!currentMusicState.playing &&
        added.some((t) => t.id === savedCustomTrack)
          ? { track: savedCustomTrack }
          : {}),
      });
    })
    .catch(() => {
      // Нет IndexedDB (приватный режим и т. п.) — свои треки живут до перезагрузки.
    });
}

export function getMusicState(): MusicState {
  return currentMusicState;
}

export function subscribeMusic(listener: () => void) {
  musicListeners.add(listener);
  loadLibrary();
  return () => {
    musicListeners.delete(listener);
  };
}

export async function playMusic(id = currentMusicState.track) {
  const token = ++playToken;
  const known = currentMusicState.playlist.some((t) => t.id === id);
  const trackId = known ? id : BUILTIN_PLAYLIST[0].id;
  const url = customUrls.get(trackId);
  try {
    if (!sharedPlayer) sharedPlayer = new Soundtrack();
    applyGain();
    setState({ track: trackId, error: undefined });
    savePrefs();
    if (url) await sharedPlayer.playFile(url, () => void nextMusic());
    else await sharedPlayer.play(trackId);
    if (token !== playToken) return;
    setState({ playing: true });
  } catch {
    if (token !== playToken) return;
    sharedPlayer?.stop();
    setState({
      playing: false,
      error: url
        ? 'Этот файл браузер воспроизвести не смог.'
        : 'Браузер не запустил звук. Нажмите воспроизведение ещё раз.',
    });
  }
}

export function pauseMusic() {
  playToken++;
  sharedPlayer?.stop();
  setState({ playing: false });
}

/** Соседний трек плейлиста по кругу: `step` 1 — следующий, -1 — предыдущий. */
export function nextMusic(step = 1) {
  const list = currentMusicState.playlist;
  const at = list.findIndex((t) => t.id === currentMusicState.track);
  const next = list[(at + step + list.length) % list.length];
  return playMusic(next.id);
}

export function setMusicVolume(v: number) {
  setState({ volume: Math.max(0, Math.min(1, v)) });
  applyGain();
  savePrefs();
}

export function setMusicBackground(background: boolean) {
  setState({ background });
  applyGain();
  savePrefs();
}

/** Голосовой чат сообщает, говорит ли кто-то: в фоновом режиме музыка уступает. */
export function setMusicVoiceActive(voiceActive: boolean) {
  if (currentMusicState.voiceActive === voiceActive) return;
  setState({ voiceActive });
  applyGain();
}

function isAudioFile(file: File) {
  return file.type.startsWith('audio/') || AUDIO_EXT.test(file.name);
}

/** Добавить файлы в плейлист. Первый принятый файл сразу начинает играть. */
export async function addMusicFiles(files: Iterable<File>) {
  const accepted: PlaylistTrack[] = [];
  const problems: string[] = [];
  let room = MAX_CUSTOM_TRACKS - customUrls.size;
  for (const file of files) {
    if (!isAudioFile(file)) {
      problems.push(`«${file.name}» — не аудиофайл`);
      continue;
    }
    if (file.size > MAX_TRACK_BYTES) {
      problems.push(`«${file.name}» больше 50 МБ`);
      continue;
    }
    if (room <= 0) {
      problems.push(`в плейлисте уже ${MAX_CUSTOM_TRACKS} своих треков`);
      break;
    }
    room--;
    const id = 'user:' + crypto.randomUUID();
    customUrls.set(id, URL.createObjectURL(file));
    accepted.push(customTrack(id, file.name));
    try {
      await saveStoredTrack({
        id,
        name: file.name,
        blob: file,
        addedAt: Date.now(),
      });
    } catch {
      problems.push(`«${file.name}» не сохранится после перезагрузки`);
    }
  }
  setState({
    playlist: [...currentMusicState.playlist, ...accepted],
    error: problems.length ? problems.join('; ') : undefined,
  });
  if (!accepted.length) return;
  await playMusic(accepted[0].id);
  // Запуск стирает прошлую ошибку, а про отклонённые файлы игрок должен узнать.
  if (problems.length && !currentMusicState.error)
    setState({ error: problems.join('; ') });
}

export async function removeMusicTrack(id: string) {
  const url = customUrls.get(id);
  if (!url) return;
  if (currentMusicState.track === id) {
    pauseMusic();
    setState({ track: BUILTIN_PLAYLIST[0].id });
  }
  customUrls.delete(id);
  URL.revokeObjectURL(url);
  setState({
    playlist: currentMusicState.playlist.filter((t) => t.id !== id),
  });
  try {
    await deleteStoredTrack(id);
  } catch {
    // Не удалилось из хранилища — трек вернётся после перезагрузки, это не страшно.
  }
}
