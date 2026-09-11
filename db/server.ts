import { env } from 'cloudflare:workers';
export function db() {
  if (!env.DB) throw Error('Хранилище комнат недоступно');
  return env.DB;
}
/** The room's Durable Object: owner of poses, HP, shots and combat (worker/room-hub.ts). */
export function roomHub(id: string) {
  return env.ROOM_HUB.get(env.ROOM_HUB.idFromName(id));
}
/** Tells connected sockets that the room changed in D1. Never fails the caller's write. */
export async function notifyRoom(id: string) {
  try {
    await roomHub(id).roomChanged(id);
  } catch (e) {
    console.error('room hub notify failed', e);
  }
}
/** Makes the hub pick up a joined member or an edited profile. Never fails the caller's write. */
export async function notifyMember(id: string, self: string) {
  try {
    await roomHub(id).memberChanged(id, self);
  } catch (e) {
    console.error('room hub notify failed', e);
  }
}
export async function session(request: Request) {
  const token = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)jinaly_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
  if (!token) return null;
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw Error('Источник запроса не разрешён');
}
export async function payload(request: Request) {
  checkOrigin(request);
  const text = await request.text();
  if (text.length > 250_000) throw Error('Слишком большой запрос');
  return JSON.parse(text || '{}');
}

let joinRequestsReady = false;
/** Runs the DDL once per isolate instead of on every request (presence polls several times a second). */
export async function ensureJoinRequestsTable() {
  if (joinRequestsReady) return;
  try {
    await db()
      .prepare(
        `CREATE TABLE IF NOT EXISTS join_requests (
          id TEXT PRIMARY KEY NOT NULL,
          room TEXT NOT NULL,
          session TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created INTEGER NOT NULL,
          resolved_at INTEGER NOT NULL DEFAULT 0,
          resolved_by TEXT NOT NULL DEFAULT ''
        )`,
      )
      .run();

    await db()
      .prepare(
        'CREATE INDEX IF NOT EXISTS idx_join_requests_room ON join_requests (room)',
      )
      .run();

    await db()
      .prepare(
        'CREATE INDEX IF NOT EXISTS idx_join_requests_session ON join_requests (session)',
      )
      .run();
    joinRequestsReady = true;
  } catch (error) {
    console.warn('join_requests table bootstrap failed', error);
  }
}
