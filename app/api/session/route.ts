import { session, json, checkOrigin, discardBody } from '@/db/server';
export async function POST(request: Request) {
  try {
    await discardBody(request);
    checkOrigin(request);
    const existing = await session(request);
    if (existing) return json({ id: existing });
    const token = crypto.randomUUID();
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    const fake = new Request(request.url, {
      headers: { cookie: 'jinaly_session=' + token },
    });
    return Response.json(
      { id: await session(fake) },
      {
        headers: {
          'Set-Cookie': `jinaly_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`,
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch {
    return json({ error: 'Источник запроса не разрешён' }, 403);
  }
}
