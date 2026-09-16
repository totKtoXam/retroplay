import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREF_KEYS,
  readChoice,
  readMusicPrefs,
  readPref,
  writeMusicPrefs,
  writePref,
} from '../lib/user-prefs.ts';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
beforeEach(() => store.clear());

const TRACKS = ['evening', 'steppe'];
const DEFAULT_MUSIC = { track: 'evening', volume: 0.25 };

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

test('музыка: трек и громкость сохраняются, мусор отбрасывается', () => {
  assert.deepEqual(readMusicPrefs(TRACKS, DEFAULT_MUSIC), DEFAULT_MUSIC);
  writeMusicPrefs({ track: 'steppe', volume: 0.7 });
  assert.deepEqual(readMusicPrefs(TRACKS, DEFAULT_MUSIC), { track: 'steppe', volume: 0.7 });
  writePref(PREF_KEYS.music, JSON.stringify({ track: 'gone', volume: 5 }));
  assert.deepEqual(readMusicPrefs(TRACKS, DEFAULT_MUSIC), { track: 'evening', volume: 1 });
  writePref(PREF_KEYS.music, '{broken');
  assert.deepEqual(readMusicPrefs(TRACKS, DEFAULT_MUSIC), DEFAULT_MUSIC);
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
    assert.deepEqual(readMusicPrefs(TRACKS, DEFAULT_MUSIC), DEFAULT_MUSIC);
  } finally {
    globalThis.localStorage = saved;
  }
});
