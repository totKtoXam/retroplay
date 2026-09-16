import {
  db,
  session,
  json,
  payload,
  discardBody,
  ensureJoinRequestsTable,
  roomHub,
  notifyRoom,
  notifyMember,
} from '@/db/server';
import { ensureCombatColumns } from '@/db/combat';
import type { LiveView } from '@/worker/room-hub';
import { assembleState } from '@/lib/room-store';
import { publicState, cleanText, type RoomState } from '@/lib/model';
import {
  checkBotSlots,
  commitOperation,
  noteRows,
  occupiedSlots,
} from '@/db/room-ops';
type Context = { params: Promise<{ id: string }> };
type Row = {
  id: string;
  host: string;
  state: string;
  version: number;
  created: number;
};

async function buildRoomSnapshot(
  id: string,
  r: Row,
  roomState: RoomState,
  self: string,
  clientVersion: number | null,
  live: LiveView,
) {
  const isHost = self === r.host;
  const isPrivateRoom = roomState.access?.type === 'private';

  let pendingJoinRequests: {
    id: string;
    session: string;
    name: string;
    status: string;
    created: number;
  }[] = [];
  if (isHost && isPrivateRoom) {
    const jreq = await db()
      .prepare(
        `SELECT id, session, name, status, created FROM join_requests WHERE room=? AND status='pending' ORDER BY created ASC`,
      )
      .bind(id)
      .all<{
        id: string;
        session: string;
        name: string;
        status: string;
        created: number;
      }>();
    pendingJoinRequests = jreq.results;
  }

  return {
    ...r,
    self,
    serverNow: live.now,
    match: live.match,
    joinRequests: pendingJoinRequests,
    effects: live.effects,
    state:
      clientVersion != null && clientVersion === r.version
        ? undefined
        : publicState(assembleState(r.state, await noteRows(id)), self, r.host),
    members: live.members,
  };
}

