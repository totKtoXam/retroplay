/**
 * Шаги: свои и чужие, без аудиофайлов — короткий шум через полосовой фильтр и глухой удар
 * снизу, как ботинок по металлическому полу. Каждый шаг чуть отличается высотой и громкостью,
 * чтобы серия не звучала одним семплом.
 *
 * Чужие шаги слышно в пределах `HEAR_RANGE`: чем дальше, тем тише, за стеной ещё тише, и звук
 * разнесён влево-вправо относительно взгляда. Медленный шаг (Shift) почти беззвучен — в режиме
 * «Предатель» это и есть способ подкрасться.
 *
 * AudioContext браузер разрешает запустить только после жеста игрока, поэтому контекст
 * создаётся лениво и `resume()` вызывается по клику по миру.
 */

/** Шаг — каждые столько метров пройденного пути. */
const STRIDE = 0.85;
/** Дальше этого чужие шаги не слышно, м. */
const HEAR_RANGE = 14;
/** Перемещение больше этого за кадр — телепорт (стол собраний, вентиляция), а не шаги. */
const TELEPORT = 2.5;

export type Walker = {
  id: string;
  x: number;
  z: number;
  /** Скорость по данным позы, м/с: медленный шаг тише. */
  speed: number;
  /** Между слушателем и шагающим стена. */
  occluded: boolean;
};

export function createFootsteps() {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  const walked = new Map<string, { x: number; z: number; acc: number }>();

  const audio = () => {
    if (ctx) return ctx;
    if (typeof AudioContext === 'undefined') return null;
    try {
      ctx = new AudioContext();
      noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.12), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    } catch {
      ctx = null;
    }
    return ctx;
  };

  /** Один шаг: громкость 0…1, панорама −1…1. */
  const play = (volume: number, pan: number) => {
    const c = ctx;
    if (!c || !noise || c.state !== 'running' || volume < 0.01) return;
    const t = c.currentTime;
    const out = c.createGain();
    out.gain.value = Math.min(0.5, volume * 0.42 * (0.85 + Math.random() * 0.3));
    let tail: AudioNode = out;
    if (typeof c.createStereoPanner === 'function') {
      const panner = c.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(panner);
      tail = panner;
    }
    tail.connect(c.destination);

    // Шорох подошвы: шум через полосовой фильтр.
    const src = c.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900 + Math.random() * 500;
    band.Q.value = 1.1;
    src.connect(band).connect(out);
    src.start(t);

    // Глухой удар по металлическому полу.
    const thump = c.createOscillator();
    const thumpGain = c.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(95 + Math.random() * 25, t);
    thump.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    thumpGain.gain.setValueAtTime(0.9, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    thump.connect(thumpGain).connect(out);
    thump.start(t);
    thump.stop(t + 0.12);
  };

  /** Накопить пройденный путь и вернуть, пора ли звучать шагу. */
  const stepped = (id: string, x: number, z: number) => {
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
    if (last.acc < STRIDE) return false;
    last.acc %= STRIDE;
    return true;
  };

  /** Медленный шаг почти не слышно, бег — громче всего. */
  const loudness = (speed: number) => (speed < 2.2 ? 0.18 : speed < 4 ? 0.7 : 1);

  return {
    /** Разрешить звук после жеста игрока (клик по миру). */
    resume() {
      void audio()?.resume();
    },

    /**
     * Кадр: свои шаги (`me`, пока стоит на земле) и чужие. `yaw` — направление взгляда
     * слушателя: вперёд — это (−sin yaw, −cos yaw), как у камеры.
     */
    update(me: { x: number; z: number; yaw: number; speed: number; grounded: boolean } | null, others: Walker[]) {
      if (!ctx) return;
      const seen = new Set<string>();
      if (me) {
        seen.add('self');
        if (stepped('self', me.x, me.z) && me.grounded) play(loudness(me.speed) * 0.75, 0);
      }
      for (const w of others) {
        seen.add(w.id);
        if (!stepped(w.id, w.x, w.z) || !me) continue;
        const dx = w.x - me.x,
          dz = w.z - me.z;
        const dist = Math.hypot(dx, dz);
        if (dist > HEAR_RANGE) continue;
        const falloff = (1 - dist / HEAR_RANGE) ** 1.6;
        // Вправо от взгляда — (cos yaw, −sin yaw).
        const pan = dist > 0.1 ? (dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw)) / dist : 0;
        play(loudness(w.speed) * falloff * (w.occluded ? 0.35 : 1), pan * 0.8);
      }
      for (const id of walked.keys()) if (!seen.has(id)) walked.delete(id);
    },

    dispose() {
      walked.clear();
      void ctx?.close();
      ctx = null;
    },
  };
}
