// Палитры праздничных миров (lib/festive.ts): у каждой темы своя, у
// неизвестной — нейтральная, текст и данные читаются по WCAG 2.x.
import assert from 'node:assert/strict';
import test from 'node:test';
import { THEMES } from '../lib/model.ts';
import {
  NEUTRAL_PALETTE,
  SURFACES,
  confettiColors,
  contrast,
  festivePalette,
  festiveVars,
  luminance,
} from '../lib/festive.ts';

const HEX = /^#[0-9a-f]{6}$/i;
const FIELDS = ['bg', 'accent', 'pattern', 'ground', 'ink', 'strong'];

test('контраст по WCAG считается верно', () => {
  assert.equal(luminance('#000000'), 0);
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(contrast('#000', '#fff').toFixed(0), '21');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
  assert.equal(contrast('#fff', '#000'), contrast('#000', '#fff'));
});

test('у каждой темы из THEMES своя палитра', () => {
  const seen = new Set();
  for (const t of THEMES) {
    const p = festivePalette(t.id);
    assert.equal(p.id, t.id, `у «${t.name}» нет своей палитры`);
    for (const f of FIELDS) assert.match(p[f], HEX, `${t.id}.${f}`);
    seen.add(p.bg);
  }
  assert.equal(seen.size, THEMES.length, 'фоны миров не должны совпадать');
});

test('у неизвестной темы — нейтральная палитра', () => {
  for (const id of ['', 'unknown', undefined, null, '__proto__', 'toString'])
    assert.deepEqual(festivePalette(id), NEUTRAL_PALETTE);
});

for (const p of [...THEMES.map((t) => festivePalette(t.id)), NEUTRAL_PALETTE]) {
  test(`«${p.id}»: подпись поверх фона ≥ 4.5:1`, () => {
    const c = contrast(p.ink, p.bg);
    assert.ok(c >= 4.5, `ink на bg: ${c.toFixed(2)}`);
  });
  test(`«${p.id}»: полоски и акцент на поверхности ≥ 3:1 в обеих темах`, () => {
    for (const [name, surface] of Object.entries(SURFACES)) {
      const c = contrast(p.strong, surface);
      assert.ok(c >= 3, `strong на ${name}: ${c.toFixed(2)}`);
    }
  });
}

test('переменные и конфетти берутся из палитры', () => {
  const p = festivePalette('nauryz');
  const vars = festiveVars(p);
  assert.equal(vars['--festive-bg'], p.bg);
  assert.equal(vars['--color-festive'], p.strong);
  assert.ok(confettiColors(p).every((c) => HEX.test(c)));
});
