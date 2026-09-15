import { json, payload, discardBody } from '@/db/server';
import { appOrigin, issueToken, userByEmail, RESET_TTL } from '@/db/auth';
import {
  mailConfigured,
  isLocalRequest,
  sendLetter,
  resetLetter,
} from '@/db/auth-mail';
import { emailProblem, normalizeEmail } from '@/lib/auth';

/**
 * Запрос на сброс пароля. Ответ одинаков для существующего и несуществующего
 * адреса: форма не должна показывать, кто зарегистрирован.
 */
export async function POST(request: Request) {
  try {
    const body = await payload(request);
    const email = normalizeEmail(body.email);
    const emailError = emailProblem(email);
    if (emailError) return json({ error: emailError }, 400);
    if (!mailConfigured() && !isLocalRequest(request))
      return json(
        { error: 'Отправка писем не настроена — обратитесь к администратору' },
        503,
      );

    const user = await userByEmail(email);
    let devLink: string | undefined;
    if (user) {
      const token = await issueToken(user.id, 'reset', RESET_TTL);
      const link = `${appOrigin(request)}/auth/reset?token=${token}`;
      try {
        devLink = (await sendLetter(request, resetLetter(email, link), link)).link;
      } catch (error) {
        console.error('reset letter failed', error);
        return json({ error: 'Не удалось отправить письмо, попробуйте позже' }, 503);
      }
    }
    return json({ ok: true, devLink });
  } catch (error) {
    await discardBody(request);
    console.error(error);
    return json({ error: 'Не удалось отправить письмо' }, 400);
  }
}
