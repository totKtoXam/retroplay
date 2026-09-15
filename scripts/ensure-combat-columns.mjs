import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const [database, ...wranglerArgs] = process.argv.slice(2);
if (!database) {
  throw new Error(
    'Usage: node scripts/ensure-combat-columns.mjs <database> [wrangler D1 options]',
  );
}

const columns = [
  ['kills', 'INTEGER NOT NULL DEFAULT 0'],
  ['deaths', 'INTEGER NOT NULL DEFAULT 0'],
  ['assists', 'INTEGER NOT NULL DEFAULT 0'],
  ['recent_damage', "TEXT NOT NULL DEFAULT '{}'"],
  ['immune_until', 'INTEGER NOT NULL DEFAULT 0'],
];
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

function execute(command) {
  return execFileSync(
    process.execPath,
    [
      wrangler,
      'd1',
      'execute',
      database,
      ...wranglerArgs,
      '--command',
      command,
      '--json',
    ],
    { encoding: 'utf8' },
  );
}

function memberColumns() {
  const result = JSON.parse(execute('PRAGMA table_info(members)'));
  const rows = result.flatMap((entry) => entry.results || []);
  return new Set(rows.map((row) => row.name));
}

let existing = memberColumns();
for (const [name, definition] of columns) {
  if (existing.has(name)) continue;
  try {
    execute(`ALTER TABLE members ADD COLUMN ${name} ${definition}`);
  } catch (error) {
    existing = memberColumns();
    if (!existing.has(name)) throw error;
  }
  existing.add(name);
}

console.log('Combat member columns are ready.');
