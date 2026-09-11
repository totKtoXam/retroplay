import { env } from 'cloudflare:workers';
export function db() {
  if (!env.DB) throw Error('Хранилище комнат недоступно');
  return env.DB;
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
