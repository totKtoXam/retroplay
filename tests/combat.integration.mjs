import assert from 'node:assert/strict';
const base = process.env.RETRO_TEST_URL || 'http://localhost:3000';
async function actor() {
  const r = await fetch(base + '/api/session', { method: 'POST' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return { cookie, id: (await r.json()).id };
}
async function req(a, path, body) {
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { Cookie: a.cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
const host = await actor(),
  guest = await actor();
const created = await req(host, '/api/rooms', {
  title: 'QA · party items',
  name: 'Distinct Host Name',
  theme: 'nauryz',
});
assert.equal(created.status, 201, JSON.stringify(created.data));
const path = '/api/rooms/' + created.data.id;
await req(guest, path, { type: 'join', name: 'Distinct Guest Name' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const member = async () =>
  (await req(host, path)).data.members.find((m) => m.id === guest.id);
const pose = { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand', moving: false };
assert.equal((await member()).hp, 100);
await req(guest, path, { type: 'presence', pose, life: 0, hp: 1 });
assert.equal((await member()).hp, 100, 'client cannot change HP');
assert.equal(
  (
    await req(guest, path, {
      type: 'room.settings',
      patch: { respawnSeconds: 1, anonymousPlayers: true },
    })
  ).status,
  400,
);
for (const value of [0, 31, 2.5])
  assert.equal(
    (
      await req(host, path, {
        type: 'room.settings',
        patch: { respawnSeconds: value },
      })
    ).status,
    400,
  );
await req(host, path, {
  type: 'room.settings',
  patch: { respawnSeconds: 1, anonymousPlayers: true, privateWriting: true },
});
await req(guest, path, {
  type: 'note.add',
  text: 'SECRET_PARTY_TEXT',
  zone: 'stop',
  url: 'https://example.com/SECRET_MEDIA',
  owner: 'SECRET_OWNER',
  tags: ['SECRET_TAG'],
});
const snapshot = (await req(host, path)).data;
assert.ok(snapshot.state.notes[0].redacted);
assert.equal(snapshot.state.notes[0].zone, 'stop');
assert.ok(!JSON.stringify(snapshot).includes('SECRET_'));
assert.ok(!JSON.stringify(snapshot).includes('Distinct'));
const history = await req(host, path, { type: 'history' });
assert.ok(!JSON.stringify(history).includes('Distinct'));
const fire = (
  kind = 'paint',
  variant = 'classic',
  id = crypto.randomUUID(),
) => ({
  type: 'effect',
  id,
  kind,
  variant,
  origin: [0, 1.1, 4],
  target: [0, 1.1, 0],
  normal: [0, 0, 1],
  color: '#ff647c',
});
const first = fire();
// Current gameplay grants five seconds of protection on join and respawn.
// Wait for that existing rule instead of expecting damage during immunity.
await wait(Math.max(0, (await member()).immuneRemaining || 0) + 80);
await req(host, path, first);
assert.equal((await member()).hp, 80);
await Promise.all([
  req(host, path, first),
  req(host, path, first),
  req(guest, path),
]);
assert.equal((await member()).hp, 80, 'duplicate deliveries resolve only once');
for (let i = 0; i < 4; i++) {
  await wait(130);
  await req(host, path, fire());
}
const dead = await member();
assert.equal(dead.hp, 0);
assert.ok(dead.respawnAt > Date.now());
await req(guest, path, { type: 'presence', pose: { ...pose, x: 20 }, life: 0 });
assert.equal((await member()).pose.x, 0, 'dead player cannot move');
assert.ok(
  (await member()).lastSeen >= dead.lastSeen,
  'presence stays online during respawn',
);
assert.equal(
  (await req(guest, path, fire())).data.ok,
  false,
  'dead player cannot shoot',
);
await wait(1100);
const revived = await member();
assert.equal(revived.hp, 100);
assert.equal(revived.life, 1);
assert.equal(revived.pose.z, 4);
await req(guest, path, { type: 'presence', pose: { ...pose, x: 20 }, life: 0 });
assert.equal(
  (await member()).pose.x,
  0,
  'old life packets cannot overwrite spawn',
);
await req(guest, path, { type: 'presence', pose, life: 1 });
assert.equal((await member()).pose.z, 0);
await wait(Math.max(1500, (await member()).immuneRemaining || 0) + 80);
const grenade = fire('grenade', 'pinata');
await req(host, path, grenade);
assert.equal((await member()).hp, 100, 'grenade fuse is delayed');
await wait(1150);
await Promise.all([req(host, path), req(guest, path), req(host, path)]);
assert.equal(
  (await member()).hp,
  55,
  'concurrent polls resolve grenade only once',
);
const effects = (await req(guest, path)).data.effects;
assert.equal(effects.find((e) => e.id === grenade.id).variant, 'pinata');
await wait(1500);
await req(host, path, fire('grenade', 'meteor'));
await wait(15600);
await req(guest, path, { type: 'presence', pose, life: 1 });
assert.equal(
  (await member()).hp,
  55,
  'expired effects cannot damage a participant returning later',
);
await req(host, path, {
  type: 'room.settings',
  patch: { anonymousPlayers: false },
});
assert.equal((await member()).name, 'Distinct Guest Name');
await req(host, path, { type: 'archive', value: true });
console.log(
  'PASS: HP authority, effect deduplication, delayed grenade, concurrent damage, respawn, stale pose protection, host interval, anonymous names, private placeholders.',
);
