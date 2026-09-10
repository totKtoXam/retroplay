import {
  sqliteTable,
  text,
  integer,
  index,
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
  },
  (t) => [
    primaryKey({ columns: [t.room, t.session] }),
    index('idx_members_session').on(t.session),
  ],
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