export async function GET(request: Request, context: Context) {
  try {
    await ensureJoinRequestsTable();
    await ensureCombatColumns();
    const { id } = await context.params;
    const self = await session(request);
    if (!self) return json({ error: 'Откройте приложение заново' }, 401);
    const r = await db()
      .prepare('SELECT * FROM rooms WHERE id=?')
      .bind(id)
      .first<Row>();
    if (!r)
      return json({ error: 'Комната не найдена. Проверьте ссылку.' }, 404);

    const roomState = JSON.parse(r.state) as RoomState;
    const access = roomState.access || {
      type: 'public',
      visibility: 'public',
      joinPolicy: 'free',
      inviteToken: '',
      maxPlayers: 8,
    };
    const isHost = self === r.host;

    const member = await db()
      .prepare('SELECT session FROM members WHERE room=? AND session=?')
      .bind(id, self)
      .first();

    if (!member) {
      if (access.type === 'private' && !isHost) {
        const invite = new URL(request.url).searchParams.get('invite');
        if (!invite || invite !== access.inviteToken) {
          return json(
            { error: 'Комната не найдена или ссылка-приглашение недействительна.' },
            404,
          );
        }
        const req = await db()
          .prepare(
            'SELECT id, status, created FROM join_requests WHERE room=? AND session=? ORDER BY created DESC LIMIT 1',
          )
          .bind(id, self)
          .first<{ id: string; status: string; created: number }>();

        const hostMember = await db()
          .prepare('SELECT name FROM members WHERE room=? AND session=?')
          .bind(id, r.host)
          .first<{ name: string }>();

        const occupied = await occupiedSlots(id, roomState);

        return json({
          join: true,
          isPrivate: true,
          requestStatus: req ? req.status : 'none',
          requestId: req?.id,
          title: roomState.title,
          theme: roomState.theme,
          hostName: hostMember?.name || 'Ведущий',
          membersCount: occupied,
          maxPlayers: access.maxPlayers || 8,
        });
      }

      const hostMember = await db()
        .prepare('SELECT name FROM members WHERE room=? AND session=?')
        .bind(id, r.host)
        .first<{ name: string }>();

      const occupied = await occupiedSlots(id, roomState);

      return json({
        join: true,
        isPrivate: false,
        title: roomState.title,
        theme: roomState.theme,
        hostName: hostMember?.name || 'Ведущий',
        membersCount: occupied,
        maxPlayers: access.maxPlayers || 8,
      });
    }

    const url = new URL(request.url);
    const versionParam = url.searchParams.get('version');
    const clientVersion = versionParam !== null ? Number(versionParam) : null;
    const sinceParam = url.searchParams.get('sinceEffect');
    const sinceEffect = sinceParam !== null ? Number(sinceParam) : null;

    const live = await roomHub(id).live(id, sinceEffect);
    const snapshot = await buildRoomSnapshot(id, r, roomState, self, clientVersion, live);
    return json(snapshot);
  } catch (e) {
    console.error(e);
    return json(
      { error: 'Связь с комнатой потеряна. Повторяем подключение…' },
      503,
    );
  }
}
export async function POST(request: Request, context: Context) {
  try {
    await ensureJoinRequestsTable();
    await ensureCombatColumns();
    const { id } = await context.params,
      self = await session(request);
    if (!self) {
      await discardBody(request);
      return json({ error: 'Откройте приложение заново' }, 401);
    }
    const op = await payload(request);
    const r = await db()
      .prepare('SELECT * FROM rooms WHERE id=?')
      .bind(id)
      .first<Row>();
    if (!r) return json({ error: 'Комната не найдена' }, 404);

    const roomState = JSON.parse(r.state) as RoomState;
    const access = roomState.access || {
      type: 'public',
      visibility: 'public',
      joinPolicy: 'free',
      inviteToken: '',
      maxPlayers: 8,
    };
    const maxPlayers = access.maxPlayers || 8;
    const shieldSeconds = Math.max(0, Math.min(30, roomState.shieldSeconds ?? 5));

    if (op.type === 'join_request.create' || op.type === 'join_request') {
      const name = cleanText(op.name, 40);
      if (!name) throw Error('Введите ваше имя');
      if (roomState.archived) throw Error('Комната закрыта');

      if (access.type === 'private' && self !== r.host) {
        if (!op.inviteToken || op.inviteToken !== access.inviteToken) {
          throw Error('Недействительная ссылка-приглашение');
        }
      }

      const occupied = await occupiedSlots(id, roomState);
      if (occupied >= maxPlayers) throw Error('Комната заполнена');

      const existing = await db()
        .prepare(
          `SELECT id, status FROM join_requests WHERE room=? AND session=? AND status='pending'`,
        )
        .bind(id, self)
        .first<{ id: string; status: string }>();
      if (existing) {
        return json({ ok: true, id: existing.id, status: 'pending' });
      }

      const reqId = crypto.randomUUID();
      await db()
        .prepare(
          `INSERT INTO join_requests (id, room, session, name, status, created) VALUES (?, ?, ?, ?, 'pending', ?)`,
        )
        .bind(reqId, id, self, name, Date.now())
        .run();
      await notifyRoom(id);
      return json({ ok: true, id: reqId, status: 'pending' });
    }

    if (op.type === 'join_request.status') {
      const req = await db()
        .prepare(
          'SELECT id, status, created FROM join_requests WHERE room=? AND session=? ORDER BY created DESC LIMIT 1',
        )
        .bind(id, self)
        .first<{ id: string; status: string; created: number }>();
      return json({ status: req?.status || 'none', id: req?.id });
    }

    if (op.type === 'join_request.accept') {
      if (self !== r.host)
        throw Error('Только ведущий может принимать запросы на вход');
      const req = await db()
        .prepare(
          'SELECT id, session, name, status FROM join_requests WHERE id=? AND room=?',
        )
        .bind(op.id, id)
        .first<{ id: string; session: string; name: string; status: string }>();
      if (!req || req.status !== 'pending')
        throw Error('Запрос не найден или уже обработан');

      if (roomState.archived) throw Error('Комната закрыта');

      const occupied = await occupiedSlots(id, roomState);
      if (occupied >= maxPlayers)
        throw Error('В комнате не осталось свободного места');

      await db()
        .prepare(
          `UPDATE join_requests SET status='accepted', resolved_at=?, resolved_by=? WHERE id=?`,
        )
        .bind(Date.now(), self, op.id)
        .run();
      await notifyRoom(id);
      return json({ ok: true });
    }

    if (op.type === 'join_request.reject') {
      if (self !== r.host)
        throw Error('Только ведущий может отклонять запросы на вход');
      await db()
        .prepare(
          `UPDATE join_requests SET status='rejected', resolved_at=?, resolved_by=? WHERE id=? AND room=? AND status='pending'`,
        )
        .bind(Date.now(), self, op.id, id)
        .run();
      await notifyRoom(id);
      return json({ ok: true });
    }

    if (op.type === 'join') {
      const name = cleanText(op.name, 40);
      if (!name) throw Error('Введите ваше имя');
      const occupied = await occupiedSlots(id, roomState);
      const exists = await db()
        .prepare('SELECT session FROM members WHERE room=? AND session=?')
        .bind(id, self)
        .first();
      if (!exists && occupied >= maxPlayers)
        throw Error('Комната заполнена');

      if (
        (access.joinPolicy === 'host_approval' || access.type === 'private') &&
        self !== r.host &&
        !exists
      ) {
        const approved = await db()
          .prepare(
            `SELECT id FROM join_requests WHERE room=? AND session=? AND status='accepted'`,
          )
          .bind(id, self)
          .first();
        if (!approved)
          return json(
            { error: 'Для входа в эту комнату требуется одобрение ведущего' },
            403,
          );
      }

      const colors = ['#368c78', '#c38464', '#827ba9', '#5b8ba6', '#b59848'];
      const color = colors[occupied % colors.length];
      await db()
        .prepare(
          'INSERT INTO members (room,session,name,color,seen,pose,ping,mood,hat,immune_until) VALUES (?,?,?,?,?,?,0,?,?,?) ON CONFLICT(room,session) DO UPDATE SET name=excluded.name,seen=excluded.seen',
        )
        .bind(
          id,
          self,
          name,
          color,
          Date.now(),
          JSON.stringify({
            x: 0,
            y: 0,
            z: 4,
            yaw: 0,
            stance: 'stand',
            moving: false,
          }),
          '',
          '',
          // Щит новичка живёт столько же, сколько щит возрождения в комнате;
          // выключенный щит (0 секунд) не даёт вошедшему ничего.
          shieldSeconds > 0 ? Date.now() + shieldSeconds * 1000 : 0,
        )
        .run();
      await notifyMember(id, self);
      return json({ ok: true });
    }
    const member = await db()
      .prepare('SELECT session FROM members WHERE room=? AND session=?')
      .bind(id, self)
      .first();
    if (!member) return json({ error: 'Сначала войдите в комнату' }, 403);
    if (op.type === 'team.set') {
      if (typeof op.session !== 'string') throw Error('Не указан участник');
      // Сторону себе игрок выбирает сам (как в сетевых шутерах); чужую —
      // только ведущий.
      if (self !== r.host && op.session !== self)
        throw Error('Чужую команду меняет ведущий');
      if (op.team !== 'red' && op.team !== 'blue') throw Error('Неизвестная команда');
      return json(await roomHub(id).team(id, op.session, op.team));
    }
    if (op.type === 'effect') {
      return json(await roomHub(id).effect(id, self, op));
    }
    if (op.type === 'weapon') {
      return json(await roomHub(id).weapon(id, self, op));
    }
    if (op.type === 'history') {
      const { results } = await db()
        .prepare(
          'SELECT h.version,h.author,h.action,h.at,m.name FROM history h LEFT JOIN members m ON m.room=h.room AND m.session=h.author WHERE h.room=? ORDER BY h.version DESC LIMIT 40',
        )
        .bind(id)
        .all();
      return json({
        history: results.map((h) =>
          JSON.parse(r!.state).anonymousPlayers ||
          (JSON.parse(r!.state).anonymous &&
            String(h.action).startsWith('note.') &&
            h.author !== self)
            ? { ...h, author: '', name: 'Анонимно' }
            : h,
        ),
      });
    }
    if (op.type === 'presence') {
      const clientVersion = typeof op.version === 'number' ? op.version : null;
      const sinceEffect = typeof op.sinceEffect === 'number' ? op.sinceEffect : null;
      const live = await roomHub(id).presence(id, self, op, sinceEffect);
      const snapshot = await buildRoomSnapshot(id, r, roomState, self, clientVersion, live);
      return json({ ok: true, now: live.now, ...snapshot });
    }
    if (op.type === 'profile') {
      // Partial update: omitted fields keep their stored value. In anonymous rooms
      // clients only see placeholders, so they must never echo name/mood/hat back.
      let name: string | null = null;
      if ('name' in op) {
        name = cleanText(op.name, 40);
        if (!name) throw Error('Введите имя');
      }
      const color =
        typeof op.color === 'string' && /^#[0-9a-f]{6}$/i.test(op.color)
          ? op.color
          : null;
      await db()
        .prepare(
          'UPDATE members SET name=COALESCE(?,name),mood=COALESCE(?,mood),hat=COALESCE(?,hat),color=COALESCE(?,color) WHERE room=? AND session=?',
        )
        .bind(
          name,
          'mood' in op ? cleanText(op.mood || '', 20) : null,
          'hat' in op ? cleanText(op.hat || '', 20) : null,
          color,
          id,
          self,
        )
        .run();
      await notifyMember(id, self);
      return json({ ok: true });
    }
    if (op.type === 'bots.add') await checkBotSlots(id, roomState, op);
    const done = await commitOperation(id, op, self, r);
    if (done) return json(done);
    return json(
      { error: 'Комнату обновил другой участник. Повторите действие.' },
      409,
    );
  } catch (e) {
    await discardBody(request);
    return json(
      {
        error:
          e instanceof Error ? e.message : 'Не удалось сохранить изменение',
      },
      400,
    );
  }
}
