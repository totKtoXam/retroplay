'use client';

// Интерфейс режима «Предатель» поверх 3D-мира: лобби партии, показ роли, задания и кнопки
// действий, мини-игры, собрание с голосованием и итог. Всё, что здесь видно, пришло в
// снимке партии этого игрока (`room.impostor`), а каждое действие проверяет сервер.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Check, Crosshair, Megaphone, Siren, Skull, Wrench } from 'lucide-react';
import type { Pose, Room } from '@/lib/model';
import { getMap } from '@/lib/maps';
import { MIN_PLAYERS, TASK_MS, type ImpostorView } from '@/lib/impostor';
import {
  atButton,
  amGhost,
  bodyHere,
  inGame,
  killTarget,
  secondsLeft,
  taskHere,
  zoneAt,
} from '@/lib/impostor-client';
import type { ImpostorReply } from './use-room-sync';
import { TASK_GAMES } from './impostor-tasks';

type Props = {
  room: Room;
  host: boolean;
  /** Серверное время сейчас. */
  serverNow: () => number;
  pose: RefObject<Pose>;
  send: (action: Record<string, unknown>) => Promise<ImpostorReply>;
  /** Открыт экран, которому нужен курсор: мир не должен принимать ввод. */
  onBlocked: (blocked: boolean) => void;
};

