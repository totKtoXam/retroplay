import assert from 'node:assert/strict';
import WebSocket from 'ws';

const base = new URL(process.env.RETRO_TEST_URL || 'http://localhost:3000');

async function actor() {
  const response = await fetch(new URL('/api/session', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'session cookie is required for WebSocket authentication');
  const data = await response.json();
  return { cookie, id: data.id };
}

async function request(actorSession, path, body) {
  const response = await fetch(new URL(path, base), {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: actorSession.cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await response.json();
  } catch {}
  return { status: response.status, data };
}

function socketUrl(roomId) {
  const url = new URL(`/api/rooms/${roomId}/socket`, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
}

function tickQueue(ws) {
  const queued = [];
  const waiters = [];
  let closed = null;
  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.t !== 'tick') return;
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(message);
    else queued.push(message);
  });
  ws.once('close', () => {
    closed = new Error('WebSocket closed before the expected match tick');
    while (waiters.length) waiters.shift().reject(closed);
  });

  return {
    next(timeoutMs = 1500) {
      if (queued.length) return Promise.resolve(queued.shift());
      return new Promise((resolve, reject) => {
        if (closed) return reject(closed);
        const pending = {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(pending);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`No WebSocket tick received within ${timeoutMs}ms`));
        }, timeoutMs);
        waiters.push(pending);
      });
    },
  };
}

const host = await actor();
let roomId;
let ws;
try {
  const created = await request(host, '/api/rooms', {
    title: `WS match snapshot ${crypto.randomUUID()}`,
    name: 'WS snapshot host',
    theme: 'nauryz',
    mode: 'battle',
    map: 'mansion',
    maxPlayers: 2,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  roomId = created.data.id;

  const configured = await request(host, `/api/rooms/${roomId}`, {
    type: 'room.settings',
    patch: { matchMode: 'rounds', matchMinutes: 0, roundWins: 2 },
  });
  assert.equal(configured.status, 200, JSON.stringify(configured.data));

  ws = new WebSocket(socketUrl(roomId), { headers: { Cookie: host.cookie } });
  const queue = tickQueue(ws);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const initial = await queue.next();
  assert.equal(
    initial.match?.mode,
    'rounds',
    'handshake tick must include match',
  );
  assert.equal(
    initial.match.phase,
    'freeze',
    'round must start in freeze phase',
  );
  assert.ok(
    initial.match.until > initial.now,
    'freeze deadline must be in the future',
  );

  const subsequent = await queue.next();
  assert.ok(subsequent.match, 'regular tick must include match');
  assert.equal(subsequent.match.phase, 'freeze');
  assert.equal(subsequent.match.round, initial.match.round);

  let live = subsequent;
  const deadline = Date.now() + 7000;
  while (live.match.phase !== 'live' && Date.now() < deadline)
    live = await queue.next(1500);
  assert.equal(
    live.match.phase,
    'live',
    'regular WebSocket ticks must publish freeze -> live',
  );
  assert.ok(
    live.now >= initial.match.until,
    'live tick must be after the freeze deadline',
  );
  console.log(
    'PASS: initial and regular WebSocket ticks carry current match state without HTTP refresh.',
  );
} finally {
  if (ws && ws.readyState !== WebSocket.CLOSED) {
    await new Promise((resolve) => {
      ws.once('close', resolve);
      ws.close();
    });
  }
  if (roomId) {
    await request(host, `/api/rooms/${roomId}`, {
      type: 'archive',
      value: true,
    }).catch(() => {});
  }
}
