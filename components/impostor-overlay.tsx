'use client';

// Интерфейс режима «Предатель» поверх 3D-мира: лобби партии, показ роли, задания и кнопки
// действий, мини-игры, собрание с голосованием и итог. Всё, что здесь видно, пришло в
// снимке партии этого игрока (`room.impostor`), а каждое действие проверяет сервер.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AlertTriangle, Check, Crosshair, Megaphone, Siren, Skull, Wind, Wrench, Zap } from 'lucide-react';
import type { Pose, Room } from '@/lib/model';
import { getMap } from '@/lib/maps';
import { MIN_PLAYERS, SABOTAGE_KINDS, TASK_MS, type ImpostorView } from '@/lib/impostor';
import type { SabotageKind, SabotagePanel, TaskKind } from '@/lib/maps/types';
import {
  atButton,
  amGhost,
  bodyHere,
  inGame,
  killTarget,
  panelHere,
  secondsLeft,
  taskHere,
  ventHere,
  zoneAt,
} from '@/lib/impostor-client';
import type { ImpostorReply } from './use-room-sync';
import { TASK_GAMES } from './impostor-tasks';
import ImpostorRules from './impostor-rules';
import ImpostorDeath from './impostor-death';

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
  sabotage: 'Корабль не пережил аварию',
};

const SABOTAGE_TITLE: Record<SabotageKind, string> = {
  lights: 'Свет',
  comms: 'Связь',
  reactor: 'Реактор',
  o2: 'O2',
};
/** Какой мини-игрой чинится авария; реактор — отдельное удержание вдвоём. */
const REPAIR_GAME: Record<Exclude<SabotageKind, 'reactor'>, TaskKind> = {
  lights: 'hold',
  comms: 'calibrate',
  o2: 'code',
};

/** Стабилизатор реактора: пока кнопка зажата, пульт считается удерживаемым. */
function ReactorHold({ held, onHold }: { held: number; onHold: () => void }) {
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    if (!holding) return;
    onHold();
    const timer = setInterval(onHold, 500);
    return () => clearInterval(timer);
  }, [holding, onHold]);
  return (
    <div className="impostor-hold">
      <p className="impostor-task-hint">Держат стабилизаторы: {held} / 2 — нужен второй игрок у другого пульта</p>
      <button
        className="impostor-hold-button"
        onPointerDown={() => setHolding(true)}
        onPointerUp={() => setHolding(false)}
        onPointerLeave={() => setHolding(false)}
      >
        {holding ? 'Держу…' : 'Удерживайте'}
      </button>
    </div>
  );
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Игроки в сети по снимку, боты тоже: столько попадёт в партию. */
const onlineCount = (room: Room, now: number) =>
  room.members.filter((m) => now - (m.lastSeen ?? 0) < 15_000).length;

