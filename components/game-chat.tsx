'use client';

// Текстовый чат поверх мира: общий канал и командный. Enter открывает строку ввода (курсор
// освобождается, мир перестаёт слушать клавиши), Enter отправляет, Tab меняет канал, Esc
// закрывает. Закрытый чат показывает свежие сообщения несколько секунд и гасит их.
import { useEffect, useRef, useState } from 'react';
import type { ChatChannel, ChatMessage } from '@/lib/room-chat';
import { CHAT_MAX_LENGTH } from '@/lib/room-chat';

/** Столько живёт сообщение на экране, пока чат закрыт. */
const FADE_MS = 12_000;

type Props = {
  messages: ChatMessage[];
  self: string;
  open: boolean;
  /** `resume` — вернуть захват мыши: игрок закрыл чат клавишей, а не ушёл в меню. */
  onOpen: (open: boolean, resume?: boolean) => void;
  send: (channel: ChatChannel, text: string) => boolean;
  error: string;
  clearError: () => void;
  /** Подпись командного канала; null — в этой комнате его нет. */
  teamLabel: string | null;
  /** Почему писать в общий канал сейчас нельзя (например, живым вне собрания). */
  allBlocked: string;
  /** Ввод с клавиатуры занят другим окном (карточка, настройки): Enter чату не принадлежит. */
  disabled: boolean;
};

const isTextField = (el: EventTarget | null) =>
  !!(el as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable=true]');

export default function GameChat({ messages, self, open, onOpen, send, error, clearError, teamLabel, allBlocked, disabled }: Props) {
  const [text, setText] = useState('');
  const [channel, setChannel] = useState<ChatChannel>('all');
  const [now, setNow] = useState(() => Date.now());
  /** Сообщение не ушло: сокет закрыт. Текст остаётся в строке, чтобы не набирать заново. */
  const [offline, setOffline] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const state = useRef({ open, disabled });
  useEffect(() => {
    state.current = { open, disabled };
  });

  // Командного канала нет (или его отняли) — пишем в общий. Общий закрыт, а свой есть — в свой.
  const current: ChatChannel = channel === 'team' && teamLabel ? 'team' : allBlocked && teamLabel ? 'team' : 'all';
  const blocked = current === 'all' ? allBlocked : '';

  // Enter в игре открывает чат. Слушаем раньше мира и оверлеев, чтобы Enter не нажал
  // кнопку, на которой остался фокус (например, голос на собрании).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (state.current.open || state.current.disabled || isTextField(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOffline(false);
      onOpen(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onOpen]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    clearError();
  }, [open, clearError]);

  // Часы для угасания сообщений закрытого чата.
  const newest = messages[messages.length - 1]?.at ?? 0;
  useEffect(() => {
    if (open || Date.now() - newest > FADE_MS) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, newest]);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, open]);

  const close = (resume: boolean) => {
    setText('');
    onOpen(false, resume);
  };
  const submit = () => {
    const value = text.trim();
    if (!value) return close(true);
    if (blocked) return;
    if (send(current, value)) close(true);
    else setOffline(true);
  };

  const shown = open ? messages.slice(-40) : messages.filter((m) => now - m.at < FADE_MS).slice(-6);
  const tag = (m: ChatMessage) => (m.ghost ? 'призраки' : m.channel === 'team' ? (teamLabel ?? 'команде') : '');

  if (!open && !shown.length) return null;
  return (
    <div className={`game-chat${open ? ' is-open' : ''}`}>
      {shown.length > 0 && (
        <ol ref={list} className="game-chat-list" aria-live="polite">
          {shown.map((m) => (
            <li key={m.id} className={m.channel === 'team' || m.ghost ? 'is-private' : ''}>
              {tag(m) && <span className="game-chat-tag">[{tag(m)}]</span>}
              <b style={{ color: m.color }}>{m.from === self ? 'Вы' : m.name}:</b> {m.text}
            </li>
          ))}
        </ol>
      )}
      {open && (
        <form
          className="game-chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <button
            type="button"
            className={`game-chat-channel${current === 'team' ? ' is-team' : ''}`}
            disabled={!teamLabel}
            title={teamLabel ? 'Сменить канал · Tab' : 'Командного канала здесь нет'}
            onClick={() => {
              setChannel(current === 'team' ? 'all' : 'team');
              input.current?.focus();
            }}
          >
            {current === 'team' ? teamLabel : 'Всем'}
          </button>
          <input
            ref={input}
            value={text}
            maxLength={CHAT_MAX_LENGTH}
            placeholder={blocked || 'Сообщение · Enter — отправить, Esc — закрыть'}
            aria-label="Сообщение в чат"
            onChange={(e) => {
              setText(e.target.value);
              setOffline(false);
            }}
            onBlur={(e) => {
              // Ушли кликом в мир или в меню — чат закрывается, текст остаётся до следующего раза.
              if (!e.currentTarget.form?.contains(e.relatedTarget as Node | null)) onOpen(false);
            }}
            onKeyDown={(e) => {
              // Клавиши чата не должны дойти до мира: Esc там ставит паузу, буквы — ходят.
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                close(true);
              } else if (e.key === 'Tab') {
                e.preventDefault();
                if (teamLabel) setChannel(current === 'team' ? 'all' : 'team');
              }
            }}
          />
        </form>
      )}
      {open && (error || blocked || offline) && (
        <p className="game-chat-error">{error || blocked || 'Нет связи с комнатой — сообщение не ушло'}</p>
      )}
    </div>
  );
}
