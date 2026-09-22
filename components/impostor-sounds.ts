/**
 * Звуки режима «Предатель»: начало партии, собрание, голосование, изгнание, авария, победа и
 * поражение. Записи — public/sounds/impostor (источники и лицензии в README.md рядом). Это
 * звуки интерфейса, а не мира: играют у всех одинаково, без расстояния и стен.
 *
 * AudioContext браузер разрешает только после жеста игрока. Контекст создаётся при первом
 * звуке, а разрешение берётся с первого клика или клавиши на странице — к началу партии
 * игрок уже хоть раз щёлкнул по миру.
 */

export const IMPOSTOR_SOUNDS = ['start', 'meeting', 'voting', 'vote', 'eject', 'sabotage', 'win', 'lose'] as const;
export type ImpostorSound = (typeof IMPOSTOR_SOUNDS)[number];

const GAIN: Record<ImpostorSound, number> = {
  start: 0.8,
  meeting: 0.85,
  voting: 0.5,
  vote: 0.35,
  eject: 0.8,
  sabotage: 0.55,
  win: 0.75,
  lose: 0.75,
};
const MASTER = 0.7;

export function createImpostorSounds() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let disposed = false;
  const buffers = new Map<ImpostorSound, AudioBuffer>();

  const audio = () => {
    if (ctx || disposed || typeof AudioContext === 'undefined') return ctx;
    try {
      const c = new AudioContext();
      master = c.createGain();
      master.gain.value = MASTER;
      master.connect(c.destination);
      ctx = c;
      for (const name of IMPOSTOR_SOUNDS)
        void fetch(`/sounds/impostor/${name}.mp3`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
          .then((data) => c.decodeAudioData(data))
          .then((buffer) => {
            if (!disposed) buffers.set(name, buffer);
          })
          // Без записи событие просто беззвучно.
          .catch(() => {});
    } catch {
      ctx = null;
    }
    return ctx;
  };

  // Первый жест на странице разрешает звук; дальше слушать незачем.
  const unlock = () => {
    void audio()?.resume();
    if (ctx?.state === 'running') removeUnlock();
  };
  const removeUnlock = () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  return {
    /** Сыграть звук через `delay` секунд (изгнание звучит, когда игрок уже летит за борт). */
    play(name: ImpostorSound, volume = 1, delay = 0) {
      const c = audio();
      const buffer = buffers.get(name);
      if (!c || !master || !buffer || c.state !== 'running') return;
      const src = c.createBufferSource();
      src.buffer = buffer;
      const amp = c.createGain();
      amp.gain.value = GAIN[name] * volume;
      src.connect(amp).connect(master);
      src.onended = () => amp.disconnect();
      src.start(c.currentTime + delay);
    },

    dispose() {
      disposed = true;
      removeUnlock();
      buffers.clear();
      void ctx?.close();
      ctx = null;
      master = null;
    },
  };
}
