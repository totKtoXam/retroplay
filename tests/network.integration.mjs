import assert from 'node:assert/strict';

const base = process.env.RETRO_TEST_URL || 'http://localhost:3000';

async function actor() {
  const r = await fetch(base + '/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const data = await r.json();
  return { cookie, id: data.id };
}

async function req(a, path, body) {
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: a.cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await r.json();
  } catch {}
  return { status: r.status, data };
}

console.log('Testing Network Load Reduction & Unified Sync against', base);

const host = await actor();
const guest = await actor();

// 1. Create Room
const roomRes = await req(host, '/api/rooms', {
  title: 'Network Optimization Test Room',
  name: 'NetHost',
  theme: 'nauryz',
  access: 'public',
  maxPlayers: 8,
});
assert.equal(roomRes.status, 201, JSON.stringify(roomRes.data));
const roomId = roomRes.data.id;
const path = '/api/rooms/' + roomId;

// Guest joins
const joinRes = await req(guest, path, { type: 'join', name: 'NetGuest' });
assert.equal(joinRes.status, 200);
console.log('✔ Room created and guest joined');

// 2. Test Unified Sync via POST presence:
// Sending presence returns full snapshot (members, effects, version) in ONE single HTTP response
const syncRes = await req(guest, path, {
  type: 'presence',
  life: 0,
  ping: 42,
  pose: {
    x: 5.1234567,
    y: 0.9876543,
    z: -3.456789,
    yaw: 1.23456,
    stance: 'stand',
    moving: true,
    speed: 3.4,
  },
  cursor: { x: 120.4, y: 240.8, mode: 'board' },
  version: 1,
});

assert.equal(syncRes.status, 200);
assert.equal(syncRes.data.ok, true);
assert.ok(Array.isArray(syncRes.data.members), 'Snapshot must contain members list');
assert.ok(Array.isArray(syncRes.data.effects), 'Snapshot must contain effects array');
assert.equal(syncRes.data.id, roomId);
console.log('✔ Unified sync returned complete room snapshot in a single POST response');

// 3. Verify member list in snapshot has the updated member data
const guestMember = syncRes.data.members.find((m) => m.id === guest.id);
assert.ok(guestMember, 'Guest must be in members list');
assert.equal(guestMember.ping, 42);
assert.equal(guestMember.pose.x, 5.1234567);
assert.equal(guestMember.cursor.x, 120.4);
assert.equal(guestMember.cursor.y, 240.8);
console.log('✔ Member cursor and pose updated atomically in DB and reflected in snapshot');

// 4. Test Incremental Effects Synchronization (Delta Polling):
// Fire an effect from host
const effectId = crypto.randomUUID();
const effectRes = await req(host, path, {
  type: 'effect',
  id: effectId,
  kind: 'paint',
  color: '#ff3366',
  origin: [0, 1, 0],
  target: [0, 1, 5],
  normal: [0, 0, -1],
});
assert.equal(effectRes.status, 200);

// Sync with sinceEffect = 0 (or undefined): should receive the effect
const poll1 = await req(guest, path, {
  type: 'presence',
  version: 1,
  sinceEffect: 0,
});
assert.equal(poll1.status, 200);
const foundEffect = poll1.data.effects.find((e) => e.id === effectId);
assert.ok(foundEffect, 'New effect must be delivered on first sync');
const effectAt = foundEffect.at;
console.log('✔ Effect received on initial sync, timestamp:', effectAt);

// Next sync with sinceEffect: effectAt -> effects array must be empty (0 bytes wasted!)
const poll2 = await req(guest, path, {
  type: 'presence',
  version: 1,
  sinceEffect: effectAt,
});
assert.equal(poll2.status, 200);
const redundantEffects = poll2.data.effects.filter((e) => e.id === effectId);
assert.equal(redundantEffects.length, 0, 'Already-seen effect must NOT be retransmitted');
console.log('✔ Delta sync verified: already-seen effect filtered out, bandwidth saved');

// Fire a second effect
const effectId2 = crypto.randomUUID();
await req(host, path, {
  type: 'effect',
  id: effectId2,
  kind: 'paint',
  color: '#33ff66',
  origin: [0, 1, 0],
  target: [2, 1, 5],
  normal: [0, 0, -1],
});

// Sync with sinceEffect: effectAt -> should receive ONLY effectId2, NOT effectId
const poll3 = await req(guest, path, {
  type: 'presence',
  version: 1,
  sinceEffect: effectAt,
});
assert.equal(poll3.status, 200);
assert.ok(poll3.data.effects.some((e) => e.id === effectId2), 'New effect2 must be delivered');
assert.ok(!poll3.data.effects.some((e) => e.id === effectId), 'Old effect1 must remain excluded');
console.log('✔ Incremental delta delivery verified for subsequent effects');

// 5. Test State Version Caching:
// When version matches current room version, state is omitted (undefined)
assert.equal(poll3.data.state, undefined, 'State is omitted when client version matches');

// When version is older or null, full state is returned
const poll4 = await req(guest, path, {
  type: 'presence',
  version: 0,
});
assert.ok(poll4.data.state, 'State is included when client version is outdated');
assert.equal(poll4.data.state.title, 'Network Optimization Test Room');
console.log('✔ State bandwidth caching verified (omitted on matching version, sent on change)');

console.log('\nAll Network Load Reduction integration tests passed successfully!');
