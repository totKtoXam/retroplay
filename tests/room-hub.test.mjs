import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPresence,
  balanceTeam,
  newMatch,
  setTeam,
  updateMatch,
  effectsSince,
  fireEffect,
  memberFromRow,
  poseAt,
  publicEffects,
  publicMembers,
  resolveCombat,
  sanitizePose,
} from '../lib/room-hub-core.ts';
import { isBlocked3D } from '../lib/world-collision.ts';
import { getMap } from '../lib/maps/index.ts';

const T = 1_000_000;
const stand = (x, z) => ({ x, y: 0, z, yaw: 0, stance: 'stand', moving: false });
const member = (id, over = {}) => ({
  id,
  name: 'Name ' + id,
  color: '#368c78',
  mood: '',
  hat: '',
  seen: T,
  pose: stand(0, 4),
  ping: 0,
  cursor: null,
  hp: 100,
  respawnAt: 0,
  immuneUntil: 0,
  life: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  recentDamage: {},
  lastShot: 0,
  track: [],
  moveBudget: 5,
  lastMoveAt: 0,
  refusedSince: 0,
  spawn: { x: 0, z: 4 },
  team: '',
  ...over,
});
const room = (over = {}) => ({
  host: 'a',
  anonymous: false,
  respawnSeconds: 5,
  archived: false,
  map: 'hub',
  teams: false,
  friendlyFire: false,
  friendlyFirePercent: 50,
  matchMode: 'deathmatch',
  killLimit: 30,
  matchMinutes: 10,
  roundWins: 5,
  ...over,
});
const hub = (...members) => ({
  room: room(),
  members: new Map(members.map((m) => [m.id, m])),
  effects: [],
  seq: 0,
  match: { mode: 'deathmatch', score: { red: 0, blue: 0 }, round: 1, phase: 'live', until: 0 },
});
// Shooter stands at spawn (0,0,4); the victim at the origin is hit in the body.
const shot = (kind = 'paint', over = {}) => ({
  kind,
  variant: 'classic',
  origin: [0, 1.1, 4],
  target: [0, 1.1, 0],
  normal: [0, 0, 1],
  color: '#ff647c',
  ...over,
});
const duel = () => hub(member('a'), member('v', { pose: stand(0, 0) }));
const fire = (h, who, now, kind, over) => {
  const r = fireEffect(h, who, shot(kind, over), now);
  resolveCombat(h, now);
  return r;
};

test('a paint hit deals 20 damage once, even when the same shot id arrives twice', () => {
  const h = duel();
  const id = crypto.randomUUID();
  assert.equal(fire(h, 'a', T, 'paint', { id }).ok, true);
  assert.equal(fire(h, 'a', T + 200, 'paint', { id }).ok, false);
  assert.equal(h.members.get('v').hp, 80);
});

test('shots faster than the weapon cooldown are rejected', () => {
  const h = duel();
  assert.equal(fire(h, 'a', T).ok, true);
  assert.equal(fire(h, 'a', T + 50).ok, false);
  assert.equal(fire(h, 'a', T + 100).ok, true);
  assert.equal(h.members.get('v').hp, 60);
});

test('a lethal hit kills, credits the killer and the latest other attacker, and posts a kill effect', () => {
  const h = hub(member('a'), member('b'), member('v', { pose: stand(0, 0) }));
  fire(h, 'b', T);
  for (let i = 1; i <= 4; i++) fire(h, 'a', T + i * 100);
  const v = h.members.get('v');
  assert.equal(v.hp, 0);
  assert.equal(v.deaths, 1);
  assert.equal(v.respawnAt, T + 400 + 5000);
  assert.equal(h.members.get('a').kills, 1);
  assert.equal(h.members.get('b').assists, 1);
  const kill = h.effects.find((e) => e.kind === 'kill');
  assert.equal(kill.killer, 'a');
  assert.equal(kill.victim, 'v');
  assert.equal(kill.assister, 'b');
  assert.equal(kill.assisterName, 'Name b');
});

