import assert from 'node:assert/strict';
import {
  initialState,
  applyOperation,
  noteKindLabel,
  templateZones,
  zoneShort,
  zoneTitle,
  FORM_NOTE_KINDS,
  isActionKind,
} from '../lib/model.ts';
import {
  actionItems,
  exportCsvRows,
  exportMarkdown,
  topVoted,
  toCsv,
  zoneFromLabel,
} from '../lib/room-export.ts';
import { connectionStatus, isNetworkError } from '../lib/room-connection.ts';
import { phaseGuide } from '../lib/room-phase.ts';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('PASS', name);
}
const run = (s, op, user = 'host') => applyOperation(s, op, user, 'host');

test('Названия зон совпадают с доской для обоих форматов', () => {
  assert.equal(zoneTitle('good'), 'Что было хорошо');
  assert.equal(zoneTitle('good', 'three'), 'Продолжать делать');
  assert.equal(zoneTitle('stop', 'three'), 'Перестать делать');
  assert.equal(zoneTitle('unknown'), 'unknown', 'неизвестный id не теряется');
  assert.equal(zoneShort('good'), 'Хорошо');
  assert.equal(zoneShort('good', 'three'), 'Продолжать');
  assert.equal(zoneShort('bad'), 'Сложно');
  assert.deepEqual(
    templateZones('three').map((z) => z.id),
    ['good', 'start', 'stop'],
  );
  assert.equal(templateZones('four').length, 4);
});

test('Типы карточек: одно «Действие» и человеческие названия старых id', () => {
  for (const kind of ['action', 'task', 'roadmap']) {
    assert.equal(noteKindLabel(kind), 'Действие');
    assert.ok(isActionKind(kind));
  }
  assert.equal(noteKindLabel('sticky'), 'Стикер');
  assert.equal(noteKindLabel('draw'), 'Рисунок', 'старые рисунки подписаны');
  assert.equal(noteKindLabel('mystery'), 'mystery');
  assert.ok(!FORM_NOTE_KINDS.includes('draw'));
  assert.ok(!FORM_NOTE_KINDS.includes('connector'));
  assert.ok(!FORM_NOTE_KINDS.includes('task'));
  assert.ok(!FORM_NOTE_KINDS.includes('roadmap'));
  assert.ok(FORM_NOTE_KINDS.includes('action'));
});

function meeting(template = 'four') {
  // Встреча собирается в четырёх колонках, а формат ставится в конце: так у доски
  // из трёх колонок остаётся карточка в зоне «Сложно», как в старых комнатах
  // (сейчас сервер такую карточку в этом формате не создаст).
  let s = initialState('Спринт 42', 'nauryz', 'four');
  s = run(s, { type: 'group.add', title: 'Коммуникация' });
  const group = s.groups[0].id;
  s = run(s, { type: 'note.add', text: 'Быстрые релизы', zone: 'good', group });
  s = run(s, { type: 'note.add', text: 'Долгие ревью', zone: 'bad' });
  s = run(s, {
    type: 'note.add',
    kind: 'action',
    text: 'Ревью за сутки',
    zone: 'start',
    owner: 'Айгерим',
    due: '2026-10-05',
  });
  s = run(s, { type: 'note.add', kind: 'task', text: 'Старая задача', zone: 'stop' });
  s = run(s, { type: 'note.add', kind: 'connector', from: 'a', to: 'b' });
  s = run(s, { type: 'vote.start', limit: 5 });
  const [good, bad] = s.notes;
  s = run(s, { type: 'vote', id: bad.id });
  s = run(s, { type: 'vote', id: bad.id });
  s = run(s, { type: 'vote', id: good.id }, 'guest');
  s = run(s, { type: 'vote.end' });
  return { ...s, template };
}

test('Топ по голосам и план действий берут и старые типы', () => {
  const s = meeting();
  const top = topVoted(s);
  assert.deepEqual(
    top.map((t) => [t.note.text, t.votes]),
    [
      ['Долгие ревью', 2],
      ['Быстрые релизы', 1],
    ],
  );
  assert.deepEqual(
    actionItems(s).map((n) => n.text),
    ['Ревью за сутки', 'Старая задача'],
  );
});

