import { json, payload, discardBody } from '@/db/server';
import {
  claimPublicId,
  createUser,
  issueToken,
  jsonCookies,
  publicUser,
  startSession,
  userByEmail,
  appOrigin,
  VERIFY_TTL,
} from '@/db/auth';
import { sendLetter, verifyLetter } from '@/db/auth-mail';
import {
  emailProblem,
  hashPassword,
  nameFromEmail,
  normalizeEmail,
  passwordProblem,
  cleanDisplayName,
} from '@/lib/auth';

/**
 * Регистрация по почте. Аккаунт сразу входит в систему, но почта помечена
 * неподтверждённой: письмо со ссылкой уходит следом, а до подтверждения нельзя
 * восстановить пароль. Созданные до регистрации комнаты остаются у человека —
 * аккаунт забирает его гостевую личность (db/auth.ts).
 */
export async function POST(request: Request) {
  try {
    const body = await payload(request);
    const email = normalizeEmail(body.email);
    const emailError = emailProblem(email);
    if (emailError) return json({ error: emailError }, 400);
    const passwordError = passwordProblem(body.password);
    if (passwordError) return json({ error: passwordError }, 400);

    const existing = await userByEmail(email);
    if (existing)
      return json(
        {
          error: existing.password_hash
            ? 'Такая почта уже зарегистрирована — войдите или восстановите пароль'
            : 'Этот адрес привязан к Google — войдите через Google',
        },
        409,
      );

    let user;
    try {
      user = await createUser({
        publicId: await claimPublicId(request),
        email,
        name: cleanDisplayName(body.name, nameFromEmail(email)),
        passwordHash: await hashPassword(body.password),
      });
    } catch (error) {
      // Одновременная регистрация того же адреса упирается в уникальный индекс.
      console.error('register failed', error);
      const taken = await userByEmail(email);
      return json(
        {
          error: taken
            ? 'Такая почта уже зарегистрирована — войдите или восстановите пароль'
            : 'Не удалось создать аккаунт, попробуйте ещё раз',
        },
        taken ? 409 : 503,
      );
    }

    const token = await issueToken(user.id, 'verify', VERIFY_TTL);
    const link = `${appOrigin(request)}/api/auth/verify?token=${token}`;
    let sent: { delivered: boolean; link?: string } = { delivered: false };
    try {
      sent = await sendLetter(request, verifyLetter(email, link), link);
    } catch (error) {
      // Аккаунт уже создан: сбой почты не должен отменять регистрацию.
      console.error('verification letter failed', error);
    }

    return jsonCookies(
      {
        user: publicUser(user),
        mailSent: sent.delivered,
        devLink: sent.link,
      },
      await startSession(request, user.id),
      201,
    );
  } catch (error) {
    await discardBody(request);
    console.error(error);
    return json({ error: (error as Error).message || 'Не удалось создать аккаунт' }, 400);
  }
}
