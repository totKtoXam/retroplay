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
  const self = (await r.json()).id;
  assert.ok(
    !cookie.includes(self),
    'Public identity must not be a login credential',
  );
  return { cookie, self };
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
  const data = await r.json();
  return { status: r.status, data };
}
const host = await actor(),
  guest = await actor(),
  stranger = await actor();
const created = await req(host, '/api/rooms', {
  title: 'QA · concurrent retro',
  name: 'QA Host',
  theme: 'nauryz',
  visualStyle: 'anime',
});
assert.equal(created.status, 201, JSON.stringify(created.data));
const id = created.data.id,
  path = '/api/rooms/' + id;
assert.equal((await req(stranger, path)).data.join, true);
assert.equal(
  (await req(stranger, path, { type: 'note.add', text: 'Intrusion' })).status,
  403,
);
assert.equal(
  (await req(guest, path, { type: 'join', name: 'QA Guest' })).status,
  200,
);
assert.equal((await req(guest, path, { type: 'phase', phase: 4 })).status, 400);
assert.equal((await req(host, path)).data.state.visualStyle, 'anime');
assert.equal(
  (
    await req(guest, path, {
      type: 'room.settings',
      patch: { visualStyle: 'classic' },
    })
  ).status,
  400,
);
await req(host, path, {
  type: 'room.settings',
  patch: { visualStyle: 'classic' },
});
assert.equal((await req(guest, path)).data.state.visualStyle, 'classic');
assert.equal(
  (
    await req(host, path, {
      type: 'room.settings',
      patch: { visualStyle: 'unknown' },
    })
  ).status,
  400,
);
await req(guest, path, {
  type: 'presence',
  pose: {
    x: 0,
    y: 0,
    z: 0,
    yaw: 1.5,
    stance: 'lie',
    moving: true,
    speed: 999,
    strafe: 3,
    forward: -5,
    pitch: 6,
    tool: 'paint',
    working: true,
    crouching: true,
    aiming: true,
    reload: 2,
  },
});
const pose = (await req(host, path)).data.members.find(
  (m) => m.id === guest.self,
).pose;
assert.deepEqual(
  [
    pose.x,
    pose.z,
    pose.speed,
    pose.strafe,
    pose.forward,
    pose.pitch,
    pose.tool,
    pose.working,
  ],
  [0, 0, 6.5, 1, -1, 1.4, 'paint', true],
);

assert.deepEqual([pose.crouching, pose.aiming, pose.reload], [true, true, 1]);
await req(host, path, {
  type: 'room.settings',
  patch: { privateWriting: true },
});
await req(guest, path, {
  type: 'note.add',
  text: 'PRIVATE_SECRET',
  zone: 'bad',
});
assert.ok(
  !JSON.stringify((await req(host, path)).data).includes('PRIVATE_SECRET'),
);
assert.ok(
  JSON.stringify((await req(guest, path)).data).includes('PRIVATE_SECRET'),
);
await req(guest, path, { type: 'reveal' });
assert.ok(
  JSON.stringify((await req(host, path)).data).includes('PRIVATE_SECRET'),
);
await req(host, path, {
  type: 'room.settings',
  patch: { privateWriting: false },
});
const adds = await Promise.all([
  req(host, path, { type: 'note.add', text: 'Parallel A', zone: 'good' }),
  req(guest, path, { type: 'note.add', text: 'Parallel B', zone: 'start' }),
]);
assert.ok(
  adds.every((r) => r.status === 200),
  JSON.stringify(adds),
);
const room = (await req(host, path)).data;
assert.equal(room.state.notes.length, 3);
await req(host, path, { type: 'vote.start', limit: 2 });
const noteId = room.state.notes[0].id;
const votes = await Promise.all([
  req(guest, path, { type: 'vote', id: noteId }),
  req(guest, path, { type: 'vote', id: noteId }),
  req(guest, path, { type: 'vote', id: noteId }),
]);
assert.equal(
  votes.filter((r) => r.status === 200).length,
  2,
  JSON.stringify(votes),
);
const privateVote = (await req(host, path)).data;
assert.ok(!privateVote.state.rounds[0].votes[guest.self]);
await req(host, path, { type: 'vote.end' });
assert.equal(
  (await req(host, path)).data.state.rounds[0].votes[guest.self][noteId],
  2,
);
const another = await req(host, '/api/rooms', {
  title: 'QA · isolated room',
  name: 'QA Host',
  theme: 'newyear',
});
assert.equal(
  (await req(host, '/api/rooms/' + another.data.id)).data.state.notes.length,
  0,
);
assert.equal((await req(guest, '/api/rooms')).data.rooms.length, 1);
const beforeUndo = (await req(host, path)).data.state.notes.length;
await req(host, path, { type: 'note.add', text: 'Undo me', zone: 'good' });
assert.equal((await req(host, path, { type: 'undo' })).status, 200);
assert.equal((await req(host, path)).data.state.notes.length, beforeUndo);
await req(guest, path, { type: 'note.add', text: 'Newer guest edit' });
assert.equal(
  (await req(host, path, { type: 'undo' })).status,
  400,
  'Undo must not overwrite a newer collaborator action',
);
const history = (await req(host, path, { type: 'history' })).data.history;
assert.ok(history.length > 0);
assert.ok(history.every((h) => !('before' in h)));
const effect = {
  id: crypto.randomUUID(),
  type: 'effect',
  kind: 'paint',
  origin: [0, 1, 2],
  target: [2, 0, 4],
  normal: [0, 1, 0],
  color: '#aa86f6',
};
assert.equal((await req(host, path, effect)).status, 200);
const effects = (await req(guest, path)).data.effects;
assert.ok(effects.some((e) => e.id === effect.id));
assert.equal(
  (await req(host, '/api/rooms/' + another.data.id)).data.effects.length,
  0,
);
const known = (await req(host, path)).data;
const incremental = (await req(host, path + '?version=' + known.version)).data;
assert.ok(!('state' in incremental));
assert.ok(incremental.members.length >= 2);
await req(host, path, { type: 'archive', value: true });
await req(host, '/api/rooms/' + another.data.id, {
  type: 'archive',
  value: true,
});
console.log(
  'PASS: HTTP sessions, credentials, room membership, privacy, host permissions, concurrent writes, atomic vote budget, room isolation and durable reload.',
);