const WIN_TEXT: Record<string, string> = {
  tasks: 'Экипаж выполнил все задания',
  ejected: 'Все предатели изгнаны',
  kills: 'Предатели сравнялись с экипажем',
  left: 'Соперники покинули корабль',
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Игроки в сети по снимку: столько попадёт в партию. */
const onlineCount = (room: Room, now: number) =>
  room.members.filter((m) => !m.bot && now - (m.lastSeen ?? 0) < 15_000).length;

export default function ImpostorOverlay({ room, host, serverNow, pose, send, onBlocked }: Props) {
  const view = room.impostor;
  const map = getMap(room.state.map);
  const [now, setNow] = useState(() => serverNow());
  const [toast, setToast] = useState('');
  const [task, setTask] = useState<{ station: string; kind: ImpostorView['tasks'][number]['kind']; title: string; startedAt: number } | null>(null);
  const [saving, setSaving] = useState(false);
  // Кадр обновления: подсказки «рядом пульт / тело / цель» зависят от позы, а она в ref.
  const phaseRef = useRef(room.impostor?.phase);
  useEffect(() => {
    phaseRef.current = room.impostor?.phase;
  });
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(serverNow());
      // Мини-игра закрывается сама, если игра ушла из фазы «play» (собрание, конец).
      if (phaseRef.current !== 'play') setTask(null);
    }, 200);
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

  const me = pose.current ?? { x: 0, z: 0 };
  const phase = view?.phase ?? 'lobby';
  const meeting = phase === 'meeting' || phase === 'voting' || phase === 'eject';
  const hereTask = taskHere(view, me);
  const hereBody = bodyHere(view, me);
  const target = killTarget(view, room.self, me, room.members);
  const button = atButton(view, map, me);

  // Экран с курсором: мини-игра, собрание, итог. Мир на это время не слушает ввод.
  const openGame = phase === 'play' ? task : null;
  const needsCursor = !!openGame || meeting || phase === 'ended';
  useEffect(() => {
    onBlocked(needsCursor);
    if (needsCursor && document.pointerLockElement) document.exitPointerLock();
  }, [needsCursor, onBlocked]);
  useEffect(() => () => onBlocked(false), [onBlocked]);

  const finishRef = useRef<() => Promise<void>>(async () => {});
  // Мини-игра получает постоянный колбэк: иначе каждая перерисовка (5 раз в секунду)
  // перезапускала бы её таймеры.
  const onGameDone = useCallback(() => void finishRef.current(), []);
  const openTask = useCallback(async () => {
    if (!hereTask) return;
    if (await run({ action: 'task.start', station: hereTask.station }))
      setTask({ station: hereTask.station, kind: hereTask.kind, title: hereTask.title, startedAt: performance.now() });
  }, [hereTask, run]);
  const finishTask = useCallback(async () => {
    if (!task || saving) return;
    setSaving(true);
    // Сервер не засчитает быстрее минимального времени — дождёмся его с небольшим запасом.
    const wait = TASK_MS[task.kind] + 300 - (performance.now() - task.startedAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const ok = await run({ action: 'task.done', station: task.station });
    setSaving(false);
    setTask(null);
    if (ok) flash('Задание выполнено');
  }, [task, saving, run, flash]);
  useEffect(() => {
    finishRef.current = finishTask;
  });

  const act = useRef({ use: () => {}, report: () => {}, kill: () => {} });
  useEffect(() => {
    act.current = {
      use: () => {
        if (hereTask) void openTask();
        else if (button) void run({ action: 'meeting' });
      },
      report: () => {
        if (hereBody) void run({ action: 'report', body: hereBody.victim });
      },
      kill: () => {
        if (target) void run({ action: 'kill', target });
      },
    };
  });
  // E — использовать, R — репорт, Q — нож. Перехватываем раньше мира, чтобы E не открыл
  // планшет, а Q — снаряжение: во время партии эти клавиши принадлежат режиму.
  const active = inGame(view);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.code === 'Escape' && task) {
        setTask(null);
        return;
      }
      const handler = e.code === 'KeyE' ? 'use' : e.code === 'KeyR' ? 'report' : e.code === 'KeyQ' ? 'kill' : null;
      if (!handler) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat && !task) act.current[handler]();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, task]);

  const nameOf = (id: string) => view?.players.find((p) => p.id === id)?.name ?? 'Игрок';

  if (!view) return null;

  // ---- Лобби ----
  if (phase === 'lobby') {
    const online = onlineCount(room, now);
    return (
      <div className="impostor-layer">
        <div className="impostor-lobby">
          <strong>Предатель</strong>
          <span>
            В сети: {online} · нужно от {MIN_PLAYERS}
          </span>
          {host ? (
            <button className="primary" disabled={online < MIN_PLAYERS} onClick={() => void run({ action: 'start' })}>
              Начать партию
            </button>
          ) : (
            <span className="impostor-muted">Ждём, пока ведущий начнёт партию</span>
          )}
        </div>
        {toast && <div className="impostor-toast">{toast}</div>}
      </div>
    );
  }

  const ghost = amGhost(view);
  const impostor = view.role === 'impostor';
  const left = secondsLeft(view.until, now);

  return (
    <div className="impostor-layer">
      {/* ---- Показ роли ---- */}
      {phase === 'intro' && (
        <div className={`impostor-intro ${impostor ? 'is-impostor' : 'is-crew'}`}>
          <h2>{view.role ? (impostor ? 'Предатель' : 'Экипаж') : 'Зритель'}</h2>
          <p>
            {impostor
              ? view.allies.length
                ? `Ваши союзники: ${view.allies.map(nameOf).join(', ')}`
                : 'Устраните экипаж, не выдав себя'
              : `Среди нас ${view.impostors} ${view.impostors === 1 ? 'предатель' : 'предателя'}`}
          </p>
        </div>
      )}

      {/* ---- Задания и роль ---- */}
      {(phase === 'play' || phase === 'intro') && (
        <div className="impostor-tasks">
          <div className={`impostor-role ${impostor ? 'is-impostor' : ''}`}>
            {ghost ? 'Вы призрак' : impostor ? 'Предатель' : view.role ? 'Экипаж' : 'Зритель'}
          </div>
          <div className="impostor-progress" title="Общий прогресс заданий экипажа">
            <span style={{ width: `${view.progress.total ? (view.progress.done / view.progress.total) * 100 : 0}%` }} />
          </div>
          {impostor && <p className="impostor-muted">Ложные задания — для прикрытия</p>}
          {ghost && view.role === 'crew' && <p className="impostor-muted">Доделайте задания — экипаж ещё может победить</p>}
          <ul>
            {view.tasks.map((t) => (
              <li key={t.station} className={t.done ? 'is-done' : ''}>
                {t.done ? <Check size={13} /> : <Wrench size={13} />} {t.room}: {t.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === 'play' && (
        <>
          <div className="impostor-zone">{zoneAt(map, me)}</div>
          <div className="impostor-actions">
            {impostor && !ghost && (
              <button
                className="impostor-action is-kill"
                disabled={!target || view.killReadyAt > now}
                onClick={() => act.current.kill()}
              >
                <Crosshair size={22} />
                <span>{view.killReadyAt > now ? secondsLeft(view.killReadyAt, now) : 'Убить'}</span>
                <kbd>Q</kbd>
              </button>
            )}
            {!ghost && (
              <button className="impostor-action" disabled={!hereBody} onClick={() => act.current.report()}>
                <Megaphone size={22} />
                <span>Репорт</span>
                <kbd>R</kbd>
              </button>
            )}
            <button
              className="impostor-action"
              disabled={!hereTask && !(button && view.meetingsLeft > 0 && view.buttonReadyAt <= now)}
              onClick={() => act.current.use()}
            >
              {button && !hereTask ? <Siren size={22} /> : <Wrench size={22} />}
              <span>
                {button && !hereTask
                  ? view.buttonReadyAt > now
                    ? secondsLeft(view.buttonReadyAt, now)
                    : `Собрание · ${view.meetingsLeft}`
                  : 'Использовать'}
              </span>
              <kbd>E</kbd>
            </button>
          </div>
        </>
      )}

      {host && active && (
        <button className="impostor-stop" onClick={() => void run({ action: 'stop' })}>
          Остановить партию
        </button>
      )}

      {/* ---- Мини-игра ---- */}
      {openGame && (
        <div className="impostor-modal">
          <div className="impostor-card">
            <header>
              <strong>{openGame.title}</strong>
              <button className="impostor-close" onClick={() => setTask(null)} aria-label="Закрыть">
                ×
              </button>
            </header>
            {saving ? (
              <p className="impostor-task-hint">Сохраняем…</p>
            ) : (
              (() => {
                const Game = TASK_GAMES[openGame.kind];
                return <Game onDone={onGameDone} />;
              })()
            )}
          </div>
        </div>
      )}

      {/* ---- Собрание ---- */}
      {meeting && (
        <div className="impostor-modal">
          <div className="impostor-card impostor-meeting">
            <header>
              <strong>
                {view.meeting?.reason === 'report'
                  ? `Найдено тело: ${nameOf(view.meeting.body ?? '')}`
                  : `Экстренное собрание: ${nameOf(view.meeting?.caller ?? '')}`}
              </strong>
              <span className="impostor-timer">
                {phase === 'meeting' ? 'Обсуждение' : phase === 'voting' ? 'Голосование' : 'Итог'} · {clock(left)}
              </span>
            </header>
            {phase === 'eject' && view.ejected && (
              <p className="impostor-eject">
                {view.ejected.id
                  ? `${nameOf(view.ejected.id)} изгнан.` +
                    (room.state.impostor?.confirmEjects === false
                      ? ''
                      : view.ejected.impostor
                        ? ' Он был предателем.'
                        : ' Он не был предателем.')
                  : view.ejected.tie
                    ? 'Голоса разделились — никого не изгнали.'
                    : 'Никого не изгнали.'}
              </p>
            )}
            <div className="impostor-players">
              {view.players.map((p) => {
                const canVote = phase === 'voting' && !ghost && p.alive && !p.left && !view.voted.includes(room.self);
                const votes = view.votes ? Object.entries(view.votes).filter(([, t]) => t === p.id) : [];
                return (
                  <button
                    key={p.id}
                    className={`impostor-player${p.alive && !p.left ? '' : ' is-dead'}`}
                    disabled={!canVote}
                    onClick={() => void run({ action: 'vote', target: p.id })}
                  >
                    <span className="impostor-dot" style={{ background: p.color }} />
                    <span className="impostor-player-name">
                      {p.name}
                      {p.id === room.self ? ' (вы)' : ''}
                    </span>
                    {!p.alive && <Skull size={14} />}
                    {view.voted.includes(p.id) && <span className="impostor-badge">голос отдан</span>}
                    {votes.length > 0 && (
                      <span className="impostor-votes">
                        {votes.map(([voter]) => (
                          <span
                            key={voter}
                            className="impostor-dot"
                            title={nameOf(voter)}
                            style={{ background: view.players.find((x) => x.id === voter)?.color }}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <footer>
              {phase === 'meeting' && <span className="impostor-muted">Голосование начнётся через {left} с — обсудите голосом (Y)</span>}
              {phase === 'voting' &&
                (ghost ? (
                  <span className="impostor-muted">Призраки не голосуют</span>
                ) : view.voted.includes(room.self) ? (
                  <span className="impostor-muted">Ваш голос принят</span>
                ) : (
                  <button onClick={() => void run({ action: 'vote', target: 'skip' })}>Пропустить голосование</button>
                ))}
              {phase === 'eject' && view.votes && (
                <span className="impostor-muted">
                  Пропустили: {Object.values(view.votes).filter((t) => t === 'skip').length}
                </span>
              )}
            </footer>
          </div>
        </div>
      )}

      {/* ---- Итог партии ---- */}
      {phase === 'ended' && (
        <div className="impostor-modal">
          <div className={`impostor-card impostor-ended ${view.winner === 'impostor' ? 'is-impostor' : 'is-crew'}`}>
            <h2>{view.winner === 'impostor' ? 'Победа предателей' : 'Победа экипажа'}</h2>
            <p>{WIN_TEXT[view.winReason ?? ''] ?? ''}</p>
            {view.role && (
              <p className="impostor-result">
                {view.role === view.winner ? 'Вы победили' : 'Вы проиграли'}
              </p>
            )}
            <ul className="impostor-roles">
              {view.players.map((p) => (
                <li key={p.id}>
                  <span className="impostor-dot" style={{ background: p.color }} />
                  {p.name} — {view.roles?.[p.id] === 'impostor' ? 'предатель' : 'экипаж'}
                </li>
              ))}
            </ul>
            <span className="impostor-muted">Новая партия — через {left} с в лобби</span>
          </div>
        </div>
      )}

      {toast && <div className="impostor-toast">{toast}</div>}
    </div>
  );
}
