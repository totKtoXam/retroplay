import { json, payload, discardBody } from '@/db/server';
import {
  currentUser,
  endAllSessions,
  publicUser,
  updateUser,
  userById,
} from '@/db/auth';
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/auth';

/**
 * Смена пароля из профиля. Аккаунт, созданный через Google, здесь же заводит
 * первый пароль — тогда текущий не спрашивается. Остальные устройства
 * разлогиниваются, текущее остаётся в аккаунте.
 */
export async function POST(request: Request) {
  try {
    const body = await payload(request);
    const found = await currentUser(request);
    if (!found) return json({ error: 'Войдите в аккаунт' }, 401);

    const passwordError = passwordProblem(body.password);
    if (passwordError) return json({ error: passwordError }, 400);

    if (found.user.password_hash) {
      const current = typeof body.current === 'string' ? body.current : '';
      if (!(await verifyPassword(current, found.user.password_hash)))
        return json({ error: 'Текущий пароль указан неверно' }, 401);
    }

    await updateUser(found.user.id, {
      password_hash: await hashPassword(body.password),
      failed_logins: 0,
      locked_until: 0,
    });
    await endAllSessions(found.user.id, found.tokenHash);
    const updated = await userById(found.user.id);
    return json({ user: publicUser(updated || found.user) });
  } catch (error) {
    await discardBody(request);
    console.error(error);
    return json({ error: 'Не удалось сменить пароль' }, 400);
  }
}
