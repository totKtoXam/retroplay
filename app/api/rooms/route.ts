import { db, session, json, payload, discardBody } from '@/db/server';
import { initialState, cleanText, THEMES, type RoomAccessType } from '@/lib/model';
export async function GET(request: Request) {
  const self = await session(request);
  if (!self) return json({ error: 'Откройте приложение заново' }, 401);
  try {
    const url = new URL(request.url);
    const browse = url.searchParams.get('browse');

    if (browse === 'public') {
      const { results } = await db()
        .prepare(
          `SELECT r.id, r.host, r.state, r.version, r.created,
            (SELECT COUNT(*) FROM members m WHERE m.room = r.id AND m.seen > ?) AS membersCount,
            (SELECT m.name FROM members m WHERE m.room = r.id AND m.session = r.host LIMIT 1) AS hostName
          FROM rooms r
          ORDER BY r.created DESC LIMIT 100`,
        )
        // Only recently seen members occupy a slot; the same window as app/api/rooms/[id].
        .bind(Date.now() - 60_000)
        .all<{
          id: string;
          host: string;
          state: string;
          version: number;
          created: number;
          membersCount: number;
          hostName: string | null;
        }>();

      const publicRooms = results
        .map((r) => {
          const s = JSON.parse(r.state);
          const isHidden =
            s.access &&
            (s.access.visibility === 'hidden' || s.access.type === 'private');
          if (isHidden) return null;

          const maxPlayers = s.access?.maxPlayers || 8;
          const membersCount = Number(r.membersCount) || 0;
          let status: 'available' | 'full' | 'in_progress' | 'closed' = 'available';
          if (s.archived) {
            status = 'closed';
          } else if (membersCount >= maxPlayers) {
            status = 'full';
          } else if (s.phase > 0 || s.timer?.running) {
            status = 'in_progress';
          }

          return {
            id: r.id,
            host: r.host,
            hostName: r.hostName || 'Ведущий',
            title: s.title,
            theme: s.theme,
            season: s.season,
            archived: !!s.archived,
            phase: s.phase,
            created: r.created,
            membersCount,
            maxPlayers,
            status,
            accessType: 'public' as const,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      return json({ rooms: publicRooms });
    }

    const { results } = await db()
      .prepare(
        'SELECT r.id,r.host,r.state,r.version,r.created FROM rooms r JOIN members m ON m.room=r.id WHERE m.session=? ORDER BY r.created DESC LIMIT 100',
      )
      .bind(self)
      .all<{
        id: string;
        host: string;
        state: string;
        version: number;
        created: number;
      }>();
    return json({
      rooms: results.map((r) => {
        const s = JSON.parse(r.state);
        return {
          id: r.id,
          host: r.host,
          title: s.title,
          theme: s.theme,
          season: s.season,
          archived: s.archived,
          phase: s.phase,
          created: r.created,
          notes: s.notes.filter(
            (n: { hidden: boolean; author: string }) =>
              !n.hidden || n.author === self,
          ).length,
        };
      }),
    });
  } catch (e) {
    console.error(e);
    return json({ error: 'Не удалось загрузить комнаты' }, 503);
  }
}
export async function POST(request: Request) {
  const self = await session(request);
  if (!self) {
    await discardBody(request);
    return json({ error: 'Откройте приложение заново' }, 401);
  }
  try {
    const p = await payload(request);
    const title = cleanText(p.title, 100);
    const name = cleanText(p.name, 40);
    if (!title || !name) throw Error('Введите название комнаты и ваше имя');
    if (!THEMES.some((t) => t.id === p.theme)) throw Error('Неизвестный мир');
    const count = await db()
      .prepare('SELECT COUNT(*) AS n FROM rooms WHERE host=?')
      .bind(self)
      .first<{ n: number }>();
    if ((count?.n || 0) >= 100) throw Error('Достигнут лимит 100 комнат');
    const id = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    const accessType: RoomAccessType =
      p.access === 'private' ? 'private' : 'public';
    const maxPlayers = Math.max(2, Math.min(50, Number(p.maxPlayers) || 8));
    const s = initialState(
      title,
      p.theme,
      p.template === 'three' ? 'three' : 'four',
      accessType,
      maxPlayers,
    );
    if (
      p.visualStyle !== undefined &&
      !['classic', 'anime'].includes(p.visualStyle)
    )
      throw Error('Неизвестный стиль');
    s.visualStyle = p.visualStyle === 'anime' ? 'anime' : 'classic';
    await db().batch([
      db()
        .prepare(
          'INSERT INTO rooms (id,host,state,version,created) VALUES (?,?,?,1,?)',
        )
        .bind(id, self, JSON.stringify(s), Date.now()),
      db()
        .prepare(
          'INSERT INTO members (room,session,name,color,seen,pose,ping,mood,hat) VALUES (?,?,?,?,?,?,0,?,?)',
        )
        .bind(
          id,
          self,
          name,
          '#368c78',
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
        ),
    ]);
    return json(
      { id, accessType, inviteToken: s.access?.inviteToken },
      201,
    );
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Не удалось создать комнату' },
      400,
    );
  }
}
