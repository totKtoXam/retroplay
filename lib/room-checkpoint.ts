import type { HubMember, HubState } from './room-hub-core.ts';
import { ToolMagazine, type MagazineSnapshot } from './tool-magazine.ts';

type SavedMember = Omit<HubMember, 'weapon'> & {
  weapon?: { life: number; revision: number; magazine: MagazineSnapshot };
};
type Checkpoint = {
  version: 1; roomId: string; map: string; teams: boolean;
  match: HubState['match']; effects: HubState['effects']; seq: number; members: SavedMember[];
  /** Партия «Предателя»; в чекпоинтах до режима её нет. */
  impostor?: HubState['impostor'];
};
/** JSON only; absolute server deadlines survive restarts without restarting their timers. */
export function encodeCheckpoint(roomId: string, hub: HubState): string {
  const saved: Checkpoint = {
    version: 1, roomId, map: hub.room.map, teams: hub.room.teams,
    match: hub.match, effects: hub.effects, seq: hub.seq, impostor: hub.impostor,
    members: [...hub.members.values()].map(({ weapon, ...member }) => ({
      ...member, weapon: weapon && { ...weapon, magazine: weapon.magazine.snapshot() },
    })),
  };
  return JSON.stringify(saved);
}
export function checkpointRoom(data: string): string {
  const saved = JSON.parse(data) as Checkpoint;
  if (saved.version !== 1) throw Error('Unsupported room checkpoint version');
  return saved.roomId;
}
/** D1 remains authoritative for membership, room settings and profiles. */
export function restoreCheckpoint(roomId: string, hub: HubState, data: string): boolean {
  if (checkpointRoom(data) !== roomId) throw Error('Room checkpoint identity mismatch');
  const saved = JSON.parse(data) as Checkpoint;
  if (saved.map !== hub.room.map || saved.teams !== hub.room.teams) return false;
  hub.match = saved.match;
  hub.effects = saved.effects;
  hub.seq = saved.seq;
  if (saved.impostor) hub.impostor = saved.impostor;
  for (const previous of saved.members) {
    const current = hub.members.get(previous.id);
    if (!current) continue;
    const { weapon, ...hot } = previous;
    const profile = { name: current.name, color: current.color, mood: current.mood,
      hat: current.hat, seen: Math.max(current.seen, previous.seen) };
    Object.assign(current, hot, profile);
    if (weapon) {
      const magazine = new ToolMagazine();
      magazine.restore(weapon.magazine);
      current.weapon = { life: weapon.life, revision: weapon.revision, magazine };
    }
  }
  return true;
}
