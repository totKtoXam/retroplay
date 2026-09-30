import { useId, type CSSProperties, type ReactNode } from 'react';
import { festivePalette, festiveVars } from '@/lib/festive';

/*
 * Иллюстрации праздничных миров (план UX/UI, этап 5). Один графический язык —
 * плоская аппликация, как войлочный текемет: небо, два слоя холмов, один
 * главный предмет мира и мягкие круглые формы без контуров. Цвета приходят
 * CSS-переменными --festive-* из lib/festive.ts (классы .fx-* в ux-lobby.css),
 * поэтому разметка сцены одна для обеих тем и весит ~1–2 КБ.
 *
 * Сцена рисуется в кадре 320 × 140 и вписывается по высоте, прижатая к низу
 * (xMidYMax meet, overflow visible). Небо, холмы и орнамент продолжаются за
 * края кадра на 400 единиц, поэтому широкая обложка не режет солнце сверху, а
 * просто показывает больше степи по бокам. Предмет мира держится в полосе
 * x 90–250 и ниже y ≈ 28: выше лежат бейджи, а на узкой карточке правая
 * группа бейджей начинается уже от середины.
 */

const HILL_BACK =
  'M-400 96C-260 84-120 104 0 100C56 84 118 90 168 98S272 84 320 94C420 104 560 86 720 96V140H-400Z';
const HILL_FRONT =
  'M-400 116C-240 106-120 124 0 118C70 104 150 114 212 110S292 106 320 114C440 124 560 106 720 114V140H-400Z';

function Hills({ back = 0.6 }: { back?: number }) {
  return (
    <>
      <path className="fx-ground" opacity={back} d={HILL_BACK} />
      <path className="fx-ground" d={HILL_FRONT} />
    </>
  );
}

/** Точки по кругу: лучи солнца и шанырака. */
const rays = (cx: number, cy: number, r1: number, r2: number, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const f = (r: number, t: (x: number) => number, c: number) =>
      Math.round((c + r * t(a)) * 10) / 10;
    return `M${f(r1, Math.cos, cx)} ${f(r1, Math.sin, cy)}L${f(r2, Math.cos, cx)} ${f(r2, Math.sin, cy)}`;
  }).join('');

function Tulip({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path className="fx-s-ink" opacity={0.4} strokeWidth={2} d="M0-2V16" />
      <path className="fx-accent" d="M-6-3C-7-11-4-15-3-15L0-11 3-15C4-15 7-11 6-3 5 2-5 2-6-3Z" />
    </g>
  );
}

function Fir({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <path
      className="fx-accent"
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0-40L-13-20H-7L-17-4H-9L-19 10H19L9-4H17L7-20H13Z"
    />
  );
}

function Tree({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <path className="fx-s-accent" strokeWidth={3} d={`M${x} ${y}V${y + r + 10}`} />
      <circle className="fx-pattern" cx={x} cy={y} r={r} />
    </g>
  );
}

/** Орнамент «қошқар мүйіз» — бараний рог, по центру стебель и два завитка. */
const HORN = 'M0 10V0M0 0C0-8-12-10-12-2-12 3-6 3-6-1M0 0C0-8 12-10 12-2 12 3 6 3 6-1';

/** Полоса орнамента под сценой — узором, чтобы не повторять завиток 27 раз. */
function Ornament() {
  // Свой id у каждой обложки: карточек одного мира на странице может быть много.
  const id = 'horn' + useId().replace(/[^\w-]/g, '');
  return (
    <>
      <defs>
        <pattern id={id} width={40} height={26} x={-20} y={114} patternUnits="userSpaceOnUse">
          <path
            className="fx-s-pattern"
            strokeWidth={2.4}
            strokeLinecap="round"
            transform="translate(20 10)"
            d={HORN}
          />
        </pattern>
      </defs>
      <rect fill={`url(#${id})`} x={-400} y={114} width={1120} height={26} />
    </>
  );
}

