import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newOpId, sendWithRetry } from '../lib/room-connection.ts';
import { operationId } from '../lib/room-store.ts';

const noSleep = async () => {};

test('повтор: сетевой сбой повторяется, потом успех', async () => {
  let calls = 0;
  const r = await sendWithRetry(async () => {
    if (++calls < 3) throw Error('Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.');
    return 'ok';
  }, [1, 1], noSleep);
  assert.equal(r, 'ok');
  assert.equal(calls, 3);
});

test('повтор: отказ сервера по правилам не повторяется', async () => {
  let calls = 0;
  await assert.rejects(
    sendWithRetry(async () => {
      calls++;
      throw Error('Доступно только ведущему');
    }, [1, 1], noSleep),
    /ведущему/,
  );
  assert.equal(calls, 1);
});

test('повтор: после последней попытки ошибка уходит наверх', async () => {
  let calls = 0;
  await assert.rejects(
    sendWithRetry(async () => {
      calls++;
      throw Error('Сервер не ответил вовремя. Проверьте подключение и попробуйте ещё раз.');
    }, [1, 1], noSleep),
    /не ответил/,
  );
  assert.equal(calls, 3);
});

test('ключ операции: уникальный и проходит серверную проверку', () => {
  const a = newOpId();
  assert.notEqual(a, newOpId());
  assert.equal(operationId(a), a);
  assert.equal(operationId('короткий'), null);
  assert.equal(operationId("x'; DROP TABLE"), null);
  assert.equal(operationId(42), null);
});
