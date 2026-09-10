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
export async function payload(request: Request) {
  checkOrigin(request);
  const text = await request.text();
  if (text.length > 250_000) throw Error('Слишком большой запрос');
  return JSON.parse(text || '{}');
}
