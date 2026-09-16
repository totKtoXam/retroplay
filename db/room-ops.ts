// Запись операции над комнатой в D1 — общая для участников (app/api/rooms/[id])
// и внешнего API ботов (app/api/rooms/[id]/bots).
import { db, notifyRoom } from '@/db/server';
import {
  applyUndo,
  assembleState,
  diffForUndo,
  planWrite,
  type NoteRow,
} from '@/lib/room-store';
import { applyOperation, publicState, type RoomState } from '@/lib/model';
import { modeOf } from '@/lib/maps/catalog';
import { MAX_BOTS_PER_ADD } from '@/lib/bot-levels';

export type RoomRow = {
  id: string;
  host: string;
  state: string;
  version: number;
  created: number;
};

/** Members unseen for longer than this no longer occupy a player slot. */
export const ACTIVE_MEMBER_MS = 60_000;

/** The room's cards (lib/room-store.ts). */
export async function noteRows(id: string) {
  const { results } = await db()
    .prepare('SELECT id,position,data FROM notes WHERE room=?')
    .bind(id)
    .all<NoteRow>();
  return results;
}

/** Сколько ботов сервер комнаты сейчас выпускает играть (lib/room-hub-core.ts, roomFromState). */
export const activeBots = (state: RoomState) =>
  modeOf(state) === 'battle' ? (state.bots?.length ?? 0) : 0;

/**
 * Занятые места: люди, заходившие за последнюю минуту, и боты. Бот занимает
 * место как игрок — иначе «20 человек в комнате» значило бы 20 человек плюс
 * сколько угодно ботов, и лимит перестал бы защищать сервер от перегрузки.
 */
export async function occupiedSlots(id: string, state: RoomState) {
  const count = await db()
    .prepare('SELECT COUNT(*) AS n FROM members WHERE room=? AND seen>?')
    .bind(id, Date.now() - ACTIVE_MEMBER_MS)
    .first<{ n: number }>();
  return (count?.n || 0) + activeBots(state);
}

export const maxPlayersOf = (state: RoomState) => state.access?.maxPlayers || 8;

/** Добавить ботов можно, только если им хватит мест в комнате. */
export async function checkBotSlots(id: string, state: RoomState, op: Record<string, unknown>) {
  const count =
    typeof op.count === 'number' && Number.isInteger(op.count)
      ? Math.max(1, Math.min(MAX_BOTS_PER_ADD, op.count))
      : 1;
  const free = maxPlayersOf(state) - (await occupiedSlots(id, state));
  if (count > free)
    throw Error(
      free > 0
        ? `Свободных мест: ${free}. Уберите ботов или поднимите «Максимум участников»`
        : 'В комнате нет свободных мест. Поднимите «Максимум участников»',
    );
}

/**
 * Применить операцию и записать комнату. Одна транзакция; каждая запись
 * охраняется прочитанной версией, поэтому параллельное изменение превращает
 * пакет в пустышку, и цикл повторяет его на свежих данных. `null` — пять
 * попыток подряд комнату обновлял кто-то другой.
 */
export async function commitOperation(
  id: string,
  op: Record<string, unknown>,
  self: string,
  first: RoomRow,
) {
  let r: RoomRow | null = first;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt)
      r = await db()
        .prepare('SELECT * FROM rooms WHERE id=?')
        .bind(id)
        .first<RoomRow>();
    if (!r) throw Error('Комната не найдена');
    const rows = await noteRows(id);
    const current = assembleState(r.state, rows);
    let updated: RoomState;
    if (op.type === 'undo') {
      const last = await db()
        .prepare('SELECT author,before FROM history WHERE room=? AND version=?')
        .bind(id, r.version)
        .first<{ author: string; before: string }>();
      if (!last || last.author !== self)
        throw Error(
          'Отмена доступна только для вашего последнего действия, пока комнату не изменил другой участник',
        );
      updated = applyUndo(current, JSON.parse(last.before));
    } else updated = applyOperation(current, op, self, r.host);
    const write = planWrite(r.state, rows, updated);
    const guard = 'EXISTS(SELECT 1 FROM rooms WHERE id=? AND version=?)';
    const results = await db().batch([
      db()
        .prepare(
          'INSERT INTO history (room,version,author,before,action,at) SELECT id,version+1,?,?,?,? FROM rooms WHERE id=? AND version=?',
        )
        .bind(
          self,
          JSON.stringify(diffForUndo(current, updated)),
          String(op.type),
          Date.now(),
          id,
          r.version,
        ),
      db()
        .prepare(
          `INSERT INTO notes (room,id,position,data) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.position'),json_extract(value,'$.data') FROM json_each(?) WHERE ${guard} ON CONFLICT(room,id) DO UPDATE SET position=excluded.position,data=excluded.data`,
        )
        .bind(id, JSON.stringify(write.upsert), id, r.version),
      db()
        .prepare(
          `DELETE FROM notes WHERE room=? AND id IN (SELECT value FROM json_each(?)) AND ${guard}`,
        )
        .bind(id, JSON.stringify(write.remove), id, r.version),
      db()
        .prepare('UPDATE rooms SET state=COALESCE(?,state),version=version+1 WHERE id=? AND version=?')
        .bind(write.state, id, r.version),
      db()
        .prepare('DELETE FROM history WHERE room=? AND version<?')
        .bind(id, r.version - 39),
    ]);
    if (results[3].meta.changes) {
      await notifyRoom(id);
      return {
        ok: true as const,
        version: r.version + 1,
        state: publicState(updated, self, r.host),
      };
    }
  }
  return null;
}
