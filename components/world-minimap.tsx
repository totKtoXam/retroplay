'use client';
import { useEffect, useRef } from 'react';
import type { GameMap } from '@/lib/maps/types';
import type { MinimapBlip } from '@/lib/minimap-blips';
import { PREF_KEYS } from '@/lib/user-prefs';
import { teamCss } from '@/lib/team-colors';
import { usePrefValue } from './settings-player';
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
  /** Команды — оранжевые и синие (lib/team-colors), идентификаторы прежние. */
  red: teamCss('red'),
  blue: teamCss('blue'),
  ally: '#6ee7a8',
  /** Тёмная обводка знаков в режиме для дальтоников: форма читается на любом полу. */
  outline: 'rgba(8, 13, 25, 0.9)',
};

/**
 * Знак бойца на плане. Обычно — кружок; в режиме для дальтоников союзник —
 * ромб, враг — треугольник остриём вверх (как знаки над бойцами в мире), чтобы
 * сторона читалась формой, а не только цветом.
 */
function blipPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, shape: 'dot' | 'ally' | 'enemy') {
  ctx.beginPath();
  if (shape === 'ally') {
    // Ромб на той же площади выглядит мельче круга — чуть больше по диагонали.
    const d = r * 1.35;
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d, y);
    ctx.lineTo(x, y + d);
    ctx.lineTo(x - d, y);
    ctx.closePath();
  } else if (shape === 'enemy') {
    const d = r * 1.45;
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d * 0.95, y + d * 0.7);
    ctx.lineTo(x - d * 0.95, y + d * 0.7);
    ctx.closePath();
  } else ctx.arc(x, y, r, 0, Math.PI * 2);
}

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
 * Огромная карта (с рельефом, lib/maps/outbreak.ts): целиком в угловую плашку она не
 * влезает — 2 км в 168 пикселях это 12 м на пиксель, ни дома, ни дороги не видно. В углу
 * показывается окно в HUGE_VIEW метров вокруг игрока, развёрнутый план — вся карта.
 */
const HUGE_VIEW = 320;
const isHuge = (map: GameMap) => !!map.arena?.terrain;

/** Окно плана со стороной `span` м с центром (cx, cz), прижатое к границам карты. */
function windowProjection(map: GameMap, px: number, cx: number, cz: number, span: number) {
  const b = map.bounds;
  const half = span / 2;
  const x0 = Math.max(b.minX, Math.min(b.maxX - span, cx - half)),
    z0 = Math.max(b.minZ, Math.min(b.maxZ - span, cz - half));
  const scale = px / span;
  return { scale, x0, z0, toX: (x: number) => (x - x0) * scale, toZ: (z: number) => (z - z0) * scale };
}

/** Метров на пиксель атласа огромной карты. */
const ATLAS_M = 1;
const atlases = new WeakMap<GameMap, HTMLCanvasElement>();

/**
 * Атлас огромной карты: рельеф по видам земли с отмывкой склонов, вода, дороги, дома,
 * деревья — один раз на карту. Угловая плашка и развёрнутый план вырезают из него кусок.
 */
