import assert from 'node:assert/strict';
import {
  authorizeParams,
  tokenExchangeBody,
  readIdToken,
  readTokenResponse,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
} from '../lib/google-token.ts';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('PASS', name);
}

const CLIENT = '1234.apps.googleusercontent.com';
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);

const b64url = (value) =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** Собирает id_token так же, как его отдаёт Google: три сегмента через точку. */
function idToken(claims, signature = 'подпись-не-проверяется') {
  const payload = {
    iss: 'https://accounts.google.com',
    aud: CLIENT,
    sub: '117000000000000000001',
    email: 'asan@example.com',
    email_verified: true,
    name: 'Асан Ерболович',
    picture: 'https://lh3.googleusercontent.com/a/photo',
    exp: Math.floor(NOW / 1000) + 3600,
    ...claims,
  };
  for (const [key, value] of Object.entries(claims))
    if (value === undefined) delete payload[key];
  return [
    b64url(JSON.stringify({ alg: 'RS256', kid: 'abc' })),
    b64url(JSON.stringify(payload)),
    signature,
  ].join('.');
}

test('Адрес согласия просит минимальный доступ и требует PKCE', () => {
  const url = new URL(
    GOOGLE_AUTH_ENDPOINT +
      '?' +
      authorizeParams({
        clientId: CLIENT,
        redirectUri: 'https://jinaly.example/api/auth/google/callback',
        state: 'состояние',
        challenge: 'вызов',
      }),
  );
  assert.equal(url.hostname, 'accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), CLIENT);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), 'вызов');
  assert.equal(url.searchParams.get('state'), 'состояние');
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://jinaly.example/api/auth/google/callback',
  );
  // Ничего лишнего: доступа к данным аккаунта вход не просит.
  assert.ok(!url.searchParams.has('access_type'));
});

test('Обмен кода уходит с секретом клиента и проверочным кодом PKCE', () => {
  const body = tokenExchangeBody({
    code: '4/0Aкод',
    clientId: CLIENT,
    clientSecret: 'секрет',
    redirectUri: 'http://localhost:3000/api/auth/google/callback',
    verifier: 'проверочный-код',
  });
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), '4/0Aкод');
  assert.equal(body.get('client_secret'), 'секрет');
  assert.equal(body.get('code_verifier'), 'проверочный-код');
  assert.equal(
    body.get('redirect_uri'),
    'http://localhost:3000/api/auth/google/callback',
  );
  assert.equal(GOOGLE_TOKEN_ENDPOINT, 'https://oauth2.googleapis.com/token');
});

test('Обычный токен Google разбирается в профиль', () => {
  const profile = readIdToken(idToken({}), CLIENT, NOW);
  assert.deepEqual(profile, {
    sub: '117000000000000000001',
    email: 'asan@example.com',
    emailVerified: true,
    name: 'Асан Ерболович',
    picture: 'https://lh3.googleusercontent.com/a/photo',
  });
});

test('Почта приводится к нижнему регистру, второй вид издателя принимается', () => {
  const profile = readIdToken(
    idToken({ iss: 'accounts.google.com', email: '  Asan@Example.COM ' }),
    CLIENT,
    NOW,
  );
  assert.equal(profile.email, 'asan@example.com');
});

test('Флаг подтверждения читается и строкой, и булевым значением', () => {
  assert.equal(
    readIdToken(idToken({ email_verified: 'true' }), CLIENT, NOW).emailVerified,
    true,
  );
  assert.equal(
    readIdToken(idToken({ email_verified: false }), CLIENT, NOW).emailVerified,
    false,
  );
  // Отсутствие флага — это «не подтверждено», а не «подтверждено».
  assert.equal(
    readIdToken(idToken({ email_verified: undefined }), CLIENT, NOW)
      .emailVerified,
    false,
  );
});

test('Токен другого приложения не принимается', () => {
  assert.throws(
    () => readIdToken(idToken({ aud: 'чужой.apps.googleusercontent.com' }), CLIENT, NOW),
    /для другого приложения/,
  );
  // Пустой client_id в окружении не должен превращаться в «подходит любой».
  assert.throws(() => readIdToken(idToken({ aud: '' }), '', NOW), /для другого приложения/);
});

test('Чужой издатель и подделанный домен не принимаются', () => {
  for (const iss of [
    'https://accounts.google.com.attacker.example',
    'https://attacker.example',
    '',
    undefined,
  ])
    assert.throws(
      () => readIdToken(idToken({ iss }), CLIENT, NOW),
      /неизвестного издателя/,
      String(iss),
    );
});

test('Просроченный токен отклоняется, часовой сдвиг в минуту прощается', () => {
  const expired = idToken({ exp: Math.floor(NOW / 1000) - 3600 });
  assert.throws(() => readIdToken(expired, CLIENT, NOW), /Срок действия/);

  // Токен «протух» 30 секунд назад: расхождение часов не должно ломать вход.
  const justExpired = idToken({ exp: Math.floor(NOW / 1000) - 30 });
  assert.equal(readIdToken(justExpired, CLIENT, NOW).sub, '117000000000000000001');

  for (const exp of ['скоро', undefined, null])
    assert.throws(() => readIdToken(idToken({ exp }), CLIENT, NOW), /Срок действия/);
});

test('Токен без sub или почты не принимается', () => {
  assert.throws(
    () => readIdToken(idToken({ sub: '' }), CLIENT, NOW),
    /идентификатор аккаунта/,
  );
  assert.throws(
    () => readIdToken(idToken({ email: undefined }), CLIENT, NOW),
    /адрес почты/,
  );
});

test('Мусор вместо токена не роняет обработчик', () => {
  for (const broken of [
    '',
    'не токен',
    'a.b',
    'a.b.c.d',
    ['a', b64url('не json'), 'c'].join('.'),
    ['a', b64url('"строка"'), 'c'].join('.'),
    ['a', b64url('[1,2,3]'), 'c'].join('.'),
    null,
    42,
  ])
    assert.throws(
      () => readIdToken(broken, CLIENT, NOW),
      /некорректный токен/,
      String(broken),
    );
});

test('Ошибка token endpoint превращается в понятный текст', () => {
  assert.throws(
    () =>
      readTokenResponse(
        false,
        400,
        { error: 'invalid_grant', error_description: 'Code was already redeemed.' },
        CLIENT,
        NOW,
      ),
    /Code was already redeemed/,
  );
  assert.throws(
    () => readTokenResponse(false, 401, { error: 'invalid_client' }, CLIENT, NOW),
    /invalid_client/,
  );
  // Ответ 200 без id_token — тоже отказ, а не вход.
  assert.throws(
    () => readTokenResponse(true, 200, { access_token: 'x' }, CLIENT, NOW),
    /не подтвердил вход/,
  );
  assert.throws(() => readTokenResponse(true, 200, null, CLIENT, NOW), /не подтвердил вход/);
});

test('Удачный ответ token endpoint даёт профиль', () => {
  const profile = readTokenResponse(
    true,
    200,
    { access_token: 'ya29...', id_token: idToken({}), expires_in: 3599 },
    CLIENT,
    NOW,
  );
  assert.equal(profile.email, 'asan@example.com');
  assert.equal(profile.emailVerified, true);
});

console.log(`\n${passed} проверок разбора ответа Google пройдено`);
