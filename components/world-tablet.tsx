'use client';
import { useState, useSyncExternalStore } from 'react';
import Board from './board';
import { ZONES, type Room, type RoomState, type Note } from '@/lib/model';
import {
  MousePointer,
  StickyNote,
  Pencil,
  Link2,
  ThumbsUp,
  PartyPopper,
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

type WorldTabletProps = {
  room: Room;
  host?: boolean;
  onRoomSettings?: (patch: Partial<RoomState>) => void;
  onOp?: (op: Record<string, unknown>) => Promise<unknown>;
  onEditNote?: (n: Note) => void;
  onAddNote?: (zone: string, x?: number, y?: number) => void;
  onCursor?: (x: number, y: number) => void;
  closeTabletInWorld: () => void;
};

export function WorldTablet(props: WorldTabletProps) {
  const [tabletTab, setTabletTab] = useState<'board' | 'env' | 'music'>('board');
  const [tabletTool, setTabletTool] = useState('pointer');
  const [actionItemsOpen, setActionItemsOpen] = useState(false);
  const [tabletSearch, setTabletSearch] = useState('');
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
            <div className="tablet-retro-toolbar">
              <div className="tablet-retro-tools-group">
                <button
                  className={`tablet-tool-btn ${tabletTool === 'pointer' ? 'active' : ''}`}
                  onClick={() => setTabletTool('pointer')}
                  title="Выбор и перемещение"
                >
                  <MousePointer size={14} />
                  <span>Выбор</span>
                </button>
                <button
                  className={`tablet-tool-btn ${tabletTool === 'sticky' ? 'active' : ''}`}
                  onClick={() => setTabletTool('sticky')}
                  title="Добавить стикер"
                >
                  <StickyNote size={14} />
                  <span>Стикер</span>
                </button>
                <button
                  className={`tablet-tool-btn ${tabletTool === 'draw' ? 'active' : ''}`}
                  onClick={() => setTabletTool('draw')}
                  title="Маркер (зажмите мышь на холсте)"
                >
                  <Pencil size={14} />
                  <span>Маркер</span>
                </button>
                <button
                  className={`tablet-tool-btn ${tabletTool === 'connector' ? 'active' : ''}`}
                  onClick={() => setTabletTool('connector')}
                  title="Соединить карточки стрелкой"
                >
                  <Link2 size={14} />
                  <span>Связь</span>
                </button>
                <button
                  className={`tablet-tool-btn ${tabletTool === 'reaction' ? 'active' : ''}`}
                  onClick={() => setTabletTool('reaction')}
                  title="Быстрая реакция"
                >
                  <ThumbsUp size={14} />
                  <span>Реакция</span>
                </button>
              </div>

              <div className="tablet-retro-actions-group">
                <button
                  className="tablet-confetti-btn"
                  onClick={() => {
                    void props.onOp?.({
                      type: 'event',
                      kind: 'confetti',
                      value: 'classic',
                    });
                  }}
                  title="Запустить праздничное конфетти"
                >
                  <PartyPopper size={14} />
                  <span>Салют</span>
                </button>

                {(() => {
                  const activeRound = props.room.state.rounds.at(-1)?.active
                    ? props.room.state.rounds.at(-1)
                    : null;
                  const myVotes = activeRound
                    ? Object.values(
                        activeRound.votes[props.room.self] || {},
                      ).reduce((a, b) => a + b, 0)
                    : 0;
                  return (
                    <div className="tablet-vote-status">
                      <span className="vote-badge">
                        🗳️{' '}
                        {activeRound
                          ? `${myVotes}/${activeRound.limit}`
                          : 'Голоса'}
                      </span>
                      {props.host && (
                        <button
                          className="tablet-vote-toggle"
                          onClick={() => {
                            if (activeRound?.active) {
                              void props.onOp?.({ type: 'vote.end' });
                            } else {
                              void props.onOp?.({
                                type: 'vote.start',
                                limit: 5,
                              });
                            }
                          }}
                        >
                          {activeRound?.active ? 'Стоп' : 'Старт'}
                        </button>
                      )}
                    </div>
                  );
                })()}

                {(() => {
                  const actionNotes = props.room.state.notes.filter(
                    (n) => n.kind === 'action' || n.kind === 'task',
                  );
                  const doneCount = actionNotes.filter(
                    (n) => n.done,
                  ).length;
                  return (
                    <button
                      className={`tablet-action-items-toggle ${actionItemsOpen ? 'active' : ''}`}
                      onClick={() => setActionItemsOpen(!actionItemsOpen)}
                      title="Список задач (Action Items)"
                    >
                      <CheckSquare size={14} />
                      <span>
                        Задачи ({doneCount}/{actionNotes.length})
                      </span>
                    </button>
                  );
                })()}
              </div>

              <div className="tablet-search-box">
                <input
                  placeholder="Поиск карточек…"
                  value={tabletSearch}
                  onChange={(e) => setTabletSearch(e.target.value)}
                  aria-label="Поиск по доске"
                />
              </div>
            </div>

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
            </div>
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
                  const active = props.room.state.time === item.id;
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
