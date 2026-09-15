import { env } from 'cloudflare:workers';
import { authIdentity, guestIdentity } from './auth';
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
/**
 * Личность участника запроса — та же строка, что лежит в `members.session`.
 * У вошедшего в аккаунт это `users.public_id`, у гостя — SHA-256 от его
 * cookie-токена. Остальной код о способе входа не знает (db/auth.ts).
 */
export async function session(request: Request) {
  try {
    const identity = await authIdentity(request);
    if (identity) return identity.publicId;
  } catch (error) {
    // Сломанный вход не должен ронять комнаты: гость всё ещё может играть.
    console.error('auth session lookup failed', error);
  }
  return (await guestIdentity(request)) || null;
}
export const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw Error('Источник запроса не разрешён');
}
/**
 * Drops an unread request body. Under `wrangler dev` (the LAN production
 * server) responding before the body is read breaks wrangler's proxy
 * connection, and the next POST fails with 503 "Your worker restarted
 * mid-request". Call it on every early return of a POST handler. The body has
 * to be read: `request.body.cancel()` does not help.
 */
export async function discardBody(request: Request) {
  if (request.body && !request.bodyUsed)
    await request.arrayBuffer().catch(() => {});
}
export async function payload(request: Request) {
  const text = await request.text();
  checkOrigin(request);
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
