import { json, payload, discardBody } from '@/db/server';
import {
  jsonCookies,
  lockedFor,
  noteFailedLogin,
  noteSuccessfulLogin,
  publicUser,
  startSession,
  updateUser,
  userByEmail,
} from '@/db/auth';
import {
  hashPassword,
  needsRehash,
  normalizeEmail,
  verifyPassword,
} from '@/lib/auth';

/**
 * Вход по почте и паролю. Сообщение об ошибке одинаково для неизвестного
 * адреса и неверного пароля, а десять неудач подряд замораживают аккаунт на
 * 15 минут (db/auth.ts).
 */
export async function POST(request: Request) {
  try {
    const body = await payload(request);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password)
      return json({ error: 'Введите почту и пароль' }, 400);

    const user = await userByEmail(email);
    if (!user || !user.password_hash)
      return json({ error: 'Неверная почта или пароль' }, 401);

    const minutes = lockedFor(user);
    if (minutes)
      return json(
        { error: `Слишком много попыток входа. Повторите через ${minutes} мин` },
        429,
      );

    if (!(await verifyPassword(password, user.password_hash))) {
      await noteFailedLogin(user);
      return json({ error: 'Неверная почта или пароль' }, 401);
    }

    await noteSuccessfulLogin(user);
    // Пароль пересчитывается, если хеш создан меньшим числом итераций.
    if (needsRehash(user.password_hash))
      await updateUser(user.id, { password_hash: await hashPassword(password) });

    return jsonCookies(
      { user: publicUser(user) },
      await startSession(request, user.id),
    );
  } catch (error) {
    await discardBody(request);
    console.error(error);
    return json({ error: (error as Error).message || 'Не удалось войти' }, 400);
  }
}
