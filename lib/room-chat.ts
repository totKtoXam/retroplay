// Текстовый чат комнаты: общий канал и командный. Чистые функции над HubState, как и
// lib/room-hub-core.ts; рассылает сообщения объект комнаты (worker/room-hub.ts).
//
// Кто что читает, решает сервер в момент отправки: получатели записываются в само сообщение.
// Так история, которую получает переподключившийся игрок, не выдаёт ничего лишнего — например,
// переписку предателей или разговоры призраков.
//
// В «Предателе» чат подчиняется тем же правилам, что голос: живые говорят только на собраниях,
// призраки — только между собой. Командный канал там есть только у предателей: у экипажа нет
// общей тайны, а предателям нужно договориться незаметно для остальных.
import { uid } from './model.ts';
import { isBotId } from './bot-levels.ts';
import { gameActive, isGhost } from './impostor.ts';
import type { HubState } from './room-hub-core.ts';

export type ChatChannel = 'all' | 'team';
export type ChatMessage = {
  id: string;
  from: string;
  name: string;
  color: string;
  channel: ChatChannel;
  text: string;
  at: number;
  /** Пишет серверный бот. */
  bot?: boolean;
  /** Пишет призрак «Предателя»: читают только призраки. */
  ghost?: boolean;
};
/** Сообщение с получателями; `null` — читают все, в том числе пришедшие позже. */
export type ChatEntry = { message: ChatMessage; to: Set<string> | null };
export type ChatResult = { ok: true; entry: ChatEntry } | { ok: false; error: string };

export const CHAT_MAX_LENGTH = 200;
/** Столько последних сообщений комната помнит для тех, кто переподключился. */
export const CHAT_HISTORY = 60;
/** Не больше RATE_COUNT сообщений за RATE_MS от одного участника: чат не для флуда. */
const RATE_MS = 5000;
const RATE_COUNT = 5;

/** Невидимые и управляющие символы: ими прячут текст и переворачивают строку. */
// oxlint-disable-next-line no-control-regex -- управляющие символы здесь и вырезаем.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** Текст сообщения: одна строка без служебных символов, не длиннее предела. '' — нечего отправлять. */
export function cleanChatText(raw: unknown) {
  if (typeof raw !== 'string') return '';
  const text = raw.replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim();
  // Обрезаем по символам, а не по UTF-16: эмодзи не должен рваться пополам.
  return Array.from(text).slice(0, CHAT_MAX_LENGTH).join('').trim();
}

type Audience =
  | { ok: true; channel: ChatChannel; public: boolean; hears: (id: string) => boolean; ghost?: boolean }
  | { ok: false; error: string };

/** Кто прочтёт сообщение `from` в канале `channel`. */
export function chatAudience(state: HubState, from: string, channel: ChatChannel): Audience {
  const g = state.impostor;
  if (state.room.mode === 'impostor' && gameActive(g)) {
    if (isGhost(g, from)) return { ok: true, channel, public: false, hears: (id) => isGhost(g, id), ghost: true };
    if (channel === 'team') {
      if (g.players[from]?.role !== 'impostor') return { ok: false, error: 'Командный канал есть только у предателей' };
      // Погибший предатель — уже призрак и живым союзникам не пишет и их не читает.
      return { ok: true, channel, public: false, hears: (id) => g.players[id]?.role === 'impostor' && !isGhost(g, id) };
    }
    if (g.phase !== 'meeting' && g.phase !== 'voting' && g.phase !== 'eject')
      return { ok: false, error: 'Живые говорят только на собраниях' };
    return { ok: true, channel, public: true, hears: () => true };
  }
  const team = state.members.get(from)?.team;
  if (channel === 'team' && state.room.teams && team)
    return { ok: true, channel, public: false, hears: (id) => state.members.get(id)?.team === team };
  // Без команд (хаб, ретро, лобби «Предателя») командный канал — это просто общий.
  return { ok: true, channel: 'all', public: true, hears: () => true };
}

/** Участник отправил сообщение. Бот пишет через ту же функцию, что и человек. */
export function postChat(state: HubState, from: string, op: { channel?: unknown; text?: unknown }, now: number): ChatResult {
  if (state.room.archived) return { ok: false, error: 'Встреча завершена' };
  const m = state.members.get(from);
  if (!m) return { ok: false, error: 'Сначала войдите в комнату' };
  const text = cleanChatText(op.text);
  if (!text) return { ok: false, error: 'Пустое сообщение' };
  const times = (m.chatTimes ?? []).filter((t) => t > now - RATE_MS);
  if (times.length >= RATE_COUNT) return { ok: false, error: 'Слишком часто — подождите пару секунд' };
  const audience = chatAudience(state, from, op.channel === 'team' ? 'team' : 'all');
  if (!audience.ok) return audience;
  m.chatTimes = [...times, now];
  const to = audience.public
    ? null
    : new Set([...state.members.keys()].filter((id) => id === from || audience.hears(id)));
  const message: ChatMessage = {
    id: uid(),
    from,
    name: state.room.anonymous ? 'Участник' : m.name || 'Игрок',
    color: m.color,
    channel: audience.channel,
    text,
    at: now,
    ...(isBotId(from) ? { bot: true } : {}),
    ...(audience.ghost ? { ghost: true } : {}),
  };
  const entry: ChatEntry = { message, to };
  state.chat = [...(state.chat ?? []), entry].slice(-CHAT_HISTORY);
  return { ok: true, entry };
}

export const readsChat = (entry: ChatEntry, id: string) => !entry.to || entry.to.has(id);

/** История, которую можно показать участнику `viewer`. */
export function chatFor(state: HubState, viewer: string): ChatMessage[] {
  return (state.chat ?? []).filter((e) => readsChat(e, viewer)).map((e) => e.message);
}
