import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREF_KEYS,
  readChoice,
  readPref,
  writePref,
} from '../lib/user-prefs.ts';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
beforeEach(() => store.clear());

test('настройка переживает перезапись и читается обратно', () => {
  writePref(PREF_KEYS.sound, 'true');
  assert.equal(readPref(PREF_KEYS.sound), 'true');
});

test('выбор вне списка вариантов сбрасывается на значение по умолчанию', () => {
  writePref(PREF_KEYS.confettiStyle, 'stars');
  assert.equal(readChoice(PREF_KEYS.confettiStyle, ['classic', 'stars'], 'classic'), 'stars');
  writePref(PREF_KEYS.confettiStyle, 'removed-style');
  assert.equal(readChoice(PREF_KEYS.confettiStyle, ['classic', 'stars'], 'classic'), 'classic');
});

test('недоступное хранилище не роняет чтение и запись', () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  try {
    writePref(PREF_KEYS.sound, 'true');
    assert.equal(readPref(PREF_KEYS.sound), null);
  } finally {
    globalThis.localStorage = saved;
  }
});
