'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import type { WheelItem } from '@/lib/game-items';

/**
 * Группа секторов колеса. Одна группа — привычное колесо на весь круг. Две —
 * круг делится пополам: первая занимает верх, вторая низ. Так у краскомёта в
 * одном меню оказываются и прицелы (сверху), и краска (снизу), и не нужно
 * помнить, какой кнопкой открывается что.
 */
export type WheelGroup = {
  id: string;
  title: string;
  /** Что выбрано в этой группе сейчас. */
  selected: string;
  items: WheelItem[];
};

type Sector = WheelItem & {
  group: WheelGroup;
  /** Начало сектора, радианы от верха по часовой стрелке. */
  start: number;
  span: number;
  /** Подписи не влезают, когда полукруг делится на много секторов. */
  compact: boolean;
};

const TAU = Math.PI * 2;

/** Нормализованный угол от верха по часовой стрелке. */
function screenAngle(dx: number, dy: number) {
  const angle = Math.atan2(dy, dx) + Math.PI / 2;
  return angle < 0 ? angle + TAU : angle;
}

export function ItemWheel({
  groups,
  title,
  onSelect,
  onClose,
}: {
  groups: WheelGroup[];
  title: string;
  onSelect: (id: string, group: string) => void;
  onClose: () => void;
}) {
  const sectors = useMemo<Sector[]>(() => {
    const out: Sector[] = [];
    const groupSpan = TAU / groups.length;
    for (const [g, group] of groups.entries()) {
      const span = groupSpan / group.items.length;
      // Одна группа: первый сектор смотрит ровно вверх, как было всегда.
      // Несколько: группа занимает свою половину круга и заполняется слева
      // направо — сверху прицелы, снизу краска.
      const from =
        groups.length === 1 ? -span / 2 : g * groupSpan - groupSpan / 2;
      const compact = groups.length > 1 && group.items.length > 5;
      group.items.forEach((item, i) =>
        out.push({ ...item, group, start: from + i * span, span, compact }),
      );
    }
    return out;
  }, [groups]);
  const [hover, setHover] = useState(() =>
    Math.max(
      0,
      sectors.findIndex((s) => s.id === s.group.selected),
    ),
  );
  const point = (r: number, a: number) => [
    240 + Math.cos(a) * r,
    240 + Math.sin(a) * r,
  ];
  const active = sectors[hover];
  /** В какой сектор смотрит направление мыши. */
  const pick = (angle: number) =>
    sectors.findIndex((s) => {
      let delta = (angle - s.start) % TAU;
      if (delta < 0) delta += TAU;
      return delta < s.span;
    });

  // Пока колесо открыто, помечаем body: так CSS убирает затемняющий оверлей
  // диалога — бой за меню должен оставаться видимым.
  useEffect(() => {
    document.body.classList.add('item-wheel-open');
    return () => document.body.classList.remove('item-wheel-open');
  }, []);

  // При захваченной мыши курсора на экране нет, поэтому сектор выбирается по
  // накопленному движению мыши: меню открывается, не отпуская захват.
  useEffect(() => {
    let x = 0,
      y = 0;
    const move = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      x = Math.max(-240, Math.min(240, x + e.movementX));
      y = Math.max(-240, Math.min(240, y + e.movementY));
      if (Math.hypot(x, y) <= 25) return;
      const index = pick(screenAngle(x, y));
      if (index >= 0) setHover(index);
    };
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  });

  useEffect(() => {
    const handleUp = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        if (active) onSelect(active.id, active.group.id);
      }
    };
    window.addEventListener('mouseup', handleUp, true);
    return () => window.removeEventListener('mouseup', handleUp, true);
  }, [active, onSelect]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) <= 25) return;
    const index = pick(screenAngle(dx, dy));
    if (index >= 0) setHover(index);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="item-wheel-dialog"
        finalFocus={false}
        onKeyDown={(e) => {
          if (
            ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)
          ) {
            e.preventDefault();
            setHover(
              (hover +
                (['ArrowLeft', 'ArrowUp'].includes(e.key)
                  ? sectors.length - 1
                  : 1)) %
                sectors.length,
            );
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            onSelect(active.id, active.group.id);
          }
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Удерживайте колёсико и ведите мышью · отпустите для выбора
        </DialogDescription>
        <div
          className="item-wheel"
          onMouseMove={handleMouseMove}
          onWheel={(e) => {
            e.stopPropagation();
            setHover(
              (hover + (e.deltaY > 0 ? 1 : sectors.length - 1)) %
                sectors.length,
            );
          }}
        >
          <svg viewBox="0 0 480 480" aria-hidden="true">
            {sectors.map((item, i) => {
              const a = item.start - Math.PI / 2 + 0.014,
                b = a + item.span - 0.028;
              const p = point(222, a),
                q = point(222, b),
                r = point(94, b),
                s = point(94, a);
              const chosen = item.group.selected === item.id;
              return (
                <path
                  key={`${item.group.id}:${item.id}`}
                  className={`wheel-sector${hover === i ? ' highlighted' : ''}${chosen ? ' selected' : ''}`}
                  d={`M${p.join(',')} A222 222 0 0 1 ${q.join(',')} L${r.join(',')} A94 94 0 0 0 ${s.join(',')}Z`}
                  fill={hover === i ? item.color : '#1d2635'}
                  stroke={chosen ? '#fff' : '#566173'}
                  strokeWidth={chosen ? 2 : 1}
                  onPointerEnter={() => setHover(i)}
                  onClick={() => onSelect(item.id, item.group.id)}
                />
              );
            })}
            <circle
              className="wheel-hub"
              cx="240"
              cy="240"
              r="84"
              fill="#111a27"
              stroke="#69788b"
            />
          </svg>
          {sectors.map((item, i) => {
            const p = point(157, item.start + item.span / 2 - Math.PI / 2);
            return (
              <button
                key={`${item.group.id}:${item.id}`}
                className={`wheel-sector-label ${hover === i ? 'highlighted' : ''} ${item.compact ? 'compact' : ''}`}
                style={{ left: `${p[0] / 4.8}%`, top: `${p[1] / 4.8}%` }}
                aria-label={item.label}
                aria-pressed={item.group.selected === item.id}
                onPointerEnter={() => setHover(i)}
                onClick={() => onSelect(item.id, item.group.id)}
              >
                <b style={{ color: hover === i ? undefined : item.color }}>
                  {item.icon}
                </b>
                {!item.compact && <span>{item.label}</span>}
              </button>
            );
          })}
          <div className="wheel-center">
            <b style={{ color: active.color }}>{active.icon}</b>
            <strong>{active.label}</strong>
            {groups.length > 1 ? (
              <small>{active.group.title}</small>
            ) : (
              <small>ВЫБРАТЬ</small>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
