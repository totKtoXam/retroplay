import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYMAP, bindingsFor, codesFor, keyLabel } from '../lib/keymap.ts';
import { slotsFor } from '../lib/loadout.ts';
import { MODES } from '../lib/maps/catalog.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modes = MODES.map((m) => m.id);
const allCodes = new Set(KEYMAP.flatMap((b) => b.keys.map((k) => k.code)));
const specId = (k) => `${k.alt ? 'Alt+' : ''}${k.code}`;
const CYRILLIC = /[А-Яа-яЁё]/;

/**
 * Коды, для которых world.tsx гасит действие браузера по умолчанию (onKey, список перед
 * `keys.add(e.code)`). Копия нужна на случай, когда world.tsx перейдёт на codesFor() и литерала
 * не останется; пока он есть, тест сверяет копию с ним.
 */
const PREVENT_DEFAULT = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'KeyX', 'ShiftLeft', 'ShiftRight', 'Tab',
  'Backquote', 'KeyE', 'KeyF', 'KeyV', 'KeyR', 'KeyZ', 'KeyM', 'KeyT', 'KeyY',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  ...Array.from({ length: 10 }, (_, i) => 'Digit' + i),
];

test('the preventDefault list in world-input.ts is the one this test knows', () => {
  // Обработчики клавиш переехали из world.tsx в components/world-input.ts.
  const src = read('components/world-input.ts');
  const m = /\[\s*((?:'[A-Za-z0-9]+',\s*)+)\.\.\.Array\.from\(\{ length: 10 \}, \(_, i\) => 'Digit' \+ i\),?\s*\]\.includes\(e\.code\)/.exec(src);
  assert.ok(m, 'список preventDefault не найден в world-input.ts — если он теперь берётся из keymap, уберите эту проверку');
  const literal = [...m[1].matchAll(/'([A-Za-z0-9]+)'/g)].map((x) => x[1]);
  assert.deepEqual(
    [...literal, ...Array.from({ length: 10 }, (_, i) => 'Digit' + i)].sort(),
    [...PREVENT_DEFAULT].sort(),
    'список preventDefault в world.tsx изменился — обновите KEYMAP и копию в тесте',
  );
});

test('every key the world swallows is described in the keymap', () => {
  for (const code of PREVENT_DEFAULT) {
    if (code.startsWith('Digit')) continue; // цифры проверяются по слотам ниже
    assert.ok(allCodes.has(code), `${code} гасится в world.tsx, но его нет в KEYMAP`);
  }
});

test('every key the handlers react to is in the keymap', () => {
  const sources = [
    'components/world.tsx',
    'components/world-input.ts',
    'components/world-player.ts',
    'components/impostor-overlay.tsx',
    'components/game-chat.tsx',
    'components/room-app.tsx',
  ];
  for (const path of sources) {
    const src = read(path);
    const codes = [
      ...[...src.matchAll(/e\.code [!=]== '([A-Za-z0-9]+)'/g)].map((x) => x[1]),
      ...[...src.matchAll(/keys\.has\('([A-Za-z0-9]+)'\)/g)].map((x) => x[1]),
    ];
    for (const code of codes) assert.ok(allCodes.has(code), `${path}: ${code} не описан в KEYMAP`);
  }
  // Кнопки мыши и колесо — world.tsx (onDown, wheel), item-wheel.tsx (отпускание СКМ).
  for (const code of ['Mouse0', 'Mouse1', 'Mouse2', 'Wheel'])
    assert.ok(allCodes.has(code), `${code} не описан в KEYMAP`);
});

test('digit slots come from the loadout of each mode', () => {
  for (const mode of modes) {
    const slots = slotsFor(mode);
    const bound = bindingsFor(mode).filter((b) => b.action.startsWith('slot-') && b.action !== 'slot-cycle');
    assert.deepEqual(
      bound.map((b) => [b.keys[0].code, b.label]),
      slots.map((s) => [`Digit${s.key}`, s.label]),
      `слоты режима ${mode}`,
    );
    for (const s of slots) assert.deepEqual(codesFor(`slot-${s.key}`, mode), [`Digit${s.key}`]);
  }
});

