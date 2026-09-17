'use client';
import { useEffect, useRef } from 'react';
import type { GameMap } from '@/lib/maps/types';
import type { MinimapBlip } from '@/lib/minimap-blips';
/** Снимок кадра: своя поза приходит из движка, чужие — из последнего состояния комнаты. */
export type MinimapFrame = { x: number; z: number; yaw: number; blips: MinimapBlip[] };

/** Сторона плашки в CSS-пикселях. */
const SIZE = 168;
/** Развёрнутый план по M: во весь свободный экран, но не больше этого. */
const EXPANDED_MAX = 640;
/** Поля внутри плашки, CSS-пиксели. */
const PAD = 6;
/** Высота, выше которой блок считается верхним ярусом и рисуется светлее. */
const HIGH_Y = 2;

const COLORS = {
  ground: 'rgba(148, 163, 184, 0.16)',
  wall: 'rgba(226, 232, 240, 0.34)',
  high: 'rgba(226, 232, 240, 0.62)',
  floor: 'rgba(148, 197, 226, 0.34)',
  ramp: 'rgba(250, 204, 121, 0.55)',
  water: 'rgba(80, 150, 200, 0.42)',
  self: '#ffffff',
  spot: 'rgba(255, 255, 255, 0.92)',
  red: '#ff6b7a',
  blue: '#6ba8ff',
  ally: '#6ee7a8',
};

/**
 * Пересчёт мировых метров в пиксели холста. Статический слой и точки бойцов
 * обязаны считать его одинаково — иначе стрелка едет относительно стен, — и
 * поэтому проекция живёт в одном месте, а не повторяется в двух.
 */
function projection(map: GameMap, px: number, dpr: number) {
  const b = map.bounds;
  const pad = PAD * dpr;
  const inner = px - pad * 2;
  const scale = inner / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  // Карта не квадратная: по короткой стороне центрируем остаток.
  const offX = pad + (inner - (b.maxX - b.minX) * scale) / 2;
  const offZ = pad + (inner - (b.maxZ - b.minZ) * scale) / 2;
  return {
    scale,
    toX: (x: number) => offX + (x - b.minX) * scale,
    toZ: (z: number) => offZ + (z - b.minZ) * scale,
  };
}

type Projection = ReturnType<typeof projection>;

/**
 * Короткое название отсека для угловой плашки: «Нижний двигатель» → «Ниж. двиг.»,
 * «Администрация» → «Админ.». На развёрнутом плане места хватает на полное.
 */
export function shortZoneName(name: string) {
  const words = name.split(' ');
  if (words.length > 1) return words.map((w) => (w.length > 5 ? w.slice(0, 4) + '.' : w)).join(' ');
  return name.length > 9 ? name.slice(0, 5) + '.' : name;
}

/**
 * Статический слой: всё, что не двигается, рисуется один раз в отдельный холст
 * и дальше только копируется. Иначе каждый кадр перерисовывал бы сотни
 * прямоугольников поверх сцены, которая и так занимает кадр целиком.
 */
