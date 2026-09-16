/**
 * HTTP-проверка регистрации и входа. Нужен запущенный сервер на localhost:3000.
 * Каждый запуск создаёт аккаунты со случайными адресами вида
 * `qa-...@jinaly.test`: удалять их нечем, они остаются в локальной базе.
 */
import assert from 'node:assert/strict';

const base = process.env.RETRO_TEST_URL || 'http://localhost:3000';
const unique = () =>
  `qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@jinaly.test`;

/** Простейшая банка cookie: удерживает состояние одного «браузера». */
function browser() {
  return new Map();
}

function absorb(jar, response) {
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(';')[0];
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  return response;
}

const header = (jar) =>
  [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

async function req(jar, path, body, method) {
  const response = await fetch(base + path, {
    method: method || (body ? 'POST' : 'GET'),
    redirect: 'manual',
    headers: {
      Cookie: header(jar),
      Origin: base,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  absorb(jar, response);
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text || '{}');
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: response.status, data, response };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log('PASS', name);
}

// --- Регистрация -----------------------------------------------------------
const email = unique();
const password = 'retro3d-тест-пароль';
const alice = browser();

await test('Регистрация создаёт аккаунт, входит в него и гасит гостевую cookie', async () => {
  await req(alice, '/api/session', {});
  assert.ok(alice.get('jinaly_session'), 'гостевая cookie должна появиться');

  const created = await req(alice, '/api/auth/register', {
    email,
    password,
    name: 'QA Аккаунт',
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.user.email, email);
  assert.equal(created.data.user.emailVerified, false);
  assert.ok(alice.get('jinaly_auth'), 'должна появиться cookie входа');
  assert.ok(
    !alice.get('jinaly_session'),
    'гостевая cookie гасится: после выхода прежняя личность не возвращается',
  );

  const cookies = created.response.headers.getSetCookie().join(' ');
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /SameSite=Lax/);
  assert.ok(
    !alice.get('jinaly_auth').includes(created.data.user.id),
    'публичная личность не должна быть учётными данными',
  );
});

await test('Текущий аккаунт виден в /api/auth/me', async () => {
  const me = await req(alice, '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, email);
  assert.equal(me.data.user.hasPassword, true);
  assert.equal(me.data.user.google, false);
});

await test('Повторная регистрация того же адреса отклоняется', async () => {
  const again = await req(browser(), '/api/auth/register', {
    email,
    password,
    name: 'Двойник',
  });
  assert.equal(again.status, 409);
});

await test('Короткий пароль и кривой адрес не принимаются', async () => {
  const short = await req(browser(), '/api/auth/register', {
    email: unique(),
    password: 'корот',
  });
  assert.equal(short.status, 400);
  const bad = await req(browser(), '/api/auth/register', {
    email: 'не-адрес',
    password,
  });
  assert.equal(bad.status, 400);
});

// --- Настройки аккаунта -----------------------------------------------------
await test('Гостю настройки не хранятся, но и ошибки нет', async () => {
  const guest = browser();
  await req(guest, '/api/session', {});
  const got = await req(guest, '/api/settings');
  assert.equal(got.status, 200);
  assert.equal(got.data.user, null);
  const saved = await req(guest, '/api/settings', { base: 0, settings: { 'jinaly-theme': 'dark' } });
  assert.equal(saved.status, 401);
});

await test('Настройки аккаунта сохраняются, чужие ключи отбрасываются', async () => {
  const empty = await req(alice, '/api/settings');
  assert.equal(empty.status, 200);
  assert.equal(empty.data.updated, 0);
  const saved = await req(alice, '/api/settings', {
    base: 0,
    settings: { 'jinaly-theme': 'dark', 'jinaly-sound': 'true', 'evil-key': 'x' },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.ok(saved.data.updated > 0);
  const got = await req(alice, '/api/settings');
  assert.deepEqual(got.data.settings, { 'jinaly-theme': 'dark', 'jinaly-sound': 'true' });
  assert.equal(got.data.updated, saved.data.updated);
});

await test('Запись поверх устаревшей версии не затирает чужие изменения', async () => {
  const now = await req(alice, '/api/settings');
  const stale = await req(alice, '/api/settings', {
    base: now.data.updated - 1,
    settings: { 'jinaly-theme': 'light' },
  });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.data.settings, now.data.settings, 'в ответе свежая версия для слияния');
  const again = await req(alice, '/api/settings', { base: 0, settings: {} });
  assert.equal(again.status, 409, 'первая запись не должна перезаписать существующие настройки');
});

// --- Вход и выход ----------------------------------------------------------
await test('Вход по неверному паролю отклоняется без подсказки', async () => {
  const wrong = await req(browser(), '/api/auth/login', {
    email,
    password: password + 'x',
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, 'Неверная почта или пароль');

  const unknown = await req(browser(), '/api/auth/login', {
    email: unique(),
    password,
  });
  assert.equal(unknown.status, 401);
  assert.equal(
    unknown.data.error,
    wrong.data.error,
    'ответ не должен показывать, какой адрес зарегистрирован',
  );
});

const bob = browser();
await test('Вход с другого устройства даёт ту же личность', async () => {
  const login = await req(bob, '/api/auth/login', { email, password });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.ok(bob.get('jinaly_auth'));
  const me = await req(alice, '/api/auth/me');
  assert.equal(
    login.data.user.id,
    me.data.user.id,
    'личность участника не зависит от устройства',
  );
  assert.notEqual(
    bob.get('jinaly_auth'),
    alice.get('jinaly_auth'),
    'у каждого устройства своя сессия',
  );
});

await test('Выход закрывает только своё устройство', async () => {
  const out = await req(bob, '/api/auth/logout', {});
  assert.equal(out.status, 200);
  assert.ok(!bob.get('jinaly_auth'));
  assert.equal((await req(bob, '/api/auth/me')).data.user, null);
  assert.equal((await req(alice, '/api/auth/me')).data.user.email, email);
});

// --- Комнаты и личность ----------------------------------------------------
await test('Комната, созданная гостем, остаётся у него после регистрации', async () => {
  const guest = browser();
  await req(guest, '/api/session', {});
  const room = await req(guest, '/api/rooms', {
    title: 'QA · комната до регистрации',
    name: 'QA Гость',
    theme: 'nauryz',
  });
  assert.equal(room.status, 201, JSON.stringify(room.data));

  const registered = await req(guest, '/api/auth/register', {
    email: unique(),
    password,
    name: 'QA Гость',
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.data));

  const mine = await req(guest, '/api/rooms');
  assert.ok(
    mine.data.rooms.some((r) => r.id === room.data.id),
    'после регистрации комната должна остаться в списке своих',
  );

  // Комната больше не нужна: убираем её в архив, как делает основная проверка.
  await req(guest, '/api/rooms/' + room.data.id, { type: 'archive', value: true });
});

await test('Вошедший участник создаёт комнаты от имени аккаунта', async () => {
  const room = await req(alice, '/api/rooms', {
    title: 'QA · комната аккаунта',
    name: 'QA Аккаунт',
    theme: 'nauryz',
  });
  assert.equal(room.status, 201, JSON.stringify(room.data));
  const mine = await req(alice, '/api/rooms');
  assert.ok(mine.data.rooms.some((r) => r.id === room.data.id));

  // Второе устройство того же аккаунта видит ту же комнату.
  const second = browser();
  await req(second, '/api/auth/login', { email, password });
  const fromSecond = await req(second, '/api/rooms');
  assert.ok(
    fromSecond.data.rooms.some((r) => r.id === room.data.id),
    'вход с другого устройства возвращает свои комнаты',
  );
  await req(alice, '/api/rooms/' + room.data.id, { type: 'archive', value: true });
});

// --- Восстановление пароля и Google ---------------------------------------
await test('Запрос сброса пароля не выдаёт, зарегистрирован ли адрес', async () => {
  const known = await req(browser(), '/api/auth/forgot', { email });
  const unknown = await req(browser(), '/api/auth/forgot', { email: unique() });
  assert.equal(known.status, 200, JSON.stringify(known.data));
  assert.equal(unknown.status, 200);
  assert.equal(known.data.ok, true);
  assert.equal(unknown.data.ok, true);
});

await test('Ссылка сброса с чужим токеном не меняет пароль', async () => {
  const reset = await req(browser(), '/api/auth/reset', {
    token: 'f'.repeat(64),
    password: 'другой-длинный-пароль',
  });
  assert.equal(reset.status, 400);
  assert.equal((await req(browser(), '/api/auth/login', { email, password })).status, 200);
});

await test('Запрос с чужого источника отклоняется', async () => {
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://attacker.example',
    },
    body: JSON.stringify({ email, password }),
  });
  // Отказ даёт либо сам обработчик (проверка Origin), либо слой перед ним.
  assert.ok(response.status >= 400, 'чужой источник должен получить отказ');
  assert.ok(!response.headers.getSetCookie().some((c) => c.startsWith('jinaly_auth=')));
});

await test('Вход через Google отвечает осмысленно и без секретов', async () => {
  const start = await fetch(base + '/api/auth/google', { redirect: 'manual' });
  if (start.status === 503) {
    // Ключи не заданы в этом окружении — кнопка Google скрыта в интерфейсе.
    assert.match((await start.json()).error, /Google/);
  } else {
    assert.equal(start.status, 302);
    const target = new URL(start.headers.get('location'));
    assert.equal(target.hostname, 'accounts.google.com');
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(start.headers.getSetCookie().some((c) => c.startsWith('jinaly_oauth=')));
  }
});

await test('Возврат от Google без состояния не создаёт сессию', async () => {
  const back = await fetch(base + '/api/auth/google/callback?code=x&state=y', {
    redirect: 'manual',
  });
  assert.equal(back.status, 302);
  assert.ok(!back.headers.getSetCookie().some((c) => /^jinaly_auth=\w/.test(c)));
});

console.log(`\n${passed} HTTP-проверок входа пройдено`);
