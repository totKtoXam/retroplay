// Run prepare, restart the actual server using the SAME storage directory, then run verify.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import WebSocket from 'ws';
const base = process.env.RETRO_TEST_URL || 'http://127.0.0.1:3016';
const file = process.env.RETRO_RESTART_FIXTURE || 'outputs/restart-fixture.json';
const mode = process.argv[2];
let cookie;
async function req(path, body) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data;
}
if (mode === 'prepare') {
  const session = await fetch(base + '/api/session', { method: 'POST' });
  cookie = session.headers.get('set-cookie').split(';')[0];
  const user = await session.json();
  const room = await req('/api/rooms', { title: 'QA real restart', name: 'Restart QA', theme: 'nauryz' });
  const path = '/api/rooms/' + room.id;
  const shot = await req(path, { type: 'effect', id: crypto.randomUUID(), kind: 'paint',
    origin: [0,1,4], target: [0,1,0], normal: [0,0,1], color: '#ff647c' });
  assert.equal(shot.ok, true); assert.equal(shot.magazine.rounds.paint, 23);
  const reloadShot = await req(path, { type: 'effect', id: crypto.randomUUID(), kind: 'confetti',
    origin: [0,1,4], target: [0,1,0], normal: [0,0,1], color: '#ff647c' });
  // Global cadence may reject the immediate second tool; wait and retry if needed.
  if (!reloadShot.ok) {
    await new Promise(r => setTimeout(r, 600));
    const retry = await req(path, { type: 'effect', id: crypto.randomUUID(), kind: 'confetti',
      origin: [0,1,4], target: [0,1,0], normal: [0,0,1], color: '#ff647c' });
    assert.equal(retry.ok, true);
  }
  const reload = await req(path, { type: 'weapon', action: 'reload', tool: 'confetti', id: crypto.randomUUID() });
  assert.ok(reload.magazine.loading);
  const battle = await req('/api/rooms', { title: 'QA restart match', name: 'Restart QA', theme: 'nauryz', mode: 'battle', map: 'mansion' });
  const battlePath = '/api/rooms/' + battle.id;
  await req(battlePath, { type: 'room.settings', patch: { matchMode: 'rounds', roundWins: 9 } });
  await req(battlePath);
  await new Promise(r => setTimeout(r, 5200));
  const before = await req(battlePath);
  assert.equal(before.match.phase, 'live');
  await mkdir('outputs', { recursive: true });
  await writeFile(file, JSON.stringify({ base, cookie, user: user.id, path, battlePath, before, reload }), { mode: 0o600 });
  console.log('PREPARED: spent paint, timed confetti reload, live round. Restart server now.');
} else if (mode === 'verify') {
  const f = JSON.parse(await readFile(file, 'utf8')); assert.equal(base, f.base); cookie = f.cookie;
  const ammo = await req(f.path, { type: 'weapon', action: 'sync', id: crypto.randomUUID() });
  assert.equal(ammo.magazine.rounds.paint, 23, 'restart must not refill spent ammo');
  assert.equal(ammo.magazine.rounds.confetti, 6, 'elapsed reload completes');
  assert.equal(ammo.magazine.loading, null); assert.ok(ammo.revision > f.reload.revision);
  const after = await req(f.battlePath);
  assert.deepEqual(after.match, f.before.match, 'round, score, phase and deadline survive restart');
  const beforeMember = f.before.members.find(m => m.id === f.user);
  const afterMember = after.members.find(m => m.id === f.user);
  assert.ok(beforeMember); assert.equal(afterMember.life, beforeMember.life, 'no extra respawn');
  const ws = new WebSocket(base.replace(/^http/, 'ws') + f.battlePath + '/socket', { headers: { Cookie: cookie } });
  try {
    const tick = await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(Error('WS restart snapshot timeout')), 5000);
      ws.once('error', e => { clearTimeout(timer); reject(e); });
      ws.on('message', raw => { const m = JSON.parse(String(raw)); if (m.t === 'tick') { clearTimeout(timer); resolve(m); } });
    });
    assert.deepEqual(tick.match, after.match);
  } finally { ws.close(); }
  await req(f.path, { type: 'archive', value: true });
  await req(f.battlePath, { type: 'archive', value: true });
  console.log('PASS: real process restart preserves ammo/revision, reload, live round/deadline, lives; HTTP and WS agree.');
} else throw Error('Specify prepare or verify');
