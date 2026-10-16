'use client';

// Интерфейс режима «Выживание» поверх 3D-мира: фаза партии (лобби, подготовка, волна,
// итог), полоса опыта с уровнем и панель навыков. Всё, что здесь видно, пришло в снимке
// партии (`room.survival`), а каждое действие (`start`, `stop`, `perk`) проверяет сервер:
// клиент только просит и рисует ответ.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Biohazard, Skull, Sparkles } from 'lucide-react';
import type { Room } from '@/lib/model';
import { plural } from '@/lib/plural';
import {
  DIFFICULTY,
  MAX_LEVEL,
  PERKS,
  PERK_IDS,
  xpForLevel,
} from '@/lib/survival';
import type { ImpostorReply } from './use-room-sync';
import { useDialogFocus } from './impostor-rules';

type Props = {
  room: Room;
  host: boolean;
  /** Серверное время сейчас: таймеры фаз приходят в серверных отметках. */
  serverNow: () => number;
  send: (action: Record<string, unknown>) => Promise<ImpostorReply>;
  /** Открыт экран, которому нужен курсор: мир не должен принимать ввод. */
  onBlocked: (blocked: boolean) => void;
};

const secondsLeft = (at: number, now: number) =>
  Math.max(0, Math.ceil((at - now) / 1000));
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const WAVES: [string, string, string] = ['волна', 'волны', 'волн'];