test('Markdown: голоса, темы, план действий и ответственные', () => {
  const md = exportMarkdown(meeting(), new Date(2026, 8, 28));
  assert.match(md, /^# Спринт 42/);
  assert.match(md, /## Итоги голосования\n\n1\. Долгие ревью — голосов: 2/);
  assert.match(md, /## Что было хорошо\n\n- Быстрые релизы · голосов: 1/);
  assert.match(md, /## Темы\n\n### Коммуникация\n\n- Быстрые релизы/);
  assert.match(
    md,
    /## План действий\n\n- \[ \] Ревью за сутки — ответственный: Айгерим \(срок 2026-10-05\)/,
  );
  assert.ok(!md.includes('connector'), 'связи в итоги не попадают');
  const three = exportMarkdown(meeting('three'));
  assert.match(three, /## Продолжать делать/);
  assert.match(
    three,
    /## Что было сложно/,
    'карточки зоны, которой нет в формате, не теряются',
  );
});

test('CSV: русский тип, название зоны и тема', () => {
  const rows = exportCsvRows(meeting('three'));
  assert.deepEqual(rows[0].slice(0, 3), ['Текст', 'Зона', 'Тип']);
  const good = rows.find((r) => r[0] === 'Быстрые релизы');
  assert.equal(good[1], 'Продолжать делать');
  assert.equal(good[2], 'Стикер');
  assert.equal(good[6], '1');
  assert.equal(good[8], 'Коммуникация');
  assert.equal(rows.find((r) => r[0] === 'Старая задача')[2], 'Действие');
  assert.ok(!rows.some((r) => r[2] === 'Связь'));
  const csv = toCsv([['a"b', 'c']]);
  assert.equal(csv, '﻿"a""b","c"');
});

test('Импорт CSV узнаёт зону по любой подписи', () => {
  assert.equal(zoneFromLabel('Продолжать делать'), 'good');
  assert.equal(zoneFromLabel('Что было сложно'), 'bad');
  assert.equal(zoneFromLabel('stop'), 'stop');
  assert.equal(zoneFromLabel(' Начать делать '), 'start');
  assert.equal(zoneFromLabel('что-то'), 'good');
  assert.equal(zoneFromLabel(undefined), 'good');
});

const facts = {
  browserOnline: true,
  socketOpen: true,
  socketEverOpened: true,
  networkFailures: 0,
  unsentWrite: false,
  slowWrite: false,
};

test('Статус связи: сохранено, сохраняем, переподключаемся, офлайн', () => {
  assert.equal(connectionStatus(facts), 'saved');
  assert.equal(connectionStatus({ ...facts, slowWrite: true }), 'saving');
  assert.equal(connectionStatus({ ...facts, socketOpen: false }), 'reconnecting');
  assert.equal(
    connectionStatus({ ...facts, socketOpen: false, socketEverOpened: false }),
    'saved',
    'без Durable Object сокета нет вовсе — это не обрыв',
  );
  assert.equal(connectionStatus({ ...facts, networkFailures: 1 }), 'reconnecting');
  assert.equal(connectionStatus({ ...facts, networkFailures: 2 }), 'offline');
  assert.equal(connectionStatus({ ...facts, unsentWrite: true }), 'offline');
  assert.equal(
    connectionStatus({ ...facts, browserOnline: false, slowWrite: true }),
    'offline',
  );
  assert.equal(
    connectionStatus({ ...facts, socketOpen: false, slowWrite: true }),
    'reconnecting',
    'обрыв важнее медленной записи',
  );
});

test('Ошибка сети отличается от отказа по правилам комнаты', () => {
  assert.ok(isNetworkError('Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.'));
  assert.ok(isNetworkError('Сервер не ответил вовремя. Проверьте подключение и попробуйте ещё раз.'));
  assert.ok(isNetworkError('Сервер временно недоступен. Попробуйте через минуту.'));
  assert.ok(!isNetworkError('Доступно только ведущему'));
  assert.ok(!isNetworkError(''));
});

const phase = {
  phase: 0,
  host: true,
  archived: false,
  online: 5,
  total: 8,
  privateWriting: false,
  voting: false,
  votesLeft: 0,
  voteLimit: 0,
  nextVoteLimit: 5,
  groups: 0,
  actions: 0,
};

test('Этапы ведут ведущего: подсказка и главная кнопка', () => {
  const intro = phaseGuide(phase);
  assert.match(intro.hint, /5 из 8 в сети/);
  assert.deepEqual(intro.action, { id: 'phase', phase: 1, label: 'Начать сбор идей' });
  const vote = phaseGuide({ ...phase, phase: 3 });
  assert.equal(vote.action.id, 'vote.start');
  assert.equal(vote.action.label, 'Начать голосование');
  const voting = phaseGuide({ ...phase, phase: 3, voting: true, votesLeft: 2, voteLimit: 5 });
  assert.equal(voting.action.id, 'vote.end', 'идущий раунд не запускается повторно');
  assert.match(voting.hint, /2 из 5/);
  const results = phaseGuide({ ...phase, phase: 5 });
  assert.deepEqual(results.action, { id: 'open.results', label: 'Открыть итоги' });
  const done = phaseGuide({ ...phase, phase: 2, archived: true });
  assert.equal(done.action.id, 'open.results');
  // Кнопка «дальше» есть на каждом этапе.
  for (let p = 0; p < 6; p++) assert.ok(phaseGuide({ ...phase, phase: p }).action);
});

test('Участник видит, что происходит, но не двигает встречу', () => {
  const guest = { ...phase, host: false };
  assert.match(phaseGuide(guest).hint, /Ведущий скоро начнёт сбор идей/);
  assert.equal(phaseGuide(guest).action, undefined);
  const waiting = phaseGuide({ ...guest, phase: 3 });
  assert.match(waiting.hint, /Ждём, когда ведущий начнёт раунд/);
  assert.equal(waiting.action, undefined);
  const voting = phaseGuide({ ...guest, phase: 3, voting: true, votesLeft: 3, voteLimit: 5 });
  assert.equal(voting.action.id, 'open.vote');
  for (let p = 0; p < 6; p++) {
    const g = phaseGuide({ ...guest, phase: p, voting: p === 3 });
    for (const a of [g.action, g.secondary].filter(Boolean))
      assert.ok(a.id.startsWith('open.'), 'участнику — только открыть панель');
  }
});

console.log(`${passed} passed`);
