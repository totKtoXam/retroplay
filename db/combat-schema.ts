export const combatColumns = [
  ['kills', 'INTEGER NOT NULL DEFAULT 0'],
  ['deaths', 'INTEGER NOT NULL DEFAULT 0'],
  ['assists', 'INTEGER NOT NULL DEFAULT 0'],
  ['recent_damage', "TEXT NOT NULL DEFAULT '{}'"],
  ['immune_until', 'INTEGER NOT NULL DEFAULT 0'],
] as const;

type ColumnRow = { name: string };

export type CombatSchemaDatabase = {
  prepare(query: string): {
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<unknown>;
  };
};

async function memberColumns(database: CombatSchemaDatabase) {
  const { results } = await database
    .prepare('PRAGMA table_info(members)')
    .all<ColumnRow>();
  return new Set(results.map((column) => column.name));
}

/**
 * Reconciles databases whose combat fields were added before they were part of
 * the migration history. SQLite does not support ADD COLUMN IF NOT EXISTS, so
 * a duplicate-column error is accepted only after a fresh schema read proves
 * another isolate completed that exact change.
 */
export async function ensureCombatSchema(database: CombatSchemaDatabase) {
  let existing = await memberColumns(database);
  for (const [name, definition] of combatColumns) {
    if (existing.has(name)) continue;

    try {
      await database
        .prepare(`ALTER TABLE members ADD COLUMN ${name} ${definition}`)
        .run();
    } catch (error) {
      existing = await memberColumns(database);
      if (!existing.has(name)) {
        throw new Error(`Unable to add members.${name}`, { cause: error });
      }
    }
    existing.add(name);
  }

  const missing = combatColumns
    .map(([name]) => name)
    .filter((name) => !existing.has(name));
  if (missing.length)
    throw new Error(`members is missing combat columns: ${missing.join(', ')}`);
}

/** Keeps one in-flight upgrade per isolate and permits a retry after failure. */
export function createCombatSchemaBootstrap(database: CombatSchemaDatabase) {
  let upgrade: Promise<void> | null = null;
  return () => {
    if (!upgrade) {
      upgrade = ensureCombatSchema(database).catch((error) => {
        upgrade = null;
        throw error;
      });
    }
    return upgrade;
  };
}