export default function SurvivalOverlay({
  room,
  host,
  serverNow,
  send,
  onBlocked,
}: Props) {
  const view = room.survival;
  const [now, setNow] = useState(() => serverNow());
  const [toast, setToast] = useState('');
  const [perksOpen, setPerksOpen] = useState(false);
  // Отсчёт идёт по серверным часам: `until` в снимке — серверная отметка.
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 200);
    return () => clearInterval(timer);
  }, [serverNow]);

  const flash = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? '' : t)), 2500);
  }, []);
  const run = useCallback(
    async (action: Record<string, unknown>) => {
      const reply = await send(action);
      if (!reply.ok && reply.error) flash(reply.error);
      return reply.ok;
    },
    [send, flash],
  );

  const phase = view?.phase ?? 'lobby';
  // Панель навыков и итог партии держат курсор: мир на это время не слушает ввод.
  const needsCursor = perksOpen || phase === 'ended';
  useEffect(() => {
    onBlocked(needsCursor);
    if (needsCursor && document.pointerLockElement) document.exitPointerLock();
  }, [needsCursor, onBlocked]);
  useEffect(() => () => onBlocked(false), [onBlocked]);

  // N — панель навыков в любой фазе: очки тратят между волнами, а описания читают и в
  // лобби. Перехватываем раньше мира, чтобы клавиша не ушла в движение, Esc при открытой
  // панели закрывает её, а не ставит паузу.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      )
        return;
      if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) setPerksOpen((open) => !open);
      } else if (e.code === 'Escape' && perksOpen) {
        e.stopImmediatePropagation();
        setPerksOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [perksOpen]);

  const perksDialog = useRef<HTMLDialogElement>(null);
  useDialogFocus(perksDialog, perksOpen);

  if (!view) return null;

  const me = view.players.find((p) => p.id === room.self);
  const level = me?.level ?? 1;
  const xp = me?.xp ?? 0;
  const points = me?.points ?? 0;
  const from = xpForLevel(level);
  const to = level >= MAX_LEVEL ? from : xpForLevel(level + 1);
  const share =
    to > from ? Math.min(1, Math.max(0, (xp - from) / (to - from))) : 1;
  const active = phase === 'prep' || phase === 'wave';
  const left = secondsLeft(view.until, now);
  const wavesLabel = view.waves > 0 ? ` из ${view.waves}` : '';
  const difficulty = DIFFICULTY[view.difficulty] ?? DIFFICULTY.normal;

  return (
    <div className="survival-layer">
      {/* ---- Фаза партии ---- */}
      <div className={`survival-top is-${phase}`}>
        {phase === 'lobby' && (
          <>
            <Biohazard size={18} aria-hidden="true" />
            <strong>Выживание</strong>
            <span className="survival-muted">
              {difficulty.label.toLowerCase()} ·{' '}
              {view.waves > 0 ? plural(view.waves, WAVES) : 'волны без конца'} ·{' '}
              {plural(view.players.length, ['игрок', 'игрока', 'игроков'])}
            </span>
            {host ? (
              <button
                type="button"
                className="primary"
                onClick={() => void run({ action: 'start' })}
              >
                Начать выживание
              </button>
            ) : (
              <span className="survival-muted">Ведущий ещё не начал</span>
            )}
          </>
        )}
        {phase === 'prep' && (
          <>
            <strong>
              Волна {view.wave + 1}
              {wavesLabel}
            </strong>
            <span className="survival-timer">через {left} с</span>
            <span className="survival-muted">
              Готовьтесь: перезарядите оружие и займите позицию
            </span>
          </>
        )}
        {phase === 'wave' && (
          <>
            <strong>
              Волна {view.wave}
              {wavesLabel}
            </strong>
            <span className="survival-stat">
              <Skull size={14} aria-hidden="true" />
              зомби осталось <b>{view.zombiesLeft}</b>
            </span>
            <span className="survival-stat">
              живых <b>{view.alive}</b>
            </span>
          </>
        )}
        {phase === 'ended' && (
          <>
            <strong>{view.result?.won ? 'База выстояла' : 'База пала'}</strong>
            <span className="survival-muted">лобби через {left} с</span>
          </>
        )}
      </div>
      {active && me && !me.alive && (
        <div className="survival-dead">
          <Skull size={14} aria-hidden="true" />
          Вы погибли — вернётесь в строй к следующей волне
        </div>
      )}

      {host && active && (
        <button
          type="button"
          className="survival-stop"
          onClick={() => void run({ action: 'stop' })}
        >
          Остановить
        </button>
      )}

      {/* ---- Опыт и уровень ---- */}
      <div
        className="survival-xp"
        title={
          level >= MAX_LEVEL
            ? 'Максимальный уровень'
            : `Опыт: ${xp} из ${to} до уровня ${level + 1}`
        }
      >
        <span className="survival-level" aria-label={`Уровень ${level}`}>
          {level}
        </span>
        <div className="survival-xp-body">
          <div className="survival-xp-bar" aria-hidden="true">
            <span style={{ width: `${share * 100}%` }} />
          </div>
          <progress
            className="sr-only"
            max={Math.max(1, to - from)}
            value={Math.round(share * Math.max(1, to - from))}
            aria-label={`Опыт до следующего уровня`}
          />
          <span className="survival-xp-label">
            {level >= MAX_LEVEL
              ? `Уровень ${level} · максимум`
              : `${xp - from} / ${to - from} до уровня ${level + 1}`}
            {me && me.kills > 0 && ` · убийств ${me.kills}`}
          </span>
        </div>
        <button
          type="button"
          className={`survival-perks-button${points > 0 ? ' has-points' : ''}`}
          onClick={() => setPerksOpen((open) => !open)}
          aria-expanded={perksOpen}
          title={
            points > 0
              ? `Очков навыков: ${points} — потратьте, N`
              : 'Навыки · N'
          }
        >
          <Sparkles size={14} aria-hidden="true" />
          {points > 0 ? `Очков навыков: ${points}` : 'Навыки'}
          <kbd>N</kbd>
        </button>
      </div>

      {/* ---- Панель навыков ---- */}
      {perksOpen && (
        <div className="survival-modal">
          <dialog
            open
            ref={perksDialog}
            className="survival-card"
            aria-modal="true"
            aria-label="Навыки"
            tabIndex={-1}
          >
            <header>
              <strong>Навыки</strong>
              <span
                className={`survival-points${points > 0 ? ' has-points' : ''}`}
              >
                {points > 0
                  ? `Свободных очков: ${points}`
                  : 'Свободных очков нет'}
              </span>
              <button
                type="button"
                className="survival-close"
                onClick={() => setPerksOpen(false)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </header>
            {!active && (
              <p className="survival-muted">
                Навыки берутся во время партии: каждый уровень даёт очко.
              </p>
            )}
            <ul className="survival-perks">
              {PERK_IDS.map((id) => {
                const rank = me?.perks[id] ?? 0;
                const max = PERKS[id].max;
                const can = active && points > 0 && rank < max;
                return (
                  <li
                    key={id}
                    className={
                      rank >= max ? 'is-max' : rank > 0 ? 'is-taken' : ''
                    }
                  >
                    <div>
                      <strong>{PERKS[id].label}</strong>
                      <span className="survival-muted">{PERKS[id].hint}</span>
                    </div>
                    <span
                      className="survival-rank"
                      aria-label={`Ранг ${rank} из ${max}`}
                    >
                      {Array.from({ length: max }, (_, i) => (
                        <i key={i} className={i < rank ? 'is-on' : ''} />
                      ))}
                    </span>
                    <button
                      type="button"
                      className="primary"
                      disabled={!can}
                      onClick={() => void run({ action: 'perk', perk: id })}
                    >
                      {rank >= max ? 'Максимум' : 'Взять'}
                    </button>
                  </li>
                );
              })}
            </ul>
            <footer>
              <span className="survival-muted">N или Esc — закрыть</span>
            </footer>
          </dialog>
        </div>
      )}

      {/* ---- Итог партии ---- */}
      {phase === 'ended' && view.result && (
        <div className="survival-modal">
          <div
            className={`survival-card survival-ended ${view.result.won ? 'is-won' : 'is-lost'}`}
          >
            <h2>{view.result.won ? 'База выстояла' : 'База пала'}</h2>
            <p className="survival-result">
              {view.result.won
                ? `Отбиты все ${plural(view.result.wave, WAVES)}`
                : `Пройдено волн: ${view.result.wave}`}
              {' · '}убито зомби: {view.result.kills} ·{' '}
              {clock(view.result.seconds)}
            </p>
            <table className="survival-table">
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th>Уровень</th>
                  <th>Опыт</th>
                  <th>Убийств</th>
                </tr>
              </thead>
              <tbody>
                {view.players.map((p) => (
                  <tr key={p.id} className={p.id === room.self ? 'is-me' : ''}>
                    <td>
                      {p.name}
                      {p.id === room.self ? ' (вы)' : ''}
                    </td>
                    <td>{p.level}</td>
                    <td>{p.xp}</td>
                    <td>{p.kills}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <footer>
              <span className="survival-muted">Лобби через {left} с</span>
              {host && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => void run({ action: 'start' })}
                >
                  Ещё раз
                </button>
              )}
            </footer>
          </div>
        </div>
      )}

      {toast && <div className="survival-toast">{toast}</div>}
    </div>
  );
}
