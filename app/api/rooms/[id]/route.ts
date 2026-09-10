import { resolveCombat } from '@/db/combat';
import { effectStyle, effectCooldown } from '@/lib/game-items';
import { db, session, json, payload, ensureJoinRequestsTable } from '@/db/server';
import {
  applyOperation,
  publicState,
  cleanText,
  type RoomState,
} from '@/lib/model';
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
  clientVersion?: number | null,
  sinceEffect?: number | null,
) {
  const now = Date.now();
  await resolveCombat(id, roomState.respawnSeconds ?? 5);
  const { results } = await db()
    .prepare(
      'SELECT session AS id,name,color,seen AS lastSeen,pose,ping,mood,hat,cursor,hp,respawn_at AS respawnAt,immune_until AS immuneUntil,life,kills,deaths,assists FROM members WHERE room=? ORDER BY seen DESC LIMIT 100',
    )
    .bind(id)
    .all();

  const minEffectTime =
    typeof sinceEffect === 'number' && Number.isFinite(sinceEffect) && sinceEffect > 0
      ? Math.max(now - 15000, sinceEffect)
      : now - 15000;

  const effects = await db()
    .prepare(
      'SELECT id,author,payload,at FROM effects WHERE room=? AND at>? ORDER BY at DESC LIMIT 80',
    )
    .bind(id, minEffectTime)
    .all();
  const isAnonymous = !!roomState.anonymousPlayers;
  const isHost = self === r.host;

  let pendingJoinRequests: {
    id: string;
    session: string;
    name: string;
    status: string;
    created: number;
  }[] = [];
  if (isHost) {
    const jreq = await db()
      .prepare(
        'SELECT id, session, name, status, created FROM join_requests WHERE room=? AND status="pending" ORDER BY created ASC',
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
    serverNow: now,
    joinRequests: pendingJoinRequests,
    effects: effects.results.map((e) => {
      const payload = JSON.parse(String(e.payload));
      if (isAnonymous && payload.kind === 'kill') {
        payload.killerName = 'Участник';
        payload.victimName = 'Участник';
        if (payload.assisterName) payload.assisterName = 'Участник';
      }
      return {
        ...payload,
        id: e.id,
        author: e.author,
        at: e.at,
      };
    }),
    state:
      clientVersion != null && clientVersion === r.version
        ? undefined
        : publicState(roomState, self, r.host),
    members: results.map((m) => {
      const immuneUntil = Number(m.immuneUntil) || 0;
      const respawnAt = Number(m.respawnAt) || 0;
      return {
        ...m,
        kills: m.kills ?? 0,
        deaths: m.deaths ?? 0,
        assists: m.assists ?? 0,
        immuneUntil,
        immuneRemaining: Math.max(0, immuneUntil - now),
        respawnRemaining: Math.max(0, respawnAt - now),
        name: isAnonymous ? 'Участник' : m.name,
        mood: isAnonymous ? '' : m.mood,
        hat: isAnonymous ? '' : m.hat,
        pose: JSON.parse(String(m.pose)),
        cursor: JSON.parse(String(m.cursor)),
      };
    }),
  };
}

export async function GET(request: Request, context: Context) {
  try {
    await ensureJoinRequestsTable();
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

        const count = await db()
          .prepare('SELECT COUNT(*) AS n FROM members WHERE room=?')
          .bind(id)
          .first<{ n: number }>();

        return json({
          join: true,
          isPrivate: true,
          requestStatus: req ? req.status : 'none',
          requestId: req?.id,
          title: roomState.title,
          theme: roomState.theme,
          hostName: hostMember?.name || 'Ведущий',
          membersCount: count?.n || 0,
          maxPlayers: access.maxPlayers || 8,
        });
      }

      const hostMember = await db()
        .prepare('SELECT name FROM members WHERE room=? AND session=?')
        .bind(id, r.host)
        .first<{ name: string }>();

      const count = await db()
        .prepare('SELECT COUNT(*) AS n FROM members WHERE room=?')
        .bind(id)
        .first<{ n: number }>();

      return json({
        join: true,
        isPrivate: false,
        title: roomState.title,
        theme: roomState.theme,
        hostName: hostMember?.name || 'Ведущий',
        membersCount: count?.n || 0,
        maxPlayers: access.maxPlayers || 8,
      });
    }

    const url = new URL(request.url);
    const versionParam = url.searchParams.get('version');
    const clientVersion = versionParam !== null ? Number(versionParam) : null;
    const sinceParam = url.searchParams.get('sinceEffect');
    const sinceEffect = sinceParam !== null ? Number(sinceParam) : null;

    const snapshot = await buildRoomSnapshot(
      id,
      r,
      roomState,
      self,
      clientVersion,
      sinceEffect,
    );
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
    const { id } = await context.params,
      self = await session(request);
    if (!self) return json({ error: 'Откройте приложение заново' }, 401);
    const op = await payload(request);
    let r = await db()
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

    if (op.type === 'join_request.create' || op.type === 'join_request') {
      const name = cleanText(op.name, 40);
      if (!name) throw Error('Введите ваше имя');
      if (roomState.archived) throw Error('Комната закрыта');

      if (access.type === 'private' && self !== r.host) {
        if (!op.inviteToken || op.inviteToken !== access.inviteToken) {
          throw Error('Недействительная ссылка-приглашение');
        }
      }

      const count = await db()
        .prepare('SELECT COUNT(*) AS n FROM members WHERE room=?')
        .bind(id)
        .first<{ n: number }>();
      if ((count?.n || 0) >= maxPlayers) throw Error('Комната заполнена');

      const existing = await db()
        .prepare(
          'SELECT id, status FROM join_requests WHERE room=? AND session=? AND status="pending"',
        )
        .bind(id, self)
        .first<{ id: string; status: string }>();
      if (existing) {
        return json({ ok: true, id: existing.id, status: 'pending' });
      }

      const reqId = crypto.randomUUID();
      await db()
        .prepare(
          'INSERT INTO join_requests (id, room, session, name, status, created) VALUES (?, ?, ?, ?, "pending", ?)',
        )
        .bind(reqId, id, self, name, Date.now())
        .run();
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

      const count = await db()
        .prepare('SELECT COUNT(*) AS n FROM members WHERE room=?')
        .bind(id)
        .first<{ n: number }>();
      if ((count?.n || 0) >= maxPlayers)
        throw Error('В комнате не осталось свободного места');

      await db()
        .prepare(
          'UPDATE join_requests SET status="accepted", resolved_at=?, resolved_by=? WHERE id=?',
        )
        .bind(Date.now(), self, op.id)
        .run();
      return json({ ok: true });
    }

    if (op.type === 'join_request.reject') {
      if (self !== r.host)
        throw Error('Только ведущий может отклонять запросы на вход');
      await db()
        .prepare(
          'UPDATE join_requests SET status="rejected", resolved_at=?, resolved_by=? WHERE id=?',
        )
        .bind(Date.now(), self, op.id)
        .run();
      return json({ ok: true });
    }

    if (op.type === 'join') {
      const name = cleanText(op.name, 40);
      if (!name) throw Error('Введите ваше имя');
      const count = await db()
        .prepare('SELECT COUNT(*) AS n FROM members WHERE room=?')
        .bind(id)
        .first<{ n: number }>();
      const exists = await db()
        .prepare('SELECT session FROM members WHERE room=? AND session=?')
        .bind(id, self)
        .first();
      if (!exists && (count?.n || 0) >= maxPlayers)
        throw Error('Комната заполнена');

      if (
        (access.joinPolicy === 'host_approval' || access.type === 'private') &&
        self !== r.host &&
        !exists
      ) {
        const approved = await db()
          .prepare(
            'SELECT id FROM join_requests WHERE room=? AND session=? AND status="accepted"',
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
      const color = colors[(count?.n || 0) % colors.length];
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
          Date.now() + 5000,
        )
        .run();
      return json({ ok: true });
    }
    const member = await db()
      .prepare('SELECT session FROM members WHERE room=? AND session=?')
      .bind(id, self)
      .first();
    if (!member) return json({ error: 'Сначала войдите в комнату' }, 403);
    if (op.type === 'effect') {
      if (JSON.parse(r.state).archived) return json({ ok: false });
      if (!['paint', 'confetti', 'grenade', 'sniper', 'like'].includes(op.kind))
        throw Error('Неизвестный эффект');
      for (const p of [op.origin, op.target, op.normal])
        if (
          !Array.isArray(p) ||
          p.length !== 3 ||
          !p.every(
            (n) =>
              typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 200,
          )
        )
          throw Error('Некорректная траектория');
      if (!/^#[0-9a-f]{6}$/i.test(op.color)) throw Error('Некорректный цвет');
      const shooter = await db()
        .prepare(
          'SELECT pose,hp,last_shot,immune_until FROM members WHERE room=? AND session=?',
        )
        .bind(id, self)
        .first<{
          pose: string;
          hp: number;
          last_shot: number;
          immune_until?: number;
        }>();
      if (!shooter || shooter.hp <= 0)
        return json({ ok: false, reason: 'respawning' });
      if ((Number(shooter.immune_until) || 0) > Date.now())
        return json({ ok: false, reason: 'immune' });
      const position = JSON.parse(shooter.pose);
      if (
        Math.hypot(
          op.origin[0] - position.x,
          op.origin[1] - position.y,
          op.origin[2] - position.z,
        ) > 9 ||
        Math.hypot(
          ...op.target.map((v: number, i: number) => v - op.origin[i]),
        ) > 75
      )
        throw Error('Предмет слишком далеко');
      const now = Date.now();
      const data = {
        kind: op.kind,
        variant: effectStyle(op.kind, op.variant),
        origin: op.origin,
        target: op.target,
        normal: op.normal,
        color: op.color,
      };
      const effectId =
        typeof op.id === 'string' && /^[a-f0-9-]{36}$/.test(op.id)
          ? op.id
          : crypto.randomUUID();
      const result = await db().batch([
        db()
          .prepare(
            'INSERT OR IGNORE INTO effects (id,room,author,payload,at,resolve_at) SELECT ?,?,?,?,?,? FROM members WHERE room=? AND session=? AND hp>0 AND last_shot<=?',
          )
          .bind(
            effectId,
            id,
            self,
            JSON.stringify(data),
            now,
            now + (op.kind === 'grenade' ? 1100 : 0),
            id,
            self,
            now - effectCooldown(op.kind),
          ),
        db()
          .prepare(
            'UPDATE members SET last_shot=? WHERE room=? AND session=? AND EXISTS(SELECT 1 FROM effects WHERE id=? AND at=?)',
          )
          .bind(now, id, self, effectId, now),
        db()
          .prepare('DELETE FROM effects WHERE room=? AND at<?')
          .bind(id, now - 15000),
      ]);
      await resolveCombat(id, JSON.parse(r.state).respawnSeconds ?? 5);
      return json({ ok: !!result[0].meta.changes });
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
      const cursor = op.cursor;
      const cursorJson =
        cursor &&
        typeof cursor.x === 'number' &&
        typeof cursor.y === 'number' &&
        Number.isFinite(cursor.x) &&
        Number.isFinite(cursor.y)
          ? JSON.stringify({
              x: Math.max(0, Math.min(1540, cursor.x)),
              y: Math.max(0, Math.min(1630, cursor.y)),
              mode: cursor.mode === 'board' ? 'board' : '3d',
            })
          : null;

      const p = op.pose;
      const pose =
        p &&
        typeof p === 'object' &&
        [p.x, p.y, p.z, p.yaw].every(
          (n) => typeof n === 'number' && Number.isFinite(n),
        )
          ? {
              x: Math.max(-23, Math.min(23, p.x)),
              y: Math.max(0, Math.min(5, p.y)),
              z: Math.max(-23, Math.min(23, p.z)),
              yaw: p.yaw,
              stance: ['stand', 'sit', 'lie'].includes(p.stance)
                ? p.stance
                : 'stand',
              moving: !!p.moving,
              speed:
                typeof p.speed === 'number' && Number.isFinite(p.speed)
                  ? Math.max(0, Math.min(6.5, p.speed))
                  : p.moving
                    ? 3.4
                    : 0,
              strafe:
                typeof p.strafe === 'number' && Number.isFinite(p.strafe)
                  ? Math.max(-1, Math.min(1, p.strafe))
                  : 0,
              forward:
                typeof p.forward === 'number' && Number.isFinite(p.forward)
                  ? Math.max(-1, Math.min(1, p.forward))
                  : 0,
              pitch:
                typeof p.pitch === 'number' && Number.isFinite(p.pitch)
                  ? Math.max(-1.35, Math.min(1.4, p.pitch))
                  : 0,
              tool: [
                'paint',
                'confetti',
                'grenade',
                'sniper',
                'pointer',
                'other',
              ].includes(p.tool)
                ? p.tool
                : 'other',
              variant: effectStyle(p.tool, p.variant),
              working: !!p.working,
              crouching: !!p.crouching,
              aiming: !!p.aiming,
              reload:
                typeof p.reload === 'number' && Number.isFinite(p.reload)
                  ? Math.max(0, Math.min(1, p.reload))
                  : 0,
            }
          : null;

      const ping =
        typeof op.ping === 'number'
          ? Math.max(0, Math.min(60000, Math.round(op.ping)))
          : 0;

      const poseJson = pose ? JSON.stringify(pose) : null;
      const lifeVal = Number.isInteger(op.life) ? op.life : 0;
      const now = Date.now();

      await db()
        .prepare(
          `UPDATE members
           SET seen = ?,
               ping = ?,
               cursor = CASE WHEN ? IS NOT NULL THEN ? ELSE cursor END,
               pose = CASE WHEN hp > 0 AND life = ? AND ? IS NOT NULL THEN ? ELSE pose END
           WHERE room = ? AND session = ?`,
        )
        .bind(
          now,
          ping,
          cursorJson,
          cursorJson,
          lifeVal,
          poseJson,
          poseJson,
          id,
          self,
        )
        .run();

      const clientVersion = typeof op.version === 'number' ? op.version : null;
      const sinceEffect = typeof op.sinceEffect === 'number' ? op.sinceEffect : null;

      const snapshot = await buildRoomSnapshot(
        id,
        r,
        roomState,
        self,
        clientVersion,
        sinceEffect,
      );

      return json({ ok: true, now, ...snapshot });
    }
    if (op.type === 'profile') {
      const name = cleanText(op.name, 40);
      if (!name) throw Error('Введите имя');
      await db()
        .prepare(
          'UPDATE members SET name=?,mood=?,hat=? WHERE room=? AND session=?',
        )
        .bind(
          name,
          cleanText(op.mood || '', 20),
          cleanText(op.hat || '', 20),
          id,
          self,
        )
        .run();
      return json({ ok: true });
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt)
        r = await db()
          .prepare('SELECT * FROM rooms WHERE id=?')
          .bind(id)
          .first<Row>();
      if (!r) throw Error('Комната не найдена');
      let updated: RoomState;
      if (op.type === 'undo') {
        const last = await db()
          .prepare(
            'SELECT author,before FROM history WHERE room=? AND version=?',
          )
          .bind(id, r.version)
          .first<{ author: string; before: string }>();
        if (!last || last.author !== self)
          throw Error(
            'Отмена доступна только для вашего последнего действия, пока комнату не изменил другой участник',
          );
        updated = JSON.parse(last.before);
      } else
        updated = applyOperation(
          JSON.parse(r.state) as RoomState,
          op,
          self,
          r.host,
        );
      const results = await db().batch([
        db()
          .prepare(
            'INSERT INTO history (room,version,author,before,action,at) SELECT id,version+1,?,state,?,? FROM rooms WHERE id=? AND version=?',
          )
          .bind(self, String(op.type), Date.now(), id, r.version),
        db()
          .prepare(
            'UPDATE rooms SET state=?,version=version+1 WHERE id=? AND version=?',
          )
          .bind(JSON.stringify(updated), id, r.version),
        db()
          .prepare('DELETE FROM history WHERE room=? AND version<?')
          .bind(id, r.version - 39),
      ]);
      if (results[1].meta.changes)
        return json({
          ok: true,
          version: r.version + 1,
          state: publicState(updated, self, r.host),
        });
    }
    return json(
      { error: 'Комнату обновил другой участник. Повторите действие.' },
      409,
    );
  } catch (e) {
    return json(
      {
        error:
          e instanceof Error ? e.message : 'Не удалось сохранить изменение',
      },
      400,
    );
  }
}
