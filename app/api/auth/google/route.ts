import { json } from '@/db/server';
import {
  OAUTH_COOKIE,
  appOrigin,
  redirectWithCookies,
  safeNext,
  setCookie,
} from '@/db/auth';
import { authorizeUrl, googleConfigured, pkcePair } from '@/db/google';
import { randomToken } from '@/lib/auth';

/**
 * Начало входа через Google. Состояние (защита от подделки), проверочный код
 * PKCE и адрес возврата кладутся в короткоживущую HttpOnly-cookie — сервер
 * ничего не запоминает между двумя запросами.
 */
export async function GET(request: Request) {
  if (!googleConfigured())
    return json({ error: 'Вход через Google не настроен на этом сервере' }, 503);
  try {
    const state = randomToken(16);
    const { verifier, challenge } = await pkcePair();
    const next = safeNext(new URL(request.url).searchParams.get('next'));
    const cookie = setCookie(
      request,
      OAUTH_COOKIE,
      encodeURIComponent(JSON.stringify({ state, verifier, next })),
      600,
    );
    return redirectWithCookies(authorizeUrl(request, { state, challenge }), [
      cookie,
    ]);
  } catch (error) {
    console.error(error);
    return Response.redirect(
      appOrigin(request) + '/?auth=' + encodeURIComponent('Не удалось начать вход через Google'),
      302,
    );
  }
}
