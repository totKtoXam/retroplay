// Простые боты для живой проверки боя: заходят в комнату как обычные игроки,
// патрулируют спавны своей команды, стреляют по ближайшему врагу и умирают.
// Запуск: node --experimental-strip-types quick-bots.mjs --url http://host:port --room <id>
import { getMap } from '../lib/maps/index.ts';
import { isBlocked3D, rayCastWorldObstacle } from '../lib/world-collision.ts';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg('url', 'http://100.74.94.97:3001');
const roomId = arg('room');
const count = Number(arg('count', 6));
const minutes = Number(arg('minutes', 30));
if (!roomId) throw new Error('нужен --room <id>');

const NAMES = ['Алма', 'Ерлан', 'Тимур', 'Дана', 'Асхат', 'Жанна', 'Марат', 'Сауле'];
const path = '/api/rooms/' + roomId;
const anomalies = [];
const note = (bot, kind, detail) => {
  anomalies.push({ bot, kind, detail, at: new Date().toISOString() });
  if (anomalies.length % 10 === 1) console.log('⚠', bot, kind, detail ?? '');
};

async function actor(name) {
  const r = await fetch(base + '/api/session', { method: 'POST' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const { id } = await r.json();
  return { name, cookie, id, version: 0, kills: 0, deaths: 0, latency: [] };
}
async function req(a, body) {
  const started = Date.now();
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: a.cookie,
      'Content-Type': 'application/json',
      Origin: base,
    },
    body: body ? JSON.stringify({ ...body, version: a.version }) : undefined,
  });
  a.latency.push(Date.now() - started);
  const data = await r.json().catch(() => ({}));
  if (typeof data.version === 'number') a.version = data.version;
  if (r.status >= 400) note(a.name, 'http-' + r.status, data.error || body?.type);
  return data;
}

const map = { current: null };
const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
/** Угол между направлением взгляда и целью, радианы. */
const angleTo = (pose, q) => {
  const want = Math.atan2(q.x - pose.x, q.z - pose.z);
  let d = want - pose.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
};
/** Бот видит цель так же, как живой игрок: в пределах обзора и без стены на пути. */
const canSee = (pose, q, gm) => {
  if (Math.abs(angleTo(pose, q)) > FOV / 2) return false;
  const wall = rayCastWorldObstacle(
    [pose.x, pose.y + 1.5, pose.z],
    [q.x, (q.y ?? 0) + 1.1, q.z],
    gm.colliders,
  );
  return !wall;
};
/** Поле зрения по горизонтали (как у игрока с обычным FOV). */
const FOV = (100 * Math.PI) / 180;
/** Скорость доворота прицела, рад/с: мгновенных разворотов у бота нет. */
const TURN_RATE = 3.2;
/** Шаг к цели, обходящий стены «скольжением» вдоль них. */
function step(pose, target, speed, dt, gm) {
  const dx = target.x - pose.x,
    dz = target.z - pose.z,
    len = Math.hypot(dx, dz) || 1;
  const move = Math.min(speed * dt, len);
  const tries = [
    [dx / len, dz / len],
    [dz / len, -dx / len],
    [-dz / len, dx / len],
    [-dx / len, -dz / len],
  ];
  for (const [ux, uz] of tries) {
    const nx = pose.x + ux * move,
      nz = pose.z + uz * move;
    if (!isBlocked3D(nx, nz, pose.y, 0.3, 1.8, gm.colliders))
      return { x: nx, z: nz, y: gm.groundHeight(nx, nz, pose.y) };
  }
  return { x: pose.x, z: pose.z, y: pose.y };
}

