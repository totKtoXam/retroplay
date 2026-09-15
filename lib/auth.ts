/**
 * Пароли, токены и проверка учётных данных. Модуль намеренно не зависит от
 * биндингов Worker: те же функции работают в тестах на Node и в воркере.
 *
 * Cloudflare Workers не дают bcrypt/argon2, поэтому пароль хранится как
 * PBKDF2-HMAC-SHA256 из WebCrypto.
 */

/**
 * Итераций PBKDF2 у новых паролей. Число ограничено сверху бюджетом CPU на
 * запрос в Cloudflare Workers: вход не должен упираться в лимит. Проверка
 * читает число из самой строки хеша, поэтому значение можно поднять позже — а
 * `needsRehash` пересчитает пароль при следующем удачном входе.
 */
export const PBKDF2_ITERATIONS = 120_000;
/** Дальше пароль не хешируется: длинный ввод не должен занимать CPU воркера. */
export const MAX_PASSWORD_LENGTH = 200;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_EMAIL_LENGTH = 254;

const encoder = new TextEncoder();

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Случайный токен для cookie, ссылок из писем и OAuth-состояния. */
export function randomToken(bytes = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** В базе лежит только хеш токена: утечка таблицы не даёт войти по чужой сессии. */
export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return hex(new Uint8Array(digest));
}

const toBase64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes));

const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Формат: `pbkdf2$sha256$<итерации>$<соль base64>$<хеш base64>`. */
export async function hashPassword(password: string, salt?: Uint8Array) {
  const bytes = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const digest = await pbkdf2(password, bytes, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toBase64(bytes)}$${toBase64(digest)}`;
}

/** Сравнение за постоянное время: длина хешей одинакова, утечки по времени нет. */
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Хеш посчитан меньшим числом итераций, чем нужно сейчас. */
export function needsRehash(stored: string) {
  const parts = stored.split('$');
  return (
    parts.length === 5 &&
    parts[0] === 'pbkdf2' &&
    Number(parts[2]) < PBKDF2_ITERATIONS
  );
}

export async function verifyPassword(password: string, stored: string) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256')
    return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1_000_000)
    return false;
  try {
    const salt = fromBase64(parts[3]);
    const expected = fromBase64(parts[4]);
    return sameBytes(await pbkdf2(password, salt, iterations), expected);
  } catch {
    return false;
  }
}

/** Почта хранится приведённой к нижнему регистру: адрес — уникальный ключ пользователя. */
export function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Проверка достаточная для формы, а не полный RFC 5322: адрес всё равно
 * подтверждается письмом. Возвращает текст ошибки или пустую строку.
 */
export function emailProblem(value: unknown) {
  const email = normalizeEmail(value);
  if (!email) return 'Укажите почту';
  if (email.length > MAX_EMAIL_LENGTH) return 'Слишком длинный адрес почты';
  if (/\s/.test(email)) return 'В адресе почты не должно быть пробелов';
  const match = /^[^@]+@([^@]+)$/.exec(email);
  if (!match) return 'Адрес должен быть вида name@example.com';
  const domain = match[1];
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.startsWith('.') || domain.endsWith('.'))
    return 'Адрес должен быть вида name@example.com';
  if (!/\.[a-z]{2,}$/.test(domain))
    return 'Адрес должен быть вида name@example.com';
  if (domain.includes('..')) return 'Адрес должен быть вида name@example.com';
  return '';
}

/** Длина важнее состава символов: правила «цифра и заглавная» не добавляют стойкости. */
export function passwordProblem(value: unknown) {
  if (typeof value !== 'string' || !value)
    return 'Придумайте пароль';
  if (value.length < MIN_PASSWORD_LENGTH)
    return `Пароль не короче ${MIN_PASSWORD_LENGTH} символов`;
  if (value.length > MAX_PASSWORD_LENGTH)
    return `Пароль не длиннее ${MAX_PASSWORD_LENGTH} символов`;
  if (!/\S/.test(value)) return 'Пароль не может состоять из пробелов';
  if (new Set(value).size < 3) return 'Слишком простой пароль';
  return '';
}

/** Имя участника: то же ограничение, что и у формы входа в комнату. */
export function cleanDisplayName(value: unknown, fallback = '') {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return (name || fallback).slice(0, 40);
}

/** Имя по умолчанию для регистрации по почте: часть адреса до «@». */
export function nameFromEmail(email: string) {
  return cleanDisplayName(
    normalizeEmail(email).split('@')[0].replace(/[._-]+/g, ' '),
    'Участник',
  );
}

/** Достаёт одну cookie из заголовка. Значения не декодируются: их пишем сами. */
export function readCookie(header: string | null, name: string) {
  if (!header) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

/**
 * Куда вернуться после входа через Google. Пропускается только относительный
 * путь внутри приложения: чужой адрес в `next` сделал бы открытый редирект, а
 * `//example.com` браузер считает внешним адресом.
 */
export function safeNext(value: unknown) {
  const next = typeof value === 'string' ? value : '';
  return /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : '/';
}
