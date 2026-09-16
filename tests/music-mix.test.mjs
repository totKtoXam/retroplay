import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  musicGain,
  trackTitleFromFile,
  BACKGROUND_LEVEL,
  DUCKED_LEVEL,
} from '../lib/music-mix.ts';

test('в полную громкость музыка не уступает голосам', () => {
  assert.equal(musicGain(0.8, false, false), 0.8);
  assert.equal(musicGain(0.8, false, true), 0.8);
});

test('на фоне музыка тише, а под голосом ещё тише', () => {
  const quiet = musicGain(0.8, true, false);
  const ducked = musicGain(0.8, true, true);
  assert.equal(quiet, 0.8 * BACKGROUND_LEVEL);
  assert.equal(ducked, 0.8 * DUCKED_LEVEL);
  assert.ok(ducked < quiet && quiet < 0.8);
});

test('громкость зажата в 0…1', () => {
  assert.equal(musicGain(2, false, false), 1);
  assert.equal(musicGain(-1, true, true), 0);
});

test('название трека берётся из имени файла', () => {
  assert.equal(trackTitleFromFile('My_Song.mp3'), 'My Song');
  assert.equal(trackTitleFromFile('lofi.beats.flac'), 'lofi.beats');
  assert.equal(trackTitleFromFile('.mp3'), 'Без названия');
});