function atlasOf(map: GameMap) {
  const cached = atlases.get(map);
  if (cached) return cached;
  const b = map.bounds;
  const arena = map.arena!;
  const t = arena.terrain!;
  const w = Math.round((b.maxX - b.minX) / ATLAS_M),
    h = Math.round((b.maxZ - b.minZ) / ATLAS_M);
  const atlas = document.createElement('canvas');
  atlas.width = w;
  atlas.height = h;
  const ctx = atlas.getContext('2d');
  if (!ctx) return atlas;
  // Рельеф — картинка по узлам сетки, растянутая на атлас (сглаживание даёт мягкие переходы).
  const grid = document.createElement('canvas');
  grid.width = t.cols;
  grid.height = t.rows;
  const gctx = grid.getContext('2d')!;
  const img = gctx.createImageData(t.cols, t.rows);
  const palette = (t.palette ?? [{ color: '#6d8f4a', name: '' }]).map((p) => {
    const n = parseInt(p.color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const at = (c: number, r: number) =>
    t.heights[Math.max(0, Math.min(t.rows - 1, r)) * t.cols + Math.max(0, Math.min(t.cols - 1, c))];
  for (let r = 0; r < t.rows; r++)
    for (let c = 0; c < t.cols; c++) {
      const i = r * t.cols + c;
      const [cr, cg, cb] = palette[t.kinds?.[i] ?? 0] ?? palette[0];
      // Отмывка: склон к северо-западу светлее, к юго-востоку темнее — горы читаются объёмом.
      const shade = Math.max(0.55, Math.min(1.25, 1 + ((at(c - 1, r - 1) - at(c + 1, r + 1)) / t.cell) * 0.35));
      img.data.set([cr * shade * 0.8, cg * shade * 0.8, cb * shade * 0.8, 255], i * 4);
    }
  gctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  const k = 1 / ATLAS_M;
  ctx.drawImage(grid, ((t.minX - b.minX) * k), ((t.minZ - b.minZ) * k), (t.cols - 1) * t.cell * k + t.cell * k, (t.rows - 1) * t.cell * k + t.cell * k);
  const X = (x: number) => (x - b.minX) * k,
    Z = (z: number) => (z - b.minZ) * k;
  ctx.fillStyle = 'rgb(58, 104, 132)';
  for (const water of arena.water ?? []) {
    ctx.beginPath();
    if (water.round)
      ctx.arc(X((water.minX + water.maxX) / 2), Z((water.minZ + water.maxZ) / 2), ((water.maxX - water.minX) / 2) * k, 0, Math.PI * 2);
    else ctx.rect(X(water.minX), Z(water.minZ), (water.maxX - water.minX) * k, (water.maxZ - water.minZ) * k);
    ctx.fill();
  }
  const models = arena.propKit?.models ?? {};
  /** Повёрнутый прямоугольник рамки модели. */
  const footprint = (p: NonNullable<typeof arena.props>[number], color: string, grow = 0) => {
    const info = models[p.m];
    if (!info) return;
    const s = p.s ?? 1;
    ctx.save();
    ctx.translate(X(p.x), Z(p.z));
    // Поворот модели вокруг y на yaw — на плане (x вправо, z вниз) это поворот холста на −yaw.
    ctx.rotate(-(p.yaw ?? 0));
    ctx.fillStyle = color;
    ctx.fillRect((info.min[0] * s - grow) * k, (info.min[2] * s - grow) * k, ((info.max[0] - info.min[0]) * s + grow * 2) * k, ((info.max[2] - info.min[2]) * s + grow * 2) * k);
    ctx.restore();
  };
  const props = arena.props ?? [];
  for (const p of props) if (p.m.startsWith('road/road-') || p.m.startsWith('zk/street')) footprint(p, 'rgb(60, 62, 66)', 0.3);
  for (const p of props) {
    const info = models[p.m];
    if (!info) continue;
    if (info.hit === 'trunk' && (info.max[1] - info.min[1]) * (p.s ?? 1) > 5) {
      ctx.fillStyle = 'rgba(28, 64, 40, 0.75)';
      ctx.beginPath();
      ctx.arc(X(p.x), Z(p.z), 1.8 * (p.s ?? 1) * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const p of props) {
    const info = models[p.m];
    if (!info || info.hit !== 'box') continue;
    const area = (info.max[0] - info.min[0]) * (info.max[2] - info.min[2]) * (p.s ?? 1) ** 2;
    if (p.m.startsWith('com/') || p.m.startsWith('sub/') || p.m.startsWith('grave/crypt')) footprint(p, 'rgb(214, 220, 230)');
    else if (area > 1.5) footprint(p, 'rgba(34, 38, 46, 0.8)');
  }
  atlases.set(map, atlas);
  return atlas;
}

/** Подписи мест огромной карты поверх плана; вне окна — не рисуются. */
function drawZoneLabels(ctx: CanvasRenderingContext2D, map: GameMap, p: { toX: (x: number) => number; toZ: (z: number) => number }, font: number, px: number) {
  const zones = map.arena?.zones ?? [];
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, font / 3.5);
  ctx.strokeStyle = 'rgba(8, 13, 25, 0.9)';
  ctx.fillStyle = 'rgba(241, 245, 251, 0.95)';
  for (const z of zones) {
    const x = p.toX((z.minX + z.maxX) / 2),
      y = p.toZ((z.minZ + z.maxZ) / 2);
    if (x < -40 || y < -10 || x > px + 40 || y > px + 10) continue;
    ctx.strokeText(z.name, x, y);
    ctx.fillText(z.name, x, y);
  }
}

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
  // Режим для дальтоников читается в каждом кадре через ref: переключение в
  // настройках применяется сразу и не пересобирает статический слой.
  const colorblind = usePrefValue(PREF_KEYS.colorblind) === '1';
  const shapes = useRef(colorblind);
  useEffect(() => {
    shapes.current = colorblind;
  }, [colorblind]);
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
    const huge = isHuge(props.map);
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
      if (huge) {
        // Огромная карта: развёрнутый план — весь атлас с подписями; угловая плашка
        // вырезает окно вокруг игрока в каждом кадре.
        const layer = document.createElement('canvas');
        layer.width = layer.height = px;
        const lctx = layer.getContext('2d');
        if (lctx && props.expanded) {
          const b = props.map.bounds;
          lctx.drawImage(atlasOf(props.map), p.toX(b.minX), p.toZ(b.minZ), (b.maxX - b.minX) * p.scale, (b.maxZ - b.minZ) * p.scale);
          drawZoneLabels(lctx, props.map, p, Math.round(12 * dpr), px);
        }
        statics = layer;
        return;
      }
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
      if (huge && !props.expanded) {
        // Окно вокруг игрока: кусок атласа и подписи тех мест, что в него попали.
        if (!data) return;
        const w = windowProjection(props.map, px, data.x, data.z, HUGE_VIEW);
        const b = props.map.bounds;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(atlasOf(props.map), (w.x0 - b.minX) / ATLAS_M, (w.z0 - b.minZ) / ATLAS_M, HUGE_VIEW / ATLAS_M, HUGE_VIEW / ATLAS_M, 0, 0, px, px);
        drawZoneLabels(ctx, props.map, w, Math.round(9 * dpr), px);
        p = w;
      } else ctx.drawImage(statics, 0, 0);
      if (!data) return;
      // Отметки и стрелка — одного размера на экране при любой стороне плашки.
      const unit = props.expanded ? px / (SIZE * dpr) : 1;
      for (const blip of data.blips) {
        const r = (blip.enemy ? 3.6 : 3) * dpr * unit;
        ctx.globalAlpha = blip.dead ? 0.3 : (blip.fresh ?? 1);
        const shaped = shapes.current;
        blipPath(
          ctx,
          p.toX(blip.x),
          p.toZ(blip.z),
          r,
          shaped ? (blip.enemy ? 'enemy' : 'ally') : 'dot',
        );
        ctx.fillStyle =
          blip.team === 'red' ? COLORS.red : blip.team === 'blue' ? COLORS.blue : COLORS.ally;
        ctx.fill();
        // Засвеченный враг обведён: цвет команды говорит, чей он, а кольцо — что
        // это разведанная цель, а не свой, которого видно всегда.
        if (blip.enemy) {
          ctx.strokeStyle = COLORS.spot;
          ctx.lineWidth = 1.4 * dpr * unit;
          ctx.stroke();
        } else if (shaped) {
          // Тёмный контур отделяет ромб союзника от светлых стен и пола.
          ctx.strokeStyle = COLORS.outline;
          ctx.lineWidth = 1.2 * dpr * unit;
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
