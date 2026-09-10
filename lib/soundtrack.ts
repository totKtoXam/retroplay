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
  volume(value: number) {
    this.master.gain.setTargetAtTime(
      Math.max(0, Math.min(1, value)),
      this.context.currentTime,
      0.08,
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
  }
  async dispose() {
    this.stop();
    await this.context.close();
  }
}

export type MusicState = {
  playing: boolean;
  track: string;
  volume: number;
  error?: string;
};

let sharedPlayer: Soundtrack | null = null;
let currentMusicState: MusicState = {
  playing: false,
  track: 'evening',
  volume: 0.25,
};
const musicListeners = new Set<() => void>();

function notifyMusic() {
  musicListeners.forEach((l) => l());
}

export function getMusicState(): MusicState {
  return currentMusicState;
}

export function subscribeMusic(listener: () => void) {
  musicListeners.add(listener);
  return () => {
    musicListeners.delete(listener);
  };
}

export async function playMusic(id = currentMusicState.track) {
  try {
    if (!sharedPlayer) sharedPlayer = new Soundtrack();
    sharedPlayer.volume(currentMusicState.volume);
    await sharedPlayer.play(id);
    currentMusicState = {
      ...currentMusicState,
      playing: true,
      track: id,
      error: undefined,
    };
    notifyMusic();
  } catch {
    currentMusicState = {
      ...currentMusicState,
      playing: false,
      error: 'Браузер не запустил звук. Нажмите воспроизведение ещё раз.',
    };
    notifyMusic();
  }
}

export function pauseMusic() {
  sharedPlayer?.stop();
  currentMusicState = { ...currentMusicState, playing: false };
  notifyMusic();
}

export function setMusicVolume(v: number) {
  const vol = Math.max(0, Math.min(1, v));
  currentMusicState = { ...currentMusicState, volume: vol };
  sharedPlayer?.volume(vol);
  notifyMusic();
}

