/**
 * Вход через Google: authorization code + PKCE. Разбор и проверка ответа
 * вынесены в `lib/google-token.ts` (он покрыт тестами), здесь остаётся работа с
 * окружением и сетью.
 */
import { authEnv, appOrigin } from './auth';
import {
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  authorizeParams,
  readTokenResponse,
  tokenExchangeBody,
  type GoogleProfile,
} from '@/lib/google-token';

export type { GoogleProfile };

export const googleConfigured = () =>
  !!(authEnv().GOOGLE_CLIENT_ID && authEnv().GOOGLE_CLIENT_SECRET);

/**
 * Адрес возврата. Обязан посимвольно совпадать со строкой из Google Cloud
 * Console; Google принимает только https, кроме localhost и 127.0.0.1
 * (docs/auth-setup.md).
 */
export function redirectUri(request: Request) {
  const configured = authEnv().GOOGLE_REDIRECT_URI?.trim();
  return configured || `${appOrigin(request)}/api/auth/google/callback`;
}

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** PKCE: проверочный код остаётся в HttpOnly-cookie, наружу уходит только его хеш. */
export async function pkcePair() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function authorizeUrl(
  request: Request,
  params: { state: string; challenge: string },
) {
  const query = authorizeParams({
    clientId: authEnv().GOOGLE_CLIENT_ID || '',
    redirectUri: redirectUri(request),
    state: params.state,
    challenge: params.challenge,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${query}`;
}

export async function exchangeCode(
  request: Request,
  code: string,
  verifier: string,
) {
  const clientId = authEnv().GOOGLE_CLIENT_ID || '';
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenExchangeBody({
      code,
      clientId,
      clientSecret: authEnv().GOOGLE_CLIENT_SECRET || '',
      redirectUri: redirectUri(request),
      verifier,
    }),
  });
  const data: unknown = await response.json().catch(() => ({}));
  return readTokenResponse(response.ok, response.status, data, clientId);
}
