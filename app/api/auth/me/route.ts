import { json, payload, discardBody } from '@/db/server';
import { currentUser, publicUser, updateUser } from '@/db/auth';
import { mailConfigured, isLocalRequest } from '@/db/auth-mail';
import { googleConfigured } from '@/db/google';
import { cleanDisplayName } from '@/lib/auth';

/** Текущий аккаунт и то, какие способы входа вообще настроены в этом окружении. */
export async function GET(request: Request) {
  try {
    const found = await currentUser(request);
    return json({
      user: found ? publicUser(found.user) : null,
      google: googleConfigured(),
      // Локально письма заменяет ссылка в ответе, поэтому восстановление
      // пароля доступно и без настроенной отправки (db/auth-mail.ts).
      mail: mailConfigured() || isLocalRequest(request),
    });
  } catch (error) {
    console.error(error);
    return json({ error: 'Не удалось проверить вход' }, 503);
  }
}

/** Смена отображаемого имени аккаунта. */
export async function POST(request: Request) {
  try {
    const body = await payload(request);
    const found = await currentUser(request);
    if (!found) return json({ error: 'Войдите в аккаунт' }, 401);
    const name = cleanDisplayName(body.name);
    if (!name) return json({ error: 'Укажите имя' }, 400);
    await updateUser(found.user.id, { name });
    return json({ user: publicUser({ ...found.user, name }) });
  } catch (error) {
    await discardBody(request);
    return json({ error: (error as Error).message }, 400);
  }
}
