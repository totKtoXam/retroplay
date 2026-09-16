import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SETTING_LENGTH,
  cleanSettings,
  mergeSettings,
  sameSettings,
} from '../lib/settings-sync.ts';

test('на сервер и обратно проходят только известные ключи со строками', () => {
  assert.deepEqual(
    cleanSettings({
      'jinaly-theme': 'dark',
      'jinaly-sensitivity': 1.2,
      'jinaly-graphics-v1': '{}',
      __proto__: { 'jinaly-sound': 'true' },
      'jinaly-paint-color': 'x'.repeat(MAX_SETTING_LENGTH + 1),
    }),
    { 'jinaly-theme': 'dark' },
  );
  assert.deepEqual(cleanSettings(null), {});
  assert.deepEqual(cleanSettings(['dark']), {});
});

test('новое устройство получает настройки аккаунта и дополняет их своими', () => {
  const merged = mergeSettings({
    local: { 'jinaly-theme': 'light', 'jinaly-sound': 'true' },
    remote: { 'jinaly-theme': 'dark' },
    base: null,
  });
  assert.deepEqual(merged, { 'jinaly-theme': 'dark', 'jinaly-sound': 'true' });
});

test('пустой аккаунт забирает настройки первого устройства', () => {
  const local = { 'jinaly-theme': 'dark', 'jinaly-perspective': 'first' };
  assert.deepEqual(mergeSettings({ local, remote: {}, base: null }), local);
});

test('изменённое здесь побеждает, остальное приходит с другого устройства', () => {
  const base = { 'jinaly-theme': 'light', 'jinaly-sound': 'false', 'jinaly-perspective': 'third' };
  const local = { ...base, 'jinaly-theme': 'dark' };
  const remote = { ...base, 'jinaly-sound': 'true' };
  delete remote['jinaly-perspective'];
  assert.deepEqual(mergeSettings({ local, remote, base }), {
    'jinaly-theme': 'dark',
    'jinaly-sound': 'true',
  });
});

test('удалённая здесь настройка не возвращается с аккаунта', () => {
  const base = { 'jinaly-theme': 'dark' };
  assert.deepEqual(mergeSettings({ local: {}, remote: base, base }), {});
});

test('сравнение не зависит от порядка ключей и игнорирует посторонние', () => {
  assert.ok(
    sameSettings(
      { 'jinaly-theme': 'dark', 'jinaly-sound': 'true' },
      { 'jinaly-sound': 'true', 'jinaly-theme': 'dark', other: '1' },
    ),
  );
  assert.ok(!sameSettings({ 'jinaly-theme': 'dark' }, {}));
});