test('dead players cannot move or shoot; they respawn protected at the spawn point', () => {
  const h = duel();
  const v = h.members.get('v');
  Object.assign(v, { hp: 0, respawnAt: T + 1000 });
  applyPresence(v, { pose: stand(20, 0), life: 0 }, T);
  assert.equal(v.pose.x, 0, 'dead player cannot move');
  assert.equal(v.seen, T, 'presence stays online during respawn');
  assert.equal(fireEffect(h, 'v', shot(), T).reason, 'respawning');
  resolveCombat(h, T + 1000);
  assert.deepEqual([v.hp, v.life, v.pose.z, v.immuneUntil], [100, 1, 4, -1]);
  applyPresence(v, { pose: stand(20, 0), life: 0 }, T + 1100);
  assert.equal(v.pose.z, 4, 'old life packets cannot overwrite spawn');
  assert.equal(v.immuneUntil, -1, 'old life packets do not end spawn protection');
  applyPresence(v, { pose: stand(0, 0), life: 1 }, T + 1200);
  assert.equal(v.pose.z, 0);
  assert.equal(v.immuneUntil, T + 1200 + 5000, 'protection ends 5 s after the first move');
});

test('immune players neither take nor deal damage', () => {
  const h = duel();
  h.members.get('v').immuneUntil = T + 1000;
  fire(h, 'a', T);
  assert.equal(h.members.get('v').hp, 100);
  h.members.get('v').immuneUntil = 0;
  h.members.get('a').immuneUntil = -1;
  assert.equal(fire(h, 'a', T + 200).reason, 'immune');
});

test('clients cannot set their own HP through presence', () => {
  const h = duel();
  applyPresence(h.members.get('v'), { pose: stand(0, 0), life: 0, hp: 1 }, T);
  assert.equal(h.members.get('v').hp, 100);
});

test('a grenade explodes after its fuse and is resolved only once', () => {
  const h = duel();
  fire(h, 'a', T, 'grenade', { variant: 'pinata' });
  assert.equal(h.members.get('v').hp, 100, 'grenade fuse is delayed');
  resolveCombat(h, T + 1100);
  resolveCombat(h, T + 1150);
  assert.equal(h.members.get('v').hp, 55);
  assert.equal(effectsSince(h, T + 1150)[0].variant, 'pinata');
});

test('expired effects cannot damage a participant returning later', () => {
  const h = duel();
  fireEffect(h, 'a', shot('grenade'), T);
  h.members.get('v').seen = T + 16_000;
  resolveCombat(h, T + 16_000);
  assert.equal(h.members.get('v').hp, 100);
  assert.equal(h.effects.length, 0);
});

test('offline members are not hit', () => {
  const h = duel();
  h.members.get('v').seen = T - 20_000;
  fire(h, 'a', T);
  assert.equal(h.members.get('v').hp, 100);
});

test('malformed or out-of-reach shots are rejected; archived rooms ignore shots', () => {
  const h = duel();
  assert.throws(() => fireEffect(h, 'a', shot('laser'), T), /Неизвестный эффект/);
  assert.throws(() => fireEffect(h, 'a', shot('paint', { target: [0, 1, NaN] }), T), /траектория/);
  assert.throws(() => fireEffect(h, 'a', shot('paint', { color: 'red' }), T), /цвет/);
  assert.throws(() => fireEffect(h, 'a', shot('paint', { origin: [20, 1, 4] }), T), /далеко/);
  h.room.archived = true;
  assert.equal(fireEffect(h, 'a', shot(), T).ok, false);
});

test('anonymous rooms hide names in members and in the kill feed; internals are not exposed', () => {
  const h = duel();
  h.room.anonymous = true;
  for (let i = 0; i < 5; i++) fire(h, 'a', T + i * 100);
  const names = publicMembers(h, T + 500).map((m) => m.name);
  assert.deepEqual(names, ['Участник', 'Участник']);
  const effects = publicEffects(effectsSince(h, T + 500), true);
  const kill = effects.find((e) => e.kind === 'kill');
  assert.equal(kill.killerName, 'Участник');
  assert.equal(kill.victimName, 'Участник');
  assert.ok(
    effects.every((e) => !('seq' in e) && !('applied' in e) && !('resolveAt' in e) && !('rewindTo' in e)),
  );
});

test('effectsSince respects the client cursor and the TTL', () => {
  const h = duel();
  fire(h, 'a', T);
  fire(h, 'a', T + 200);
  assert.equal(effectsSince(h, T + 300, T + 100).length, 1);
  assert.equal(effectsSince(h, T + 15_100).length, 1);
});

test('poses are clamped and cleaned; D1 rows load with defaults', () => {
  const p = sanitizePose({ x: 99, y: -1, z: 0, yaw: 1, stance: 'fly', tool: 'bazooka', speed: 50 });
  assert.deepEqual([p.x, p.y, p.stance, p.tool, p.speed], [36, 0, 'stand', 'other', 6.5]);
  assert.equal(sanitizePose({ x: 1, y: 0, z: 0 }), null);
  const m = memberFromRow({ session: 's', name: 'N', color: '#fff', seen: 5, pose: 'bad json', cursor: '{}', hp: 0 });
  assert.deepEqual([m.hp, m.pose.z, m.cursor, m.kills], [0, 4, null, 0]);
});

