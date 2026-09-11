// Board storage. `rooms.state` holds the room without its cards; every card is a row of
// `notes` (room, id, position, data), so editing one card writes one small row instead of
// the whole room. Rooms saved before this layout keep `notes` inline in `rooms.state` until
// their next write moves them. History rows store a RoomPatch — the previous values of what
// an operation changed — instead of a full copy of the room.
import type { Note, RoomState } from './model.ts';

export type NoteRow = { id: string; position: number; data: string };
export type RoomPatch = {
  v: 2;
  /** Previous card by id; null: the card did not exist. */
  notes: Record<string, Note | null>;
  /** Previous card order, when the set or order of cards changed. */
  order?: string[];
  /** Previous values of changed top-level fields (other than notes). */
  state: Record<string, unknown>;
  /** Fields that did not exist before. */
  unset?: string[];
};
/** Rows to insert or update, ids to delete, and the new `rooms.state` (null: unchanged). */
export type RoomWrite = { upsert: NoteRow[]; remove: string[]; state: string | null };

export function stripNotes(state: RoomState): string {
  const rest: Partial<RoomState> = { ...state };
  delete rest.notes;
  return JSON.stringify(rest);
}

/** The full room from `rooms.state` and its `notes` rows (inline notes win: not yet moved). */
export function assembleState(stateJson: string, rows: NoteRow[]): RoomState {
  const state = JSON.parse(stateJson) as RoomState;
  if (!Array.isArray(state.notes))
    state.notes = [...rows]
      .sort((a, b) => a.position - b.position)
      .map((r) => JSON.parse(r.data) as Note);
  return state;
}

/**
 * What to write so the stored room (`storedJson` + `rows`) becomes `next`. Positions only
 * need to increase along the card order, so a card keeps its stored position while that
 * still holds: adding or deleting a card does not rewrite the others.
 */
export function planWrite(storedJson: string, rows: NoteRow[], next: RoomState): RoomWrite {
  const stored = new Map(rows.map((r) => [r.id, r]));
  const upsert: NoteRow[] = [];
  let last = -Infinity;
  for (const note of next.notes) {
    const data = JSON.stringify(note);
    const row = stored.get(note.id);
    const position = row && row.position > last ? row.position : Math.max(0, Math.floor(last) + 1);
    if (!row || row.data !== data || row.position !== position)
      upsert.push({ id: note.id, position, data });
    last = position;
  }
  const ids = new Set(next.notes.map((n) => n.id));
  const state = stripNotes(next);
  return {
    upsert,
    remove: rows.filter((r) => !ids.has(r.id)).map((r) => r.id),
    state: state === storedJson ? null : state,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The undo record for an operation that turned `before` into `next`. */
export function diffForUndo(before: RoomState, next: RoomState): RoomPatch {
  const notes: Record<string, Note | null> = {};
  const prev = new Map(before.notes.map((n) => [n.id, n]));
  const kept = new Set(next.notes.map((n) => n.id));
  for (const n of next.notes) {
    const p = prev.get(n.id);
    if (!p) notes[n.id] = null;
    else if (!same(p, n)) notes[n.id] = p;
  }
  for (const p of before.notes) if (!kept.has(p.id)) notes[p.id] = p;
  const order = before.notes.map((n) => n.id);
  const orderChanged = !same(order, next.notes.map((n) => n.id));
  const a = before as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  const state: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'notes' || same(a[key], b[key])) continue;
    if (a[key] === undefined) unset.push(key);
    else state[key] = a[key];
  }
  return {
    v: 2,
    notes,
    ...(orderChanged ? { order } : {}),
    state,
    ...(unset.length ? { unset } : {}),
  };
}

/** `current` with an undo record put back; a legacy record is the full previous room. */
export function applyUndo(current: RoomState, before: RoomPatch | RoomState): RoomState {
  if ((before as RoomPatch).v !== 2) return before as RoomState;
  const patch = before as RoomPatch;
  const next = structuredClone(current) as RoomState & Record<string, unknown>;
  for (const key of patch.unset ?? []) delete next[key];
  Object.assign(next, structuredClone(patch.state));
  const byId = new Map(next.notes.map((n) => [n.id, n]));
  for (const [id, note] of Object.entries(patch.notes)) {
    if (note) byId.set(id, structuredClone(note));
    else byId.delete(id);
  }
  const notes: Note[] = [];
  for (const id of patch.order ?? next.notes.map((n) => n.id)) {
    const n = byId.get(id);
    if (!n) continue;
    notes.push(n);
    byId.delete(id);
  }
  next.notes = [...notes, ...byId.values()];
  return next;
}
