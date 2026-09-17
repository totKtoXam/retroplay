/**
 * Шаги: свои и чужие, из настоящих записей (public/sounds/footsteps). На каждой поверхности
 * свой файл с несколькими шагами подряд; файл делится по тишине на одиночные шаги, и каждый раз
 * играет случайный из них, не повторяя предыдущий, чуть сдвинутый по высоте и громкости.
 * По чему идёт нога, решает `surfaceAt` (lib/footsteps.ts).
 *
 * Чужие шаги слышно в пределах `HEAR_RANGE`: чем дальше, тем тише и глуше, за стеной ещё тише
 * и срезаны высокие частоты, звук разнесён влево-вправо относительно взгляда. Медленный шаг
 * (Shift) почти беззвучен — в режиме «Предатель» это и есть способ подкрасться.
 *
 * AudioContext браузер разрешает запустить только после жеста игрока, поэтому контекст и записи
 * загружаются лениво, а `resume()` вызывается по клику по миру.
 */
import {
  FOOTSTEP_SURFACES,
  footstepUrl,
  splitSteps,
  strideLength,
  type FootstepSurface,
} from '@/lib/footsteps';

/** Дальше этого чужие шаги не слышно, м. */
const HEAR_RANGE = 16;
/** Перемещение больше этого за кадр — телепорт (стол собраний, вентиляция), а не шаги. */
const TELEPORT = 2.5;
/** Общая громкость шагов: записи нормированы громко, шаги не должны заглушать выстрелы. */
const MASTER = 0.55;
/** Громкость по поверхностям: мягкие звучат тише твёрдых, мокрые всплески резкие. */
const SURFACE_GAIN: Record<FootstepSurface, number> = {
  metal: 0.9,
  tile: 0.9,
  stone: 0.9,
  wood: 1,
  carpet: 0.8,
  grass: 0.75,
  gravel: 0.8,
  snow: 0.8,
  wet: 0.75,
};

export type Walker = {
  id: string;
  x: number;
  /** Высота ступней: по ней видно, стоит ли шагающий на ковре или на полу под ним. */
  y: number;
  z: number;
  /** Скорость по данным позы, м/с: медленный шаг тише. */
  speed: number;
  /** Между слушателем и шагающим стена. */
  occluded: boolean;
};

type Bank = { buffer: AudioBuffer; steps: [number, number][]; last: number };

