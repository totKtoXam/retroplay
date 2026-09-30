import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowStep, columnTarget, judgeSwipe, nextEnabled } from '../lib/impostor-task-keys.ts';

test('arrowStep: стрелки двигают на малый шаг, Shift и PageUp/PageDown — на крупный', () => {
  assert.equal(arrowStep('ArrowRight', false, 1, 5), 1);
  assert.equal(arrowStep('ArrowLeft', false, 1, 5), -1);
  assert.equal(arrowStep('ArrowUp', true, 1, 5), 5);
  assert.equal(arrowStep('ArrowDown', true, 1, 5), -5);
  assert.equal(arrowStep('PageUp', false, 1, 5), 5);
  assert.equal(arrowStep('PageDown', false, 1, 5), -5);
  assert.equal(arrowStep('Enter', false, 1, 5), null);
});

test('arrowStep: турель не ездит вертикальными стрелками', () => {
  assert.equal(arrowStep('ArrowUp', false, 4, 12, false), null);
  assert.equal(arrowStep('ArrowDown', false, 4, 12, false), null);
  assert.equal(arrowStep('ArrowRight', true, 4, 12, false), 12);
});

test('judgeSwipe: одна проверка на мышь и клавиатуру', () => {
  assert.equal(judgeSwipe(150, 500, 210, 260, 900), 'short');
  assert.equal(judgeSwipe(210, 200, 210, 260, 900), 'fast');
  assert.equal(judgeSwipe(210, 1000, 210, 260, 900), 'slow');
  assert.equal(judgeSwipe(200, 500, 210, 260, 900), 'ok');
});

test('judgeSwipe: скорости клавиатуры и кнопки «Провести карту» попадают в окно', () => {
  // Кнопка: весь путь за 600 мс; клавиатура: 92 % пути за ~515 мс из 560.
  assert.equal(judgeSwipe(210, 600, 210, 260, 900), 'ok');
  assert.equal(judgeSwipe(210 * (520 / 560), 520, 210, 260, 900), 'ok');
  assert.equal(judgeSwipe(210 * (400 / 560), 400, 210, 260, 900), 'short');
});

test('nextEnabled: по кругу, пропуская выключенные', () => {
  const on = [true, false, true, false];
  assert.equal(nextEnabled(on, 0, 1), 2);
  assert.equal(nextEnabled(on, 2, 1), 0);
  assert.equal(nextEnabled(on, 0, -1), 2);
  assert.equal(nextEnabled(on, -1, 1), 0);
  assert.equal(nextEnabled([false, true], 1, 1), 1, 'сам элемент — последним');
  assert.equal(nextEnabled([false, false], 0, 1), -1);
});

test('columnTarget: выстрел вверх попадает в ближайший к турели астероид над прицелом', () => {
  const rocks = [
    { left: 10, right: 40, top: 20, bottom: 50 },
    { left: 20, right: 50, top: 80, bottom: 110 },
    { left: 100, right: 130, top: 120, bottom: 150 },
    { left: 20, right: 50, top: -30, bottom: -2 },
  ];
  assert.equal(columnTarget(rocks, 30, 0, 4), 1);
  assert.equal(columnTarget(rocks, 12, 0, 4), 0);
  assert.equal(columnTarget(rocks, 98, 0, 4), 2, 'с запасом по краю');
  assert.equal(columnTarget(rocks, 70, 0, 4), -1, 'промах');
  assert.equal(columnTarget([rocks[3]], 30, 0, 4), -1, 'ещё не влетел в поле');
});
