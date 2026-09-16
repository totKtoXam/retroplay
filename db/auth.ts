/**
 * Хранилище аккаунтов и сессий входа.
 *
 * Личность участника во всём приложении — строка `members.session`. У гостя это
 * SHA-256 от cookie-токена, у аккаунта — `users.public_id`. Поэтому комнаты,
 * карточки, голоса и права ведущего не знают о способе входа: `session()` из
 * `db/server.ts` возвращает либо гостевую, либо аккаунтную личность.
 *
 * При регистрации аккаунт забирает себе текущую гостевую личность, если она
 * свободна, — тогда уже созданные комнаты и карточки остаются у человека без
 * переноса строк. Вход в существующий аккаунт гостевые комнаты не переносит.
 */
import { env } from 'cloudflare:workers';
import { db } from './server';
import {
  randomToken,
  sha256Hex,
  cleanDisplayName,
  readCookie,
  safeNext,
} from '@/lib/auth';
import { cleanSettings, type SettingsValues } from '@/lib/settings-sync';

export { safeNext };

export const AUTH_COOKIE = 'jinaly_auth';
export const GUEST_COOKIE = 'jinaly_session';
export const OAUTH_COOKIE = 'jinaly_oauth';

/** Срок жизни сессии входа и порог её продления. */
const SESSION_TTL = 60 * 24 * 60 * 60 * 1000;
const SESSION_RENEW_AFTER = 15 * 24 * 60 * 60 * 1000;
/** Ссылки из писем: подтверждение почты живёт сутки, сброс пароля — час. */
export const VERIFY_TTL = 24 * 60 * 60 * 1000;
export const RESET_TTL = 60 * 60 * 1000;
/** Блокировка подбора пароля. */
const MAX_FAILED_LOGINS = 10;
const LOCK_TIME = 15 * 60 * 1000;

export type UserRow = {
  id: string;
  public_id: string;
  email: string;
  email_verified: number;
  name: string;
  password_hash: string;
  google_sub: string;
  avatar: string;
  failed_logins: number;
  locked_until: number;
  created: number;
  updated: number;
};

let authTablesReady = false;
/**
 * DDL один раз на изолят, как `ensureJoinRequestsTable`: вход должен работать и
 * в базе, куда миграция `0007_auth.sql` ещё не применена.
 */