export function createFootsteps(options: {
  /** Поверхность под ногами в точке (x, y — высота ступней, z). */
  surfaceAt: (x: number, y: number, z: number) => FootstepSurface;
}) {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let disposed = false;
  const banks = new Map<FootstepSurface, Bank>();
  const walked = new Map<string, { x: number; z: number; acc: number }>();

  const load = (c: AudioContext) => {
    for (const surface of FOOTSTEP_SURFACES)
      void fetch(footstepUrl(surface))
        .then((r) =>
          r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`)),
        )
        .then((data) => c.decodeAudioData(data))
        .then((buffer) => {
          if (disposed) return;
          const steps = splitSteps(buffer.getChannelData(0), buffer.sampleRate);
          if (steps.length) banks.set(surface, { buffer, steps, last: -1 });
        })
        // Без записи эта поверхность просто молчит — игре это не мешает.
        .catch(() => {});
  };

  const audio = () => {
    if (ctx || disposed) return ctx;
    if (typeof AudioContext === 'undefined') return null;
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = MASTER;
      master.connect(ctx.destination);
      load(ctx);
    } catch {
      ctx = null;
    }
    return ctx;
  };

  /** Один шаг: громкость 0…1, панорама −1…1, `muffle` 0…1 — насколько срезать верх. */
  const play = (
    surface: FootstepSurface,
    volume: number,
    pan: number,
    muffle: number,
  ) => {
    const c = ctx;
    const bank = banks.get(surface);
    if (!c || !master || !bank || c.state !== 'running' || volume < 0.01)
      return;
    let pick = Math.floor(Math.random() * bank.steps.length);
    if (bank.steps.length > 1 && pick === bank.last)
      pick = (pick + 1) % bank.steps.length;
    bank.last = pick;
    const [from, to] = bank.steps[pick];

    const src = c.createBufferSource();
    src.buffer = bank.buffer;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = c.createGain();
    gain.gain.value = Math.min(
      1.2,
      volume * SURFACE_GAIN[surface] * (0.85 + Math.random() * 0.3),
    );
    let node: AudioNode = src;
    if (muffle > 0.02) {
      const lowpass = c.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value =
        18000 * Math.pow(600 / 18000, Math.min(1, muffle));
      node.connect(lowpass);
      node = lowpass;
    }
    node.connect(gain);
    let tail: AudioNode = gain;
    if (typeof c.createStereoPanner === 'function') {
      const panner = c.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      tail = panner;
    }
    tail.connect(master);
    src.start(c.currentTime, from, to - from + 0.02);
  };

  /** Накопить пройденный путь и вернуть, пора ли звучать шагу. */
  const stepped = (id: string, x: number, z: number, speed: number) => {
    const last = walked.get(id);
    if (!last) {
      walked.set(id, { x, z, acc: 0 });
      return false;
    }
    const d = Math.hypot(x - last.x, z - last.z);
    last.x = x;
    last.z = z;
    if (d > TELEPORT) {
      last.acc = 0;
      return false;
    }
    last.acc += d;
    const stride = strideLength(speed);
    if (last.acc < stride) return false;
    last.acc %= stride;
    return true;
  };

  /** Медленный шаг почти не слышно, бег — громче всего. */
  const loudness = (speed: number) =>
    speed < 2.2 ? 0.22 : speed < 4 ? 0.65 : 1;

  return {
    /** Разрешить звук после жеста игрока (клик по миру). */
    resume() {
      void audio()?.resume();
    },

    /**
     * Кадр: свои шаги (`me`, пока стоит на земле) и чужие. `yaw` — направление взгляда
     * слушателя: вперёд — это (−sin yaw, −cos yaw), как у камеры. `volume` — общий множитель
     * (в хабе шаги тише, чтобы не мешать ретроспективе).
     */
    update(
      me: {
        x: number;
        y: number;
        z: number;
        yaw: number;
        speed: number;
        grounded: boolean;
      } | null,
      others: Walker[],
      volume = 1,
    ) {
      if (!ctx) return;
      const seen = new Set<string>();
      if (me) {
        seen.add('self');
        if (stepped('self', me.x, me.z, me.speed) && me.grounded)
          play(
            options.surfaceAt(me.x, me.y, me.z),
            loudness(me.speed) * 0.7 * volume,
            0,
            0,
          );
      }
      for (const w of others) {
        seen.add(w.id);
        if (!stepped(w.id, w.x, w.z, w.speed) || !me) continue;
        const dx = w.x - me.x,
          dz = w.z - me.z;
        const dist = Math.hypot(dx, dz);
        if (dist > HEAR_RANGE) continue;
        const falloff = (1 - dist / HEAR_RANGE) ** 1.6;
        // Вправо от взгляда — (cos yaw, −sin yaw).
        const pan =
          dist > 0.1
            ? (dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw)) / dist
            : 0;
        const muffle = (w.occluded ? 0.75 : 0) + (dist / HEAR_RANGE) * 0.25;
        play(
          options.surfaceAt(w.x, w.y, w.z),
          loudness(w.speed) * falloff * (w.occluded ? 0.45 : 1) * volume,
          pan * 0.8,
          muffle,
        );
      }
      for (const id of walked.keys()) if (!seen.has(id)) walked.delete(id);
    },

    dispose() {
      disposed = true;
      walked.clear();
      banks.clear();
      void ctx?.close();
      ctx = null;
      master = null;
    },
  };
}