test('no key does two things at once in one mode', () => {
  for (const mode of modes) {
    const byKey = new Map();
    for (const b of bindingsFor(mode))
      for (const k of b.keys) {
        const id = `${b.context ?? 'world'}|${specId(k)}`;
        byKey.set(id, [...(byKey.get(id) ?? []), b]);
      }
    for (const [id, list] of byKey) {
      const actions = new Set(list.map((b) => b.action));
      if (actions.size < 2) continue;
      assert.ok(
        list.every((b) => b.conflictNote),
        `${mode}: ${id} занята действиями ${[...actions].join(', ')} без пометки conflictNote`,
      );
    }
  }
});

test('a key that changes meaning between modes is marked', () => {
  // Одна клавиша в одном контексте, но в разных режимах — разные действия: игрок нажмёт её по
  // привычке. Хотя бы одна из привязок обязана объяснить это в conflictNote.
  const byKey = new Map();
  for (const mode of modes)
    for (const b of bindingsFor(mode))
      for (const k of b.keys) {
        const id = `${b.context ?? 'world'}|${specId(k)}`;
        if (!byKey.has(id)) byKey.set(id, new Set());
        byKey.get(id).add(b);
      }
  for (const [id, set] of byKey) {
    const list = [...set];
    if (new Set(list.map((b) => b.action)).size < 2) continue;
    assert.ok(
      list.some((b) => b.conflictNote),
      `${id}: ${list.map((b) => b.action).join(', ')} — нужна пометка conflictNote`,
    );
  }
  // Главный случай из плана (п. 3.1): нож на Q в «Предателе».
  const knife = KEYMAP.find((b) => b.action === 'impostor-kill');
  assert.ok(knife?.conflictNote);
  assert.deepEqual(codesFor('impostor-kill'), ['KeyQ']);
  assert.deepEqual(codesFor('inventory', 'impostor'), [], 'в «Предателе» Q и I снаряжение не открывают');
});

test('every action has a Russian label and every key a caption', () => {
  for (const b of KEYMAP) {
    assert.match(b.label, CYRILLIC, `${b.action}: подпись должна быть по-русски`);
    assert.ok(b.keys.length > 0, `${b.action}: нет клавиш`);
    for (const k of b.keys) assert.ok(k.label.trim(), `${b.action}: у ${k.code} нет подписи`);
  }
});

test('labels for hints', () => {
  assert.equal(keyLabel('inventory'), 'Q / I');
  assert.equal(keyLabel('move'), 'W A S D');
  assert.equal(keyLabel('walk-slow'), 'Shift');
  assert.equal(keyLabel('camera-distance'), 'Alt + Колесо');
  assert.equal(keyLabel('scoreboard'), 'Ё');
  const tilde = KEYMAP.find((b) => b.action === 'scoreboard').keys[0];
  assert.equal(tilde.code, 'Backquote');
  assert.match(tilde.hint, /слева от 1/);
  assert.match(tilde.hint, /`/);
  assert.equal(keyLabel('no-such-action'), '');
  assert.deepEqual(codesFor('walk-slow'), ['ShiftLeft', 'ShiftRight']);
});

test('mode filters', () => {
  const actions = (mode) => new Set(bindingsFor(mode).map((b) => b.action));
  assert.ok(actions('retro').has('use-board'));
  assert.ok(!actions('battle').has('use-board'));
  assert.ok(actions('battle').has('reload'));
  assert.ok(!actions('impostor').has('reload'));
  assert.ok(actions('impostor').has('impostor-report'));
  assert.ok(!actions('retro').has('impostor-kill'));
  // Общие клавиши есть везде.
  for (const mode of modes) for (const a of ['move', 'pause', 'chat-open', 'scoreboard']) assert.ok(actions(mode).has(a), `${mode}: ${a}`);
});
