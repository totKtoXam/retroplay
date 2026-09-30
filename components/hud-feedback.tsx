'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { relativeAngle } from '@/lib/hud-feedback';
import type { CrosshairStyle } from '@/lib/hud-prefs';

/*
 * Мгновенная обратная связь боя (план UX/UI, этап 3.2–3.3): прицел, отметка
 * попадания, дуги урона и тревога низкого здоровья. Стили — app/hud.css.
 */

/**
 * Прицел. Четыре луча с зазором и точка: вид выбирается в настройках
 * (`cross` — лучи, `dot` — точка, `cross-dot` — оба). Тёмная обводка у каждой
 * детали: белый 1px без неё терялся на снегу и на небе.
 */
export function HudCrosshair({
  style,
  color,
  hidden,
}: {
  style: CrosshairStyle;
  color: string;
  hidden: boolean;
}) {
  return (
    <div
      className={`crosshair hud-crosshair is-${style} ${hidden ? 'is-hidden' : ''}`}
      style={{ '--crosshair-color': color } as React.CSSProperties}
      aria-hidden="true"
    >
      <i className="hud-crosshair-up" />
      <i className="hud-crosshair-down" />
      <i className="hud-crosshair-left" />
      <i className="hud-crosshair-right" />
      <b />
    </div>
  );
}

/** Отметка своего попадания; `kill` — отдельная ступень: крупнее и с подписью. */
export type HudMarkZone = 'head' | 'torso' | 'limb' | 'kill';

const MARK_LABEL: Partial<Record<HudMarkZone, string>> = {
  head: 'В ГОЛОВУ',
  limb: 'ПО КОНЕЧНОСТИ',
  kill: 'УСТРАНЁН',
};

export function HudHitMark({ zone }: { zone: HudMarkZone }) {
  const label = MARK_LABEL[zone];
  return (
    <div className={`hit-mark hit-mark-${zone}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      {label && <b>{label}</b>}
    </div>
  );
}

/** Одно попадание по игроку: откуда (точка на карте) или `null`, если источник неизвестен. */
export type DamageHit = { key: number; source: { x: number; z: number } | null };

/**
 * Дуги урона по краю экрана. Дуга смотрит на источник и поворачивается вслед за
 * камерой, пока не погаснет: развернулся к стрелку — дуга ушла вверх. Цвет
 * постоянный (--hud-danger), а не цвет чужой краски: урон должен читаться
 * одинаково, чем бы ни стреляли. Попадание без известного источника — вспышка
 * по всему краю.
 */
export function HudDamage({
  hits,
  view,
}: {
  hits: DamageHit[];
  /** Где игрок и куда смотрит — читается каждый кадр, без ре-рендера. */
  view: () => { x: number; z: number; yaw: number } | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const directional = hits.filter((h) => h.source);
  const arcKeys = directional.map((h) => h.key).join();
  // До первой отрисовки: иначе новая дуга на кадр мелькнула бы не на своём месте.
  useLayoutEffect(() => {
    if (!arcKeys) return;
    let raf = 0;
    const place = () => {
      const me = viewRef.current();
      const el = root.current;
      if (me && el) {
        for (const arc of el.querySelectorAll<HTMLElement>('.hud-damage-arc')) {
          const x = Number(arc.dataset.x),
            z = Number(arc.dataset.z);
          const angle = relativeAngle(me, { x, z }, me.yaw);
          // Точка на эллипсе, вписанном в экран: дуга держится у края и сверху,
          // и сбоку, а не на круге вокруг прицела. Сверху отступ больше: там шапка.
          arc.style.left = `${50 + Math.sin(angle) * 43}%`;
          arc.style.top = `${52 - Math.cos(angle) * 37}%`;
          arc.style.setProperty('--arc-angle', `${angle}rad`);
        }
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [arcKeys]);
  if (!hits.length) return null;
  const blind = hits.find((h) => !h.source);
  return (
    <div ref={root} className="hud-damage" aria-hidden="true">
      {blind && <div key={blind.key} className="hud-damage-flash" />}
      {directional.map((h) => (
        <div
          key={h.key}
          className="hud-damage-arc"
          data-x={h.source!.x}
          data-z={h.source!.z}
        />
      ))}
    </div>
  );
}

/** Мало здоровья: красная виньетка по краю. Пульсирует; при reduced motion — статична. */
export function HudLowHealth() {
  return <div className="hud-low-hp" aria-hidden="true" />;
}