const SCENES: Record<string, () => ReactNode> = {
  nauryz: () => (
    <>
      <circle className="fx-pattern" opacity={0.28} cx={196} cy={66} r={34} />
      <circle className="fx-pattern" cx={196} cy={66} r={22} />
      <Hills />
      <Tulip x={112} y={112} />
      <Tulip x={132} y={118} s={0.85} />
      <Tulip x={150} y={110} s={1.1} />
      <Tulip x={224} y={114} s={0.9} />
      <Tulip x={244} y={120} />
    </>
  ),
  steppe: () => (
    <>
      <ellipse className="fx-pattern" cx={236} cy={48} rx={22} ry={7} />
      <path className="fx-accent" opacity={0.45} d="M-10 104L64 52 98 76 146 34 200 88 236 62 330 104Z" />
      <path className="fx-accent" d="M40 110L120 46 156 80 188 60 270 110Z" />
      <path className="fx-pattern" d="M120 46L107 57 114 56 120 61 126 55 133 57Z" />
      <path className="fx-pattern" d="M188 60L179 67 184 67 188 70 192 66 197 68Z" />
      <path className="fx-pattern" opacity={0.85} d="M146 34L136 43 142 42 147 46 151 41 156 43Z" />
      <Hills back={0.7} />
      <path className="fx-s-ink" opacity={0.45} strokeWidth={2} fill="none" d="M122 34q6-5 11 0q5-5 11 0" />
    </>
  ),
  republic: () => (
    <>
      <path className="fx-s-pattern" strokeWidth={3} strokeLinecap="round" d={rays(160, 66, 31, 37, 16)} />
      <circle className="fx-s-accent" fill="none" strokeWidth={5} cx={160} cy={66} r={24} />
      <path
        className="fx-s-accent"
        fill="none"
        strokeWidth={3}
        d="M137.4 58Q160 54 182.6 58M136 66Q160 62 184 66M137.4 74Q160 70 182.6 74M152 43.4Q148 66 152 88.6M160 42Q156 66 160 90M168 43.4Q164 66 168 88.6"
      />
      <Hills back={0.55} />
      <Tree x={100} y={96} r={11} />
      <Tree x={120} y={104} r={8} />
      <Tree x={218} y={98} r={12} />
      <Tree x={240} y={106} r={8} />
    </>
  ),
  independence: () => (
    <>
      <path className="fx-s-accent" strokeWidth={3} strokeLinecap="round" d={rays(160, 60, 25, 32, 20)} />
      <circle className="fx-accent" cx={160} cy={60} r={19} />
      <path className="fx-accent" d="M104 94C126 80 146 84 160 92 174 84 194 80 216 94 196 91 178 95 160 103 142 95 124 91 104 94Z" />
      <rect className="fx-ground" x={-400} y={114} width={1120} height={26} />
      <Ornament />
    </>
  ),
  newyear: () => (
    <>
      <circle className="fx-pattern" cx={164} cy={44} r={11} />
      <circle className="fx-bg" cx={169} cy={40} r={9} />
      {[
        [104, 26],
        [132, 46],
        [150, 20],
        [182, 58],
        [246, 52],
        [262, 24],
      ].map(([cx, cy]) => (
        <circle key={cx} className="fx-pattern" cx={cx} cy={cy} r={1.8} />
      ))}
      <Hills back={0.5} />
      <Fir x={118} y={104} />
      <Fir x={142} y={110} s={0.7} />
      <Fir x={210} y={102} s={1.15} />
      <Fir x={236} y={110} s={0.75} />
      {[
        [206, 80],
        [214, 92],
        [201, 99],
        [217, 108],
      ].map(([cx, cy]) => (
        <circle key={cy} className="fx-pattern" cx={cx} cy={cy} r={2.2} />
      ))}
    </>
  ),
  unity: () => (
    <>
      <Hills />
      {[
        [124, 56, 'accent'],
        [160, 56, 'pattern'],
        [196, 56, 'accent'],
        [142, 76, 'pattern'],
        [178, 76, 'accent'],
      ].map(([cx, cy, c]) => (
        <circle
          key={`${cx}-${cy}`}
          className={`fx-s-${c}`}
          fill="none"
          strokeWidth={5}
          cx={cx}
          cy={cy}
          r={19}
        />
      ))}
    </>
  ),
  neutral: () => (
    <>
      <circle className="fx-pattern" opacity={0.5} cx={196} cy={58} r={22} />
      <Hills />
    </>
  ),
};

/** Сцена мира во весь размер родителя; только украшение, для экранных чтецов её нет. */
export function WorldScene({ theme, className }: { theme: string; className?: string }) {
  const palette = festivePalette(theme);
  const Scene = SCENES[palette.id] ?? SCENES.neutral;
  return (
    <svg
      className={className ? `world-scene ${className}` : 'world-scene'}
      viewBox="0 0 320 140"
      preserveAspectRatio="xMidYMax meet"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="fx-bg" x={-400} y={-200} width={1120} height={340} />
      <Scene />
    </svg>
  );
}

/**
 * Обложка карточки комнаты: сцена мира и бейджи поверх. Бейджи — дети
 * компонента; они лежат на своей поверхности и читаются на любой сцене.
 */
export function RoomCover({ theme, children }: { theme: string; children?: ReactNode }) {
  return (
    <div className="room-cover room-cover-art" style={festiveVars(festivePalette(theme)) as CSSProperties}>
      <WorldScene theme={theme} />
      {children}
    </div>
  );
}

/*
 * Иллюстрации пустых состояний лобби — в том же стиле, но цветами интерфейса
 * (--jin-*), а не мира: пустой список не принадлежит ни одному празднику.
 */
const EMPTY_HILLS = 'M14 88C34 72 66 74 96 78S160 70 186 88Z';

/** «Комнат пока нет»: пустая степь и место под юрту, обведённое пунктиром. */
export function EmptyRoomsArt() {
  return (
    <svg className="empty-art" viewBox="0 0 200 100" aria-hidden="true" focusable="false">
      <circle className="ea-soft" cx={150} cy={30} r={14} />
      <path className="ea-soft" d={EMPTY_HILLS} />
      <path
        className="ea-line"
        fill="none"
        strokeWidth={2.5}
        strokeDasharray="5 5"
        strokeLinecap="round"
        d="M72 80V62Q72 46 100 40Q128 46 128 62V80"
      />
      <path className="ea-line" fill="none" strokeWidth={2.5} strokeDasharray="5 5" d="M92 80V66H108V80" />
      <path className="ea-accent-s" fill="none" strokeWidth={3} strokeLinecap="round" d="M100 18V30M94 24H106" />
    </svg>
  );
}

/** «Ничего не найдено»: лупа над пустым горизонтом. */
export function NoMatchesArt() {
  return (
    <svg className="empty-art" viewBox="0 0 200 100" aria-hidden="true" focusable="false">
      <path className="ea-soft" d={EMPTY_HILLS} />
      <circle className="ea-surface ea-accent-s" strokeWidth={4} cx={96} cy={44} r={18} />
      <path className="ea-accent-s" strokeWidth={6} strokeLinecap="round" d="M109 57L124 72" />
      <path className="ea-accent-s" fill="none" strokeWidth={2.5} strokeLinecap="round" opacity={0.5} d="M86 38a12 12 0 0 1 9-6" />
    </svg>
  );
}