async function run(bot, index) {
  await req(bot, { type: 'join', name: '🤖 ' + bot.name });
  const room = await req(bot);
  const gm = getMap(room.state?.map);
  map.current = gm;
  const me = () => room.members?.find?.((m) => m.id === bot.id);
  let pose = { ...(me()?.pose ?? { x: 0, y: 0, z: 4, yaw: 0, stance: 'stand', moving: false }) };
  let route = [];
  let target = null;
  let seen = null;
  let lastShot = 0;
  let lastSeenTick = 0;
  let serverNow = Date.now();
  let life = me()?.life ?? 0;
  const tools = ['paint', 'confetti', 'sniper', 'grenade'];
  let tool = tools[index % tools.length];

  const deadline = Date.now() + minutes * 60_000;
  let last = Date.now();
  while (Date.now() < deadline) {
    const dt = Math.min(0.2, (Date.now() - last) / 1000);
    last = Date.now();
    // Состояние комнаты читаем не каждый тик: хватает 3 раз в секунду.
    let snapshot = null;
    if (Date.now() - lastSeenTick > 320) {
      lastSeenTick = Date.now();
      snapshot = await req(bot);
      serverNow = snapshot.serverNow ?? Date.now();
    }
    const state = snapshot ?? null;
    if (state) {
      const self = state.members.find((m) => m.id === bot.id);
      if (self) {
        if (self.life !== life) {
          life = self.life;
          pose = { ...self.pose };
        }
        if ((self.hp ?? 100) === 0) {
          bot.deaths = self.deaths ?? bot.deaths;
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        bot.kills = self.kills ?? bot.kills;
        // Сервер отверг шаг — продолжаем от его позиции.
        if (dist(self.pose, pose) > 1.5) {
          note(bot.name, 'move-refused', `${dist(self.pose, pose).toFixed(1)} м`);
          pose = { ...self.pose };
        }
        const team = self.team;
        const enemies = state.members.filter(
          (m) => m.id !== bot.id && m.team && m.team !== team && (m.hp ?? 0) > 0,
        );
        const spawns = gm.spawns[team === 'red' ? 'blue' : 'red'] ?? gm.spawns.red;
        if (!route.length) route = spawns.map((s) => ({ x: s.x, z: s.z }));
        // Видимые враги: в поле зрения и без стены между нами.
        const visible = enemies
          .filter((m) => dist(m.pose, pose) < 30 && canSee(pose, m.pose, gm))
          .sort((a, b) => dist(a.pose, pose) - dist(b.pose, pose));
        const near = visible[0];
        seen = near ? { x: near.pose.x, z: near.pose.z } : seen;
        target = near ? { x: near.pose.x, z: near.pose.z } : route[index % route.length];
        const frozen = state.match?.phase === 'freeze';
        // Стреляем только по тому, кого действительно видим и на кого навелись.
        const aimed = near && Math.abs(angleTo(pose, near.pose)) < 0.12;
        if (near && aimed && !frozen && Date.now() - lastShot > 900) {
          lastShot = Date.now();
          const miss = Math.random() < 0.35 ? 0.9 : 0;
          await req(bot, {
            type: 'effect',
            kind: tool,
            variant: 'classic',
            origin: [pose.x, pose.y + 1.4, pose.z],
            target: [
              near.pose.x + miss,
              near.pose.y + 1.1,
              near.pose.z + miss,
            ],
            normal: [0, 0, 1],
            color: '#ff647c',
            seenAt: serverNow,
          });
          if (Math.random() < 0.25) tool = tools[Math.floor(Math.random() * tools.length)];
        }
      }
    }
    if (target) {
      const next = step(pose, target, 4.2, dt, gm);
      const moved = Math.hypot(next.x - pose.x, next.z - pose.z) > 0.01;
      const turn = angleTo({ ...pose, yaw: pose.yaw }, target);
      const maxTurn = TURN_RATE * dt;
      pose = {
        ...pose,
        ...next,
        yaw: pose.yaw + Math.max(-maxTurn, Math.min(maxTurn, turn)),
        moving: moved,
        speed: moved ? 4.2 : 0,
        tool,
        stance: Math.random() < 0.01 ? 'sit' : pose.stance === 'sit' && Math.random() < 0.2 ? 'stand' : pose.stance,
      };
      if (dist(pose, target) < 1.2 && !target.x) route.push(route.shift());
    }
    await req(bot, { type: 'presence', pose, life });
    await new Promise((r) => setTimeout(r, 100));
  }
}

const bots = [];
for (let i = 0; i < count; i++) bots.push(await actor(NAMES[i % NAMES.length]));
console.log(`Подключаю ${bots.length} ботов к ${base}${path}`);
const summary = () => {
  console.log('\n=== Итоги ===');
  for (const b of bots) {
    const sorted = [...b.latency].sort((x, y) => x - y);
    console.log(
      `${b.name}: убийств ${b.kills}, смертей ${b.deaths}, медиана ответа ${sorted[Math.floor(sorted.length / 2)] ?? 0} мс`,
    );
  }
  const kinds = {};
  for (const a of anomalies) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
  console.log('Аномалии:', Object.keys(kinds).length ? kinds : 'нет');
};
process.on('SIGINT', () => {
  summary();
  process.exit(0);
});
await Promise.all(bots.map((b, i) => run(b, i).catch((e) => note(b.name, 'crash', String(e)))));
summary();
