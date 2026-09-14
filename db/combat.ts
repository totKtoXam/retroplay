import { db } from './server';
import { ensureCombatSchema } from './combat-schema';

/**
 * Older databases can have a migration record without all combat columns because the
 * original rollout created them at runtime. The schema helper checks first, handles a
 * racing isolate, and leaves real DDL failures visible to the caller.
 */
let schemaUpgrade: Promise<void> | null = null;
export async function ensureCombatColumns() {
  schemaUpgrade ??= ensureCombatSchema(db()).catch((error) => {
    schemaUpgrade = null;
    throw error;
  });
  return schemaUpgrade;
}
