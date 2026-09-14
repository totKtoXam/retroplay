import { ToolMagazine } from './tool-magazine.ts';
import { isBlaster } from './weapon-definition.ts';
import type { HubMember } from './room-hub-core.ts';
import type { WeaponReply } from './weapon-protocol.ts';

/** Owned by a member, never recreated by reconnects or profile updates. A new life gets a fresh loadout. */
export function memberWeapon(m: HubMember) {
  if (!m.weapon || m.weapon.life !== m.life)
    m.weapon = { life: m.life, magazine: new ToolMagazine(), revision: (m.weapon?.revision ?? 0) + 1 };
  return m.weapon;
}
export function weaponReply(m: HubMember, id: string, now: number, ok: boolean, reason?: string): WeaponReply {
  const w = memberWeapon(m);
  w.magazine.tick(now);
  return { id, ok, reason, now, life: m.life, revision: ++w.revision, magazine: w.magazine.snapshot() };
}
export function controlWeapon(m: HubMember, op: Record<string, unknown>, now: number): WeaponReply {
  const id = typeof op.id === 'string' ? op.id : '';
  const w = memberWeapon(m);
  w.magazine.tick(now);
  if (op.life !== undefined && op.life !== m.life) return weaponReply(m, id, now, false, 'stale-life');
  if (op.action === 'sync') return weaponReply(m, id, now, true);
  if (m.hp <= 0) return weaponReply(m, id, now, false, 'respawning');
  if (op.action === 'cancel') {
    w.magazine.cancel();
    return weaponReply(m, id, now, true);
  }
  if (op.action === 'reload' && isBlaster(op.tool)) {
    w.magazine.reload(op.tool, now);
    return weaponReply(m, id, now, true);
  }
  return weaponReply(m, id, now, false, 'invalid-command');
}
