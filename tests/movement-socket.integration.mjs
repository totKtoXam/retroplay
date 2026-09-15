import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base = process.env.RETRO_TEST_URL || 'http://localhost:3000';
const session = await fetch(base + '/api/session', { method: 'POST' });
const cookie = session.headers.get('set-cookie').split(';')[0];
const { id: self } = await session.json();
async function req(path, body) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify(data));
  return data;
}
const room = await req('/api/rooms', { title: 'QA movement correction', name: 'QA', theme: 'nauryz' });
const path = '/api/rooms/' + room.id;
let ws, latest;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(predicate) {
  const end = Date.now() + 4000;
  while (!predicate() && Date.now() < end) await sleep(25);
  assert.ok(predicate(), 'missing authoritative movement tick');
}
try {
  ws = new WebSocket(base.replace(/^http/, 'ws') + path + '/socket', { headers: { Cookie: cookie } });
  ws.on('message', (raw) => { const msg = JSON.parse(String(raw)); if (msg.t === 'tick') latest = msg.members.find((m) => m.id === self); });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await until(() => latest);
  const start = { ...latest.pose }, life = latest.life;
  const send = (pose) => ws.send(JSON.stringify({ t: 'presence', pose, life }));
  for (let i = 0; i < 12; i++) {
    send({ ...start, x: start.x + (start.x <= 0 ? 20 : -20) });
    await sleep(160);
  }
  await until(() => latest.positionRevision >= 12);
  assert.equal(latest.pose.x, start.x, 'repeated teleport after 1.5 s stays rejected');
  assert.equal(latest.pose.z, start.z);
  const before = latest.positionRevision;
  send({ ...start, y: 10 });
  await until(() => latest.positionRevision > before);
  assert.equal(latest.pose.y, start.y, 'vertical teleport rejected at unchanged XZ');
  const good = { ...start, x: start.x + 0.2, moving: true };
  send(good);
  await until(() => latest.pose.x === good.x);
  const snapshot = await req(path, { type: 'presence', pose: good, life });
  const member = snapshot.members.find((m) => m.id === self);
  assert.equal(member.pose.x, good.x);
  assert.equal(member.positionRevision, latest.positionRevision, 'HTTP and WS carry the same correction');
  console.log('PASS: WS repeated/vertical teleport rejection, correction counter, legal recovery, HTTP parity.');
} finally {
  if (ws && ws.readyState === WebSocket.OPEN) await new Promise((resolve) => { ws.once('close', resolve); ws.close(); });
  await req(path, { type: 'archive', value: true });
}
