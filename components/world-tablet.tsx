'use client';
import { useState, useSyncExternalStore } from 'react';
import Board from './board';
import { isOnline, ZONES, type Room, type RoomState, type Note } from '@/lib/model';
import { dayMoment } from '@/lib/day-cycle';
import {
  Bell,
  Dices,
  Hash,
  MousePointer,
  StickyNote,
  Timer,
  Pencil,
  Link2,
  ThumbsUp,
  CheckSquare,
  Check,
  Clock,
  X,
  Sun,
  Sunrise,
  Sunset,
  Moon,
  Music2,
  Play,
  Pause,
  Volume2,
} from 'lucide-react';
import {
  TRACKS,
  getMusicState,
  subscribeMusic,
  playMusic,
  pauseMusic,
  setMusicVolume,
} from '@/lib/soundtrack';
import { WEATHER_LABELS, WEATHER_SETTINGS, weatherSetting } from '@/lib/weather';

type WorldTabletProps = {
  room: Room;
  host?: boolean;
  onRoomSettings?: (patch: Partial<RoomState>) => void;
  onOp?: (op: Record<string, unknown>) => Promise<unknown>;
  onEditNote?: (n: Note) => void;
  onAddNote?: (zone: string, x?: number, y?: number) => void;
  /** Общее «сейчас» комнаты: в планшете нельзя звать Date.now() при отрисовке. */
  now: number;
  onCursor?: (x: number, y: number) => void;
  closeTabletInWorld: () => void;
};

