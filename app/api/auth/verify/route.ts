import { json, checkOrigin, discardBody } from '@/db/server';
import {
  appOrigin,
  consumeToken,
  currentUser,
  issueToken,
  updateUser,
  VERIFY_TTL,
} from '@/db/auth';
import { sendLetter, verifyLetter } from '@/db/auth-mail';

/** Переход по ссылке из письма: почта отмечается подтверждённой. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') || '';
  const home = appOrigin(request) + '/';
  try {
    const user = await consumeToken(token, 'verify');
    if (!user) return Response.redirect(home + '?verified=expired', 302);
    if (!user.email_verified) await updateUser(user.id, { email_verified: 1 });
    return Response.redirect(home + '?verified=1', 302);
  } catch (error) {
    console.error(error);
    return Response.redirect(home + '?verified=error', 302);
  }
}

/** Отправить письмо с подтверждением ещё раз. */
export async function POST(request: Request) {
  try {
    await discardBody(request);
    checkOrigin(request);
    const found = await currentUser(request);
    if (!found) return json({ error: 'Войдите в аккаунт' }, 401);
    if (found.user.email_verified) return json({ ok: true, mailSent: false });

    const token = await issueToken(found.user.id, 'verify', VERIFY_TTL);
    const link = `${appOrigin(request)}/api/auth/verify?token=${token}`;
    const sent = await sendLetter(
      request,
      verifyLetter(found.user.email, link),
      link,
    );
    return json({ ok: true, mailSent: sent.delivered, devLink: sent.link });
  } catch (error) {
    console.error(error);
    return json({ error: 'Не удалось отправить письмо' }, 503);
  }
}
