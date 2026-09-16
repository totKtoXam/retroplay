/*
 * Воркер конвертации аудио (lib/audio-convert.ts).
 *
 * Лежит в public/ обычным скриптом, а не модулем из бандла: сборщик в
 * dev-режиме подмешивает в модульные воркеры свой клиент, который обращается к
 * `window` и роняет воркер молча. Классический воркер сборщик не трогает, а
 * ядро ffmpeg (однопоточная UMD-сборка) подключается через importScripts прямо
 * с jsDelivr.
 *
 * Протокол: { id, type, payload } → { id, ok, payload } или { id, ok: false, error };
 * между ними приходят { type: 'log' | 'progress', payload }.
 */
/* global importScripts, createFFmpegCore */
var CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
var core = null;

async function load() {
  if (core) return true;
  importScripts(CORE + '/ffmpeg-core.js');
  core = await createFFmpegCore({
    // Так ядро узнаёт, откуда брать .wasm: иначе ищет рядом с blob-адресом.
    mainScriptUrlOrBlob:
      CORE + '/ffmpeg-core.js#' + btoa(JSON.stringify({ wasmURL: CORE + '/ffmpeg-core.wasm' })),
  });
  core.setLogger(function (d) {
    self.postMessage({ type: 'log', payload: d.message });
  });
  core.setProgress(function (d) {
    self.postMessage({ type: 'progress', payload: d.progress });
  });
  return true;
}

self.onmessage = async function (event) {
  var id = event.data.id;
  var type = event.data.type;
  var payload = event.data.payload;
  try {
    if (type === 'load') {
      self.postMessage({ id: id, ok: true, payload: await load() });
      return;
    }
    if (!core) throw new Error('ffmpeg не загружен');
    if (type === 'exec') {
      core.setTimeout(-1);
      core.exec.apply(core, payload);
      var code = core.ret;
      core.reset();
      self.postMessage({ id: id, ok: true, payload: code });
    } else if (type === 'write') {
      core.FS.writeFile(payload.path, payload.data);
      self.postMessage({ id: id, ok: true, payload: true });
    } else if (type === 'read') {
      var data = core.FS.readFile(payload.path);
      self.postMessage({ id: id, ok: true, payload: data }, [data.buffer]);
    } else if (type === 'delete') {
      core.FS.unlink(payload.path);
      self.postMessage({ id: id, ok: true, payload: true });
    } else {
      throw new Error('неизвестная команда ' + type);
    }
  } catch (e) {
    self.postMessage({ id: id, ok: false, error: String((e && e.message) || e) });
  }
};
