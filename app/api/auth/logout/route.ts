import { json, checkOrigin, discardBody } from '@/db/server';
import { endSession, jsonCookies, newGuestSession } from '@/db/auth';

/**
 * Выход из аккаунта. Взамен сразу выдаётся новая гостевая личность: приложение
 * работает дальше без перезагрузки, но прежние комнаты остаются за аккаунтом —
 * старый гостевой токен не возвращается.
 */
export async function POST(request: Request) {
  try {
    await discardBody(request);
    checkOrigin(request);
    const guest = await newGuestSession(request);
    return jsonCookies({ ok: true, id: guest.id }, [
      await endSession(request),
      guest.cookie,
    ]);
  } catch (error) {
    console.error(error);
    return json({ error: (error as Error).message || 'Не удалось выйти' }, 403);
  }
}
