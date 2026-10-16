import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, initialState } from '../lib/model.ts';
import {
  fireEffect,
  memberFromRow,
  newMatch,
  resolveCombat,
  roomFromState,
  stepBots,
  syncBots,
} from '../lib/room-hub-core.ts';
import {
  defaultMapFor,
  mapFitsMode,
  mapsForMode,
  modeOf,
  modeOfMap,
} from '../lib/maps/catalog.ts';
import { newImpostorGame } from '../lib/impostor.ts';
import { newSurvivalGame } from '../lib/survival.ts';
import { getMap } from '../lib/maps/index.ts';

const T = 1_000_000;
const set = (s, patch) =>
  applyOperation(s, { type: 'room.settings', patch }, 'host', 'host');

test('«Зона заражения» — родная для «Выживания» и открыта для боя', () => {
  assert.equal(
    modeOfMap('outbreak'),
    'survival',
    'старая комната без режима — это выживание',
  );
  assert.equal(defaultMapFor('survival'), 'outbreak');
  assert.ok(mapsForMode('battle').some((m) => m.id === 'outbreak'));
  // Своя карта боя остаётся первой: смена режима не уводит комнату на огромную карту.
  assert.equal(defaultMapFor('battle'), 'mansion');
  assert.ok(
    mapFitsMode('outbreak', 'battle') && mapFitsMode('outbreak', 'survival'),
  );
  assert.ok(
    !mapFitsMode('outbreak', 'retro') && !mapFitsMode('outbreak', 'impostor'),
  );
  assert.ok(!mapFitsMode('mansion', 'survival'));
  assert.ok(mapFitsMode('unknown', 'retro'), 'неизвестная карта — как хаб');
});

test('ведущий ставит «Зону заражения» в командный бой и в «Каждый за себя»', () => {
  let s = set(initialState('Бой'), { mode: 'battle' });
  s = set(s, { map: 'outbreak' });
  assert.deepEqual([modeOf(s), s.map], ['battle', 'outbreak']);
  assert.equal(roomFromState('host', s).teams, true, 'командный бой');
  s = set(s, { freeForAll: true });
  assert.equal(
    roomFromState('host', s).teams,
    false,
    '«Каждый за себя» — без команд',
  );
  assert.equal(s.map, 'outbreak');
  // Из боя в «Выживание» — та же карта, переезжать не нужно.
  s = set(s, { mode: 'survival' });
  assert.deepEqual([modeOf(s), s.map], ['survival', 'outbreak']);
  // Назад в бой — карта тоже подходит и остаётся.
  s = set(s, { mode: 'battle' });
  assert.deepEqual([modeOf(s), s.map], ['battle', 'outbreak']);
  // В ретро и в «Предателе» её нет.
  assert.throws(
    () => set(s, { mode: 'impostor', map: 'outbreak' }),
    /не для выбранного режима/,
  );
  s = set(s, { mode: 'retro' });
  assert.equal(s.map, 'hub');
});

/** Бой на «Зоне заражения»: ведущий в сети и два бота. */
function battleHub(freeForAll) {
  let s = set(initialState('Бой'), {
    mode: 'battle',
    map: 'outbreak',
    ...(freeForAll ? { freeForAll: true } : {}),
  });
  s = applyOperation(
    s,
    { type: 'bots.add', level: 'strong', count: 2 },
    'host',
    'host',
  );
  const room = { ...roomFromState('host', s), shieldSeconds: 0 };
  const human = memberFromRow({ session: 'host', name: 'Ведущий', seen: T });
  const hub = {
    room,
    members: new Map([['host', human]]),
    effects: [],
    seq: 0,
    match: newMatch(room, T),
    impostor: newImpostorGame(),
    survival: newSurvivalGame(),
  };
  syncBots(hub, T);
  return { hub, human };
}

for (const ffa of [false, true])
  test(`боты на «Зоне заражения» в ${ffa ? '«Каждый за себя»' : 'командном бою'} ходят по карте, а не стерегут лагерь`, () => {
    const { hub, human } = battleHub(ffa);
    const map = getMap('outbreak');
    // Человек вдали от всех, чтобы боты патрулировали, а не дрались с ним.
    human.pose = {
      ...human.pose,
      x: 900,
      z: -900,
      y: map.groundHeight(900, -900, 500),
    };
    const bots = [...hub.members.values()].filter((m) => m.id !== 'host');
    assert.equal(bots.length, 2);
    for (const b of bots)
      assert.equal(b.team ? 'team' : 'none', ffa ? 'none' : 'team');
    const start = new Map(
      bots.map((b) => [b.id, { x: b.pose.x, z: b.pose.z }]),
    );
    const brains = new Map();
    let now = T;
    for (let i = 0; i < 200; i++) {
      now += 100;
      human.seen = now;
      stepBots(hub, brains, now);
      resolveCombat(hub, now);
    }
    const camp = { x: -120, z: 30 };
    for (const b of bots) {
      const s = start.get(b.id);
      assert.ok(
        Math.hypot(b.pose.x - s.x, b.pose.z - s.z) > 15,
        `${b.name} сдвинулся за 20 с`,
      );
      // В выживании они шли бы к лагерю; в бою база — просто место на карте.
      const toCamp = (p) => Math.hypot(p.x - camp.x, p.z - camp.z);
      assert.ok(
        toCamp(b.pose) > 25 || toCamp(s) <= 25,
        `${b.name} не уходит стеречь лагерь`,
      );
    }
  });

test('выстрел на краю огромной карты принимается сервером', () => {
  const { hub, human } = battleHub(false);
  const map = getMap('outbreak');
  human.pose = {
    ...human.pose,
    x: 860,
    z: 30,
    y: map.groundHeight(860, 30, 500),
  };
  const origin = [human.pose.x, human.pose.y + 1.5, human.pose.z];
  const r = fireEffect(
    hub,
    'host',
    {
      kind: 'paint',
      origin,
      target: [origin[0], origin[1], origin[2] - 20],
      normal: [0, 1, 0],
      color: '#ff0000',
    },
    T + 1000,
  );
  assert.equal(r.ok, true, 'координаты за 200 м от центра — законные');
});
