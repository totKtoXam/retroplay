import {
  OAUTH_COOKIE,
  appOrigin,
  claimPublicId,
  clearCookie,
  cookieValue,
  createUser,
  redirectWithCookies,
  safeNext,
  startSession,
  updateUser,
  userByEmail,
  userByGoogleSub,
} from '@/db/auth';
import { exchangeCode, googleConfigured } from '@/db/google';
import { cleanDisplayName, nameFromEmail } from '@/lib/auth';

/**
 * Возврат от Google. Аккаунт ищется сначала по неизменяемому `sub`, затем по
 * адресу почты: тогда прежняя регистрация по паролю получает привязку к Google
 * — но только если Google подтвердил адрес, иначе чужой непроверенной почтой
 * можно было бы забрать аккаунт.
 */
export async function GET(request: Request) {
  const origin = appOrigin(request);
  const url = new URL(request.url);
  const drop = clearCookie(request, OAUTH_COOKIE);
  const fail = (message: string, next = '/') =>
    redirectWithCookies(
      origin + next + (next.includes('?') ? '&' : '?') + 'auth=' + encodeURIComponent(message),
      [drop],
    );

  if (!googleConfigured()) return fail('Вход через Google не настроен');

  let saved: { state?: string; verifier?: string; next?: string } = {};
  try {
    saved = JSON.parse(decodeURIComponent(cookieValue(request, OAUTH_COOKIE) || '{}'));
  } catch {
    return fail('Вход через Google не завершён — попробуйте ещё раз');
  }
  const next = safeNext(saved.next);

  const error = url.searchParams.get('error');
  if (error)
    return fail(error === 'access_denied' ? 'Вход через Google отменён' : 'Google отказал во входе', next);

  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  if (!code || !saved.state || !saved.verifier || state !== saved.state)
    return fail('Вход через Google не завершён — попробуйте ещё раз', next);

  try {
    const profile = await exchangeCode(request, code, saved.verifier);
    let user = await userByGoogleSub(profile.sub);

    if (!user) {
      const byEmail = await userByEmail(profile.email);
      if (byEmail) {
        if (!profile.emailVerified)
          return fail('Google не подтвердил этот адрес почты', next);
        await updateUser(byEmail.id, {
          google_sub: profile.sub,
          email_verified: 1,
          avatar: byEmail.avatar || profile.picture,
        });
        user = { ...byEmail, google_sub: profile.sub, email_verified: 1 };
      } else {
        try {
          user = await createUser({
            publicId: await claimPublicId(request),
            email: profile.email,
            name: cleanDisplayName(profile.name, nameFromEmail(profile.email)),
            googleSub: profile.sub,
            avatar: profile.picture,
            emailVerified: profile.emailVerified,
          });
        } catch (dbError) {
          // Ошибку базы наружу не выносим: в адресе видно только наш текст.
          console.error('google account creation failed', dbError);
          return fail('Не удалось создать аккаунт, попробуйте ещё раз', next);
        }
      }
    }

    return redirectWithCookies(origin + next, [
      ...(await startSession(request, user.id)),
      drop,
    ]);
  } catch (err) {
    console.error('google sign-in failed', err);
    return fail((err as Error).message || 'Не удалось войти через Google', next);
  }
}
