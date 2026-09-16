import { env } from 'cloudflare:workers';
import { db, discardBody, json, payload, roomHub } from '@/db/server';
import { ensureCombatColumns } from '@/db/combat';
import {
  checkBotSlots,
  commitOperation,
  maxPlayersOf,
  occupiedSlots,
  type RoomRow,
} from '@/db/room-ops';
import { BOT_LEVEL_IDS, BOT_LEVELS } from '@/lib/bot-levels';
import type { RoomState } from '@/lib/model';

type Context = { params: Promise<{ id: string }> };

/**
 * Внешний API серверных ботов: добавить, убрать и перечислить ботов комнаты без
 * браузера — например, чтобы набрать составы перед игрой скриптом.
 *
 * Действует от имени ведущего, поэтому закрыт токеном `BOTS_API_TOKEN` (в
 * `.dev.vars` на сервере). Без токена в окружении API выключен целиком: ключ,
 * который никто не задавал, не должен оказаться пустой строкой, подходящей к
 * любому запросу. Правила те же, что у кнопок ведущего, — операции идут через
 * `applyOperation` и лимит мест комнаты.
 *
 *   GET  /api/rooms/:id/bots
 *   POST /api/rooms/:id/bots  { "action": "add", "level": "expert", "team": "red", "count": 5 }
 *                             { "action": "level", "id": "bot-…", "level": "weak" }
 *                             { "action": "remove", "id": "bot-…" } | { "action": "clear" }
 *   Authorization: Bearer <BOTS_API_TOKEN>
 */

const digest = async (value: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

/** Сравнение без утечки по времени: сравниваем хеши одинаковой длины целиком. */
async function authorized(request: Request) {
  const expected = env.BOTS_API_TOKEN;
  if (!expected) return 'off' as const;
  const header = request.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!given) return false;
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function denied(request: Request) {
  const auth = await authorized(request);
  if (auth === true) return null;
  await discardBody(request);
  return auth === 'off'
    ? json({ error: 'API ботов выключен: на сервере не задан BOTS_API_TOKEN' }, 404)
    : json({ error: 'Нужен заголовок Authorization: Bearer <BOTS_API_TOKEN>' }, 401);
}

async function roomRow(id: string) {
  return db().prepare('SELECT * FROM rooms WHERE id=?').bind(id).first<RoomRow>();
}

/** Список ботов с тем, как у них идёт бой. */
async function describe(id: string, r: RoomRow) {
  const state = JSON.parse(r.state) as RoomState;
  const live = await roomHub(id).live(id, null);
  const byId = new Map(live.members.map((m) => [m.id, m]));
  return {
    room: id,
    maxPlayers: maxPlayersOf(state),
    occupied: await occupiedSlots(id, state),
    levels: BOT_LEVEL_IDS.map((level) => ({ id: level, label: BOT_LEVELS[level].label })),
    bots: (state.bots ?? []).map((b) => {
      const m = byId.get(b.id);
      return {
        ...b,
        playing: !!m,
        liveTeam: m?.team ?? '',
        hp: m?.hp ?? null,
        kills: m?.kills ?? 0,
        deaths: m?.deaths ?? 0,
        assists: m?.assists ?? 0,
      };
    }),
  };
}

export async function GET(request: Request, context: Context) {
  const refusal = await denied(request);
  if (refusal) return refusal;
  try {
    await ensureCombatColumns();
    const { id } = await context.params;
    const r = await roomRow(id);
    if (!r) return json({ error: 'Комната не найдена' }, 404);
    return json(await describe(id, r));
  } catch (e) {
    console.error(e);
    return json({ error: 'Не удалось прочитать ботов комнаты' }, 503);
  }
}

export async function POST(request: Request, context: Context) {
  const refusal = await denied(request);
  if (refusal) return refusal;
  try {
    await ensureCombatColumns();
    const { id } = await context.params;
    const body = (await payload(request)) as Record<string, unknown>;
    const r = await roomRow(id);
    if (!r) return json({ error: 'Комната не найдена' }, 404);
    const state = JSON.parse(r.state) as RoomState;
    let op: Record<string, unknown>;
    if (body.action === 'add')
      op = { type: 'bots.add', level: body.level, team: body.team, count: body.count };
    else if (body.action === 'level') op = { type: 'bots.level', id: body.id, level: body.level };
    else if (body.action === 'remove') op = { type: 'bots.remove', id: body.id };
    else if (body.action === 'clear') op = { type: 'bots.remove', all: true };
    else throw Error('Неизвестное действие: add, level, remove или clear');
    if (op.type === 'bots.add') await checkBotSlots(id, state, op);
    const done = await commitOperation(id, op, r.host, r);
    if (!done) return json({ error: 'Комнату обновил другой участник. Повторите запрос.' }, 409);
    const fresh = await roomRow(id);
    return json({ ok: true, ...(await describe(id, fresh ?? r)) });
  } catch (e) {
    await discardBody(request);
    return json({ error: e instanceof Error ? e.message : 'Не удалось изменить ботов' }, 400);
  }
}
