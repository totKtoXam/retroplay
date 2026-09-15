import { session, json, checkOrigin, discardBody } from '@/db/server';
import { jsonCookies, newGuestSession } from '@/db/auth';
/** Гостевая личность браузера. У вошедшего в аккаунт возвращается его личность. */
export async function POST(request: Request) {
  try {
    await discardBody(request);
    checkOrigin(request);
    const existing = await session(request);
    if (existing) return json({ id: existing });
    const guest = await newGuestSession(request);
    return jsonCookies({ id: guest.id }, [guest.cookie]);
  } catch {
    return json({ error: 'Источник запроса не разрешён' }, 403);
  }
}
