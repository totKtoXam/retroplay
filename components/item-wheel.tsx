'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import type { WheelItem } from '@/lib/game-items';
export function ItemWheel({
  items,
  selected,
  title,
  onSelect,
  onClose,
}: {
  items: WheelItem[];
  selected: string;
  title: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [hover, setHover] = useState(
    Math.max(
      0,
      items.findIndex((i) => i.id === selected),
    ),
  );
  const point = (r: number, a: number) => [
    240 + Math.cos(a) * r,
    240 + Math.sin(a) * r,
  ];
  const active = items[hover];
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
                  ? items.length - 1
                  : 1)) %
                items.length,
            );
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            onSelect(active.id);
          }
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Колесо / стрелки — выбор · ЛКМ / Enter — применить · Esc — отменить
        </DialogDescription>
        <div
          className="item-wheel"
          onWheel={(e) => {
            e.stopPropagation();
            setHover(
              (hover + (e.deltaY > 0 ? 1 : items.length - 1)) % items.length,
            );
          }}
        >
          <svg viewBox="0 0 480 480" aria-hidden="true">
            {items.map((item, i) => {
              const a =
                  (i / items.length) * Math.PI * 2 -
                  Math.PI / 2 -
                  Math.PI / items.length +
                  0.014,
                b = a + (Math.PI * 2) / items.length - 0.028;
              const p = point(222, a),
                q = point(222, b),
                r = point(94, b),
                s = point(94, a);
              return (
                <path
                  key={item.id}
                  d={`M${p.join(',')} A222 222 0 0 1 ${q.join(',')} L${r.join(',')} A94 94 0 0 0 ${s.join(',')}Z`}
                  fill={hover === i ? item.color : '#1d2635'}
                  stroke={selected === item.id ? '#fff' : '#566173'}
                  strokeWidth={selected === item.id ? 2 : 1}
                  onPointerEnter={() => setHover(i)}
                  onClick={() => onSelect(item.id)}
                />
              );
            })}
            <circle cx="240" cy="240" r="84" fill="#111a27" stroke="#69788b" />
          </svg>
          {items.map((item, i) => {
            const p = point(
              157,
              (i / items.length) * Math.PI * 2 - Math.PI / 2,
            );
            return (
              <button
                key={item.id}
                className={`wheel-sector-label ${hover === i ? 'highlighted' : ''}`}
                style={{ left: `${p[0] / 4.8}%`, top: `${p[1] / 4.8}%` }}
                aria-pressed={selected === item.id}
                onPointerEnter={() => setHover(i)}
                onClick={() => onSelect(item.id)}
              >
                <b style={{ color: hover === i ? undefined : item.color }}>
                  {item.icon}
                </b>
                <span>{item.label}</span>
              </button>
            );
          })}
          <div className="wheel-center">
            <b style={{ color: active.color }}>{active.icon}</b>
            <strong>{active.label}</strong>
            <small>ВЫБРАТЬ</small>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
