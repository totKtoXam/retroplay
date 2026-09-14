import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  combatColumns,
  createCombatSchemaBootstrap,
  ensureCombatSchema,
} from '../db/combat-schema.ts';

class FakeDatabase {
  constructor(columns = []) {
    this.columns = new Set(columns);
    this.alters = [];
    this.failColumn = null;
  }

  prepare(query) {
    if (query === 'PRAGMA table_info(members)') {
      return {
        all: async () => ({
          results: [...this.columns].map((name) => ({ name })),
        }),
      };
    }

    const match = /^ALTER TABLE members ADD COLUMN (\w+) (.+)$/.exec(query);
    assert.ok(match, `Unexpected query: ${query}`);
    return {
      run: async () => {
        // Let two independent bootstraps both read the old schema before one wins.
        await Promise.resolve();
        const [, name] = match;
        if (this.failColumn === name) throw new Error('database unavailable');
        if (this.columns.has(name))
          throw new Error(`duplicate column name: ${name}`);
        this.columns.add(name);
        this.alters.push(name);
      },
    };
  }
}

const baseColumns = ['room', 'session', 'name'];
const combatNames = combatColumns.map(([name]) => name);

test('fresh schema gets every combat column', async () => {
  const database = new FakeDatabase(baseColumns);
  await ensureCombatSchema(database);
  assert.deepEqual(database.alters, combatNames);
  assert.deepEqual(
    [...database.columns].filter((name) => combatNames.includes(name)),
    combatNames,
  );
});

test('legacy runtime-upgraded schema performs no DDL', async () => {
  const database = new FakeDatabase([...baseColumns, ...combatNames]);
  await ensureCombatSchema(database);
  assert.deepEqual(database.alters, []);
});

test('concurrent bootstraps accept only a verified duplicate-column race', async () => {
  const database = new FakeDatabase(baseColumns);
  await Promise.all([
    createCombatSchemaBootstrap(database)(),
    createCombatSchemaBootstrap(database)(),
  ]);
  assert.deepEqual(
    [...database.columns].filter((name) => combatNames.includes(name)),
    combatNames,
  );
});

test('a failed bootstrap is surfaced and can retry', async () => {
  const database = new FakeDatabase(baseColumns);
  database.failColumn = 'immune_until';
  const bootstrap = createCombatSchemaBootstrap(database);
  await assert.rejects(bootstrap(), /Unable to add members\.immune_until/);
  database.failColumn = null;
  await bootstrap();
  assert.ok(database.columns.has('immune_until'));
});
