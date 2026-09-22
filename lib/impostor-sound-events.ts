// Какие звуки «Предателя» сыграть при смене снимка партии (components/impostor-sounds.ts).
// Отдельно от звука, чтобы правила можно было проверить тестом без браузера.
import type { ImpostorView } from './impostor.ts';

export type ImpostorSoundName = 'start' | 'meeting' | 'voting' | 'vote' | 'eject' | 'sabotage' | 'win' | 'lose';
export type ImpostorSoundSnap = Pick<ImpostorView, 'phase' | 'game' | 'role' | 'winner' | 'voted' | 'ejected' | 'sabotage'>;

/** Через сколько секунд после показа итога голосования изгнанный падает в воду. */
const EJECT_DELAY = 0.3;

/**
 * Звуки перехода от снимка `prev` к `next`. Первый снимок (зашли в комнату посреди партии)
 * звуков не даёт: игрок не видел, как это началось.
 */
export function impostorSoundEvents(
  prev: ImpostorSoundSnap | null | undefined,
  next: ImpostorSoundSnap | null | undefined,
): { sound: ImpostorSoundName; delay?: number }[] {
  if (!prev || !next) return [];
  const out: { sound: ImpostorSoundName; delay?: number }[] = [];
  const changed = prev.phase !== next.phase;
  if (next.phase === 'intro' && (changed || prev.game !== next.game)) out.push({ sound: 'start' });
  if (changed) {
    // Без обсуждения собрание сразу начинается с голосования — это всё ещё созыв собрания.
    if (next.phase === 'meeting' || (next.phase === 'voting' && prev.phase !== 'meeting')) out.push({ sound: 'meeting' });
    else if (next.phase === 'voting') out.push({ sound: 'voting' });
    if (next.phase === 'eject' && next.ejected?.id) out.push({ sound: 'eject', delay: EJECT_DELAY });
    // Зритель без роли слышит победу: проигравшей стороны у него нет.
    if (next.phase === 'ended') out.push({ sound: next.role && next.role !== next.winner ? 'lose' : 'win' });
  }
  if (next.phase === 'voting' && prev.phase === 'voting' && next.voted.length > prev.voted.length) out.push({ sound: 'vote' });
  if (next.phase === 'play' && next.sabotage && next.sabotage.kind !== prev.sabotage?.kind) out.push({ sound: 'sabotage' });
  return out;
}
