/**
 * Чистая логика игрового HUD (план UX/UI, этап 3.2–3.3): откуда пришёл урон, что
 * писать в итоге раунда, как подписать отсчёт возрождения. Разметка —
 * components/world-hud.tsx и components/hud-*.tsx; здесь то, что можно проверить
 * тестом без браузера (tests/hud-feedback.test.mjs).
 */
import type { Match, Person, WorldEffect } from './model.ts';
import { teamLook } from './team-colors.ts';

/** Ниже этого здоровья HUD бьёт тревогу: красная виньетка и пульс полосы. */
export const LOW_HP = 30;

/** Сколько после выхода из захвата мыши браузер ещё отказывает в новом захвате. */
export const POINTER_RELOCK_WINDOW_MS = 1500;

export function lowHealth(hp: number, dead: boolean) {
  return !dead && hp > 0 && hp < LOW_HP;
}

/**
 * Угол до точки относительно взгляда: 0 — прямо, π/2 — справа, −π/2 — слева, ±π —
 * сзади. Вперёд у камеры (−sin yaw, −cos yaw), вправо (cos yaw, −sin yaw) — та же
 * формула, что у индикатора ветра (lib/weather.ts, windRelative).
 */
export function relativeAngle(from: { x: number; z: number }, to: { x: number; z: number }, yaw: number) {
  const dx = to.x - from.x,
    dz = to.z - from.z;
  const side = dx * Math.cos(yaw) - dz * Math.sin(yaw),
    ahead = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
  return Math.atan2(side, ahead);
}

/**
 * Откуда пришёл урон. Сервер не сообщает, чей выстрел снял здоровье, поэтому ищем
 * сами: среди свежих чужих эффектов берём тот, чья точка попадания ближе всего к
 * нам, при равной близости — более поздний. Граната взрывается через 1100 мс после
 * выстрела, отсюда и ширина окна. Точка — дуло автора (`origin`), а если его нет —
 * поза автора. `null` — источник не найден: HUD покажет урон без направления.
 */
export function damageSource(
  effects: WorldEffect[] | undefined,
  selfId: string,
  me: Pick<Person, 'pose'> | undefined,
  members: Pick<Person, 'id' | 'pose'>[],
  now = Date.now(),
): { x: number; z: number } | null {
  const enemy = (effects || []).filter(
    (e) => e.kind !== 'kill' && e.kind !== 'knock' && e.kind !== 'like' && e.author && e.author !== selfId,
  );
  const fresh = enemy.filter((e) => now - e.at <= 1800);
  // Часы могли разойтись — тогда смотрим на весь список, он и так недолгий.
  const pool = fresh.length > 0 ? fresh : enemy;
  if (pool.length === 0) return null;
  const center = me ? [me.pose.x, me.pose.y + 0.95, me.pose.z] : null;
  let best = pool[0];
  let bestDist = Infinity;
  for (const e of pool) {
    const d =
      center && e.target
        ? Math.hypot(e.target[0] - center[0], e.target[1] - center[1], e.target[2] - center[2])
        : 0;
    if (d < bestDist || (d === bestDist && e.at > best.at)) {
      bestDist = d;
      best = e;
    }
  }
  if (best.origin && best.origin.length >= 3) return { x: best.origin[0], z: best.origin[2] };
  const author = members.find((m) => m.id === best.author);
  return author ? { x: author.pose.x, z: author.pose.z } : null;
}

export type MatchOutcome = {
  /** Крупная строка баннера. */
  title: string;
  /** Для цвета: своя победа, поражение или ничего личного. */
  tone: 'win' | 'loss' | 'neutral';
};


/**
 * Итог раунда или матча относительно своей команды: «ВЫ ПОБЕДИЛИ», а не «ПОБЕДА
 * КРАСНЫХ» — в конце боя игрок ищет глазами свой результат, а не цвет. Без команды
 * (наблюдатель) остаётся нейтральная формулировка. В бою «Каждый за себя» победитель —
 * один человек: он сам или кто-то другой по имени.
 */
export function matchOutcome(
  match: Pick<Match, 'phase' | 'winner' | 'ffa' | 'champion'>,
  myTeam: string | undefined,
  selfId?: string,
): MatchOutcome | null {
  if (match.phase !== 'ended' && match.phase !== 'intermission') return null;
  const ended = match.phase === 'ended';
  if (match.ffa) {
    const champion = match.champion;
    if (!champion) return { title: 'НИЧЬЯ', tone: 'neutral' };
    return champion.id === selfId
      ? { title: 'ВЫ ПОБЕДИЛИ', tone: 'win' }
      : { title: `ПОБЕДИЛ ${champion.name.toUpperCase()}`, tone: 'loss' };
  }
  const winner = match.winner;
  if (!winner || winner === 'draw')
    return { title: ended ? 'НИЧЬЯ' : 'РАУНД ОКОНЧЕН', tone: 'neutral' };
  if (myTeam === 'red' || myTeam === 'blue') {
    const mine = winner === myTeam;
    return ended
      ? { title: mine ? 'ВЫ ПОБЕДИЛИ' : 'ВЫ ПРОИГРАЛИ', tone: mine ? 'win' : 'loss' }
      : { title: mine ? 'РАУНД ЗА ВАМИ' : 'РАУНД ПРОИГРАН', tone: mine ? 'win' : 'loss' };
  }
  // Названия команд — из общего модуля: 'red' показывается оранжевыми.
  const look = teamLook(winner);
  return {
    title: ended ? `ПОБЕДА ${look.genitive.toUpperCase()}` : `РАУНД ЗА ${look.instrumental.toUpperCase()}`,
    tone: 'neutral',
  };
}

/** Отсчёт перед раундом крупными цифрами — только последние три секунды. */
export function roundCountdown(phase: Match['phase'] | undefined, secondsLeft: number) {
  return phase === 'freeze' && secondsLeft > 0 && secondsLeft <= 3 ? secondsLeft : 0;
}

/**
 * Подпись под кольцом отсчёта. При нуле секунд число не показываем: раньше
 * `|| 1` рисовал «1», пока сервер ещё не вернул игрока. В раундах погибшие ждут
 * следующего раунда, и никакого числа у них нет.
 */
export function respawnCaption(seconds: number, waitsForRound: boolean) {
  if (waitsForRound) return 'Возрождение — в следующем раунде';
  return seconds > 0 ? `Возрождение через ${seconds} с` : 'Возрождение…';
}

/** Можно ли повторить захват мыши, а не сдаваться: браузер ещё держит паузу после Esc. */
export function inRelockWindow(exitAt: number, now: number) {
  return now - exitAt >= 0 && now - exitAt < POINTER_RELOCK_WINDOW_MS;
}
