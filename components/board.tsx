'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Minus,
  Maximize2,
  MessageCircle,
  ThumbsUp,
  LockKeyhole,
  GripVertical,
} from 'lucide-react';
import { ZONES, voteCount, type Room, type Note } from '@/lib/model';
export const zoneOrigin = (zone: string) => {
  const i = Math.max(
    0,
    ZONES.findIndex((z) => z.id === zone),
  );
  return { x: 50 + (i % 2) * 710, y: 90 + Math.floor(i / 2) * 730 };
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
};
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
  const voted = room.state.rounds.at(-1)?.votes[room.self]?.[n.id] || 0;
  const total = voteCount(room.state, n.id);
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
          <button title="Комментарии" onClick={onEdit}>
            <MessageCircle size={13} />
            {n.comments.length || ''}
          </button>
          <button
            className={voted ? 'voted' : ''}
            disabled={!room.state.rounds.at(-1)?.active || n.hidden}
            onClick={() => void onOp({ type: 'vote', id: n.id })}
            title={
              room.state.rounds.at(-1)?.active
                ? 'Отдать голос'
                : 'Результат голосования'
            }
          >
            <ThumbsUp size={13} />
            {total || ''}
          </button>
          {voted > 0 && room.state.rounds.at(-1)?.active && (
            <button
              title="Убрать голос"
              onClick={() =>
                void onOp({ type: 'vote', id: n.id, remove: true })
              }
            >
              −
            </button>
          )}
        </div>
      </div>
      {Object.entries(n.reactions).some(([, v]) => v.length > 0) && (
        <div className="note-reactions">
          {Object.entries(n.reactions)
            .filter(([, v]) => v.length)
            .map(([emoji, v]) => (
              <button
                key={emoji}
                className={v.includes(room.self) ? 'selected' : ''}
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
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);
  const [zoom, setZoom] = useState(0.65),
    [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(
      null,
    ),
    [stroke, setStroke] = useState<number[][]>([]),
    [from, setFrom] = useState('');
  const viewport = useRef<HTMLDivElement>(null),
    origin = useRef<{ x: number; y: number; nx: number; ny: number } | null>(
      null,
    ),
    strokeRef = useRef<number[][]>([]);
  const notes = room.state.notes.filter(
    (n) =>
      (!filter || n.zone === filter) &&
      n.text.toLowerCase().includes(search.toLowerCase()),
  );
  const zones =
    room.state.template === 'three'
      ? ZONES.filter((z) => z.id !== 'bad')
      : ZONES;
  const notePosition = (n: Note) => {
    const o = zoneOrigin(n.zone);
    return { x: o.x + n.x, y: o.y + n.y + 70 };
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
  return (
    <div className="board-container">
      <div className="board-caption">
        <span className="live-dot" />
        Все изменения сохраняются
        {tool === 'draw' && ' · Зажмите мышь и рисуйте'}
        {tool === 'connector' &&
          (from
            ? ' · Выберите вторую карточку'
            : ' · Выберите первую карточку')}
      </div>
      <div className="board-viewport" ref={viewport}>
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
              if (strokeRef.current.length > 1)
                void onOp({
                  type: 'note.add',
                  kind: 'draw',
                  zone: 'good',
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
                      <h2>
                        {room.state.template === 'three' && zone.id === 'good'
                          ? 'Продолжать делать'
                          : zone.title}
                      </h2>
                      <p>{zone.short.toUpperCase()}</p>
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
                  {!notes.some((n) => n.zone === zone.id) && (
                    <button
                      className="empty-zone"
                      onClick={() => onAdd(zone.id)}
                    >
                      <Plus size={23} />
                      <span>Первая идея начинается с вас</span>
                      <small>Нажмите, чтобы добавить стикер</small>
                    </button>
                  )}
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
                          className="drag-handle"
                          disabled={
                            n.locked ||
                            room.state.layoutLocked ||
                            (n.author !== room.self && room.host !== room.self)
                          }
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
                            if (drag?.id !== n.id) return;
                            const index =
                                (drag.y > 820 ? 2 : 0) + (drag.x > 750 ? 1 : 0),
                              zone = ZONES[index];
                            const o = zoneOrigin(zone.id);
                            void onOp({
                              type: 'note.edit',
                              id: n.id,
                              patch: {
                                zone: zone.id,
                                x: drag.x - o.x,
                                y: drag.y - o.y - 70,
                              },
                            });
                            setDrag(null);
                            origin.current = null;
                          }}
                        >
                          <GripVertical size={15} />
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
                  now - m.lastSeen < 15000 &&
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
