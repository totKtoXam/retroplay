import { json, payload, discardBody } from '@/db/server';
import {
  consumeToken,
  endAllSessions,
  jsonCookies,
  publicUser,
  startSession,
  updateUser,
} from '@/db/auth';
import { hashPassword, passwordProblem } from '@/lib/auth';

/**
 * Новый пароль по ссылке из письма. Ссылка одноразовая; все прежние сессии
 * закрываются, а браузер, который сменил пароль, сразу входит в аккаунт.
 * Переход по ссылке доказывает владение почтой, поэтому адрес заодно
 * помечается подтверждённым.
 */
export async function POST(request: Request) {
  try {
    const body = await payload(request);
    const passwordError = passwordProblem(body.password);
    if (passwordError) return json({ error: passwordError }, 400);

    const user = await consumeToken(
      typeof body.token === 'string' ? body.token : '',
      'reset',
    );
    if (!user)
      return json({ error: 'Ссылка устарела — запросите письмо заново' }, 400);

    await updateUser(user.id, {
      password_hash: await hashPassword(body.password),
      email_verified: 1,
      failed_logins: 0,
      locked_until: 0,
    });
    await endAllSessions(user.id);

    return jsonCookies(
      { user: publicUser({ ...user, email_verified: 1 }) },
      await startSession(request, user.id),
    );
  } catch (error) {
    await discardBody(request);
    console.error(error);
    return json({ error: 'Не удалось сменить пароль' }, 400);
  }
}