export default function ImpostorOverlay({ room, host, serverNow, pose, send, onBlocked }: Props) {
  const view = room.impostor;
  const map = getMap(room.state.map);
  const [now, setNow] = useState(() => serverNow());
  const [toast, setToast] = useState('');
  const [task, setTask] = useState<{ station: string; kind: ImpostorView['tasks'][number]['kind']; title: string; startedAt: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [repair, setRepair] = useState<SabotagePanel | null>(null);
  const [sabotageMenu, setSabotageMenu] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  /** Сцена смерти: цвета жертвы и убийцы; null — не показываем. */
  const [death, setDeath] = useState<{ me: string; killer: string } | null>(null);
  const viewRef = useRef(room.impostor);
  const selfRef = useRef(room.self);
  const wasAlive = useRef(false);
  // Кадр обновления: подсказки «рядом пульт / тело / цель» зависят от позы, а она в ref.
  const phaseRef = useRef(room.impostor?.phase);
  const sabotageRef = useRef(room.impostor?.sabotage?.kind);
  useEffect(() => {
    phaseRef.current = room.impostor?.phase;
    sabotageRef.current = room.impostor?.sabotage?.kind;
    viewRef.current = room.impostor;
    selfRef.current = room.self;
  });
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(serverNow());
      // Мини-игра и ремонт закрываются сами, если игра ушла из фазы «play» или аварию починили.
      if (phaseRef.current !== 'play') {
        setTask(null);
        setSabotageMenu(false);
      }
      setRepair((r) => (r && (phaseRef.current !== 'play' || sabotageRef.current !== r.sabotage) ? null : r));
      // Был жив, а в игре (не на собрании — там изгоняют, это другой экран) стал мёртв: убили.
      const v = viewRef.current;
      const alive = !!v && !!v.role && v.alive;
      if (wasAlive.current && !alive && v?.phase === 'play' && v.role) {
        const color = (id: string | null) => v.players.find((p) => p.id === id)?.color;
        setDeath({ me: color(selfRef.current) ?? '#3e8ef7', killer: color(v.killedBy) ?? '#e5484d' });
      }
      wasAlive.current = alive;
    }, 200);
    return () => clearInterval(timer);
  }, [serverNow]);

  const closeDeath = useCallback(() => setDeath(null), []);
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
  const herePanel = panelHere(view, map, me);
  const hereVent = ventHere(view, map, me);
  const myVent = view?.vent ? map.vents.find((v) => v.id === view.vent) : undefined;

  // Экран с курсором: мини-игра, ремонт, вентиляция, собрание, итог. Мир на это время не слушает ввод.
  const openGame = phase === 'play' ? task : null;
  const openRepair = phase === 'play' && repair && view?.sabotage?.kind === repair.sabotage ? repair : null;
  const openMenu = phase === 'play' && sabotageMenu;
  const needsCursor = !!death || rulesOpen || !!openGame || !!openRepair || openMenu || !!myVent || meeting || phase === 'ended';
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
  const repairRef = useRef<() => void>(() => {});
  useEffect(() => {
    repairRef.current = () => {
      if (!openRepair) return;
      void run({ action: 'fix', panel: openRepair.id }).then((ok) => {
        if (ok && openRepair.sabotage !== 'reactor') setRepair(null);
      });
    };
  });
  const onRepairDone = useCallback(() => repairRef.current(), []);

  const act = useRef({ use: () => {}, report: () => {}, kill: () => {}, sabotage: () => {} });
  useEffect(() => {
    act.current = {
      // E: ремонт аварии важнее задания; предатель у решётки лезет в вентиляцию, из неё — вылезает.
      use: () => {
        if (view?.vent) void run({ action: 'vent.exit' });
        else if (herePanel) setRepair(herePanel);
        else if (hereTask) void openTask();
        else if (hereVent) void run({ action: 'vent.enter', vent: hereVent.id });
        else if (button) void run({ action: 'meeting' });
      },
      sabotage: () => {
        if (view?.role === 'impostor' && view.alive) setSabotageMenu((open) => !open);
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
      // Пока открыты правила, клавиши действий не срабатывают — но и миру не достаются.
      if (rulesOpen) {
        if (['KeyE', 'KeyR', 'KeyQ', 'KeyB'].includes(e.code)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      if (e.code === 'Escape' && (task || repair || sabotageMenu)) {
        setTask(null);
        setRepair(null);
        setSabotageMenu(false);
        return;
      }
      const handler =
        e.code === 'KeyE'
          ? 'use'
          : e.code === 'KeyR'
            ? 'report'
            : e.code === 'KeyQ'
              ? 'kill'
              : e.code === 'KeyB'
                ? 'sabotage'
                : null;
      if (!handler) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat && !task && !repair) act.current[handler]();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, task, repair, sabotageMenu, rulesOpen]);

  // I — правила режима в любой фазе, и в лобби тоже. В этом режиме снаряжения нет, поэтому клавиша
  // забирается у мира целиком.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.code === 'KeyI' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) setRulesOpen((open) => !open);
      } else if (e.code === 'Escape' && rulesOpen) {
        e.stopImmediatePropagation();
        setRulesOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [rulesOpen]);

  const nameOf = (id: string) => view?.players.find((p) => p.id === id)?.name ?? 'Игрок';

  if (!view) return null;

  const rules = rulesOpen && (
    <ImpostorRules
      map={map}
      settings={room.state.impostor}
      role={inGame(view) ? view.role : null}
      me={pose.current ? { x: pose.current.x, z: pose.current.z } : null}
      onClose={() => setRulesOpen(false)}
    />
  );

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
          <button className="impostor-rules-button" onClick={() => setRulesOpen(true)}>
            Правила <kbd>I</kbd>
          </button>
        </div>
        {rules}
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
            <button className="impostor-rules-link" onClick={() => setRulesOpen(true)}>
              правила · I
            </button>
          </div>
          <div className="impostor-progress" title="Общий прогресс заданий экипажа">
            <span style={{ width: `${view.progress.total ? (view.progress.done / view.progress.total) * 100 : 0}%` }} />
          </div>
          {impostor && <p className="impostor-muted">Ложные задания — для прикрытия</p>}
          {view.sabotage?.kind === 'comms' && <p className="impostor-muted">Связь нарушена — список заданий недоступен</p>}
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

      {phase === 'play' && view.sabotage && (
        <div className={`impostor-alarm${view.sabotage.until ? ' is-critical' : ''}`}>
          <AlertTriangle size={16} />
          <span>
            {view.sabotage.kind === 'lights' && 'Свет отключён'}
            {view.sabotage.kind === 'comms' && 'Связь нарушена'}
            {view.sabotage.kind === 'reactor' &&
              `Авария реактора · ${secondsLeft(view.sabotage.until, now)} с · стабилизаторы ${view.sabotage.held.length} / 2`}
            {view.sabotage.kind === 'o2' &&
              `Утечка O2 · ${secondsLeft(view.sabotage.until, now)} с · пульты ${view.sabotage.fixed.length} / 2`}
            {' — '}
            {[...new Set(map.panels.filter((p) => p.sabotage === view.sabotage?.kind).map((p) => p.room))].join(', ')}
          </span>
        </div>
      )}

      {phase === 'play' && (
        <>
          <div className="impostor-zone">{zoneAt(map, me)}</div>
          <div className="impostor-actions">
            {impostor && !ghost && (
              <button
                className="impostor-action"
                disabled={view.sabotageReadyAt > now || !!view.sabotage}
                onClick={() => act.current.sabotage()}
              >
                <Zap size={22} />
                <span>{view.sabotageReadyAt > now ? secondsLeft(view.sabotageReadyAt, now) : 'Саботаж'}</span>
                <kbd>B</kbd>
              </button>
            )}
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
              disabled={
                !herePanel && !hereTask && !hereVent && !(button && view.meetingsLeft > 0 && view.buttonReadyAt <= now)
              }
              onClick={() => act.current.use()}
            >
              {herePanel ? (
                <AlertTriangle size={22} />
              ) : hereTask ? (
                <Wrench size={22} />
              ) : hereVent ? (
                <Wind size={22} />
              ) : button ? (
                <Siren size={22} />
              ) : (
                <Wrench size={22} />
              )}
              <span>
                {herePanel
                  ? 'Починить'
                  : hereTask
                    ? 'Использовать'
                    : hereVent
                      ? 'Вентиляция'
                      : button
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

      {/* ---- Вентиляция ---- */}
      {phase === 'play' && myVent && (
        <div className="impostor-vent">
          <strong>Вы в вентиляции · {myVent.room}</strong>
          <div className="impostor-vent-links">
            {myVent.links.map((id) => {
              const to = map.vents.find((v) => v.id === id);
              return (
                <button key={id} onClick={() => void run({ action: 'vent.move', vent: id })}>
                  → {to?.room ?? id}
                </button>
              );
            })}
          </div>
          <button className="primary" onClick={() => void run({ action: 'vent.exit' })}>
            Вылезти (E)
          </button>
        </div>
      )}

      {/* ---- Меню саботажа ---- */}
      {openMenu && (
        <div className="impostor-modal">
          <div className="impostor-card">
            <header>
              <strong>Саботаж</strong>
              <button className="impostor-close" onClick={() => setSabotageMenu(false)} aria-label="Закрыть">
                ×
              </button>
            </header>
            <div className="impostor-sabotage-list">
              {SABOTAGE_KINDS.filter((k) => map.panels.some((p) => p.sabotage === k)).map((k) => (
                <button
                  key={k}
                  disabled={view.sabotageReadyAt > now || !!view.sabotage}
                  onClick={() => {
                    setSabotageMenu(false);
                    void run({ action: 'sabotage', kind: k });
                  }}
                >
                  <strong>{SABOTAGE_TITLE[k]}</strong>
                  <span className="impostor-muted">
                    {k === 'lights' && 'Экипаж почти ничего не видит'}
                    {k === 'comms' && 'Экипаж теряет списки заданий'}
                    {k === 'reactor' && 'Не починят вдвоём за 45 с — победа'}
                    {k === 'o2' && 'Не починят оба пульта за 45 с — победа'}
                  </span>
                </button>
              ))}
            </div>
            {view.sabotageReadyAt > now && (
              <p className="impostor-muted">Следующий саботаж через {secondsLeft(view.sabotageReadyAt, now)} с</p>
            )}
          </div>
        </div>
      )}

      {/* ---- Ремонт аварии ---- */}
      {openRepair && (
        <div className="impostor-modal">
          <div className="impostor-card">
            <header>
              <strong>{openRepair.title}</strong>
              <button className="impostor-close" onClick={() => setRepair(null)} aria-label="Закрыть">
                ×
              </button>
            </header>
            {openRepair.sabotage === 'reactor' ? (
              <ReactorHold held={view.sabotage?.held.length ?? 0} onHold={onRepairDone} />
            ) : (
              (() => {
                const Game = TASK_GAMES[REPAIR_GAME[openRepair.sabotage]];
                return <Game onDone={onRepairDone} />;
              })()
            )}
          </div>
        </div>
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

      {rules}
      {death && <ImpostorDeath myColor={death.me} killerColor={death.killer} onDone={closeDeath} />}
      {toast && <div className="impostor-toast">{toast}</div>}
    </div>
  );
}
