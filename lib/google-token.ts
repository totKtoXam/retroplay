/**
 * Разбор ответа Google на обмен кода: сборка адреса авторизации, чтение
 * `id_token` и проверка его полей.
 *
 * Модуль намеренно не знает ни о биндингах Worker, ни о переменных окружения —
 * всё приходит параметрами. Иначе эту логику нельзя было бы прогнать тестами,
 * а выполняется она только при живом входе через Google, то есть реже всего.
 *
 * Подпись токена не проверяется: код обменивается прямым запросом к Google по
 * TLS с client_secret, и OpenID Connect Core 3.1.3.7 разрешает в этом случае
 * полагаться на сам защищённый канал. Поэтому здесь нельзя принимать `id_token`
 * из любого другого источника — только из ответа token endpoint.
 */

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/** Google выдаёт `iss` в двух видах; оба законные. */
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
/** Допуск на расхождение часов сервера и Google. */
const CLOCK_SKEW_MS = 60_000;

export type GoogleProfile = {
  /** Неизменяемый идентификатор аккаунта Google: главный ключ привязки. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
};

/** Значения чужого JSON приходят как unknown: строкой считается только строка. */
const claimText = (value: unknown) => (typeof value === 'string' ? value : '');

/** Параметры адреса согласия. Scope минимальный: вход, почта и имя. */
export function authorizeParams(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}) {
  return new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    // Без этого Google молча входит прежним аккаунтом и сменить его нельзя.
    prompt: 'select_account',
  });
}

/** Тело запроса на обмен кода. `code_verifier` закрывает подмену кода (PKCE). */
export function tokenExchangeBody(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  verifier: string;
}) {
  return new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: params.verifier,
  });
}

function decodeSegment(segment: string): unknown {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Читает `id_token` и проверяет издателя, адресата и срок жизни. Возвращает
 * профиль или бросает ошибку с текстом, который не стыдно показать человеку.
 */
export function readIdToken(
  idToken: string,
  clientId: string,
  now = Date.now(),
): GoogleProfile {
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3 || !parts[1])
    throw Error('Google вернул некорректный токен');

  let claims: Record<string, unknown>;
  try {
    const decoded = decodeSegment(parts[1]);
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
      throw Error('not an object');
    claims = decoded as Record<string, unknown>;
  } catch {
    throw Error('Google вернул некорректный токен');
  }

  if (!ISSUERS.includes(claimText(claims.iss)))
    throw Error('Google вернул токен неизвестного издателя');
  // Без этой проверки подошёл бы токен, выписанный Google другому приложению.
  if (!clientId || claimText(claims.aud) !== clientId)
    throw Error('Google вернул токен для другого приложения');

  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp * 1000 + CLOCK_SKEW_MS <= now)
    throw Error('Срок действия ответа Google истёк, попробуйте ещё раз');

  const sub = claimText(claims.sub);
  const email = claimText(claims.email).trim().toLowerCase();
  if (!sub) throw Error('Google не передал идентификатор аккаунта');
  if (!email) throw Error('Google не передал адрес почты');

  return {
    sub,
    email,
    // В токене флаг бывает и строкой: Google менял формат между версиями.
    emailVerified:
      claims.email_verified === true || claims.email_verified === 'true',
    name: claimText(claims.name),
    picture: claimText(claims.picture),
  };
}

/** Ответ token endpoint: либо профиль, либо понятная ошибка. */
export function readTokenResponse(
  ok: boolean,
  status: number,
  data: unknown,
  clientId: string,
  now = Date.now(),
): GoogleProfile {
  const body = (data && typeof data === 'object' ? data : {}) as {
    id_token?: unknown;
    error?: unknown;
    error_description?: unknown;
  };
  if (!ok || typeof body.id_token !== 'string' || !body.id_token)
    throw Error(
      'Google не подтвердил вход: ' +
        (claimText(body.error_description) ||
          claimText(body.error) ||
          String(status)),
    );
  return readIdToken(body.id_token, clientId, now);
}