function drawStatic(
  map: GameMap,
  px: number,
  p: Projection,
  labels: { font: number; short: boolean } | null,
): HTMLCanvasElement {
  const layer = document.createElement('canvas');
  layer.width = px;
  layer.height = px;
  const ctx = layer.getContext('2d');
  if (!ctx) return layer;
  const b = map.bounds;
  const rect = (x0: number, z0: number, w: number, d: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(p.toX(x0), p.toZ(z0), Math.max(1, w * p.scale), Math.max(1, d * p.scale));
  };

  rect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ, COLORS.ground);

  const arena = map.arena;
  if (arena) {
    for (const w of arena.water ?? [])
      rect(w.minX, w.minZ, w.maxX - w.minX, w.maxZ - w.minZ, COLORS.water);
    for (const f of arena.boxes)
      if (f.floor) rect(f.x - f.w / 2, f.z - f.d / 2, f.w, f.d, COLORS.floor);
    for (const r of arena.ramps ?? [])
      rect(r.minX, r.minZ, r.maxX - r.minX, r.maxZ - r.minZ, COLORS.ramp);
    // Стены и укрытия поверх пола и пандусов: по ним игрок и читает проходы.
    for (const s of arena.boxes) {
      if (!s.solid) continue;
      rect(
        s.x - s.w / 2,
        s.z - s.d / 2,
        s.w,
        s.d,
        s.y + s.h / 2 >= HIGH_Y ? COLORS.high : COLORS.wall,
      );
    }
    for (const c of arena.cylinders ?? []) {
      if (!c.solid) continue;
      rect(
        c.x - c.r,
        c.z - c.r,
        c.r * 2,
        c.r * 2,
        c.y + c.h / 2 >= HIGH_Y ? COLORS.high : COLORS.wall,
      );
    }
    // Названия отсеков — поверх стен, по центру отсека, с тёмной обводкой для читаемости.
    if (labels && arena.zones?.length) {
      ctx.font = `600 ${labels.font}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, labels.font / 3.5);
      ctx.strokeStyle = 'rgba(8, 13, 25, 0.9)';
      ctx.fillStyle = 'rgba(241, 245, 251, 0.95)';
      for (const z of arena.zones) {
        const text = labels.short ? shortZoneName(z.name) : z.name;
        const x = p.toX((z.minX + z.maxX) / 2),
          y = p.toZ((z.minZ + z.maxZ) / 2);
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
      }
    }
  } else {
    // Хаб описан не ареной, а готовыми коллайдерами — рисуем их.
    for (const c of map.colliders)
      rect(
        c.minX,
        c.minZ,
        c.maxX - c.minX,
        c.maxZ - c.minZ,
        c.maxY >= HIGH_Y ? COLORS.high : COLORS.wall,
      );
  }
  return layer;
}

/**
 * Миникарта в правом нижнем углу: план карты сверху, своя стрелка и точки
 * остальных. Север всегда наверху — карту запоминают по её очертаниям, а
 * вращающийся план каждый раз выглядит новым.
 *
 * Данные берутся вызовом `read()` внутри собственного кадра, а не пропсами:
 * поза меняется 60 раз в секунду, и проводить её через состояние React значило
 * бы перерисовывать весь HUD поверх каждого кадра сцены.
 */
export function WorldMinimap(props: {
  map: GameMap;
  read: () => MinimapFrame | null;
  /** Развёрнутый план по M. */
  expanded?: boolean;
  /** Сторона угловой плашки, CSS-пиксели (по умолчанию SIZE). */
  size?: number;
  /** Подписывать отсеки карты (у карт с `zones`). */
  labels?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Кадр берёт свежий `read` через ref, чтобы смена коллбэка не перезапускала
  // цикл отрисовки и не перерисовывала статический слой заново.
  const read = useRef(props.read);
  useEffect(() => {
    read.current = props.read;
  }, [props.read]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let px = 0;
    let statics: HTMLCanvasElement | null = null;
    let p: ReturnType<typeof projection> | null = null;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    // Развёрнутый план зависит от размера окна, поэтому холст пересобирается и
    // при переключении, и при изменении окна: растянутая картинка мылит план, а
    // по нему считывают геометрию.
    const setup = () => {
      const side = props.expanded
        ? Math.max(260, Math.min(EXPANDED_MAX, Math.min(window.innerWidth, window.innerHeight) - 96))
        : (props.size ?? SIZE);
      px = Math.round(side * dpr);
      el.width = px;
      el.height = px;
      el.style.width = `${side}px`;
      el.style.height = `${side}px`;
      p = projection(props.map, px, dpr);
      statics = drawStatic(
        props.map,
        px,
        p,
        props.labels ? { font: Math.round((props.expanded ? 13 : 9) * dpr), short: !props.expanded } : null,
      );
    };
    setup();
    const onResize = () => setup();
    window.addEventListener('resize', onResize);

    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!statics || !p) return;
      const data = read.current();
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(statics, 0, 0);
      if (!data) return;
      // Отметки и стрелка — одного размера на экране при любой стороне плашки.
      const unit = props.expanded ? px / (SIZE * dpr) : 1;
      for (const blip of data.blips) {
        const r = (blip.enemy ? 3.6 : 3) * dpr * unit;
        ctx.globalAlpha = blip.dead ? 0.3 : (blip.fresh ?? 1);
        ctx.beginPath();
        ctx.arc(p.toX(blip.x), p.toZ(blip.z), r, 0, Math.PI * 2);
        ctx.fillStyle =
          blip.team === 'red' ? COLORS.red : blip.team === 'blue' ? COLORS.blue : COLORS.ally;
        ctx.fill();
        // Засвеченный враг обведён: цвет команды говорит, чей он, а кольцо — что
        // это разведанная цель, а не свой, которого видно всегда.
        if (blip.enemy) {
          ctx.strokeStyle = COLORS.spot;
          ctx.lineWidth = 1.4 * dpr * unit;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // Своя стрелка рисуется последней и всегда поверх: на ней глаз и стоит.
      ctx.save();
      ctx.translate(p.toX(data.x), p.toZ(data.z));
      // При yaw = 0 движок ведёт игрока в −z (world-player.ts), то есть вверх по
      // плану — туда же смотрит и нарисованная вверх стрелка. Дальше направление
      // (−sin yaw, −cos yaw) совпадает с поворотом холста на −yaw.
      ctx.rotate(-data.yaw);
      ctx.beginPath();
      ctx.moveTo(0, -6 * dpr * unit);
      ctx.lineTo(4.5 * dpr * unit, 5 * dpr * unit);
      ctx.lineTo(0, 2.5 * dpr * unit);
      ctx.lineTo(-4.5 * dpr * unit, 5 * dpr * unit);
      ctx.closePath();
      ctx.fillStyle = COLORS.self;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.lineWidth = 1.2 * dpr * unit;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [props.map, props.expanded, props.size, props.labels]);

  return (
    <div
      className={`hud-minimap${props.expanded ? ' is-expanded' : ''}${props.size ? ' is-large' : ''}`}
      aria-hidden="true"
    >
      <canvas ref={canvas} />
      {props.expanded && (
        <figcaption className="hud-minimap-caption">
          <span>{props.map.title}</span>
          <kbd>M</kbd>
        </figcaption>
      )}
    </div>
  );
}