export function WorldTablet(props: WorldTabletProps) {
  const [tabletTab, setTabletTab] = useState<'board' | 'env' | 'music'>('board');
  const [tabletTool, setTabletTool] = useState('pointer');
  const [actionItemsOpen, setActionItemsOpen] = useState(false);
  const [tabletSearch, setTabletSearch] = useState('');
  const [timerOpen, setTimerOpen] = useState(false);
  const round = props.room.state.rounds.at(-1)?.active
    ? props.room.state.rounds.at(-1)
    : null;
  const myVotes = round
    ? Object.values(round.votes[props.room.self] || {}).reduce((a, b) => a + b, 0)
    : 0;
  const left = props.room.state.timer.running
    ? Math.max(0, Math.ceil((props.room.state.timer.end - props.now) / 1000))
    : props.room.state.timer.remaining;
  const timerText = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(
    left % 60,
  ).padStart(2, '0')}`;
  const music = useSyncExternalStore(
    subscribeMusic,
    getMusicState,
    getMusicState,
  );

  return (
    <div
      className="diegetic-tablet-container"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.closeTabletInWorld();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.closeTabletInWorld();
      }}
    >
      <section
        className="diegetic-tablet-device"
        aria-label="Планшет ретроспективы"
      >
        <div className="tablet-camera-dot" />
        <header className="tablet-system-bar">
          <div className="tablet-system-left">
            <span className="tablet-dot-live" />
            <span className="tablet-room-badge">RETRO PAD · 3D</span>
          </div>
          <div className="tablet-system-title">
            <strong>{props.room.state.title || 'Ретроспектива'}</strong>
          </div>
          <div className="tablet-system-right">
            <span className="tablet-esc-hint">
              <kbd>Esc</kbd> закрыть
            </span>
            <button
              className="tablet-close-btn"
              onClick={props.closeTabletInWorld}
              title="Закрыть планшет (Esc)"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <nav className="tablet-nav-tabs" aria-label="Разделы планшета">
          <button
            className={`tablet-tab-btn ${tabletTab === 'board' ? 'active' : ''}`}
            onClick={() => setTabletTab('board')}
          >
            📋 Доска ретро
          </button>
          <button
            className={`tablet-tab-btn ${tabletTab === 'env' ? 'active' : ''}`}
            onClick={() => setTabletTab('env')}
          >
            🌲 Ландшафт
          </button>
          <button
            className={`tablet-tab-btn ${tabletTab === 'music' ? 'active' : ''}`}
            onClick={() => setTabletTab('music')}
          >
            🎵 Музыка
          </button>
        </nav>

        {tabletTab === 'board' && (
          <div className="tablet-board-layout">
            <aside className="spreo-tools" aria-label="Инструменты доски">
              {(
                [
                  ['pointer', MousePointer, 'Выбор и перемещение'],
                  ['sticky', StickyNote, 'Стикер'],
                  ['draw', Pencil, 'Маркер: зажмите мышь на холсте'],
                  ['connector', Link2, 'Связать две карточки'],
                  ['reaction', ThumbsUp, 'Быстрая реакция'],
                ] as const
              ).map(([id, Icon, title]) => (
                <button
                  key={id}
                  className={tabletTool === id ? 'active' : ''}
                  onClick={() => setTabletTool(id)}
                  title={title}
                  aria-label={title}
                  aria-pressed={tabletTool === id}
                >
                  <Icon size={16} />
                </button>
              ))}
              <span className="spreo-tools-label">гаджеты</span>
              <button
                className={timerOpen ? 'active' : ''}
                onClick={() => setTimerOpen(!timerOpen)}
                title="Таймер встречи"
                aria-label="Таймер встречи"
              >
                <Timer size={16} />
              </button>
              <button
                onClick={() =>
                  void props.onOp?.({
                    type: 'event',
                    kind: 'spin',
                    value:
                      props.room.members[
                        Math.floor(Math.random() * props.room.members.length)
                      ]?.name || '',
                  })
                }
                title="Спиннер: кто говорит"
                aria-label="Спиннер: кто говорит"
              >
                <Dices size={16} />
              </button>
              <button
                onClick={() => void props.onOp?.({ type: 'counter' })}
                title="Счётчик: +1"
                aria-label="Счётчик"
              >
                <Hash size={16} />
              </button>
              <button
                onClick={() => void props.onOp?.({ type: 'event', kind: 'buzzer' })}
                title="Звонок: собрать внимание"
                aria-label="Звонок"
              >
                <Bell size={16} />
              </button>
              <button
                className={`spreo-tools-bottom ${actionItemsOpen ? 'active' : ''}`}
                onClick={() => setActionItemsOpen(!actionItemsOpen)}
                title="Задачи встречи"
                aria-label="Задачи встречи"
              >
                <CheckSquare size={16} />
              </button>
            </aside>

            <div className="tablet-board-viewport-container">
              <Board
                room={props.room}
                tool={tabletTool}
                onEdit={props.onEditNote || (() => {})}
                onAdd={props.onAddNote || (() => {})}
                onOp={props.onOp || (async () => {})}
                search={tabletSearch}
                onCursor={props.onCursor}
              />

              {actionItemsOpen && (
                <aside
                  className="tablet-action-items-drawer"
                  aria-label="Action Items задачи"
                >
                  <header className="action-drawer-header">
                    <div>
                      <strong>📋 Action Items (Задачи)</strong>
                      <small>
                        {
                          props.room.state.notes
                            .filter(
                              (n) =>
                                n.kind === 'action' || n.kind === 'task',
                            )
                            .filter((n) => n.done).length
                        }{' '}
                        из{' '}
                        {
                          props.room.state.notes.filter(
                            (n) =>
                              n.kind === 'action' || n.kind === 'task',
                          ).length
                        }{' '}
                        завершено
                      </small>
                    </div>
                    <button
                      className="action-drawer-close"
                      onClick={() => setActionItemsOpen(false)}
                      aria-label="Закрыть задачи"
                    >
                      <X size={15} />
                    </button>
                  </header>

                  <div className="action-drawer-list">
                    {props.room.state.notes
                      .filter(
                        (n) => n.kind === 'action' || n.kind === 'task',
                      )
                      .map((n) => (
                        <div
                          key={n.id}
                          className={`action-drawer-item ${n.done ? 'is-done' : ''}`}
                        >
                          <label className="action-checkbox-label">
                            <input
                              type="checkbox"
                              checked={n.done}
                              onChange={() =>
                                void props.onOp?.({
                                  type: 'note.edit',
                                  id: n.id,
                                  patch: { done: !n.done },
                                })
                              }
                            />
                            <span className="action-check-visual">
                              {n.done && <Check size={12} />}
                            </span>
                          </label>
                          <div className="action-item-body">
                            <p className="action-text">
                              {n.text || 'Новая задача'}
                            </p>
                            <div className="action-tags">
                              {n.owner && (
                                <span className="action-owner">
                                  👤 {n.owner}
                                </span>
                              )}
                              {n.due && (
                                <span className="action-due">
                                  <Clock size={10} /> {n.due}
                                </span>
                              )}
                              <span
                                className="action-zone-badge"
                                style={{
                                  background:
                                    (ZONES.find((z) => z.id === n.zone)
                                      ?.color || '#334155') + '33',
                                }}
                              >
                                {ZONES.find((z) => z.id === n.zone)
                                  ?.short || n.zone}
                              </span>
                            </div>
                          </div>
                          <button
                            className="action-edit-btn"
                            onClick={() => props.onEditNote?.(n)}
                            title="Редактировать задачу"
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                      ))}
                    {props.room.state.notes.filter(
                      (n) => n.kind === 'action' || n.kind === 'task',
                    ).length === 0 && (
                      <div className="action-drawer-empty">
                        <span>
                          Пока нет задач. Зафиксируйте шаги команды!
                        </span>
                      </div>
                    )}
                  </div>

                  <footer className="action-drawer-footer">
                    <button
                      className="action-create-btn"
                      onClick={() => {
                        void props.onOp?.({
                          type: 'note.add',
                          kind: 'action',
                          zone: 'good',
                          text: 'Новая задача ретроспективы',
                          done: false,
                        });
                      }}
                    >
                      + Добавить задачу
                    </button>
                  </footer>
                </aside>
              )}
              {timerOpen && (
                <div className="spreo-timer-gadget">
                  <strong>{timerText}</strong>
                  {props.host && (
                    <div>
                      <button
                        onClick={() =>
                          void props.onOp?.({
                            type: 'timer',
                            action: props.room.state.timer.running
                              ? 'pause'
                              : 'start',
                          })
                        }
                      >
                        {props.room.state.timer.running ? 'Пауза' : 'Старт'}
                      </button>
                      <button
                        onClick={() =>
                          void props.onOp?.({ type: 'timer', action: 'reset' })
                        }
                      >
                        Сброс
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <aside className="spreo-side" aria-label="Панель встречи">
              <input
                className="spreo-search"
                placeholder="Найти карточку…"
                value={tabletSearch}
                onChange={(e) => setTabletSearch(e.target.value)}
                aria-label="Поиск по доске"
              />
              <b>Голосование</b>
              {round?.active ? (
                <p>
                  Раунд {props.room.state.rounds.length} · осталось{' '}
                  {round.limit - myVotes} из {round.limit}
                  <br />
                  Чужие голоса скрыты до конца
                </p>
              ) : (
                <p>Раунд не идёт</p>
              )}
              {props.host && (
                <button
                  className="spreo-side-action"
                  onClick={() =>
                    void props.onOp?.(
                      round?.active
                        ? { type: 'vote.end' }
                        : { type: 'vote.start', limit: 5 },
                    )
                  }
                >
                  {round?.active ? 'Завершить раунд' : 'Начать раунд'}
                </button>
              )}
              <b>Участники</b>
              <p>
                {props.room.members
                  .filter((m) => isOnline(m.lastSeen, props.now))
                  .map((m) =>
                    props.room.state.anonymousPlayers || props.room.state.anonymous
                      ? 'Аноним'
                      : m.name,
                  )
                  .join(' · ') || 'Пока никого'}
                <br />
                курсоры видны на холсте
              </p>
              <b>Счётчик</b>
              <p>{props.room.state.counter}</p>
              <button
                className="spreo-side-action"
                onClick={() => void props.onOp?.({ type: 'counter', down: true })}
              >
                Убавить
              </button>
            </aside>
          </div>
        )}

        {tabletTab === 'env' && (
          <div className="tablet-env-view">
            <div className="tablet-settings-section">
              <h3>Время суток</h3>
              <div className="tablet-settings-chips">
                {[
                  { id: 'dawn', label: 'Рассвет', icon: Sunrise },
                  { id: 'day', label: 'День', icon: Sun },
                  { id: 'sunset', label: 'Закат', icon: Sunset },
                  { id: 'night', label: 'Ночь', icon: Moon },
                ].map((item) => {
                  const Icon = item.icon;
                  // Пока сутки идут, подсвечена та фаза, что сейчас на небе, а
                  // не сохранённое `time`: иначе планшет спорил бы с картинкой.
                  const active =
                    dayMoment(props.room.state, props.now).time === item.id;
                  return (
                    <button
                      key={item.id}
                      className={`tablet-setting-chip ${active ? 'active' : ''}`}
                      onClick={() =>
                        props.onRoomSettings?.({ time: item.id })
                      }
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="tablet-settings-section">
              <h3>Сезон и ландшафт</h3>
              <div className="tablet-settings-chips">
                {[
                  { id: 'spring', label: 'Весна', emoji: '🌱' },
                  { id: 'summer', label: 'Лето', emoji: '☀️' },
                  { id: 'autumn', label: 'Осень', emoji: '🍁' },
                  { id: 'winter', label: 'Зима', emoji: '❄️' },
                ].map((item) => {
                  const active = props.room.state.season === item.id;
                  return (
                    <button
                      key={item.id}
                      className={`tablet-setting-chip ${active ? 'active' : ''}`}
                      onClick={() =>
                        props.onRoomSettings?.({ season: item.id })
                      }
                    >
                      <span>{item.emoji}</span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="tablet-settings-section">
              <h3>Погода и ветер</h3>
              <div className="tablet-settings-chips">
                {WEATHER_SETTINGS.map((id) => {
                  const active = weatherSetting(props.room.state.weather) === id;
                  return (
                    <button
                      key={id}
                      className={`tablet-setting-chip ${active ? 'active' : ''}`}
                      onClick={() => props.onRoomSettings?.({ weather: id })}
                    >
                      <span>{WEATHER_LABELS[id].icon}</span>
                      <span>{WEATHER_LABELS[id].label}</span>
                    </button>
                  );
                })}
                <button
                  className={`tablet-setting-chip ${props.room.state.windEffects !== false ? 'active' : ''}`}
                  onClick={() =>
                    props.onRoomSettings?.({
                      windEffects: props.room.state.windEffects === false,
                    })
                  }
                >
                  <span>🌬️</span>
                  <span>
                    {props.room.state.windEffects !== false
                      ? 'Ветер влияет на бой'
                      : 'Ветер выключен'}
                  </span>
                </button>
              </div>
            </div>

            <div className="tablet-settings-section">
              <h3>Визуальный стиль</h3>
              <div className="tablet-settings-chips">
                {[
                  { id: 'classic', label: 'Классический' },
                  { id: 'anime', label: 'Аниме / Шейдеры' },
                ].map((item) => {
                  const active =
                    (props.room.state.visualStyle || 'classic') === item.id;
                  return (
                    <button
                      key={item.id}
                      className={`tablet-setting-chip ${active ? 'active' : ''}`}
                      onClick={() =>
                        props.onRoomSettings?.({
                          visualStyle: item.id as 'classic' | 'anime',
                        })
                      }
                    >
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {tabletTab === 'music' && (
          <div className="tablet-music-view">
            <div className="tablet-settings-section">
              <h3>Фоновый саундтрек</h3>
              <div className="tablet-settings-chips">
                {TRACKS.map((t) => {
                  const active = music.track === t.id;
                  return (
                    <button
                      key={t.id}
                      className={`tablet-setting-chip ${active ? 'active' : ''}`}
                      onClick={() => {
                        if (active) {
                          pauseMusic();
                        } else {
                          void playMusic(t.id);
                        }
                      }}
                    >
                      <Music2 size={16} />
                      <span>{t.title}</span>
                      {active && <span className="playing-pulse">●</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="tablet-music-controls-row">
              <button
                className="tablet-music-play-toggle"
                onClick={() => {
                  if (music.playing) {
                    pauseMusic();
                  } else {
                    void playMusic(music.track || 'steppe');
                  }
                }}
              >
                {music.playing ? <Pause size={18} /> : <Play size={18} />}
                <span>{music.playing ? 'Пауза' : 'Воспроизведение'}</span>
              </button>

              <div className="tablet-music-volume">
                <Volume2 size={16} />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={music.volume}
                  onChange={(e) =>
                    setMusicVolume(parseFloat(e.target.value))
                  }
                  aria-label="Громкость музыки"
                />
                <span>{Math.round(music.volume * 100)}%</span>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          className="tablet-home-bar"
          onClick={props.closeTabletInWorld}
          aria-label="Закрыть планшет"
        >
          <span className="tablet-home-pill" />
        </button>
      </section>
    </div>
  );
}