export async function ensureAuthTables() {
  if (authTablesReady) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      public_id TEXT NOT NULL,
      email TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      google_sub TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      failed_logins INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public ON users (public_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users (google_sub) WHERE google_sub <> ''`,
    `CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY NOT NULL,
      user TEXT NOT NULL,
      created INTEGER NOT NULL,
      expires INTEGER NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user)`,
    `CREATE TABLE IF NOT EXISTS auth_tokens (
      token TEXT PRIMARY KEY NOT NULL,
      user TEXT NOT NULL,
      kind TEXT NOT NULL,
      expires INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user, kind)`,
    `CREATE TABLE IF NOT EXISTS user_settings (
      user TEXT PRIMARY KEY NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      updated INTEGER NOT NULL
    )`,
  ];
  try {
    for (const sql of statements) await db().prepare(sql).run();
    authTablesReady = true;
  } catch (error) {
    console.warn('auth tables bootstrap failed', error);
  }
}

export const cookieValue = (request: Request, name: string) =>
  readCookie(request.headers.get('cookie'), name);

export const isSecure = (request: Request) =>
  new URL(request.url).protocol === 'https:';

export function setCookie(
  request: Request,
  name: string,
  value: string,
  maxAgeSeconds: number,
) {
  const secure = isSecure(request) ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

export const clearCookie = (request: Request, name: string) =>
  setCookie(request, name, '', 0);

/** Личность гостя: SHA-256 от cookie-токена, а не сам токен. */
export async function guestIdentity(request: Request) {
  const token = /^[a-f0-9-]{36}$/.test(cookieValue(request, GUEST_COOKIE))
    ? cookieValue(request, GUEST_COOKIE)
    : '';
  return token ? await sha256Hex(token) : '';
}

/** Новая гостевая личность: в cookie уходит токен, наружу — только его хеш. */
export async function newGuestSession(request: Request) {
  const token = crypto.randomUUID();
  return {
    id: await sha256Hex(token),
    cookie: setCookie(request, GUEST_COOKIE, token, 31_536_000),
  };
}

type CachedSession = { userId: string; publicId: string; until: number };
/**
 * Кеш «токен → аккаунт» на изолят: presence опрашивает сервер несколько раз в
 * секунду, и чтение D1 на каждый запрос было бы заметно. Кешируется только
 * неизменяемая связка, поэтому имя и флаг подтверждения почты не устаревают.
 * Выход из аккаунта в другом изоляте виден с задержкой до 30 секунд.
 */
const sessionCache = new Map<string, CachedSession>();
const CACHE_TTL = 30_000;

export function forgetSession(tokenHash: string) {
  sessionCache.delete(tokenHash);
}

/** Активная сессия входа или `null`. Дёргается на каждом запросе, поэтому дёшева. */
export async function authIdentity(request: Request) {
  const token = cookieValue(request, AUTH_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const cached = sessionCache.get(tokenHash);
  if (cached && cached.until > now)
    return { userId: cached.userId, publicId: cached.publicId, tokenHash };
  await ensureAuthTables();
  const row = await db()
    .prepare(
      `SELECT s.user AS userId, s.expires AS expires, u.public_id AS publicId
       FROM auth_sessions s JOIN users u ON u.id = s.user WHERE s.token = ?`,
    )
    .bind(tokenHash)
    .first<{ userId: string; expires: number; publicId: string }>();
  if (!row || row.expires <= now) {
    sessionCache.delete(tokenHash);
    if (row) await db().prepare('DELETE FROM auth_sessions WHERE token=?').bind(tokenHash).run();
    return null;
  }
  if (row.expires - now < SESSION_TTL - SESSION_RENEW_AFTER)
    await db()
      .prepare('UPDATE auth_sessions SET expires=?, seen=? WHERE token=?')
      .bind(now + SESSION_TTL, now, tokenHash)
      .run();
  sessionCache.set(tokenHash, {
    userId: row.userId,
    publicId: row.publicId,
    until: now + CACHE_TTL,
  });
  return { userId: row.userId, publicId: row.publicId, tokenHash };
}

export async function userById(id: string) {
  await ensureAuthTables();
  return await db()
    .prepare('SELECT * FROM users WHERE id=?')
    .bind(id)
    .first<UserRow>();
}

export async function userByEmail(email: string) {
  await ensureAuthTables();
  return await db()
    .prepare('SELECT * FROM users WHERE email=?')
    .bind(email)
    .first<UserRow>();
}

export async function userByGoogleSub(sub: string) {
  await ensureAuthTables();
  return await db()
    .prepare("SELECT * FROM users WHERE google_sub=? AND google_sub<>''")
    .bind(sub)
    .first<UserRow>();
}

/** Текущий пользователь запроса вместе с сессией — для `/api/auth/me` и профиля. */
export async function currentUser(request: Request) {
  const identity = await authIdentity(request);
  if (!identity) return null;
  const user = await userById(identity.userId);
  return user ? { user, tokenHash: identity.tokenHash } : null;
}

/**
 * Личность нового аккаунта. Гостевая личность этого браузера переходит к
 * аккаунту, если она ещё ничья: созданные до регистрации комнаты и карточки
 * остаются у человека и переносить строки не нужно.
 */
export async function claimPublicId(request: Request) {
  const guest = await guestIdentity(request);
  if (guest) {
    const taken = await db()
      .prepare('SELECT 1 AS x FROM users WHERE public_id=?')
      .bind(guest)
      .first<{ x: number }>();
    if (!taken) return guest;
  }
  return randomToken(32);
}

export async function createUser(fields: {
  publicId: string;
  email: string;
  name: string;
  passwordHash?: string;
  googleSub?: string;
  avatar?: string;
  emailVerified?: boolean;
}) {
  await ensureAuthTables();
  const now = Date.now();
  const id = crypto.randomUUID();
  await db()
    .prepare(
      `INSERT INTO users (id, public_id, email, email_verified, name, password_hash, google_sub, avatar, failed_logins, locked_until, created, updated)
       VALUES (?,?,?,?,?,?,?,?,0,0,?,?)`,
    )
    .bind(
      id,
      fields.publicId,
      fields.email,
      fields.emailVerified ? 1 : 0,
      cleanDisplayName(fields.name, 'Участник'),
      fields.passwordHash || '',
      fields.googleSub || '',
      fields.avatar || '',
      now,
      now,
    )
    .run();
  return (await userById(id))!;
}

/** Поля, которые разрешено менять: имена колонок уходят в SQL как есть. */
const EDITABLE: (keyof UserRow)[] = [
  'email',
  'email_verified',
  'name',
  'password_hash',
  'google_sub',
  'avatar',
  'failed_logins',
  'locked_until',
];

export async function updateUser(id: string, fields: Partial<UserRow>) {
  const keys = Object.keys(fields).filter((key) =>
    EDITABLE.includes(key as keyof UserRow),
  );
  if (!keys.length) return;
  await db()
    .prepare(
      `UPDATE users SET ${keys.map((k) => `${k}=?`).join(', ')}, updated=? WHERE id=?`,
    )
    .bind(...keys.map((k) => fields[k as keyof UserRow]!), Date.now(), id)
    .run();
}

/** Личные настройки аккаунта (lib/settings-sync.ts); `updated` 0 — ещё не сохранялись. */
export async function readUserSettings(userId: string) {
  await ensureAuthTables();
  const row = await db()
    .prepare('SELECT data, updated FROM user_settings WHERE user=?')
    .bind(userId)
    .first<{ data: string; updated: number }>();
  if (!row) return { settings: {} as SettingsValues, updated: 0 };
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row.data);
  } catch {
    // Повреждённая запись — считаем, что настроек нет, следующая запись её заменит.
  }
  return { settings: cleanSettings(parsed), updated: row.updated };
}

/**
 * Запись настроек поверх версии `base`, которую видел клиент. Если с тех пор
 * настройки сохранило другое устройство, ничего не пишется и возвращается
 * `null`: клиент должен сначала слить свои изменения с чужими.
 */
export async function writeUserSettings(
  userId: string,
  settings: SettingsValues,
  base: number,
) {
  await ensureAuthTables();
  // Версия строго растёт, даже если часы воркера отстали от прошлой записи.
  const updated = Math.max(Date.now(), base + 1);
  const data = JSON.stringify(settings);
  const result = base
    ? await db()
        .prepare('UPDATE user_settings SET data=?, updated=? WHERE user=? AND updated=?')
        .bind(data, updated, userId, base)
        .run()
    : await db()
        .prepare(
          'INSERT INTO user_settings (user, data, updated) VALUES (?,?,?) ON CONFLICT(user) DO NOTHING',
        )
        .bind(userId, data, updated)
        .run();
  return result.meta.changes ? updated : null;
}

/** Создаёт сессию входа и возвращает заголовки: вход + сброс гостевой cookie. */
export async function startSession(request: Request, userId: string) {
  await ensureAuthTables();
  const token = randomToken(32);
  const now = Date.now();
  await db()
    .prepare(
      'INSERT INTO auth_sessions (token, user, created, expires, seen) VALUES (?,?,?,?,?)',
    )
    .bind(await sha256Hex(token), userId, now, now + SESSION_TTL, now)
    .run();
  // Гостевая cookie гасится: после выхода прежние комнаты не должны открываться
  // на общем компьютере просто потому, что старый гостевой токен ещё лежит.
  return [
    setCookie(request, AUTH_COOKIE, token, Math.floor(SESSION_TTL / 1000)),
    clearCookie(request, GUEST_COOKIE),
  ];
}

export async function endSession(request: Request) {
  const identity = await authIdentity(request);
  if (identity) {
    forgetSession(identity.tokenHash);
    await db()
      .prepare('DELETE FROM auth_sessions WHERE token=?')
      .bind(identity.tokenHash)
      .run();
  }
  return clearCookie(request, AUTH_COOKIE);
}

/** Выход со всех устройств: используется после смены пароля. */
export async function endAllSessions(userId: string, keepTokenHash = '') {
  await db()
    .prepare('DELETE FROM auth_sessions WHERE user=? AND token<>?')
    .bind(userId, keepTokenHash)
    .run();
  sessionCache.clear();
}

/** Учёт неудачных входов: после `MAX_FAILED_LOGINS` подряд аккаунт замирает на 15 минут. */
export function lockedFor(user: UserRow) {
  const left = user.locked_until - Date.now();
  return left > 0 ? Math.ceil(left / 60000) : 0;
}

export async function noteFailedLogin(user: UserRow) {
  const failed = user.failed_logins + 1;
  await updateUser(user.id, {
    failed_logins: failed,
    locked_until: failed >= MAX_FAILED_LOGINS ? Date.now() + LOCK_TIME : 0,
  });
}

export async function noteSuccessfulLogin(user: UserRow) {
  if (user.failed_logins || user.locked_until)
    await updateUser(user.id, { failed_logins: 0, locked_until: 0 });
}

/** Одноразовая ссылка из письма: наружу уходит токен, в базу — его хеш. */
export async function issueToken(userId: string, kind: 'verify' | 'reset', ttl: number) {
  await ensureAuthTables();
  const token = randomToken(32);
  const now = Date.now();
  // Прежние ссылки того же вида гасятся: действует только последнее письмо.
  await db()
    .prepare('DELETE FROM auth_tokens WHERE user=? AND kind=?')
    .bind(userId, kind)
    .run();
  await db()
    .prepare(
      'INSERT INTO auth_tokens (token, user, kind, expires, used, created) VALUES (?,?,?,?,0,?)',
    )
    .bind(await sha256Hex(token), userId, kind, now + ttl, now)
    .run();
  return token;
}

/** Забирает одноразовый токен: успешная проверка сразу его удаляет. */
export async function consumeToken(token: string, kind: 'verify' | 'reset') {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  await ensureAuthTables();
  const hash = await sha256Hex(token);
  const row = await db()
    .prepare('SELECT * FROM auth_tokens WHERE token=? AND kind=?')
    .bind(hash, kind)
    .first<{ token: string; user: string; expires: number }>();
  if (!row) return null;
  await db().prepare('DELETE FROM auth_tokens WHERE token=?').bind(hash).run();
  if (row.expires <= Date.now()) return null;
  return await userById(row.user);
}

/** Публичный профиль для клиента: без хеша пароля и служебных счётчиков. */
export const publicUser = (user: UserRow) => ({
  id: user.public_id,
  email: user.email,
  name: user.name,
  emailVerified: !!user.email_verified,
  hasPassword: !!user.password_hash,
  google: !!user.google_sub,
  avatar: user.avatar,
});

/** Переменные окружения воркера: секреты Google и почты (db/env.d.ts). */
export const authEnv = () => env;

/** Базовый адрес ссылок в письмах: `APP_URL` важнее, иначе origin запроса. */
export function appOrigin(request: Request) {
  const configured = authEnv().APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(request.url).origin;
}

/** JSON-ответ вместе с несколькими Set-Cookie: `Response.json` их не складывает. */
export function jsonCookies(value: unknown, cookies: string[], status = 200) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(value), { status, headers });
}

/** Переход после входа или подтверждения почты вместе с установкой cookie. */
export function redirectWithCookies(to: string, cookies: string[]) {
  const headers = new Headers({ Location: to, 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}