// The victim runs along +x at 4.8 m/s (0.24 m every 50 ms); shots aim at x = 0.
const runner = (steps) => {
  const h = duel();
  const v = h.members.get('v');
  applyPresence(v, { pose: stand(0, 0), life: 0 }, T);
  for (let k = 1; k <= steps; k++) applyPresence(v, { pose: stand(0.24 * k, 0), life: 0 }, T + 50 * k);
  return h;
};

test('lag compensation: a shot hits where the shooter saw the victim', () => {
  const seen = runner(4); // victim now at x = 0.96, out of a shot aimed at x = 0
  fire(seen, 'a', T + 200, 'paint', { seenAt: T });
  assert.equal(seen.members.get('v').hp, 80);
  const unseen = runner(4);
  fire(unseen, 'a', T + 200);
  assert.equal(unseen.members.get('v').hp, 100, 'without seenAt the current pose is used');
  assert.deepEqual(
    [poseAt(seen.members.get('v'), T + 125).x, poseAt(seen.members.get('v'), T + 999).x],
    [0.6, 0.96],
  );
});

test('lag compensation rewinds at most 250 ms and never for grenades', () => {
  const h = runner(10); // x = 2.4 at T + 500; 250 ms back it was at x = 1.2
  fire(h, 'a', T + 500, 'paint', { seenAt: T });
  assert.equal(h.members.get('v').hp, 100, 'x = 0 is further back than the cap');
  const aimed = runner(10);
  fire(aimed, 'a', T + 500, 'paint', { seenAt: T, target: [1.2, 1.1, 0] });
  assert.equal(aimed.members.get('v').hp, 80, 'clamped to 250 ms: x = 1.2');
  const g = fireEffect(h, 'a', shot('grenade', { seenAt: T }), T + 2000);
  assert.equal(g.effect.rewindTo, T + 2000);
});

test('teleports are refused; a client stuck on refusals is resynced after 1.5 s', () => {
  assert.equal(isBlocked3D(20, 0, 0, 0.25), false);
  const h = duel();
  const v = h.members.get('v');
  applyPresence(v, { pose: stand(0, 0), life: 0 }, T);
  applyPresence(v, { pose: { ...stand(20, 0), yaw: 1 }, life: 0 }, T + 50);
  assert.deepEqual([v.pose.x, v.pose.yaw, v.pose.moving], [0, 1, false], 'position refused, rest kept');
  applyPresence(v, { pose: stand(20, 0), life: 0 }, T + 1000);
  assert.equal(v.pose.x, 0);
  applyPresence(v, { pose: stand(20, 0), life: 0 }, T + 1600);
  assert.equal(v.pose.x, 20, 'resynced');
  applyPresence(v, { pose: stand(20.3, 0), life: 0 }, T + 1650);
  assert.equal(v.pose.x, 20.3, 'normal movement continues');
});

// A battle map (teams on); the hub stays free-for-all.
const battle = (...members) => {
  const h = hub(...members);
  h.room = room({ map: 'mansion', teams: true });
  h.match = newMatch(h.room, T);
  return h;
};

test('teams: friendly fire is off by default and the host sets its share', () => {
  const h = battle(member('a', { team: 'red' }), member('v', { team: 'red', pose: stand(0, 0) }));
  fire(h, 'a', T);
  assert.equal(h.members.get('v').hp, 100, 'no damage to a teammate');
  h.room.friendlyFire = true;
  h.room.friendlyFirePercent = 50;
  fire(h, 'a', T + 200);
  assert.equal(h.members.get('v').hp, 90, 'half of a 20 HP paint hit');
});

test('teams: a kill scores for the team, a team kill scores nothing', () => {
  const h = battle(member('a', { team: 'red' }), member('v', { team: 'blue', pose: stand(0, 0) }));
  for (let i = 0; i < 5; i++) fire(h, 'a', T + i * 100);
  assert.deepEqual(
    [h.match.score.red, h.members.get('a').kills, h.members.get('v').deaths],
    [1, 1, 1],
  );
  const t = battle(member('a', { team: 'red' }), member('v', { team: 'red', pose: stand(0, 0) }));
  t.room.friendlyFire = true;
  t.room.friendlyFirePercent = 100;
  for (let i = 0; i < 5; i++) fire(t, 'a', T + i * 100);
  const kill = t.effects.find((e) => e.kind === 'kill');
  assert.deepEqual(
    [t.match.score.red, t.members.get('a').kills, t.members.get('v').deaths, kill.teamkill],
    [0, 0, 1, true],
  );
});

