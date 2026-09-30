'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Plus,
  Minus,
  Maximize2,
  MessageCircle,
  ThumbsUp,
  LockKeyhole,
  GripVertical,
} from 'lucide-react';
import {
  isOnline,
  templateZones,
  voteCount,
  ZONES,
  zoneTitle,
  type Room,
  type Note,
} from '@/lib/model';
export const zoneOrigin = (zone: string) => {
  const i = Math.max(
    0,
    ZONES.findIndex((z) => z.id === zone),
  );
  return { x: 50 + (i % 2) * 710, y: 90 + Math.floor(i / 2) * 730 };
};
/** Размер холста доски в его собственных единицах (до масштаба). */
const PLANE_W = 1540,
  PLANE_H = 1630;
/** Шаг переноса карточки стрелками; с Shift — крупный. */
const KEY_STEP = 12,
  KEY_STEP_BIG = 60;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
/** Состояние связи с комнатой — показывается в подписи доски, если его передали. */
export type BoardSyncStatus = 'saved' | 'saving' | 'reconnecting' | 'offline';
const SYNC_LABELS: Record<BoardSyncStatus, string> = {
  saved: 'Сохранено',
  saving: 'Сохраняем…',
  reconnecting: 'Переподключаемся…',
  offline: 'Офлайн — изменения не отправлены',
};
type Props = {
  room: Room;
  tool: string;
  onEdit: (n: Note) => void;
  onAdd: (zone: string, x?: number, y?: number) => void;
  onOp: (op: Record<string, unknown>) => Promise<unknown>;
  filter?: string;
  search?: string;
  onCursor?: (x: number, y: number) => void;
  /** Статус связи из шапки комнаты. Не передан — доска о сохранении молчит. */
  syncStatus?: BoardSyncStatus;
};
/**
 * Почему голос за карточку сейчас отдать нельзя; пустая строка — можно.
 * Повторяет проверки сервера (lib/model.ts, op `vote`), чтобы кнопка не
 * обещала то, что сервер отклонит.
 */
