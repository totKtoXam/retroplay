import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  host: text('host').notNull(),
  state: text('state').notNull(),
  version: integer('version').notNull().default(1),
  created: integer('created').notNull(),
});
export const members = sqliteTable(
  'members',
  {
    room: text('room')
      .notNull()
      .references(() => rooms.id),
    session: text('session').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    seen: integer('seen').notNull(),
    pose: text('pose').notNull(),
    hp: integer('hp').notNull().default(100),
    respawnAt: integer('respawn_at').notNull().default(0),
    immuneUntil: integer('immune_until').notNull().default(0),
    life: integer('life').notNull().default(0),
    kills: integer('kills').notNull().default(0),
    deaths: integer('deaths').notNull().default(0),
    assists: integer('assists').notNull().default(0),
    recentDamage: text('recent_damage').notNull().default('{}'),
    lastShot: integer('last_shot').notNull().default(0),
    ping: integer('ping').notNull().default(0),
    mood: text('mood').notNull().default(''),
    hat: text('hat').notNull().default(''),
    cursor: text('cursor').notNull().default('{}'),
    /** 'red' | 'blue' in team battles, empty in free-for-all. */
    team: text('team').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.room, t.session] }),
    index('idx_members_session').on(t.session),
  ],
);
/** Board cards, one row each; `rooms.state` holds the rest of the room (lib/room-store.ts). */
export const notes = sqliteTable(
  'notes',
  {
    room: text('room')
      .notNull()
      .references(() => rooms.id),
    id: text('id').notNull(),
    position: integer('position').notNull(),
    data: text('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.room, t.id] })],
);
export const history = sqliteTable(
  'history',
  {
    room: text('room')
      .notNull()
      .references(() => rooms.id),
    version: integer('version').notNull(),
    author: text('author').notNull(),
    before: text('before').notNull(),
    action: text('action').notNull(),
    at: integer('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.room, t.version] })],
);

export const effects = sqliteTable(
  'effects',
  {
    id: text('id').primaryKey(),
    room: text('room')
      .notNull()
      .references(() => rooms.id),
    author: text('author').notNull(),
    applied: integer('applied').notNull().default(0),
    resolveAt: integer('resolve_at').notNull().default(0),
    payload: text('payload').notNull(),
    at: integer('at').notNull(),
  },
  (t) => [index('idx_effects_room_at').on(t.room, t.at)],
);

export const joinRequests = sqliteTable(
  'join_requests',
  {
    id: text('id').primaryKey(),
    room: text('room')
      .notNull()
      .references(() => rooms.id),
    session: text('session').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('pending'),
    created: integer('created').notNull(),
    resolvedAt: integer('resolved_at').notNull().default(0),
    resolvedBy: text('resolved_by').notNull().default(''),
  },
  (t) => [
    index('idx_join_requests_room').on(t.room),
    index('idx_join_requests_session').on(t.session),
  ],
);

/**
 * Аккаунты: почта с паролем и вход через Google. `publicId` — та же строка, что
 * лежит в `members.session`, поэтому комнаты и карточки не зависят от способа
 * входа (db/auth.ts). Гостевые сессии остаются и работают без аккаунта.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Публичная личность участника: `members.session`, `rooms.host`, автор карточек. */
    publicId: text('public_id').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified').notNull().default(0),
    name: text('name').notNull().default(''),
    /** `pbkdf2$sha256$...` или пустая строка у аккаунтов только с Google. */
    passwordHash: text('password_hash').notNull().default(''),
    /** Неизменяемый идентификатор аккаунта Google (`sub`), пусто без привязки. */
    googleSub: text('google_sub').notNull().default(''),
    avatar: text('avatar').notNull().default(''),
    /** Подряд идущие неудачные входы и блокировка подбора пароля. */
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: integer('locked_until').notNull().default(0),
    created: integer('created').notNull(),
    updated: integer('updated').notNull(),
  },
  (t) => [
    uniqueIndex('idx_users_email').on(t.email),
    uniqueIndex('idx_users_public').on(t.publicId),
    // Частичный индекс: пустая строка у аккаунтов без Google не должна конфликтовать.
    uniqueIndex('idx_users_google')
      .on(t.googleSub)
      .where(sql`google_sub <> ''`),
  ],
);

/** Сессии входа: в базе только SHA-256 от cookie-токена, сам токен есть лишь у браузера. */
export const authSessions = sqliteTable(
  'auth_sessions',
  {
    token: text('token').primaryKey(),
    user: text('user')
      .notNull()
      .references(() => users.id),
    created: integer('created').notNull(),
    expires: integer('expires').notNull(),
    seen: integer('seen').notNull().default(0),
  },
  (t) => [index('idx_auth_sessions_user').on(t.user)],
);

/** Одноразовые ссылки из писем: подтверждение почты (`verify`) и сброс пароля (`reset`). */
export const authTokens = sqliteTable(
  'auth_tokens',
  {
    token: text('token').primaryKey(),
    user: text('user')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    expires: integer('expires').notNull(),
    used: integer('used').notNull().default(0),
    created: integer('created').notNull(),
  },
  (t) => [index('idx_auth_tokens_user').on(t.user, t.kind)],
);