test('teams: a new player joins the smaller side and lands on its spawn', () => {
  const h = battle(member('a', { team: 'red' }), member('b', { team: 'red' }), member('c'));
  assert.equal(balanceTeam(h, h.members.get('c'), T), true);
  const c = h.members.get('c');
  assert.equal(c.team, 'blue');
  assert.ok(
    getMap('mansion').spawns.blue.some((s) => s.x === c.pose.x && s.z === c.pose.z),
    'moved off the hub spawn onto a blue point',
  );
  assert.equal(balanceTeam(h, h.members.get('a'), T), false, 'a team is never reassigned');
});

test('deathmatch ends on the kill limit and a new one starts after the result', () => {
  const h = battle(member('a', { team: 'red' }));
  h.room.killLimit = 2;
  h.match = newMatch(h.room, T);
  h.match.score.red = 2;
  assert.equal(updateMatch(h, T + 10), true);
  assert.deepEqual([h.match.phase, h.match.winner], ['ended', 'red']);
  assert.equal(updateMatch(h, h.match.until + 1), true);
  assert.deepEqual([h.match.phase, h.match.score], ['live', { red: 0, blue: 0 }]);
});

test('rounds: the dead wait for the next round and the surviving team takes it', () => {
  const h = battle(member('a', { team: 'red' }), member('v', { team: 'blue', pose: stand(0, 0) }));
  h.room.matchMode = 'rounds';
  h.match = newMatch(h.room, T);
  for (let i = 0; i < 5; i++) fire(h, 'a', T + i * 100);
  const v = h.members.get('v');
  assert.equal(v.hp, 0);
  for (const m of h.members.values()) m.seen = T + 20_000;
  resolveCombat(h, T + 20_000);
  assert.equal(v.hp, 0, 'no respawn inside a round');
  assert.deepEqual([h.match.score.red, h.match.phase], [1, 'intermission']);
  resolveCombat(h, h.match.until + 1);
  assert.deepEqual([h.match.phase, h.match.round, v.hp], ['live', 2, 100]);
});

test('teammates never respawn on the same point while another is free', () => {
  const h = battle(member('a', { team: 'red' }), member('b', { team: 'red' }));
  const spawns = getMap('mansion').spawns.red;
  assert.ok(spawns.length > 1, 'the map has room to spread out');
  setTeam(h, 'a', 'blue', T);
  setTeam(h, 'a', 'red', T);
  const first = h.members.get('a').pose;
  setTeam(h, 'b', 'blue', T);
  setTeam(h, 'b', 'red', T);
  const second = h.members.get('b').pose;
  assert.ok(Math.hypot(first.x - second.x, first.z - second.z) >= 2, 'different spawn points');
});

test('the host moves a player to the other side and they respawn there', () => {
  const h = battle(member('a', { team: 'red' }));
  assert.equal(setTeam(h, 'a', 'blue', T), true);
  const m = h.members.get('a');
  assert.ok(getMap('mansion').spawns.blue.some((s) => s.x === m.pose.x && s.z === m.pose.z));
  assert.deepEqual([m.team, m.life], ['blue', 1]);
});

test('the hub has no match: free-for-all', () => {
  const h = hub(member('a'), member('b'));
  assert.equal(updateMatch(h, T + 600_000), false);
});

test('walking into or through a wall is refused', () => {
  // Campus south wall: x -4.6..-1.4, z -13.7..-13.3.
  assert.ok(!isBlocked3D(-3, -12.8, 0, 0.25) && !isBlocked3D(-3, -14.2, 0, 0.25));
  assert.ok(isBlocked3D(-3, -13.5, 0, 0.25));
  const v = member('v', { pose: stand(-3, -12.8) });
  hub(member('a'), v);
  applyPresence(v, { pose: stand(-3, -14.2), life: 0 }, T);
  assert.equal(v.pose.z, -12.8, 'through the wall');
  applyPresence(v, { pose: stand(-3, -13.5), life: 0 }, T + 100);
  assert.equal(v.pose.z, -12.8, 'into the wall');
  applyPresence(v, { pose: stand(-3, -12.5), life: 0 }, T + 200);
  assert.equal(v.pose.z, -12.5);
});
