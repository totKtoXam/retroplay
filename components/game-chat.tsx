'use client';

// Текстовый чат поверх мира: общий канал и командный. Enter или кнопка «Чат» открывает
// строку ввода (курсор освобождается, мир перестаёт слушать клавиши), Enter отправляет, Tab
// меняет канал, Esc закрывает. Закрытый чат показывает свежие сообщения несколько секунд и
// гасит их, а на кнопке висит счётчик непрочитанных.
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { MessageCircle, SendHorizontal, X } from 'lucide-react';
import type { ChatChannel, ChatMessage } from '@/lib/room-chat';
import { CHAT_MAX_LENGTH } from '@/lib/room-chat';

/** Столько живёт сообщение на экране, пока чат закрыт. */
const FADE_MS = 12_000;

/**
 * Что лежит у нижнего края поверх сцены или доски. Чат встаёт над тем, что
 * оказалось под ним по горизонтали: набор зависит от режима и ширины экрана,
 * поэтому место меряется, а не задаётся константой на каждый брейкпоинт.
 */
const OBSTACLES = [
  '.quick-loadout',
  '.combat-stats-hud',
  '.equipped-card',
  '.hud-ammo',
  '.hud-minimap',
  '.reveal-button',
  '.mobile-world',
  '.room-board-fallback .zoom-controls',
].join(',');
/** Зазор между чатом и тем, над чем он встал. */
const GAP = 8;
/** Высота шапки комнаты: выше этой черты список сообщений не растёт. */
const HEADER = 48;

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
  /**
   * Enter в любом месте открывает чат. На 2D-доске без 3D выключить: там Enter
   * нажимает кнопки и карточки, а чат открывается кнопкой.
   */
  hotkey?: boolean;
};

const isTextField = (el: EventTarget | null) =>
  !!(el as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable=true]');

export default function GameChat({
  messages,
  self,
  open,
  onOpen,
  send,
  error,
  clearError,
  teamLabel,
  allBlocked,
  disabled,
  hotkey = true,
}: Props) {
  const [text, setText] = useState('');
  const [channel, setChannel] = useState<ChatChannel>('all');
  const [now, setNow] = useState(() => Date.now());
  /** Сообщение не ушло: сокет закрыт. Текст остаётся в строке, чтобы не набирать заново. */
  const [offline, setOffline] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const root = useRef<HTMLDivElement>(null);
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
    if (!hotkey) return;
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
  }, [onOpen, hotkey]);

  // Место чата: над нижними кнопками HUD или доски и над экранной клавиатурой.
  // Пишем переменные CSS прямо на элемент, как useLoadoutAnchor в world-hud.tsx:
  // замер идёт по таймеру и событиям окна, лишние ре-рендеры ему не нужны.
  useEffect(() => {
    const el = root.current;
    const host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return;
    const place = () => {
      const box = host.getBoundingClientRect();
      const left = box.left + el.offsetLeft;
      const right = left + el.offsetWidth;
      let lift = 0;
      for (const item of host.querySelectorAll<HTMLElement>(OBSTACLES)) {
        const r = item.getBoundingClientRect();
        if (!r.width || !r.height || r.right <= left || r.left >= right) continue;
        // Только то, что у нижнего края: верхние панели чату не мешают.
        if (r.top < box.top + box.height * 0.45) continue;
        lift = Math.max(lift, box.bottom - r.top + GAP);
      }
      lift = Math.min(lift, box.height * 0.55);
      // Экранная клавиатура сжимает только visualViewport: низ окна уходит под неё.
      const vv = window.visualViewport;
      const visibleBottom = vv && Math.abs(vv.scale - 1) < 0.01 ? vv.offsetTop + vv.height : box.bottom;
      const keyboard = Math.max(0, box.bottom - visibleBottom);
      const bottom = Math.max(lift, keyboard + GAP);
      const top = Math.max(box.top + HEADER, vv ? vv.offsetTop : 0);
      // Строке ввода и ошибке — около 90px, остальное может занять список.
      const room = Math.max(60, box.bottom - bottom - top - 90);
      el.style.setProperty('--chat-lift', `${Math.round(lift)}px`);
      el.style.setProperty('--chat-keyboard', `${Math.round(keyboard)}px`);
      el.style.setProperty('--chat-room', `${Math.round(room)}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(host);
    // Кнопки внизу появляются и пропадают с режимом и этапом — сверяемся раз в секунду.
    const timer = setInterval(place, 1000);
    const vv = window.visualViewport;
    window.addEventListener('resize', place);
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    return () => {
      observer.disconnect();
      clearInterval(timer);
      window.removeEventListener('resize', place);
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    clearError();
  }, [open, clearError]);

  // Часы для угасания сообщений закрытого чата.
  const newest = messages[messages.length - 1]?.at ?? 0;
  // Непрочитанные — чужие сообщения после последнего открытия чата. История,
  // пришедшая при входе, старше момента входа и в счётчик не попадает.
  const [seenAt, setSeenAt] = useState(() => Date.now());
  if (open && newest > seenAt) setSeenAt(newest);
  const unread = open ? 0 : messages.filter((m) => m.at > seenAt && m.from !== self).length;
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

  /** Открыть кнопкой. Фокус ставим в том же касании: иначе iOS не покажет клавиатуру. */
  const openByButton = () => {
    setOffline(false);
    flushSync(() => onOpen(true));
    input.current?.focus();
  };

  const shown = open ? messages.slice(-40) : messages.filter((m) => now - m.at < FADE_MS).slice(-6);
  const tag = (m: ChatMessage) => (m.ghost ? 'призраки' : m.channel === 'team' ? (teamLabel ?? 'команде') : '');

  return (
    <div ref={root} className={`game-chat${open ? ' is-open' : ''}`}>
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
            // Касание кнопки не уводит фокус из строки: иначе чат закроется раньше клика.
            onMouseDown={(e) => e.preventDefault()}
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
          <button
            type="submit"
            className="game-chat-icon"
            aria-label="Отправить"
            title="Отправить · Enter"
            disabled={!text.trim() || !!blocked}
            onMouseDown={(e) => e.preventDefault()}
          >
            <SendHorizontal size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="game-chat-icon"
            aria-label="Закрыть чат"
            title="Закрыть · Esc"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => close(false)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </form>
      )}
      {!open && (
        <button
          type="button"
          className="game-chat-toggle"
          aria-label={unread ? `Чат, непрочитанных: ${unread}` : 'Чат'}
          title={hotkey ? 'Чат · Enter' : 'Чат'}
          disabled={disabled}
          onClick={openByButton}
        >
          <MessageCircle size={16} aria-hidden="true" />
          <span>Чат</span>
          {unread > 0 && (
            <span className="game-chat-badge" aria-hidden="true">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}
      {open && (error || blocked || offline) && (
        <p className="game-chat-error">{error || blocked || 'Нет связи с комнатой — сообщение не ушло'}</p>
      )}
    </div>
  );
}
