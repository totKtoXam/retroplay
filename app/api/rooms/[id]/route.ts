import { db, session, json, payload } from '@/db/server';
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
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const self = await session(request);
    if (!self) return json({ error: 'Откройте приложение заново' }, 401);
    const r = await db()
      .prepare('SELECT * FROM rooms WHERE id=?')
      .bind(id)
      .first<Row>();
    if (!r)
      return json({ error: 'Комната не найдена. Проверьте ссылку.' }, 404);
    const member = await db()
      .prepare('SELECT session FROM members WHERE room=? AND session=?')
      .bind(id, self)
      .first();
    if (!member)
      return json({
        join: true,
        title: JSON.parse(r.state).title,
        theme: JSON.parse(r.state).theme,
      });
    const { results } = await db()
      .prepare(
        'SELECT session AS id,name,color,seen AS lastSeen,pose,ping,mood,hat,cursor FROM members WHERE room=? ORDER BY seen DESC LIMIT 100',
      )
      .bind(id)
      .all();
    const effects = await db()
      .prepare(
        'SELECT id,author,payload,at FROM effects WHERE room=? AND at>? ORDER BY at DESC LIMIT 80',
      )
      .bind(id, Date.now() - 15000)
      .all();
    return json({
      ...r,
      self,
      effects: effects.results.map((e) => ({
        ...JSON.parse(String(e.payload)),
        id: e.id,
        author: e.author,
        at: e.at,
      })),
      state:
        new URL(request.url).searchParams.get('version') === String(r.version)
          ? undefined
          : publicState(JSON.parse(r.state), self),
      members: results.map((m) => ({
        ...m,
        pose: JSON.parse(String(m.pose)),
        cursor: JSON.parse(String(m.cursor)),
      })),
    });
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
    const { id } = await context.params,
      self = await session(request);
    if (!self) return json({ error: 'Откройте приложение заново' }, 401);
    const op = await payload(request);
    let r = await db()
      .prepare('SELECT * FROM rooms WHERE id=?')
      .bind(id)
      .first<Row>();
    if (!r) return json({ error: 'Комната не найдена' }, 404);
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
      if (!exists && (count?.n || 0) >= 100) throw Error('Комната заполнена');
      const colors = ['#368c78', '#c38464', '#827ba9', '#5b8ba6', '#b59848'];
      const color = colors[(count?.n || 0) % colors.length];
      await db()
        .prepare(
          'INSERT INTO members (room,session,name,color,seen,pose,ping,mood,hat) VALUES (?,?,?,?,?,?,0,?,?) ON CONFLICT(room,session) DO UPDATE SET name=excluded.name,seen=excluded.seen',
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
      if (!['paint', 'confetti'].includes(op.kind))
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
      const data = {
        kind: op.kind,
        origin: op.origin,
        target: op.target,
        normal: op.normal,
        color: op.color,
      };
      const effectId =
        typeof op.id === 'string' && /^[a-f0-9-]{36}$/.test(op.id)
          ? op.id
          : crypto.randomUUID();
      await db().batch([
        db()
          .prepare(
            'INSERT OR IGNORE INTO effects (id,room,author,payload,at) VALUES (?,?,?,?,?)',
          )
          .bind(effectId, id, self, JSON.stringify(data), Date.now()),
        db()
          .prepare('DELETE FROM effects WHERE room=? AND at<?')
          .bind(id, Date.now() - 15000),
      ]);
      return json({ ok: true });
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
          JSON.parse(r!.state).anonymous &&
          String(h.action).startsWith('note.') &&
          h.author !== self
            ? { ...h, author: '', name: 'Анонимно' }
            : h,
        ),
      });
    }
    if (op.type === 'presence') {
      const cursor = op.cursor;
      if (
        cursor &&
        typeof cursor.x === 'number' &&
        typeof cursor.y === 'number' &&
        Number.isFinite(cursor.x) &&
        Number.isFinite(cursor.y)
      ) {
        await db()
          .prepare('UPDATE members SET cursor=? WHERE room=? AND session=?')
          .bind(
            JSON.stringify({
              x: Math.max(0, Math.min(1540, cursor.x)),
              y: Math.max(0, Math.min(1630, cursor.y)),
              mode: cursor.mode === 'board' ? 'board' : '3d',
            }),
            id,
            self,
          )
          .run();
      }
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
              tool: ['paint', 'confetti', 'other'].includes(p.tool)
                ? p.tool
                : 'other',
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
      if (pose)
        await db()
          .prepare(
            'UPDATE members SET seen=?,pose=?,ping=? WHERE room=? AND session=?',
          )
          .bind(Date.now(), JSON.stringify(pose), ping, id, self)
          .run();
      else
        await db()
          .prepare(
            'UPDATE members SET seen=?,ping=? WHERE room=? AND session=?',
          )
          .bind(Date.now(), ping, id, self)
          .run();
      return json({ ok: true, now: Date.now() });
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
          state: publicState(updated, self),
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
