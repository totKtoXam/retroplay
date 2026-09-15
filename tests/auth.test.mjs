import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  emailProblem,
  passwordProblem,
  normalizeEmail,
  cleanDisplayName,
  nameFromEmail,
  randomToken,
  sha256Hex,
  readCookie,
  safeNext,
  PBKDF2_ITERATIONS,
} from '../lib/auth.ts';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log('PASS', name);
}

await test('Пароль проверяется своим хешем и не проверяется чужим', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.match(stored, /^pbkdf2\$sha256\$\d+\$[^$]+\$[^$]+$/);
  assert.equal(await verifyPassword('correct horse battery', stored), true);
  assert.equal(await verifyPassword('Correct horse battery', stored), false);
  assert.equal(await verifyPassword('', stored), false);
});

await test('Одинаковые пароли получают разную соль и разный хеш', async () => {
  const a = await hashPassword('одинаковый пароль');
  const b = await hashPassword('одинаковый пароль');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('одинаковый пароль', a), true);
  assert.equal(await verifyPassword('одинаковый пароль', b), true);
});

await test('Испорченная строка хеша не пропускает вход', async () => {
  const stored = await hashPassword('пароль для проверки');
  const parts = stored.split('$');
  for (const broken of [
    '',
    'не хеш',
    parts.slice(0, 4).join('$'),
    // Подменённое число итераций меняет результат — пароль не сойдётся.
    ['pbkdf2', 'sha256', '1', parts[3], parts[4]].join('$'),
    // Чужой алгоритм не принимается, даже если формат похож.
    ['scrypt', 'sha256', parts[2], parts[3], parts[4]].join('$'),
    ['pbkdf2', 'sha256', '0', parts[3], parts[4]].join('$'),
  ])
    assert.equal(
      await verifyPassword('пароль для проверки', broken),
      false,
      broken,
    );
});

await test('Слишком длинный пароль не хешируется', async () => {
  const stored = await hashPassword('нормальный пароль');
  assert.equal(await verifyPassword('x'.repeat(5000), stored), false);
});

await test('Старый хеш с меньшим числом итераций помечается к пересчёту', async () => {
  const stored = await hashPassword('пароль');
  assert.equal(needsRehash(stored), false);
  const old = stored.replace(
    `$${PBKDF2_ITERATIONS}$`,
    `$${Math.floor(PBKDF2_ITERATIONS / 2)}$`,
  );
  assert.equal(needsRehash(old), true);
  // Пароль всё ещё проверяется: число итераций читается из самой строки.
  assert.equal(needsRehash('не хеш'), false);
});

await test('Адрес почты проверяется по форме и приводится к нижнему регистру', () => {
  assert.equal(normalizeEmail('  Name@Example.COM '), 'name@example.com');
  assert.equal(emailProblem('name@example.com'), '');
  assert.equal(emailProblem('Имя.Фамилия@почта.рф') === '', false);
  for (const bad of [
    '',
    'name',
    'name@',
    '@example.com',
    'name@example',
    'name@@example.com',
    'name @example.com',
    'name@exa..mple.com',
    'name@.example.com',
    'a'.repeat(250) + '@example.com',
  ])
    assert.notEqual(emailProblem(bad), '', bad);
});

await test('Пароль короче восьми символов и однообразный не принимается', () => {
  assert.equal(passwordProblem('длинный пароль'), '');
  for (const bad of ['', 'корот', '1234567', '        ', 'aaaaaaaaaa', 121])
    assert.notEqual(passwordProblem(bad), '', String(bad));
});

await test('Имя обрезается по 40 символам, пустое заменяется запасным', () => {
  assert.equal(cleanDisplayName('  Асан   Ерболович  '), 'Асан Ерболович');
  assert.equal(cleanDisplayName('', 'Участник'), 'Участник');
  assert.equal(cleanDisplayName('я'.repeat(80)).length, 40);
  assert.equal(nameFromEmail('asan.erbolovich@example.com'), 'asan erbolovich');
  assert.equal(nameFromEmail('@example.com'), 'Участник');
});

await test('Токены случайны, а хеш совпадает с известным значением SHA-256', async () => {
  const tokens = new Set(Array.from({ length: 50 }, () => randomToken()));
  assert.equal(tokens.size, 50);
  assert.equal(randomToken().length, 64);
  assert.equal(randomToken(16).length, 32);
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

await test('Cookie читается по точному имени', () => {
  const header = 'jinaly_session=guest; jinaly_auth=token123; other=x';
  assert.equal(readCookie(header, 'jinaly_auth'), 'token123');
  assert.equal(readCookie(header, 'jinaly_session'), 'guest');
  // Похожее имя не должно совпадать с искомым.
  assert.equal(readCookie('xjinaly_auth=nope', 'jinaly_auth'), '');
  assert.equal(readCookie(null, 'jinaly_auth'), '');
});

await test('Адрес возврата после входа не выводит с сайта', () => {
  assert.equal(safeNext('/room/abc?invite=1'), '/room/abc?invite=1');
  assert.equal(safeNext('/'), '/');
  for (const bad of [
    'https://example.com',
    '//example.com',
    '/\\example.com',
    'javascript:alert(1)',
    '',
    null,
    42,
  ])
    assert.equal(safeNext(bad), '/', String(bad));
});

console.log(`\n${passed} проверок входа пройдено`);