function voteBlockReason(room: Room, n: Note) {
  const round = room.state.rounds.at(-1);
  if (!round?.active)
    return room.state.rounds.length
      ? 'Голосование завершено'
      : 'Голосование ещё не началось';
  if (n.hidden) return 'Сначала раскройте заметку';
  const used = Object.values(round.votes[room.self] || {}).reduce(
    (a, b) => a + b,
    0,
  );
  return used >= round.limit ? 'Голоса закончились' : '';
}
export function Card({
  note: n,
  room,
  onEdit,
  onOp,
  style,
  dragHandle,
}: {
  note: Note;
  room: Room;
  onEdit: () => void;
  onOp: Props['onOp'];
  style?: React.CSSProperties;
  dragHandle?: React.ReactNode;
}) {
  // Подсказка, почему голос не принят: title на касание не показывается.
  const [voteHint, setVoteHint] = useState('');
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );
  if (n.redacted)
    return (
      <article
        className="note-card private-placeholder"
        style={{ background: n.color, ...style }}
        aria-label="Приватный стикер"
      >
        <svg viewBox="0 0 200 130" aria-hidden="true">
          {[25, 50, 75, 100].map((y, i) => (
            <path
              key={y}
              d={`M15 ${y} q8 -15 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 ${i % 2 ? '' : 't15 0 t15 0'}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          ))}
        </svg>
        <small>🔒 Приватно</small>
      </article>
    );
  const person = room.members.find((m) => m.id === n.author);
  const round = room.state.rounds.at(-1);
  const voted = round?.votes[room.self]?.[n.id] || 0;
  const total = voteCount(room.state, n.id);
  const voteBlocked = voteBlockReason(room, n);
  const vote = () => {
    if (!voteBlocked) {
      void onOp({ type: 'vote', id: n.id });
      return;
    }
    setVoteHint(voteBlocked);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setVoteHint(''), 2500);
  };
  return (
    <article
      className={`note-card kind-${n.kind} ${n.done ? 'done' : ''}`}
      style={{ background: n.color, ...style }}
    >
      <div className="note-top">
        <span>
          {n.kind === 'action'
            ? '✓ Задача'
            : n.kind === 'index'
              ? 'Карточка'
              : n.kind === 'roadmap'
                ? 'План'
                : n.kind === 'task'
                  ? 'Задача'
                  : n.hidden
                    ? '🔒 Только вам'
                    : n.tags[0]
                      ? '#' + n.tags[0]
                      : ''}
        </span>
        <div>
          {n.locked && <LockKeyhole size={12} />} {dragHandle}
        </div>
      </div>
      <button className="note-content" onClick={onEdit}>
        {n.kind === 'image' && n.url ? (
          n.url.match(/\.(png|jpe?g|webp|gif)(\?.*)?$/i) ? (
            // Пользовательские HTTPS-изображения без серверного прокси, размер ограничен карточкой.
            // oxlint-disable-next-line next/no-img-element
            <img
              src={n.url}
              alt={n.text || 'Изображение на доске'}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.alt = 'Не удалось загрузить изображение';
              }}
            />
          ) : (
            <span className="media-link">↗ {n.text || 'Открыть медиа'}</span>
          )
        ) : (
          n.text || 'Новая заметка'
        )}
      </button>
      {n.group && (
        <span className="note-group">
          {room.state.groups.find((g) => g.id === n.group)?.title}
        </span>
      )}
      {n.owner && (
        <span className="note-assignee">
          {n.owner}
          {n.due ? ' · ' + n.due : ''}
        </span>
      )}
      <div className="note-bottom">
        <span className="note-author">
          {n.anonymous || room.state.anonymousPlayers
            ? 'Анонимно'
            : person?.name || 'Участник'}
        </span>
        <div>
          <button
            title="Комментарии"
            aria-label={`Комментарии: ${n.comments.length}`}
            onClick={onEdit}
          >
            <MessageCircle size={13} aria-hidden="true" />
            {n.comments.length || ''}
          </button>
          {/* aria-disabled вместо disabled: кнопка остаётся в фокусе и с
              подсказкой, а нажатие объясняет, почему голос не принят. */}
          <button
            className={voted ? 'voted' : ''}
            aria-disabled={voteBlocked ? true : undefined}
            onClick={vote}
            title={
              voteBlocked
                ? `${voteBlocked} · голосов: ${total}`
                : `Отдать голос · ваших здесь: ${voted}`
            }
            aria-label={
              (voteBlocked || 'Отдать голос') + `. Голосов у карточки: ${total}`
            }
          >
            <ThumbsUp size={13} aria-hidden="true" />
            {total || ''}
          </button>
          {voted > 0 && round?.active && (
            <button
              title="Убрать свой голос"
              aria-label="Убрать свой голос"
              onClick={() =>
                void onOp({ type: 'vote', id: n.id, remove: true })
              }
            >
              <Minus size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {voteHint && (
        <output className="note-vote-hint">{voteHint}</output>
      )}
      {Object.entries(n.reactions).some(([, v]) => v.length > 0) && (
        <div className="note-reactions">
          {Object.entries(n.reactions)
            .filter(([, v]) => v.length)
            .map(([emoji, v]) => (
              <button
                key={emoji}
                className={v.includes(room.self) ? 'selected' : ''}
                aria-pressed={v.includes(room.self)}
                aria-label={`Реакция ${emoji}: ${v.length}`}
                onClick={() =>
                  void onOp({ type: 'note.react', id: n.id, emoji })
                }
              >
                {emoji} {v.length}
              </button>
            ))}
        </div>
      )}
    </article>
  );
}
export default function Board({
  room,
  tool,
  onEdit,
  onAdd,
  onOp,
  filter,
  search = '',
  onCursor,
  syncStatus,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);
  // Холст шире планшета: при открытии показываем доску целиком по ширине.
  const [zoom, setZoom] = useState(0.65),
    [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(
      null,
    ),
    [stroke, setStroke] = useState<number[][]>([]),
    [from, setFrom] = useState('');
  const viewport = useRef<HTMLDivElement>(null),
    fitted = useRef(false),
    origin = useRef<{ x: number; y: number; nx: number; ny: number } | null>(
      null,
    ),
    strokeRef = useRef<number[][]>([]),
    pan = useRef<{ x: number; y: number; left: number; top: number } | null>(
      null,
    );
  const [panning, setPanning] = useState(false);
  /** Что сказать экранному диктору после переноса карточки с клавиатуры. */
  const [announce, setAnnounce] = useState('');
  const moveHintId = useId();
  /** Карточка, которую сейчас двигают стрелками и ещё не сохранили. */
  const keyMoving = useRef<string | null>(null);
  const fit = useCallback((node: HTMLDivElement | null) => {
    viewport.current = node;
    if (!node || fitted.current) return;
    fitted.current = true;
    setZoom(Math.max(0.3, Math.min(1, (node.clientWidth - 60) / 1540)));
  }, []);
  const notes = room.state.notes.filter(
    (n) =>
      (!filter || n.zone === filter) &&
      n.text.toLowerCase().includes(search.toLowerCase()),
  );
  const zones =
    templateZones(room.state.template);
  const searching = search.trim() !== '';
  const zoneName = (id: string) => zoneTitle(id, room.state.template);
  const notePosition = (n: Note) => {
    const o = zoneOrigin(n.zone);
    return { x: o.x + n.x, y: o.y + n.y + 70 };
  };
  /** Зона под точкой холста. Формат из трёх колонок прячет одну ячейку сетки — берём ближайшую видимую. */
  const zoneAt = (x: number, y: number) => {
    const index = (y > 820 ? 2 : 0) + (x > 750 ? 1 : 0);
    const distance = (id: string) => {
      const c = zoneOrigin(id);
      return (x - c.x - 355) ** 2 + (y - c.y - 365) ** 2;
    };
    return zones.includes(ZONES[index])
      ? ZONES[index]
      : zones.reduce((a, b) => (distance(b.id) < distance(a.id) ? b : a));
  };
  /**
   * Сохранить новое место карточки — общий путь для мыши и клавиатуры.
   * Черновик позиции держим до ответа сервера, иначе карточка на миг
   * прыгает назад, пока не придёт новое состояние.
   */
  const moveNote = (n: Note, x: number, y: number) => {
    const zone = zoneAt(x, y);
    const o = zoneOrigin(zone.id);
    void onOp({
      type: 'note.edit',
      id: n.id,
      patch: { zone: zone.id, x: x - o.x, y: y - o.y - 70 },
    })
      .catch(() => null)
      .finally(() =>
        setDrag((d) => (d?.id === n.id && d.x === x && d.y === y ? null : d)),
      );
    return zone;
  };
  const point = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  };
  const clicked = (n: Note) => {
    if (tool === 'connector') {
      if (!from) setFrom(n.id);
      else if (from !== n.id) {
        void onOp({
          type: 'note.add',
          kind: 'connector',
          zone: n.zone,
          from,
          to: n.id,
          text: '',
        });
        setFrom('');
      }
    } else if (tool === 'reaction')
      void onOp({ type: 'note.react', id: n.id, emoji: '👍' });
    else onEdit(n);
  };
  const toolHint =
    tool === 'draw'
      ? 'Зажмите мышь и рисуйте'
      : tool === 'connector'
        ? from
          ? 'Выберите вторую карточку'
          : 'Выберите первую карточку'
        : '';
  return (
    <div className="board-container">
      {(syncStatus || toolHint) && (
        <output className="board-caption">
          {syncStatus && (
            <>
              <span className="live-dot" data-sync={syncStatus} />
              {SYNC_LABELS[syncStatus]}
            </>
          )}
          {syncStatus && toolHint && ' · '}
          {toolHint}
        </output>
      )}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <p className="sr-only" id={moveHintId}>
        Стрелки двигают карточку, Shift — крупный шаг, Esc — отмена.
      </p>
      <div
        className="board-viewport"
        ref={fit}
        onPointerDown={(e) => {
          const onEmpty = !(e.target as HTMLElement).closest(
            'button,article,input,textarea',
          );
          if (e.button !== 1 && !(e.button === 0 && tool === 'pointer' && onEmpty))
            return;
          pan.current = {
            x: e.clientX,
            y: e.clientY,
            left: e.currentTarget.scrollLeft,
            top: e.currentTarget.scrollTop,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          setPanning(true);
        }}
        onPointerMove={(e) => {
          if (!pan.current) return;
          e.currentTarget.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
          e.currentTarget.scrollTop = pan.current.top - (e.clientY - pan.current.y);
        }}
        onPointerUp={() => {
          pan.current = null;
          setPanning(false);
        }}
        onPointerCancel={() => {
          pan.current = null;
          setPanning(false);
        }}
        data-panning={panning || undefined}
      >
        <div style={{ width: 1540 * zoom, height: 1630 * zoom }}>
          <div
            className={`board-plane tool-${tool}`}
            style={{ transform: `scale(${zoom})` }}
            onPointerDown={(e) => {
              if (
                tool !== 'draw' ||
                (e.target as HTMLElement).closest('button,article')
              )
                return;
              const p = point(e);
              strokeRef.current = [p];
              setStroke([p]);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const cursor = point(e);
              onCursor?.(cursor[0], cursor[1]);
              if (!strokeRef.current.length) return;
              const p = point(e);
              if (strokeRef.current.length < 400) {
                strokeRef.current.push(p);
                setStroke([...strokeRef.current]);
              }
            }}
            onPointerUp={() => {
              // Рисунок принадлежит зоне, где начат штрих, а не всегда «good»:
              // иначе фильтр по зоне и экспорт относили все рисунки к ней.
              const [start] = strokeRef.current;
              if (strokeRef.current.length > 1)
                void onOp({
                  type: 'note.add',
                  kind: 'draw',
                  zone: zoneAt(start[0], start[1]).id,
                  points: strokeRef.current,
                  color: '#417a65',
                });
              strokeRef.current = [];
              setStroke([]);
            }}
          >
            <div className="board-title">
              <h2>{room.state.title}</h2>
              <p>
                Поделитесь наблюдениями. Найдите главное. Договоритесь о
                следующем шаге.
              </p>
            </div>
            {zones.map((zone) => {
              const o = zoneOrigin(zone.id);
              return (
                <section
                  key={zone.id}
                  className="board-zone"
                  style={{
                    left: o.x,
                    top: o.y,
                    background: zone.color + '27',
                    borderColor: zone.color + '77',
                  }}
                  onDoubleClick={(e) => {
                    if ((e.target as HTMLElement).closest('article,button'))
                      return;
                    const r = e.currentTarget.getBoundingClientRect();
                    onAdd(
                      zone.id,
                      (e.clientX - r.left) / zoom - 110,
                      (e.clientY - r.top) / zoom - 70,
                    );
                  }}
                >
                  <header>
                    <span className="zone-emoji">{zone.emoji}</span>
                    <div>
                      <h2>{zoneTitle(zone.id, room.state.template)}</h2>
                    </div>
                    <span className="zone-count">
                      {
                        notes.filter(
                          (n) =>
                            n.zone === zone.id &&
                            n.kind !== 'connector' &&
                            n.kind !== 'draw',
                        ).length
                      }
                    </span>
                    <button
                      aria-label={'Добавить: ' + zone.title}
                      onClick={() => onAdd(zone.id)}
                    >
                      <Plus size={21} />
                    </button>
                  </header>
                  <p className="zone-hint">{zone.hint}</p>
                  {!notes.some((n) => n.zone === zone.id) &&
                    (searching || (filter && filter !== zone.id) ? (
                      // Зона пуста только из-за поиска или фильтра — звать
                      // «добавить первую идею» здесь неверно.
                      <p className="empty-zone empty-zone-search">
                        <span>Ничего не найдено</span>
                        {searching && <small>Попробуйте другой запрос</small>}
                      </p>
                    ) : (
                      <button
                        className="empty-zone"
                        onClick={() => onAdd(zone.id)}
                      >
                        <Plus size={23} aria-hidden="true" />
                        <span>Первая идея начинается с вас</span>
                        <small>Нажмите, чтобы добавить стикер</small>
                      </button>
                    ))}
                </section>
              );
            })}
            <svg className="drawing-layer" width={1540} height={1630}>
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#527967" />
                </marker>
              </defs>
              {notes
                .filter((n) => n.kind === 'draw')
                .map((n) => (
                  <polyline
                    key={n.id}
                    points={n.points.map((p) => p.join(',')).join(' ')}
                    fill="none"
                    stroke={n.color}
                    strokeWidth="4"
                    strokeLinecap="round"
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onClick={() => onEdit(n)}
                  />
                ))}
              {stroke.length > 1 && (
                <polyline
                  points={stroke.map((p) => p.join(',')).join(' ')}
                  fill="none"
                  stroke="#417a65"
                  strokeWidth="4"
                />
              )}
              {notes
                .filter((n) => n.kind === 'connector')
                .map((n) => {
                  const a = room.state.notes.find((v) => v.id === n.from),
                    b = room.state.notes.find((v) => v.id === n.to);
                  if (!a || !b) return null;
                  const p = notePosition(a),
                    q = notePosition(b);
                  return (
                    <g
                      key={n.id}
                      onClick={() => onEdit(n)}
                      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    >
                      <line
                        x1={p.x + a.width / 2}
                        y1={p.y + a.height / 2}
                        x2={q.x + b.width / 2}
                        y2={q.y + b.height / 2}
                        stroke="#527967"
                        strokeWidth="3"
                        markerEnd="url(#arrow)"
                      />
                      <text
                        x={(p.x + q.x) / 2 + 110}
                        y={(p.y + q.y) / 2 + 75}
                        fill="#365849"
                        fontSize="16"
                      >
                        {n.text}
                      </text>
                    </g>
                  );
                })}
            </svg>
            {notes
              .filter((n) => !['draw', 'connector'].includes(n.kind))
              .map((n) => {
                const p = notePosition(n),
                  x = drag?.id === n.id ? drag.x : p.x,
                  y = drag?.id === n.id ? drag.y : p.y;
                return (
                  <div
                    key={n.id}
                    className={`positioned-note ${from === n.id ? 'connector-selected' : ''}`}
                    style={{
                      left: x,
                      top: y,
                      width: n.width,
                      minHeight: n.height,
                      transform: `rotate(${n.rotation}deg)`,
                    }}
                  >
                    <Card
                      note={n}
                      room={room}
                      onEdit={() => clicked(n)}
                      onOp={onOp}
                      style={{ minHeight: n.height }}
                      dragHandle={
                        <button
                          aria-label="Переместить карточку"
                          aria-describedby={moveHintId}
                          title="Перетащите мышью или двигайте стрелками (Shift — крупный шаг)"
                          className="drag-handle"
                          disabled={
                            n.locked ||
                            room.state.layoutLocked ||
                            (n.author !== room.self && room.host !== room.self)
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Escape' && drag?.id === n.id) {
                              // Отмена переноса, а не закрытие планшета.
                              e.preventDefault();
                              e.stopPropagation();
                              keyMoving.current = null;
                              setDrag(null);
                              return;
                            }
                            const dir = ARROWS[e.key];
                            if (!dir || e.altKey || e.ctrlKey || e.metaKey)
                              return;
                            e.preventDefault();
                            e.stopPropagation();
                            const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
                            keyMoving.current = n.id;
                            setDrag((d) => {
                              const base = d?.id === n.id ? d : { x: p.x, y: p.y };
                              return {
                                id: n.id,
                                x: Math.min(
                                  PLANE_W - n.width,
                                  Math.max(0, base.x + dir[0] * step),
                                ),
                                y: Math.min(
                                  PLANE_H - n.height,
                                  Math.max(70, base.y + dir[1] * step),
                                ),
                              };
                            });
                            const handle = e.currentTarget;
                            requestAnimationFrame(() =>
                              handle.scrollIntoView({
                                block: 'nearest',
                                inline: 'nearest',
                              }),
                            );
                          }}
                          onKeyUp={(e) => {
                            // Держим стрелку — едем, отпустили — сохраняем одним запросом.
                            if (
                              !ARROWS[e.key] ||
                              keyMoving.current !== n.id ||
                              drag?.id !== n.id
                            )
                              return;
                            keyMoving.current = null;
                            const zone = moveNote(n, drag.x, drag.y);
                            setAnnounce(`Карточка в зоне «${zoneName(zone.id)}»`);
                          }}
                          onBlur={() => {
                            if (keyMoving.current !== n.id || drag?.id !== n.id)
                              return;
                            keyMoving.current = null;
                            moveNote(n, drag.x, drag.y);
                          }}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            origin.current = {
                              x: e.clientX,
                              y: e.clientY,
                              nx: p.x,
                              ny: p.y,
                            };
                            setDrag({ id: n.id, x: p.x, y: p.y });
                          }}
                          onPointerMove={(e) => {
                            if (drag?.id !== n.id || !origin.current) return;
                            setDrag({
                              id: n.id,
                              x: Math.max(
                                0,
                                origin.current.nx +
                                  (e.clientX - origin.current.x) / zoom,
                              ),
                              y: Math.max(
                                70,
                                origin.current.ny +
                                  (e.clientY - origin.current.y) / zoom,
                              ),
                            });
                          }}
                          onPointerUp={() => {
                            if (drag?.id !== n.id || !origin.current) return;
                            origin.current = null;
                            // Клик без сдвига — не повод слать правку.
                            if (drag.x === p.x && drag.y === p.y) setDrag(null);
                            else moveNote(n, drag.x, drag.y);
                          }}
                          onPointerCancel={() => {
                            if (drag?.id !== n.id) return;
                            origin.current = null;
                            setDrag(null);
                          }}
                        >
                          <GripVertical size={15} aria-hidden="true" />
                        </button>
                      }
                    />
                  </div>
                );
              })}
            {room.members
              .filter(
                (m) =>
                  m.id !== room.self &&
                  isOnline(m.lastSeen, now) &&
                  (m.cursor?.mode === 'board' || m.cursor?.mode === 'tablet'),
              )
              .map((m) => {
                const isAnonymous =
                  room.state.anonymousPlayers ||
                  room.state.anonymous ||
                  m.hat === 'bag';
                const displayName = isAnonymous ? 'Аноним' : m.name;
                const displayColor = isAnonymous ? '#8892b0' : m.color;
                return (
                  <div
                    className={`live-cursor ${isAnonymous ? 'cursor-anonymous' : ''}`}
                    key={m.id}
                    style={{
                      left: m.cursor?.x || 0,
                      top: m.cursor?.y || 0,
                      color: displayColor,
                    }}
                  >
                    <span>➤</span>
                    <small style={{ background: displayColor }}>
                      {isAnonymous ? '🛍️ ' : ''}{displayName}
                    </small>
                  </div>
                );
              })}{' '}
          </div>
        </div>
      </div>
      <div className="zoom-controls">
        <button
          aria-label="Уменьшить масштаб"
          onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
        >
          <Minus size={17} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="Увеличить масштаб"
          onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
        >
          <Plus size={17} />
        </button>
        <i />
        <button
          aria-label="Показать всю доску"
          onClick={() =>
            setZoom(
              Math.max(
                0.3,
                Math.min(0.8, (viewport.current?.clientWidth || 1000) / 1550),
              ),
            )
          }
        >
          <Maximize2 size={17} />
        </button>
      </div>
    </div>
  );
}
