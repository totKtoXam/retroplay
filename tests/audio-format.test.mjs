import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codecFromLog,
  ffmpegArgs,
  mp4AudioCodec,
  planAudio,
  renameForTarget,
  targetForCodec,
} from '../lib/audio-format.ts';

/** Кусок MP4 с записью stsd и заданным кодеком. */
function mp4With(codec) {
  const bytes = new Uint8Array(64);
  const ascii = (at, text) => [...text].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  ascii(4, 'ftyp');
  ascii(24, 'stsd');
  ascii(24 + 16, codec);
  return bytes;
}

const empty = new Uint8Array(0);

test('MP3, AAC и FLAC хранятся как есть', () => {
  assert.equal(planAudio('a.mp3', '', empty), 'keep');
  assert.equal(planAudio('a.bin', 'audio/mpeg', empty), 'keep');
  assert.equal(planAudio('a.aac', '', empty), 'keep');
  assert.equal(planAudio('a.FLAC', '', empty), 'keep');
});

test('M4A: AAC хранится, ALAC и неизвестное идут в ffmpeg', () => {
  assert.equal(mp4AudioCodec(mp4With('mp4a')), 'mp4a');
  assert.equal(mp4AudioCodec(mp4With('alac')), 'alac');
  assert.equal(mp4AudioCodec(new Uint8Array(64)), null);
  assert.equal(planAudio('a.m4a', 'audio/x-m4a', mp4With('mp4a')), 'keep');
  assert.equal(planAudio('a.m4a', 'audio/x-m4a', mp4With('alac')), 'probe');
  assert.equal(planAudio('a.m4a', '', empty), 'probe');
});

test('WAV, AIFF, Ogg и прочее идут в ffmpeg', () => {
  for (const name of ['a.wav', 'a.aiff', 'a.ogg', 'a.opus', 'a.webm', 'a.wma'])
    assert.equal(planAudio(name, '', empty), 'probe', name);
});

test('без потерь — в FLAC, с потерями — в MP3', () => {
  for (const c of ['pcm_s16le', 'pcm_s24be', 'pcm_f32le', 'alac', 'flac', 'wavpack'])
    assert.equal(targetForCodec(c), 'flac', c);
  for (const c of ['vorbis', 'opus', 'wmav2', 'aac', 'mp3'])
    assert.equal(targetForCodec(c), 'mp3', c);
});

test('кодек читается из вывода ffmpeg -i', () => {
  const log = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'in.m4a':",
    '  Stream #0:0[0x1](und): Audio: alac (alac / 0x63616C61), 44100 Hz, stereo, s16p, 1411 kb/s (default)',
    '  Stream #0:1[0x0]: Video: mjpeg (Baseline), yuvj420p, 600x600',
  ].join('\n');
  assert.equal(codecFromLog(log), 'alac');
  assert.equal(codecFromLog('  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz'), 'pcm_s16le');
  assert.equal(codecFromLog('  Stream #0:0: Video: h264'), null);
});

test('аргументы ffmpeg и новое имя файла', () => {
  assert.deepEqual(ffmpegArgs('in.wav', 'out.flac', 'flac').slice(-4), ['-c:a', 'flac', '-compression_level', '5', 'out.flac'].slice(-4));
  assert.ok(ffmpegArgs('in.ogg', 'out.mp3', 'mp3').includes('320k'));
  assert.ok(ffmpegArgs('in.ogg', 'out.mp3', 'mp3').includes('-vn'));
  assert.equal(renameForTarget('My Song.wav', 'flac'), 'My Song.flac');
  assert.equal(renameForTarget('track.v2.ogg', 'mp3'), 'track.v2.mp3');
});
