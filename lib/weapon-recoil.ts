/**
 * Отдача и разброс — только у стрелка: взгляд уводится по-настоящему, поэтому
 * сервер получает уже сбитый прицел и ничего отдельно не проверяет.
 *
 * Углы в радианах; `pitch > 0` — взгляд вниз (lib/game-camera.ts), так что
 * отдача вверх — отрицательный `pitch`.
 */

/** Как держат оружие в миг выстрела. */
export type Handling = {
  moving: boolean;
  airborne: boolean;
  stance: string;
  /** Прицеливание через прицел (ПКМ). */
  aiming: boolean;
};

const posture = (stance: string) => (stance === 'lie' ? 0.55 : stance === 'sit' ? 0.75 : 1);

/** Во сколько раз разброс от бедра больше, чем стоя на месте: в прыжке хуже всего, лёжа лучше всего. */
export function spreadScale(h: Handling) {
  return (h.airborne ? 2.5 : h.moving ? 1.6 : 1) * posture(h.stance);
}

/**
 * Разброс через прицел, в тех же единицах экрана, что разброс от бедра. На месте
 * он нулевой, но на бегу и тем более в прыжке ствол ведёт и через прицел.
 */
export function aimedSpread(tool: string, h: Handling) {
  const motion = h.airborne ? 1 : h.moving ? 0.3 : 0;
  const base = tool === 'sniper' ? 0.04 : tool === 'paint' ? 0.03 : 0;
  return base * motion * posture(h.stance);
}

/** Подброс ствола за выстрел: вверх и вбок. */
const KICK: Record<string, { pitch: number; yaw: number }> = {
  paint: { pitch: 0.011, yaw: 0.0045 },
  confetti: { pitch: 0.045, yaw: 0.012 },
  sniper: { pitch: 0.07, yaw: 0.01 },
  like: { pitch: 0.006, yaw: 0.002 },
};

/**
 * Отдача одного выстрела. У маркера краски рисунок постоянный: первые выстрелы
 * идут вверх, дальше ствол гуляет влево-вправо — очередь можно выучить и
 * удержать мышью. У остального оружия вбок бросает случайно.
 */
export function recoilKick(
  tool: string,
  shot: number,
  h: Handling,
  random: () => number = Math.random,
): { pitch: number; yaw: number } {
  const k = KICK[tool];
  if (!k) return { pitch: 0, yaw: 0 };
  const scale = (h.aiming ? 0.7 : 1) * (h.airborne ? 1.3 : 1) * (0.6 + 0.4 * posture(h.stance));
  const side =
    tool === 'paint'
      ? (shot < 4 ? 0.25 : 1) * Math.sin(shot * 0.75 + 0.6) + (random() - 0.5) * 0.3
      : random() * 2 - 1;
  return { pitch: -k.pitch * scale * (0.9 + random() * 0.2), yaw: k.yaw * scale * side };
}

/** Как быстро подброс доходит до взгляда: выстрел — не мгновенный скачок, а рывок за ~60 мс. */
const KICK_RATE = 45;
/** Как быстро прицел возвращается после очереди. */
const RECOVER_RATE = 7;
/** Какую долю подброса прицел возвращает сам; остальное стрелок доводит мышью. */
const RECOVER_SHARE = 0.75;
/** Возврат начинается, когда пауза между выстрелами длиннее этой, с. */
const RECOVER_DELAY = 0.12;

/** Отдача, растянутая во времени: каждый кадр отдаёт, на сколько сдвинуть взгляд. */
export class ViewRecoil {
  private pending = { pitch: 0, yaw: 0 };
  private offset = { pitch: 0, yaw: 0 };
  private sinceShot = Infinity;

  kick(k: { pitch: number; yaw: number }) {
    this.pending.pitch += k.pitch;
    this.pending.yaw += k.yaw;
    this.sinceShot = 0;
  }

  reset() {
    this.pending = { pitch: 0, yaw: 0 };
    this.offset = { pitch: 0, yaw: 0 };
    this.sinceShot = Infinity;
  }

  /** Сдвиг взгляда за кадр длиной `dt` секунд. */
  step(dt: number): { pitch: number; yaw: number } {
    this.sinceShot += dt;
    const a = 1 - Math.exp(-KICK_RATE * dt);
    const pitch = this.pending.pitch * a,
      yaw = this.pending.yaw * a;
    this.pending.pitch -= pitch;
    this.pending.yaw -= yaw;
    this.offset.pitch += pitch;
    this.offset.yaw += yaw;
    let backPitch = 0,
      backYaw = 0;
    if (this.sinceShot > RECOVER_DELAY) {
      const r = 1 - Math.exp(-RECOVER_RATE * dt);
      backPitch = this.offset.pitch * r;
      backYaw = this.offset.yaw * r;
      this.offset.pitch -= backPitch;
      this.offset.yaw -= backYaw;
    }
    return {
      pitch: pitch - backPitch * RECOVER_SHARE,
      yaw: yaw - backYaw * RECOVER_SHARE,
    };
  }
}
