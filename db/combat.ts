import { db } from './server';

let schemaUpgraded = false;
/**
 * Combat columns were added at runtime before migrations existed, so older databases may
 * lack them (SQLite has no ADD COLUMN IF NOT EXISTS). Combat itself lives in lib/room-hub-core.ts.
 */
export async function ensureCombatColumns() {
  if (schemaUpgraded) return;
  try {
    await db()
      .prepare('ALTER TABLE members ADD COLUMN kills INTEGER NOT NULL DEFAULT 0')
      .run();
  } catch {}
  try {
    await db()
      .prepare('ALTER TABLE members ADD COLUMN deaths INTEGER NOT NULL DEFAULT 0')
      .run();
  } catch {}
  try {
    await db()
      .prepare('ALTER TABLE members ADD COLUMN assists INTEGER NOT NULL DEFAULT 0')
      .run();
  } catch {}
  try {
    await db()
      .prepare("ALTER TABLE members ADD COLUMN recent_damage TEXT NOT NULL DEFAULT '{}'")
      .run();
  } catch {}
  try {
    await db()
      .prepare('ALTER TABLE members ADD COLUMN immune_until INTEGER NOT NULL DEFAULT 0')
      .run();
  } catch {}
  schemaUpgraded = true;
}
