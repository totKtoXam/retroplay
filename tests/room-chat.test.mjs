import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impostorAction, memberFromRow, newMatch, roomFromState } from '../lib/room-hub-core.ts';
import { newImpostorGame } from '../lib/impostor.ts';
import { chatFor, cleanChatText, CHAT_MAX_LENGTH, postChat, readsChat } from '../lib/room-chat.ts';
import { applyOperation, initialState } from '../lib/model.ts';

const T = 1_000_000;

function hubFor(patch, ids = ['host', 'a', 'b', 'c']) {
  let state = initialState('Chat');
  if (patch) state = applyOperation(state, { type: 'room.settings', patch }, 'host', 'host');
  const room = roomFromState('host', state);
  const hub = { room, members: new Map(), effects: [], seq: 0, match: newMatch(room, T), impostor: newImpostorGame() };
  for (const id of ids) hub.members.set(id, memberFromRow({ session: id, name: id.toUpperCase(), seen: T }));
  return hub;
}

test('chat: text is one clean line of limited length', () => {
  assert.equal(cleanChatText('  привет\n\tвсем  '), 'привет всем');
  assert.equal(cleanChatText('a\u202eb\u200bc'), 'a b c');
  assert.equal(cleanChatText(42), '');
  assert.equal(cleanChatText('   '), '');
  const long = cleanChatText('😀'.repeat(500));
  assert.equal(Array.from(long).length, CHAT_MAX_LENGTH);
  assert.ok(!long.includes('\ufffd'), 'an emoji is never cut in half');
});

test('chat: a message in the hub reaches everyone, including later arrivals', () => {
  const hub = hubFor();
  const r = postChat(hub, 'a', { channel: 'all', text: 'Привет' }, T);
  assert.equal(r.ok, true);
  assert.equal(r.entry.to, null);
  assert.equal(r.entry.message.name, 'A');
  // Командного канала без команд нет: сообщение уходит всем.
  const team = postChat(hub, 'b', { channel: 'team', text: 'свои?' }, T);
  assert.equal(team.entry.message.channel, 'all');
  hub.members.set('late', memberFromRow({ session: 'late', name: 'Late', seen: T }));
  assert.equal(chatFor(hub, 'late').length, 2);
});

test('chat: the team channel in a battle is read only by the team', () => {
  const hub = hubFor();
  hub.room.teams = true;
  hub.members.get('host').team = 'red';
  hub.members.get('a').team = 'red';
  hub.members.get('b').team = 'blue';
  const r = postChat(hub, 'a', { channel: 'team', text: 'обходим слева' }, T);
  assert.equal(r.entry.message.channel, 'team');
  assert.ok(readsChat(r.entry, 'host'));
  assert.ok(readsChat(r.entry, 'a'));
  assert.ok(!readsChat(r.entry, 'b'));
  assert.deepEqual(chatFor(hub, 'b'), []);
});

test('chat: flood protection and archived rooms', () => {
  const hub = hubFor();
  for (let i = 0; i < 5; i++) assert.equal(postChat(hub, 'a', { text: `${i}` }, T + i).ok, true);
  assert.equal(postChat(hub, 'a', { text: 'ещё' }, T + 10).ok, false);
  assert.equal(postChat(hub, 'a', { text: 'потом' }, T + 6000).ok, true);
  assert.equal(postChat(hub, 'a', { text: '' }, T + 7000).ok, false);
  hub.room.archived = true;
  assert.equal(postChat(hub, 'b', { text: 'поздно' }, T).ok, false);
});

test('chat: impostor rules — silence while playing, meetings for all, ghosts and impostors apart', () => {
  const hub = hubFor({ mode: 'impostor' });
  assert.equal(impostorAction(hub, 'host', { action: 'start' }, T).ok, true);
  const g = hub.impostor;
  for (const p of Object.values(g.players)) p.role = p.id === 'a' || p.id === 'b' ? 'impostor' : 'crew';
  g.phase = 'play';
  // Живые во время игры молчат в общем канале, у экипажа своего канала нет.
  assert.equal(postChat(hub, 'host', { channel: 'all', text: 'эй' }, T).ok, false);
  assert.equal(postChat(hub, 'c', { channel: 'team', text: 'эй' }, T).ok, false);
  // Предатели переписываются между собой в любой фазе.
  const plot = postChat(hub, 'a', { channel: 'team', text: 'беру C' }, T);
  assert.equal(plot.ok, true);
  assert.deepEqual([...plot.entry.to].sort((x, y) => x.localeCompare(y)), ['a', 'b']);
  // Погибший пишет только призракам — в любом канале и в любой фазе.
  g.players.c.alive = false;
  const ghost = postChat(hub, 'c', { channel: 'all', text: 'это A!' }, T + 1);
  assert.equal(ghost.ok, true);
  assert.equal(ghost.entry.message.ghost, true);
  assert.deepEqual([...ghost.entry.to], ['c']);
  // На собрании живых читают все, включая призраков.
  g.phase = 'meeting';
  const talk = postChat(hub, 'host', { channel: 'all', text: 'кто где был?' }, T + 2);
  assert.equal(talk.ok, true);
  assert.ok(readsChat(talk.entry, 'c'));
  assert.ok(!chatFor(hub, 'host').some((m) => m.text === 'это A!'), 'the living never read ghosts');
  assert.ok(!chatFor(hub, 'host').some((m) => m.text === 'беру C'), 'the crew never reads impostors');
  assert.ok(chatFor(hub, 'b').some((m) => m.text === 'беру C'));
});

test('chat: names are hidden in anonymous rooms', () => {
  const hub = hubFor({ anonymousPlayers: true });
  assert.equal(postChat(hub, 'a', { text: 'кто я?' }, T).entry.message.name, 'Участник');
});
