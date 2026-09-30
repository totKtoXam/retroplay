import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLY_MARK,
  ENEMY_MARK,
  TEAM_IDS,
  TEAM_LOOKS,
  TEAM_NEUTRAL,
  isTeam,
  teamCss,
  teamHex,
  teamLook,
  teamName,
} from '../lib/team-colors.ts';
import { monitorGroups } from '../lib/model.ts';

test('Команда red показывается оранжевой, blue — синей', () => {
  assert.equal(teamName('red'), 'Оранжевые');
  assert.equal(teamName('blue'), 'Синие');
  // Совпадает с --team-orange / --team-blue из app/tokens.css.
  assert.equal(teamCss('red'), '#ff9a1f');
  assert.equal(teamCss('blue'), '#4d9dff');
  assert.equal(teamLook('red').genitive, 'оранжевых');
  assert.equal(teamLook('blue').genitive, 'синих');
});

test('Цвет для 3D-материалов — то же значение, что и CSS', () => {
  for (const team of TEAM_IDS) {
    const look = TEAM_LOOKS[team];
    assert.equal(teamHex(team), look.hex);
    assert.equal(`#${look.hex.toString(16).padStart(6, '0')}`, look.css);
  }
  assert.equal(`#${TEAM_NEUTRAL.hex.toString(16).padStart(6, '0')}`, TEAM_NEUTRAL.css);
});

test('Все цвета — #rrggbb, команды различаются между собой и с нейтральным', () => {
  const hex = /^#[0-9a-f]{6}$/;
  for (const look of [...Object.values(TEAM_LOOKS), TEAM_NEUTRAL]) {
    assert.match(look.css, hex);
    assert.match(look.text, hex);
  }
  const all = new Set([teamCss('red'), teamCss('blue'), TEAM_NEUTRAL.css]);
  assert.equal(all.size, 3);
});

test('Неизвестная или пустая команда — нейтральный цвет и «Без команды»', () => {
  for (const team of ['', undefined, null, 'green', 'RED', 'none']) {
    assert.equal(isTeam(team), false);
    assert.equal(teamCss(team), TEAM_NEUTRAL.css);
    assert.equal(teamHex(team), TEAM_NEUTRAL.hex);
    assert.equal(teamName(team), 'Без команды');
  }
  assert.equal(isTeam('red'), true);
  assert.equal(isTeam('blue'), true);
});

test('Табло подписывает стороны теми же названиями', () => {
  const groups = monitorGroups(
    [
      { team: 'red', kills: 1 },
      { team: 'blue', kills: 2 },
    ],
    true,
  );
  assert.deepEqual(
    groups.map((g) => [g.team, g.label]),
    [
      ['red', 'Оранжевые'],
      ['blue', 'Синие'],
    ],
  );
});

test('Свой и чужой различаются формой знака, а не только цветом', () => {
  assert.notEqual(ALLY_MARK, ENEMY_MARK);
});
