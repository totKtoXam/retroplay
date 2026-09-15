import assert from 'node:assert/strict';
import {
  mailMode,
  mailClient,
  mailSender,
  isUndeliverable,
} from '../lib/mail-config.ts';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('PASS', name);
}

test('Без ключей письма не уходят', () => {
  assert.equal(mailMode({}), 'dev');
  // Одного токена мало: без клиента Gmail не выдаст токен отправки.
  assert.equal(mailMode({ GMAIL_REFRESH_TOKEN: '1//0g' }), 'dev');
  assert.equal(
    mailMode({ GMAIL_REFRESH_TOKEN: '1//0g', GMAIL_CLIENT_ID: 'id' }),
    'dev',
  );
});

test('Письма включаются своей парой ключей, не трогая вход через Google', () => {
  const env = {
    GMAIL_CLIENT_ID: 'mail-id',
    GMAIL_CLIENT_SECRET: 'mail-secret',
    GMAIL_REFRESH_TOKEN: '1//0g',
  };
  assert.equal(mailMode(env), 'gmail');
  assert.deepEqual(mailClient(env), { id: 'mail-id', secret: 'mail-secret' });
});

test('Один клиент на всё: почта берёт ключи входа, если своих нет', () => {
  const env = {
    GOOGLE_CLIENT_ID: 'sign-in-id',
    GOOGLE_CLIENT_SECRET: 'sign-in-secret',
    GMAIL_REFRESH_TOKEN: '1//0g',
  };
  assert.equal(mailMode(env), 'gmail');
  assert.deepEqual(mailClient(env), {
    id: 'sign-in-id',
    secret: 'sign-in-secret',
  });
});

test('Свои ключи почты важнее ключей входа', () => {
  const client = mailClient({
    GOOGLE_CLIENT_ID: 'sign-in-id',
    GOOGLE_CLIENT_SECRET: 'sign-in-secret',
    GMAIL_CLIENT_ID: 'mail-id',
    GMAIL_CLIENT_SECRET: 'mail-secret',
  });
  assert.deepEqual(client, { id: 'mail-id', secret: 'mail-secret' });
});

test('Пробелы вокруг значений не создают видимость настройки', () => {
  assert.equal(
    mailMode({
      GMAIL_CLIENT_ID: '  ',
      GMAIL_CLIENT_SECRET: '  ',
      GMAIL_REFRESH_TOKEN: '  ',
    }),
    'dev',
  );
  assert.equal(mailMode({ RESEND_API_KEY: '   ' }), 'dev');
});

test('Gmail имеет приоритет над Resend, Resend работает сам по себе', () => {
  assert.equal(mailMode({ RESEND_API_KEY: 're_123' }), 'resend');
  assert.equal(
    mailMode({
      RESEND_API_KEY: 're_123',
      GMAIL_CLIENT_ID: 'id',
      GMAIL_CLIENT_SECRET: 'secret',
      GMAIL_REFRESH_TOKEN: '1//0g',
    }),
    'gmail',
  );
});

test('Отправитель берётся из настроек, иначе — заглушка', () => {
  assert.equal(mailSender({ GMAIL_SENDER: 'Jinaly <a@b.kz>' }), 'Jinaly <a@b.kz>');
  assert.equal(
    mailSender({ MAIL_FROM: 'Jinaly <no-reply@b.kz>', GMAIL_SENDER: 'a@b.kz' }),
    'Jinaly <no-reply@b.kz>',
  );
  assert.match(mailSender({}), /jinaly\.local/);
});

test('Зарезервированные тестовые домены не получают писем', () => {
  // RFC 2606/6761: почты на этих доменах не существует, письмо вернётся отлётом
  // в ящик отправителя. После интеграционных тестов таких писем десяток за прогон.
  for (const address of [
    'qa-abc@jinaly.test',
    'кто-то@example.com',
    'a@example.org',
    'a@sub.example.net',
    'a@host.invalid',
    'a@localhost',
    'a@dev.localhost',
    'без-собаки',
    '',
    null,
  ])
    assert.equal(isUndeliverable(address), true, String(address));
});

test('Обычные адреса отправку не блокируют', () => {
  for (const address of [
    'kham.b.13.09@gmail.com',
    'kham.b.13.09+jinaly@gmail.com',
    'user@jinaly.kz',
    'USER@Example.Company',
    'a@testing.org',
    'a@mail.test.kz',
  ])
    assert.equal(isUndeliverable(address), false, String(address));
});

console.log(`\n${passed} проверок настройки почты пройдено`);
