/**
 * Звуки оружия: выстрелы, бросок и взрыв пиньяты, разрыв фейерверка, шлепок краски, щелчок
 * фонарика. Записи —
 * public/sounds/weapons (источники и лицензии в README.md рядом), по одному короткому файлу на
 * событие. Каждый раз звук чуть сдвинут по высоте и громкости, чтобы очередь не звучала одним
 * семплом.
 *
 * Свой выстрел звучит в полную силу и по центру. Чужие — тише с расстоянием, глуше за стеной и
 * разнесены влево-вправо относительно взгляда, так что стрелка слышно, даже не видя его.
 *
 * AudioContext браузер разрешает только после жеста игрока: контекст и записи загружаются лениво,
 * `resume()` вызывается по клику по миру — тем же, что включает шаги.
 */

export const WEAPON_SOUNDS = [
  'paint',
  'confetti',
  'sniper',
  'like',
  'grenade-throw',
  'grenade-burst',
  'firework',
  'paint-splat',
  'flashlight',
] as const;
export type WeaponSound = (typeof WEAPON_SOUNDS)[number];

/** Громкость по звукам: частые выстрелы тише, чтобы очередь не резала уши. */
const GAIN: Record<WeaponSound, number> = {
  paint: 0.45,
  confetti: 0.75,
  sniper: 0.85,
  like: 0.45,
  'grenade-throw': 0.5,
  'grenade-burst': 0.8,
  firework: 0.7,
  'paint-splat': 0.35,
  flashlight: 0.4,
};
/** Дальше этого звук не слышно, м. Выстрел снайперки и взрывы слышно дальше всего. */
const RANGE: Record<WeaponSound, number> = {
  paint: 45,
  confetti: 50,
  sniper: 80,
  like: 35,
  'grenade-throw': 20,
  'grenade-burst': 60,
  firework: 70,
  'paint-splat': 18,
  flashlight: 12,
};
const MASTER = 0.7;
/** Одновременно звучащих источников не больше этого: в перестрелке лишние просто пропускаются. */
const MAX_VOICES = 24;

export type Listener = { x: number; y: number; z: number; yaw: number };
type Point = readonly [number, number, number];

export function createWeaponSounds(options: {
  /** Где уши игрока и куда он смотрит (вперёд — (−sin yaw, −cos yaw), как у камеры). */
  listener: () => Listener;
  /** Между двумя точками стена. */
  occluded: (from: Point, to: Point) => boolean;
}) {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let disposed = false;
  let voices = 0;
  const buffers = new Map<WeaponSound, AudioBuffer>();

  const audio = () => {
    if (ctx || disposed) return ctx;
    if (typeof AudioContext === 'undefined') return null;
    try {
      const c = new AudioContext();
      master = c.createGain();
      master.gain.value = MASTER;
      master.connect(c.destination);
      ctx = c;
      for (const name of WEAPON_SOUNDS)
        void fetch(`/sounds/weapons/${name}.mp3`)
          .then((r) =>
            r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`)),
          )
          .then((data) => c.decodeAudioData(data))
          .then((buffer) => {
            if (!disposed) buffers.set(name, buffer);
          })
          // Без записи это событие просто беззвучно — игре это не мешает.
          .catch(() => {});
    } catch {
      ctx = null;
    }
    return ctx;
  };

  /** Звук `name` в точке `at`; `own` — свой выстрел: без расстояния и стен. */
  const play = (name: WeaponSound, at: Point, own: boolean, volume = 1, rate = 1) => {
    const c = ctx;
    const buffer = buffers.get(name);
    if (
      !c ||
      !master ||
      !buffer ||
      c.state !== 'running' ||
      voices >= MAX_VOICES
    )
      return;
    let gain = GAIN[name] * volume,
      pan = 0,
      muffle = 0;
    if (!own) {
      const me = options.listener();
      const dx = at[0] - me.x,
        dz = at[2] - me.z;
      const dist = Math.hypot(dx, dz, at[1] - me.y);
      const range = RANGE[name];
      if (dist > range) return;
      gain *= (1 - dist / range) ** 1.4;
      // Вправо от взгляда — (cos yaw, −sin yaw).
      const flat = Math.hypot(dx, dz);
      pan =
        flat > 0.1
          ? ((dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw)) / flat) * 0.8
          : 0;
      const walled = options.occluded([me.x, me.y, me.z], at);
      if (walled) gain *= 0.5;
      muffle = (walled ? 0.7 : 0) + (dist / range) * 0.3;
    }
    if (gain < 0.01) return;

    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate * (0.95 + Math.random() * 0.1);
    const amp = c.createGain();
    amp.gain.value = gain * (0.9 + Math.random() * 0.2);
    let node: AudioNode = src;
    if (muffle > 0.02) {
      const lowpass = c.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value =
        18000 * Math.pow(500 / 18000, Math.min(1, muffle));
      node.connect(lowpass);
      node = lowpass;
    }
    node.connect(amp);
    let tail: AudioNode = amp;
    if (pan && typeof c.createStereoPanner === 'function') {
      const panner = c.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      amp.connect(panner);
      tail = panner;
    }
    tail.connect(master);
    voices++;
    src.onended = () => {
      voices--;
      tail.disconnect();
    };
    src.start();
  };

  return {
    /** Разрешить звук после жеста игрока (клик по миру). */
    resume() {
      void audio()?.resume();
    },

    /** Выстрел или бросок из точки `from`. */
    fire(kind: string, from: Point, own: boolean, volume = 1) {
      const name: WeaponSound | null =
        kind === 'grenade'
          ? 'grenade-throw'
          : kind === 'paint' ||
              kind === 'confetti' ||
              kind === 'sniper' ||
              kind === 'like'
            ? kind
            : null;
      if (name) play(name, from, own, volume);
    },

    /** Снаряд долетел до `at`: краска шлёпнулась, пиньята взорвалась, фейерверк разорвался. */
    impact(kind: string, at: Point, volume = 1) {
      const name: WeaponSound | null =
        kind === 'grenade'
          ? 'grenade-burst'
          : kind === 'sniper'
            ? 'firework'
            : kind === 'paint'
              ? 'paint-splat'
              : null;
      if (name) play(name, at, false, volume);
    },

    /** Щелчок фонарика: включение звучит выше выключения, как у настоящей кнопки. */
    click(on: boolean, at: Point, own: boolean, volume = 1) {
      play('flashlight', at, own, volume, on ? 1.12 : 0.88);
    },

    dispose() {
      disposed = true;
      buffers.clear();
      void ctx?.close();
      ctx = null;
      master = null;
    },
  };
}
