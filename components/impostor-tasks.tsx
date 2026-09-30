'use client';

// Мини-игры заданий режима «Предатель». Каждая — короткое действие руками, после которого
// игра зовёт `onDone`. Засчитывает сервер (lib/impostor.ts): он проверит, что игрок у пульта
// и провёл там не меньше минимального времени, поэтому подделать прохождение нечем.
//
// Оформление — как приборная панель шаттла: тёмный металл со скошенными гранями, заклёпки по
// углам и подсвеченный «экран» внутри (класс `impostor-game`, задаётся в app/impostor.css).
// Рисунки — только инлайн-SVG и CSS, без внешних картинок и библиотек.
//
// Доступность: каждую мини-игру можно пройти с клавиатуры и простыми касаниями, без
// перетаскивания и без удержания мыши. Перетаскивание заменяет выбор «что — куда» (провод →
// разъём, лист → решётка, канистра → бак), удержание — пробел или Enter, движение по оси —
// стрелки (со Shift — крупнее). Правила те же: пропуск и с клавиатуры проходит ту же проверку
// скорости, что и мышью, а удержание и заправка длятся столько же. Нажатие с клавиатуры
// отличаем по `detail === 0` у события click: так его отдаёт браузер для Enter и пробела.
// Клавиши, которые обработала мини-игра, дальше не всплывают — миру они не достаются.
import { useEffect, useRef, useState } from 'react';
import type { TaskKind } from '@/lib/maps/types';
import { arrowStep, columnTarget, judgeSwipe, nextEnabled } from '@/lib/impostor-task-keys';

type GameProps = { onDone: () => void };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const shuffled = <T,>(list: T[]) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
/** Клавиша «нажать» у кнопки: пробел или Enter. */
const isPressKey = (key: string) => key === ' ' || key === 'Enter';
/** Насколько должен сдвинуться указатель, чтобы нажатие считалось перетаскиванием, а не касанием, px. */
const TAP_SLOP = 6;

/** Дуга-сектор круга от `fromDeg` до `toDeg` (0° — вверх, по часовой) — заливка зоны осциллографа. */
function arcSector(cx: number, cz: number, r: number, fromDeg: number, toDeg: number) {
  const point = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return [cx + Math.sin(a) * r, cz - Math.cos(a) * r] as const;
  };
  const [x1, y1] = point(fromDeg);
  const [x2, y2] = point(toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M${cx} ${cz} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

/** Общая рамка пульта: скошенный металл и заклёпки по углам — вид один на все мини-игры. */
function Panel({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className={`impostor-game ${className}`}>
      <span className="impostor-rivet tl" aria-hidden="true" />
      <span className="impostor-rivet tr" aria-hidden="true" />
      <span className="impostor-rivet bl" aria-hidden="true" />
      <span className="impostor-rivet br" aria-hidden="true" />
      {children}
    </div>
  );
}

/** Подсказка по клавишам под мини-игрой. На тач-экране без мыши её прячет CSS. */
function Keys({ children }: { children: React.ReactNode }) {
  return <p className="impostor-task-keys">{children}</p>;
}

// ---------------------------------------------------------------- провода

const WIRE_COLORS = ['#e5484d', '#3e8ef7', '#f5d90a', '#c55ff0'];
/** Названия цветов для экранного диктора: иначе все четыре кнопки звучат одинаково. */
const WIRE_NAMES: Record<string, string> = {
  '#e5484d': 'красный',
  '#3e8ef7': 'синий',
  '#f5d90a': 'жёлтый',
  '#c55ff0': 'фиолетовый',
};
// Разъёмы стоят по строгой сетке — координаты считаем формулой, а не измеряем DOM.
const WIRE_W = 230,
  WIRE_H = 176,
  WIRE_PAD = 20,
  WIRE_ROW = 44;
/** Насколько близко к разъёму нужно отпустить провод, чтобы он зацепился, px. */
const WIRE_CATCH = 26;
const wireAnchor = (side: 'left' | 'right', index: number) => ({
  x: side === 'left' ? WIRE_PAD : WIRE_W - WIRE_PAD,
  y: 22 + index * WIRE_ROW,
});

/**
 * Провода: перетащить провод от разъёма к разъёму того же цвета — со искрой при соединении.
 * Без перетаскивания: нажать провод слева (клик, касание, Enter), затем разъём справа.
 */
function Wires({ onDone }: GameProps) {
  const [right] = useState(() => shuffled(WIRE_COLORS));
  const [joined, setJoined] = useState<string[]>([]);
  const [drag, setDrag] = useState<{ color: string; x: number; y: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number }[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const sparkId = useRef(0);
  const plugRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const socketRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pressAt = useRef({ x: 0, y: 0 });
  /** Провод тянули, а не просто нажали: следующий click после такого — не выбор провода. */
  const moved = useRef(false);

  useEffect(() => {
    if (joined.length === WIRE_COLORS.length) onDone();
  }, [joined, onDone]);
  useEffect(() => {
    if (!sparks.length) return;
    const t = setTimeout(() => setSparks((s) => s.slice(1)), 500);
    return () => clearTimeout(t);
  }, [sparks]);

  const join = (color: string) => {
    const a = wireAnchor('right', right.indexOf(color));
    setSparks((s) => [...s, { id: sparkId.current++, x: a.x, y: a.y }]);
    setJoined((j) => [...j, color]);
    setPicked(null);
  };

  const relative = (clientX: number, clientY: number) => {
    const r = boardRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const startDrag = (color: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (joined.includes(color)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pressAt.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    const a = wireAnchor('left', WIRE_COLORS.indexOf(color));
    setDrag({ color, x: a.x, y: a.y });
  };
  const onDragMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    if (!moved.current && Math.hypot(e.clientX - pressAt.current.x, e.clientY - pressAt.current.y) > TAP_SLOP) {
      moved.current = true;
    }
    const p = relative(e.clientX, e.clientY);
    setDrag((d) => (d ? { ...d, x: p.x, y: p.y } : d));
  };
  const onDragEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    // Цель ищем по расстоянию до разъёма, а не через elementFromPoint: пока провод тянут, события
    // указателя захвачены исходной кнопкой, и разъём под пальцем их не получает.
    // Так соединение работает и на тач-экранах.
    const p = relative(e.clientX, e.clientY);
    const target = right.find((_, i) => {
      const s = wireAnchor('right', i);
      return Math.hypot(s.x - p.x, s.y - p.y) <= WIRE_CATCH;
    });
    if (moved.current && target === drag.color) {
      join(drag.color);
      setNote('');
    }
    setDrag(null);
  };

  const pickWire = (color: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const wasDrag = moved.current;
    moved.current = false;
    if (wasDrag && e.detail !== 0) return;
    if (joined.includes(color)) return;
    if (picked === color) {
      setPicked(null);
      setNote('');
      return;
    }
    setPicked(color);
    setNote(`Выбран ${WIRE_NAMES[color]} провод — теперь разъём справа`);
    // С клавиатуры сразу переводим фокус в столбец разъёмов — к первому свободному.
    if (e.detail === 0) {
      const i = nextEnabled(
        right.map((c) => !joined.includes(c)),
        -1,
        1,
      );
      if (i >= 0) socketRefs.current[i]?.focus();
    }
  };
  const connect = (color: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (joined.includes(color)) return;
    if (!picked) {
      setNote('Сначала выберите провод слева');
      return;
    }
    if (picked !== color) {
      setNote(`Разъём ${WIRE_NAMES[color]}, а провод ${WIRE_NAMES[picked]} — нужен тот же цвет`);
      return;
    }
    join(color);
    setNote(`Подключён ${WIRE_NAMES[color]} провод`);
    // Разъём сейчас выключится и потеряет фокус — ведём клавиатуру к следующему проводу.
    if (e.detail === 0) {
      const i = nextEnabled(
        WIRE_COLORS.map((c) => c !== color && !joined.includes(c)),
        WIRE_COLORS.indexOf(color),
        1,
      );
      if (i >= 0) plugRefs.current[i]?.focus();
    }
  };
  /** Стрелки вверх-вниз ходят по столбцу, влево-вправо — между проводами и разъёмами. */
  const onWireKey = (side: 'left' | 'right', index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    let to: 'left' | 'right' = side;
    let i = index;
    const free = (s: 'left' | 'right') => (s === 'left' ? WIRE_COLORS : right).map((c) => !joined.includes(c));
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      i = nextEnabled(free(side), index, e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      to = e.key === 'ArrowLeft' ? 'left' : 'right';
      const enabled = free(to);
      if (!enabled[index]) i = nextEnabled(enabled, index, 1);
    } else return;
    e.preventDefault();
    e.stopPropagation();
    if (i >= 0) (to === 'left' ? plugRefs : socketRefs).current[i]?.focus();
  };

  return (
    <Panel className="impostor-wires">
      <p className="impostor-task-hint" aria-live="polite">
        {note || 'Перетащите провод к разъёму того же цвета — или нажмите провод, затем разъём'}
      </p>
      <div className="impostor-wires-board" ref={boardRef} style={{ width: WIRE_W, height: WIRE_H }}>
        <svg className="impostor-wires-svg" width={WIRE_W} height={WIRE_H} aria-hidden="true">
          {joined.map((c) => {
            const a = wireAnchor('left', WIRE_COLORS.indexOf(c));
            const b = wireAnchor('right', right.indexOf(c));
            return (
              <path
                key={c}
                d={`M${a.x} ${a.y} C ${a.x + 80} ${a.y}, ${b.x - 80} ${b.y}, ${b.x} ${b.y}`}
                stroke={c}
                strokeWidth={6}
                fill="none"
                strokeLinecap="round"
              />
            );
          })}
          {drag && (
            <path
              className="impostor-wire-live"
              d={`M${wireAnchor('left', WIRE_COLORS.indexOf(drag.color)).x} ${wireAnchor('left', WIRE_COLORS.indexOf(drag.color)).y} L${drag.x} ${drag.y}`}
              stroke={drag.color}
              strokeWidth={6}
              fill="none"
              strokeLinecap="round"
            />
          )}
          {sparks.map((s) => (
            <g key={s.id} className="impostor-spark" transform={`translate(${s.x} ${s.y})`}>
              {[0, 60, 120, 180, 240, 300].map((deg) => (
                <line key={deg} x1={0} y1={0} x2={0} y2={-13} stroke="#fff6c8" strokeWidth={3} transform={`rotate(${deg})`} />
              ))}
            </g>
          ))}
        </svg>
        {WIRE_COLORS.map((c, i) => {
          const a = wireAnchor('left', i);
          const isJoined = joined.includes(c);
          return (
            <button
              key={c}
              ref={(el) => {
                plugRefs.current[i] = el;
              }}
              className={`impostor-plug${isJoined ? ' is-joined' : ''}${picked === c ? ' is-picked' : ''}`}
              style={{ left: a.x, top: a.y, background: c }}
              disabled={isJoined}
              aria-label={`Провод: ${WIRE_NAMES[c]}${isJoined ? ', подключён' : ''}`}
              aria-pressed={picked === c}
              onPointerDown={startDrag(c)}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              onClick={pickWire(c)}
              onKeyDown={onWireKey('left', i)}
            />
          );
        })}
        {right.map((c, i) => {
          const a = wireAnchor('right', i);
          const isJoined = joined.includes(c);
          return (
            <button
              key={c}
              ref={(el) => {
                socketRefs.current[i] = el;
              }}
              data-wire-right={c}
              className={`impostor-plug impostor-plug-socket${isJoined ? ' is-joined' : ''}${picked && !isJoined ? ' is-target' : ''}`}
              // Цвет разъёма виден сразу — рамкой и тусклой заливкой, иначе пару пришлось бы угадывать.
              style={{ left: a.x, top: a.y, borderColor: c, borderStyle: 'solid', background: isJoined ? c : `${c}40` }}
              disabled={isJoined}
              aria-label={`Разъём: ${WIRE_NAMES[c]}${isJoined ? ', подключён' : ''}`}
              onClick={connect(c)}
              onKeyDown={onWireKey('right', i)}
            />
          );
        })}
      </div>
      <Keys>Стрелки — выбор, Enter — взять провод, затем Enter на разъёме того же цвета</Keys>
    </Panel>
  );
}

// ---------------------------------------------------------------- удержание (манометр)

/** Удержание: держать рычаг, пока манометр не дойдёт до конца шкалы; отпустил — начинай заново. */
function Hold({ onDone }: GameProps) {
  const NEED = 3000;
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const since = useRef(0);
  const done = useRef(false);
  /** Чем держат рычаг: отпускание другим способом (увели мышь, пока держат пробел) не сбрасывает. */
  const holdBy = useRef<'key' | 'pointer' | null>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!since.current || done.current) return;
      const p = Math.min(1, (performance.now() - since.current) / NEED);
      setProgress(p);
      if (p >= 1) {
        done.current = true;
        onDone();
      }
    }, 50);
    return () => clearInterval(timer);
  }, [onDone]);
  const press = (by: 'key' | 'pointer') => {
    if (done.current || holdBy.current) return;
    holdBy.current = by;
    since.current = performance.now();
    setHolding(true);
  };
  const release = (by: 'key' | 'pointer') => {
    if (done.current || holdBy.current !== by) return;
    holdBy.current = null;
    since.current = 0;
    setHolding(false);
    setProgress(0);
  };
  const angle = -108 + progress * 216;
  return (
    <Panel className="impostor-hold">
      <p className="impostor-task-hint">Держите рычаг, пока манометр не дойдёт до края</p>
      <svg className="impostor-gauge" viewBox="0 0 200 122" aria-hidden="true">
        <path d="M18 110 A82 82 0 0 1 182 110" className="impostor-gauge-track" />
        <path
          d="M18 110 A82 82 0 0 1 182 110"
          className="impostor-gauge-fill"
          style={{ strokeDasharray: 257.6, strokeDashoffset: 257.6 * (1 - progress) }}
        />
        {Array.from({ length: 7 }, (_, i) => {
          const a = ((-108 + i * 36) * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={100 + Math.sin(a) * 70}
              y1={110 - Math.cos(a) * 70}
              x2={100 + Math.sin(a) * 80}
              y2={110 - Math.cos(a) * 80}
              className="impostor-gauge-tick"
            />
          );
        })}
        <g className="impostor-gauge-needle" style={{ transform: `rotate(${angle}deg)`, transformOrigin: '100px 110px' }}>
          <line x1="100" y1="110" x2="100" y2="38" />
        </g>
        <circle cx="100" cy="110" r="7" className="impostor-gauge-hub" />
      </svg>
      <div className="impostor-gauge-readout">{Math.round(progress * 100)}%</div>
      <button
        className={`impostor-lever${holding ? ' is-active' : ''}`}
        aria-label="Удерживать рычаг манометра"
        aria-pressed={holding}
        onPointerDown={() => press('pointer')}
        onPointerUp={() => release('pointer')}
        onPointerLeave={() => release('pointer')}
        onPointerCancel={() => release('pointer')}
        onKeyDown={(e) => {
          if (!isPressKey(e.key)) return;
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) press('key');
        }}
        onKeyUp={(e) => {
          if (!isPressKey(e.key)) return;
          e.preventDefault();
          e.stopPropagation();
          release('key');
        }}
        onBlur={() => release('key')}
      >
        Удерживать
      </button>
      <Keys>Удерживайте пробел или Enter на рычаге</Keys>
    </Panel>
  );
}

// ---------------------------------------------------------------- калибровка (осциллограф)

/** Калибровка: трижды остановить бегущий по кругу луч в подсвеченном секторе. */
function Calibrate({ onDone }: GameProps) {
  const [hits, setHits] = useState(0);
  const [miss, setMiss] = useState(false);
  const [zone] = useState(() => 20 + Math.random() * 300);
  const angleRef = useRef(0);
  const needleRef = useRef<SVGGElement>(null);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const loop = (now: number) => {
      // Каждое попадание ускоряет луч.
      const speed = 0.05 + hits * 0.025;
      angleRef.current = ((now - start) * speed) % 360;
      if (needleRef.current) needleRef.current.style.transform = `rotate(${angleRef.current}deg)`;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [hits]);
  const stop = () => {
    const diff = Math.abs(angleRef.current - zone);
    const inZone = Math.min(diff, 360 - diff) < 16;
    setMiss(!inZone);
    if (!inZone) return;
    if (hits + 1 >= 3) onDone();
    setHits((h) => h + 1);
  };
  return (
    <Panel className="impostor-calibrate">
      <p className="impostor-task-hint" aria-live="polite">
        {miss ? 'Мимо — ещё раз' : 'Остановите луч в зелёном секторе'} · {hits} / 3
      </p>
      <svg className="impostor-scope" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="86" className="impostor-scope-ring" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={100 + Math.sin(a) * 78}
              y1={100 - Math.cos(a) * 78}
              x2={100 + Math.sin(a) * 86}
              y2={100 - Math.cos(a) * 86}
              className="impostor-scope-tick"
            />
          );
        })}
        <path d={arcSector(100, 100, 86, zone - 16, zone + 16)} className="impostor-scope-zone" />
        <g ref={needleRef} className="impostor-scope-needle" style={{ transformOrigin: '100px 100px' }}>
          <line x1="100" y1="100" x2="100" y2="22" />
        </g>
        <circle cx="100" cy="100" r="6" className="impostor-scope-hub" />
      </svg>
      <button className="primary impostor-scope-stop" aria-label="Остановить луч" onClick={stop}>
        Стоп
      </button>
      <Keys>Пробел или Enter на кнопке «Стоп»</Keys>
    </Panel>
  );
}

// ---------------------------------------------------------------- код (терминал)

/** Код: набрать на физической клавиатуре пульта цифры с записки. */
function Code({ onDone }: GameProps) {
  const [code] = useState(() => String(Math.floor(10000 + Math.random() * 90000)));
  const [typed, setTyped] = useState('');
  const [shake, setShake] = useState(false);
  const press = (digit: string) => {
    const next = (typed + digit).slice(0, 5);
    if (!code.startsWith(next)) {
      setTyped('');
      setShake(true);
      setTimeout(() => setShake(false), 260);
      return;
    }
    setTyped(next);
    if (next === code) onDone();
  };
  /** Цифры и Backspace с настоящей клавиатуры, пока фокус на кнопках пульта. */
  const onPadKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') setTyped('');
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <Panel className="impostor-code">
      <p className="impostor-task-hint">Наберите код с записки</p>
      <div className="impostor-code-note">{code}</div>
      <div className={`impostor-code-screen${shake ? ' is-shake' : ''}`}>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={`impostor-code-digit${i < typed.length ? ' is-filled' : ''}`}>
            {typed[i] ?? ''}
          </span>
        ))}
      </div>
      <div className="impostor-code-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="impostor-key" onClick={() => press(d)} onKeyDown={onPadKey}>
            {d}
          </button>
        ))}
        <button className="impostor-key impostor-key-wide" aria-label="Стереть" onClick={() => setTyped('')} onKeyDown={onPadKey}>
          ⌫
        </button>
        <button className="impostor-key" onClick={() => press('0')} onKeyDown={onPadKey}>
          0
        </button>
      </div>
      <Keys>Tab — к кнопкам, дальше можно печатать цифры; Backspace — стереть</Keys>
    </Panel>
  );
}

// ---------------------------------------------------------------- загрузка (файлы между папками)

function FolderIcon({ full }: { full?: boolean }) {
  return (
    <svg className="impostor-folder" viewBox="0 0 48 40" aria-hidden="true">
      <path d="M2 8 H18 L22 13 H46 V36 H2 Z" fill={full ? '#4ade80' : '#6fa8d8'} stroke="#0b0f18" strokeWidth="2" />
    </svg>
  );
}

/** Загрузка: нажать и дождаться, не закрывая пульт — файлы летят из одной папки в другую. */
function Upload({ onDone }: GameProps) {
  const NEED = 5000;
  const [started, setStarted] = useState(0);
  const [progress, setProgress] = useState(0);
  const [files, setFiles] = useState<number[]>([]);
  const fileId = useRef(0);
  useEffect(() => {
    if (!started) return;
    const tick = setInterval(() => {
      const p = Math.min(1, (performance.now() - started) / NEED);
      setProgress(p);
      if (p < 1) return;
      // Загрузилось — останавливаемся: иначе пульт звал бы «готово» каждые 100 мс, пока открыт.
      clearInterval(tick);
      clearInterval(spawn);
      onDone();
    }, 100);
    const spawn = setInterval(() => setFiles((f) => [...f.slice(-4), fileId.current++]), 450);
    return () => {
      clearInterval(tick);
      clearInterval(spawn);
    };
  }, [started, onDone]);
  return (
    <Panel className="impostor-upload">
      <p className="impostor-task-hint">Не закрывайте пульт до конца передачи</p>
      <div className="impostor-upload-lane">
        <FolderIcon />
        {files.map((id) => (
          <span key={id} className="impostor-upload-file" onAnimationEnd={() => setFiles((list) => list.filter((x) => x !== id))} />
        ))}
        <FolderIcon full />
      </div>
      <div className="impostor-bar">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <button className="primary" disabled={!!started} onClick={() => setStarted(performance.now())}>
        {started ? `Передача ${Math.round(progress * 100)} %` : 'Загрузить'}
      </button>
      <Keys>Enter — начать передачу</Keys>
    </Panel>
  );
}

// ---------------------------------------------------------------- астероиды (Оружейная)

const ASTEROID_NEED = 10;
/** Шаг прицела стрелкой и со Shift, % ширины поля. Астероид — 8–12 % ширины, мимо не проскочить. */
const AIM_STEP = 4;
const AIM_STEP_BIG = 12;

function RockSvg() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M6 18 L14 6 L28 4 L36 14 L34 30 L20 37 L8 32 Z" fill="#8a7f74" stroke="#332c26" strokeWidth="2" />
      <circle cx="16" cy="16" r="3" fill="#4d453d" />
      <circle cx="26" cy="24" r="2.4" fill="#4d453d" />
    </svg>
  );
}

/**
 * Астероиды: сбить кликом падающие обломки — орудийная башня Оружейной.
 * С клавиатуры: стрелки влево-вправо водят турель, пробел — выстрел вертикально вверх; попадает
 * в ближайший к турели астероид над прицелом.
 */
function Asteroids({ onDone }: GameProps) {
  const [rocks, setRocks] = useState<{ id: number; x: number; size: number; dur: number }[]>([]);
  const [destroyed, setDestroyed] = useState(0);
  const [aim, setAim] = useState(50);
  const [shot, setShot] = useState<{ id: number; x: number } | null>(null);
  const rockId = useRef(0);
  const shotId = useRef(0);
  const destroyedRef = useRef(0);
  const fieldRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const spawn = setInterval(() => {
      setRocks((list) => {
        // Не больше четырёх сразу — иначе экран забьётся, и попасть будет невозможно физически.
        if (list.length >= 4 || destroyedRef.current >= ASTEROID_NEED) return list;
        return [...list, { id: rockId.current++, x: 6 + Math.random() * 84, size: 26 + Math.random() * 16, dur: 1.7 + Math.random() * 0.8 }];
      });
    }, 480);
    return () => clearInterval(spawn);
  }, []);
  const hit = (id: number) => {
    setRocks((list) => list.filter((r) => r.id !== id));
    destroyedRef.current += 1;
    setDestroyed(destroyedRef.current);
    if (destroyedRef.current >= ASTEROID_NEED) onDone();
  };
  const shoot = () => {
    const field = fieldRef.current;
    if (!field) return;
    const f = field.getBoundingClientRect();
    const rockEls = [...field.querySelectorAll<HTMLElement>('[data-rock]')];
    const i = columnTarget(
      rockEls.map((el) => el.getBoundingClientRect()),
      f.left + (aim / 100) * f.width,
      f.top,
      4,
    );
    setShot({ id: shotId.current++, x: aim });
    if (i >= 0) hit(Number(rockEls[i].dataset.rock));
  };
  const onAimKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isPressKey(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) shoot();
      return;
    }
    // Вертикальные стрелки турели не нужны, но ползунок браузера двигал бы ими прицел.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const step = arrowStep(e.key, e.shiftKey, AIM_STEP, AIM_STEP_BIG, false);
    if (step === null) return;
    e.preventDefault();
    e.stopPropagation();
    setAim((a) => clamp(a + step, 0, 100));
  };
  return (
    <Panel className="impostor-asteroids">
      <p className="impostor-task-hint" aria-live="polite">
        Сбито {destroyed} / {ASTEROID_NEED}
      </p>
      <div className="impostor-asteroids-field" ref={fieldRef}>
        {rocks.map((r) => (
          <button
            key={r.id}
            data-rock={r.id}
            className="impostor-asteroid"
            style={{ left: `${r.x}%`, width: r.size, height: r.size, animationDuration: `${r.dur}s` }}
            // Падающие кнопки в порядке Tab только мешали бы: с клавиатуры стреляет турель.
            tabIndex={-1}
            aria-label="Сбить астероид"
            onClick={() => hit(r.id)}
            onAnimationEnd={() => setRocks((list) => list.filter((x) => x.id !== r.id))}
          >
            <RockSvg />
          </button>
        ))}
        <span className="impostor-asteroids-aim" style={{ left: `${aim}%` }} aria-hidden="true" />
        {shot && (
          <span
            key={shot.id}
            className="impostor-asteroids-shot"
            style={{ left: `${shot.x}%` }}
            aria-hidden="true"
            onAnimationEnd={() => setShot(null)}
          />
        )}
        <div className="impostor-asteroids-turret" style={{ left: `${aim}%` }} aria-hidden="true" />
        {/* Прицел — обычный ползунок, невидимый поверх поля: фокус, стрелки и имя для диктора
            даёт браузер, а мышь проходит сквозь него к астероидам. Последний в поле — чтобы
            ловушка фокуса окна считала его последним элементом. */}
        <input
          type="range"
          className="impostor-overlay-input"
          min={0}
          max={100}
          step={1}
          value={aim}
          aria-label="Прицел турели: стрелки влево и вправо, пробел — выстрел"
          aria-valuetext={`${Math.round(aim)} % от левого края`}
          onChange={(e) => setAim(e.currentTarget.valueAsNumber)}
          onKeyDown={onAimKey}
        />
      </div>
      <Keys>Tab — к турели, стрелки ← → — прицел (Shift — быстрее), пробел — выстрел</Keys>
    </Panel>
  );
}

// ---------------------------------------------------------------- пропуск (Администрация)

const SWIPE_LEN = 210;
const SWIPE_MIN_MS = 260;
const SWIPE_MAX_MS = 900;
/** С клавиатуры карта едет сама, пока держат клавишу: весь путь за это время, мс. Дойдёт
 * до 92 % за ~515 мс — отпустить можно в окне до SWIPE_MAX_MS, как и мышью. */
const SWIPE_GUIDE_MS = 560;
/** Кнопка «Провести карту» ведёт карту с этой скоростью — внутри допустимого окна. */
const SWIPE_AUTO_MS = 600;
const SWIPE_MESSAGES = {
  short: 'Карта не дошла до конца — ещё раз',
  fast: 'Слишком быстро — ещё раз',
  slow: 'Слишком медленно — ещё раз',
} as const;
const isGuideKey = (key: string) => isPressKey(key) || key === 'ArrowRight';

/**
 * Пропуск: провести карту через считыватель не быстрее и не медленнее нужного.
 * С клавиатуры: держать пробел (Enter, стрелку вправо) — карта едет, отпустить у конца.
 * Одним касанием: кнопка «Провести карту». Проверка одна на все способы — `judgeSwipe`.
 */
function Swipe({ onDone }: GameProps) {
  const [x, setX] = useState(0);
  const [msg, setMsg] = useState('Проведите картой слева направо');
  const dragging = useRef(false);
  const startAt = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const accepted = useRef(false);
  /**
   * Карту ведёт клавиатура или кнопка: когда начали, кадр анимации, едет ли сама до конца и
   * таймер её конца. Конец — по таймеру, а не по кадрам: кадры в фоновой вкладке не идут.
   */
  const guide = useRef<{ start: number; frame: number; auto: boolean; timer: number } | null>(null);

  useEffect(
    () => () => {
      if (!guide.current) return;
      cancelAnimationFrame(guide.current.frame);
      clearTimeout(guide.current.timer);
    },
    [],
  );

  const judge = (end: number, ms: number) => {
    const verdict = judgeSwipe(end, ms, SWIPE_LEN, SWIPE_MIN_MS, SWIPE_MAX_MS);
    if (verdict === 'ok') {
      accepted.current = true;
      setX(SWIPE_LEN);
      setMsg('Пропуск принят');
      onDone();
      return;
    }
    setMsg(SWIPE_MESSAGES[verdict]);
    setX(0);
  };

  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (guide.current || accepted.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    startAt.current = performance.now();
    setMsg('Ведите до конца считывателя');
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current || !trackRef.current) return;
    const r = trackRef.current.getBoundingClientRect();
    setX(clamp(e.clientX - r.left, 0, SWIPE_LEN));
  };
  const onUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current || accepted.current) return;
    dragging.current = false;
    const ms = performance.now() - startAt.current;
    // Где карта в момент отпускания — по самому событию: последний рывок мог ещё не успеть
    // отрисоваться, и состояние `x` отставало бы от руки.
    const r = trackRef.current?.getBoundingClientRect();
    judge(r ? clamp(e.clientX - r.left, 0, SWIPE_LEN) : x, ms);
  };

  const finishGuide = () => {
    const g = guide.current;
    if (!g) return;
    cancelAnimationFrame(g.frame);
    clearTimeout(g.timer);
    guide.current = null;
    const ms = performance.now() - g.start;
    judge(clamp((ms / (g.auto ? SWIPE_AUTO_MS : SWIPE_GUIDE_MS)) * SWIPE_LEN, 0, SWIPE_LEN), ms);
  };
  const startGuide = (auto: boolean) => {
    if (guide.current || dragging.current || accepted.current) return;
    const start = performance.now();
    const duration = auto ? SWIPE_AUTO_MS : SWIPE_GUIDE_MS;
    const step = () => {
      const g = guide.current;
      if (!g) return;
      setX(clamp(((performance.now() - start) / duration) * SWIPE_LEN, 0, SWIPE_LEN));
      g.frame = requestAnimationFrame(step);
    };
    guide.current = {
      start,
      frame: requestAnimationFrame(step),
      auto,
      timer: auto ? window.setTimeout(finishGuide, SWIPE_AUTO_MS) : 0,
    };
    setMsg(auto ? 'Карта идёт через считыватель…' : 'Отпустите, когда карта дойдёт до конца');
  };

  return (
    <Panel className="impostor-swipe">
      <p className="impostor-task-hint" aria-live="polite">
        {msg}
      </p>
      <div className="impostor-swipe-track" ref={trackRef}>
        <span className="impostor-swipe-slot" aria-hidden="true" />
        <button
          className="impostor-swipe-card"
          style={{ transform: `translateX(${x}px)` }}
          aria-label="Пропуск: удерживайте пробел, пока карта не дойдёт до конца считывателя"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={(e) => {
            if (!isGuideKey(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            if (!e.repeat) startGuide(false);
          }}
          onKeyUp={(e) => {
            if (!isGuideKey(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            if (!guide.current?.auto) finishGuide();
          }}
          onBlur={() => {
            if (!guide.current?.auto) finishGuide();
          }}
        />
      </div>
      <button className="impostor-swipe-auto" onClick={() => startGuide(true)}>
        Провести карту
      </button>
      <Keys>Держите пробел на карте и отпустите у конца считывателя — или кнопка «Провести карту»</Keys>
    </Panel>
  );
}

// ---------------------------------------------------------------- листья (O2)

const LEAF_COUNT = 5;

function LeafSvg() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <path d="M14 2 C24 6 26 18 14 26 C2 18 4 6 14 2 Z" fill="#4f8f4a" stroke="#2c5a2a" strokeWidth="1.5" />
      <path d="M14 6 V22" stroke="#2c5a2a" strokeWidth="1.2" />
    </svg>
  );
}

type Leaf = { id: number; startX: number; startY: number; x: number; y: number; dragging: boolean; done: boolean };

/**
 * Листья: перетащить каждый лист с решётки фильтра O2 в сторону — она забита ими.
 * С клавиатуры: Tab по листьям, Enter — выбросить. Касанием: лист, затем решётка.
 */
function Leaves({ onDone }: GameProps) {
  const [leaves, setLeaves] = useState<Leaf[]>(() =>
    Array.from({ length: LEAF_COUNT }, (_, i) => ({
      id: i,
      startX: 14 + (i % 3) * 32,
      startY: 14 + Math.floor(i / 3) * 40,
      x: 0,
      y: 0,
      dragging: false,
      done: false,
    })),
  );
  const [picked, setPicked] = useState<number | null>(null);
  const doneCount = useRef(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const grateRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ dx: 0, dy: 0 });
  const leafRefs = useRef(new Map<number, HTMLButtonElement>());
  const pressAt = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  /** Выбросить лист без перетаскивания; `focusNext` — увести фокус клавиатуры на соседний лист. */
  const throwLeaf = (id: number, focusNext: boolean) => {
    const left = leaves.filter((l) => !l.done);
    if (!left.some((l) => l.id === id)) return;
    doneCount.current += 1;
    setLeaves((list) => list.map((l) => (l.id === id ? { ...l, done: true, dragging: false } : l)));
    setPicked(null);
    if (doneCount.current >= LEAF_COUNT) {
      onDone();
      return;
    }
    if (focusNext) {
      const rest = left.filter((l) => l.id !== id);
      const next = rest.find((l) => l.id > id) ?? rest[0];
      if (next) leafRefs.current.get(next.id)?.focus();
    }
  };

  const onDown = (id: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pressAt.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    const r = e.currentTarget.getBoundingClientRect();
    dragOffset.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    const board = boardRef.current!.getBoundingClientRect();
    setLeaves((list) => list.map((l) => (l.id === id ? { ...l, dragging: true, x: r.left - board.left, y: r.top - board.top } : l)));
  };
  const onMove = (id: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!moved.current && Math.hypot(e.clientX - pressAt.current.x, e.clientY - pressAt.current.y) > TAP_SLOP) {
      moved.current = true;
      setPicked(null);
    }
    const board = boardRef.current!.getBoundingClientRect();
    const x = e.clientX - board.left - dragOffset.current.dx;
    const y = e.clientY - board.top - dragOffset.current.dy;
    setLeaves((list) => list.map((l) => (l.id === id && l.dragging ? { ...l, x, y } : l)));
  };
  const onUp = (id: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = grateRef.current?.getBoundingClientRect();
    const inGrate = !!g && e.clientX >= g.left && e.clientX <= g.right && e.clientY >= g.top && e.clientY <= g.bottom;
    // Счёт — снаружи функции обновления: в строгом режиме React вызывает её дважды, и лист
    // засчитывался бы за два.
    if (inGrate) {
      doneCount.current += 1;
      setPicked((p) => (p === id ? null : p));
    }
    setLeaves((list) => list.map((l) => (l.id !== id ? l : { ...l, done: l.done || inGrate, dragging: false })));
    if (inGrate && doneCount.current >= LEAF_COUNT) onDone();
  };
  const onLeafClick = (id: number) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const wasDrag = moved.current;
    moved.current = false;
    if (wasDrag && e.detail !== 0) return;
    if (e.detail === 0) throwLeaf(id, true);
    else setPicked((p) => (p === id ? null : id));
  };

  return (
    <Panel className="impostor-leaves">
      <p className="impostor-task-hint">Перетащите листья в решётку сброса — или нажмите лист, затем решётку</p>
      <div className="impostor-leaves-board" ref={boardRef}>
        {/* Решётка принимает касание только после выбора листа; с клавиатуры она не нужна —
            Enter на листе выбрасывает его сразу. */}
        <div
          className={`impostor-leaves-grate${picked !== null ? ' is-ready' : ''}`}
          ref={grateRef}
          aria-hidden="true"
          onClick={() => {
            if (picked !== null) throwLeaf(picked, false);
          }}
        />
        {leaves
          .filter((l) => !l.done)
          .map((l, i) => (
            <button
              key={l.id}
              ref={(el) => {
                if (el) leafRefs.current.set(l.id, el);
                else leafRefs.current.delete(l.id);
              }}
              className={`impostor-leaf${picked === l.id ? ' is-picked' : ''}`}
              style={l.dragging ? { left: l.x, top: l.y } : { left: l.startX, top: l.startY }}
              aria-label={`Лист на фильтре ${i + 1}: выбросить`}
              aria-pressed={picked === l.id}
              onPointerDown={onDown(l.id)}
              onPointerMove={onMove(l.id)}
              onPointerUp={onUp(l.id)}
              onPointerCancel={onUp(l.id)}
              onClick={onLeafClick(l.id)}
            >
              <LeafSvg />
            </button>
          ))}
      </div>
      <Keys>Tab — к листу, Enter — выбросить его в решётку</Keys>
    </Panel>
  );
}

// ---------------------------------------------------------------- щиты

const SHIELD_COUNT = 9;

/** Щиты: кликами погасить все красные шестиугольники защитного поля. */
function Shields({ onDone }: GameProps) {
  const [lit, setLit] = useState<boolean[]>(() => Array(SHIELD_COUNT).fill(true));
  const hexRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (lit.every((v) => !v)) onDone();
  }, [lit, onDone]);
  const clear = (i: number) => (e: React.MouseEvent<HTMLButtonElement>) => {
    setLit((list) => list.map((v, idx) => (idx === i ? false : v)));
    // Погашенный сегмент выключится и потеряет фокус — ведём клавиатуру к следующему красному.
    if (e.detail === 0) {
      const next = nextEnabled(
        lit.map((v, idx) => v && idx !== i),
        i,
        1,
      );
      if (next >= 0) hexRefs.current[next]?.focus();
    }
  };
  return (
    <Panel className="impostor-shields">
      <p className="impostor-task-hint">Погасите все красные сегменты поля</p>
      <div className="impostor-shields-grid">
        {lit.map((on, i) => (
          <button
            key={i}
            ref={(el) => {
              hexRefs.current[i] = el;
            }}
            className={`impostor-hex${on ? ' is-red' : ' is-clear'}`}
            disabled={!on}
            aria-label={on ? `Погасить сегмент щита ${i + 1}` : `Сегмент ${i + 1} в порядке`}
            onClick={clear(i)}
          >
            <svg viewBox="0 0 100 88" aria-hidden="true">
              <polygon points="25,4 75,4 98,44 75,84 25,84 2,44" />
            </svg>
          </button>
        ))}
      </div>
      <Keys>Tab — к сегменту, Enter — погасить</Keys>
    </Panel>
  );
}

// ---------------------------------------------------------------- выравнивание (двигатели)

const ALIGN_HOLD_MS = 1200;
const ALIGN_TOLERANCE = 0.05;

/** Выравнивание: ползунком совместить метку с линией и удержать её — иначе двигатель уводит. */
function Align({ onDone }: GameProps) {
  const [target] = useState(() => 0.2 + Math.random() * 0.6);
  const [value, setValue] = useState(0);
  const [holdMs, setHoldMs] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(0);
  const inZoneSince = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      if (done.current) return;
      const inZone = Math.abs(valueRef.current - target) < ALIGN_TOLERANCE;
      if (inZone) {
        if (!inZoneSince.current) inZoneSince.current = performance.now();
        const held = performance.now() - inZoneSince.current;
        setHoldMs(held);
        if (held >= ALIGN_HOLD_MS) {
          done.current = true;
          onDone();
        }
      } else {
        inZoneSince.current = 0;
        setHoldMs(0);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [target, onDone]);

  const set = (v: number) => {
    valueRef.current = v;
    setValue(v);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    const r = trackRef.current!.getBoundingClientRect();
    set(clamp((e.clientX - r.left) / r.width, 0, 1));
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const step = arrowStep(e.key, e.shiftKey, 0.01, 0.05);
    if (step === null) return;
    e.preventDefault();
    e.stopPropagation();
    set(clamp(Math.round((valueRef.current + step) * 100) / 100, 0, 1));
  };

  return (
    <Panel className="impostor-align">
      <p className="impostor-task-hint">Совместите ползунок с меткой и удержите</p>
      <div className="impostor-align-track" ref={trackRef} onPointerDown={move} onPointerMove={move}>
        <span className="impostor-align-target" style={{ left: `${target * 100}%` }} />
        <span className="impostor-align-handle" style={{ left: `${value * 100}%` }} />
        {/* Невидимый ползунок браузера поверх дорожки — для клавиатуры и диктора; мышь проходит
            сквозь него к дорожке. */}
        <input
          type="range"
          className="impostor-overlay-input"
          min={0}
          max={100}
          step={1}
          value={Math.round(value * 100)}
          aria-label="Положение ползунка двигателя"
          aria-valuetext={`${Math.round(value * 100)} %, метка на ${Math.round(target * 100)} %`}
          onChange={(e) => set(e.currentTarget.valueAsNumber / 100)}
          onKeyDown={onKey}
        />
      </div>
      <div className="impostor-bar">
        <span style={{ width: `${Math.min(1, holdMs / ALIGN_HOLD_MS) * 100}%` }} />
      </div>
      <Keys>Tab — к ползунку, стрелки — двигать (Shift — крупнее), совместите с меткой и ждите</Keys>
    </Panel>
  );
}

// ---------------------------------------------------------------- симон (Реактор)

const SIMON_COLORS = ['#e5484d', '#3e8ef7', '#f5d90a', '#4ade80'];
const SIMON_NAMES = ['Красная', 'Синяя', 'Жёлтая', 'Зелёная'];
const SIMON_ROUNDS = 4;

/** Симон: повторить растущую последовательность подсвеченных кнопок — запуск реактора. */
function Simon({ onDone }: GameProps) {
  const [sequence, setSequence] = useState<number[]>(() => [Math.floor(Math.random() * 4)]);
  const [input, setInput] = useState<number[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [msg, setMsg] = useState('Запоминайте порядок кнопок');

  useEffect(() => {
    let cancelled = false;
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    void (async () => {
      setPlaying(true);
      setInput([]);
      await wait(500);
      for (const i of sequence) {
        if (cancelled) return;
        setActive(i);
        await wait(320);
        if (cancelled) return;
        setActive(null);
        await wait(180);
      }
      if (!cancelled) {
        setPlaying(false);
        setMsg('Повторите нажатия');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sequence]);

  const press = (i: number) => {
    if (playing) return;
    const next = [...input, i];
    if (sequence[next.length - 1] !== i) {
      setMsg('Ошиблись — смотрите ещё раз');
      // Тот же массив, но новая ссылка — эффект выше перезапустит показ последовательности.
      setSequence((s) => [...s]);
      return;
    }
    setInput(next);
    if (next.length === sequence.length) {
      if (sequence.length >= SIMON_ROUNDS) {
        onDone();
        return;
      }
      setMsg('Запоминайте порядок кнопок');
      setSequence((s) => [...s, Math.floor(Math.random() * 4)]);
    }
  };

  return (
    <Panel className="impostor-simon">
      <p className="impostor-task-hint" aria-live="polite">
        {msg} · раунд {sequence.length} / {SIMON_ROUNDS}
      </p>
      <div className="impostor-simon-pad">
        {SIMON_COLORS.map((c, i) => (
          <button
            key={c}
            className={`impostor-simon-btn${active === i ? ' is-active' : ''}`}
            style={{ background: c }}
            aria-label={`${SIMON_NAMES[i]} кнопка реактора`}
            // Не `disabled`: выключенная кнопка теряет фокус, и после каждого показа клавиатуре
            // пришлось бы искать пульт заново. Нажатия во время показа `press` и так не принимает.
            aria-disabled={playing}
            onClick={() => press(i)}
          />
        ))}
      </div>
      <Keys>Tab — выбор кнопки, Enter — нажать</Keys>
    </Panel>
  );
}

// ---------------------------------------------------------------- топливо (Хранилище)

function CanSvg() {
  return (
    <svg viewBox="0 0 40 44" aria-hidden="true">
      <rect x="6" y="10" width="28" height="30" rx="4" fill="#e0b23a" stroke="#5c4413" strokeWidth="2" />
      <rect x="14" y="2" width="12" height="10" rx="2" fill="#c79a2c" stroke="#5c4413" strokeWidth="2" />
      <rect x="10" y="18" width="20" height="6" fill="#5c4413" opacity="0.4" />
    </svg>
  );
}

/**
 * Топливо: перетащить канистру к баку и дождаться, пока он заполнится.
 * С клавиатуры: Enter на канистре ставит её к баку. Касанием: канистра, затем бак.
 */
function Fuel({ onDone }: GameProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [pouring, setPouring] = useState(false);
  const [picked, setPicked] = useState(false);
  const [level, setLevel] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const tankRef = useRef<HTMLDivElement>(null);
  const canRef = useRef<HTMLButtonElement>(null);
  const dragOffset = useRef({ dx: 0, dy: 0 });
  const pressAt = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const done = useRef(false);

  useEffect(() => {
    if (!pouring) return;
    const timer = setInterval(() => {
      setLevel((l) => {
        const next = Math.min(1, l + 0.05);
        if (next >= 1 && !done.current) {
          done.current = true;
          onDone();
        }
        return next;
      });
    }, 120);
    return () => clearInterval(timer);
  }, [pouring, onDone]);

  /** Поставить канистру вплотную к баку и начать заливку — без перетаскивания. */
  const pourAtTank = () => {
    if (pouring) return;
    const board = boardRef.current?.getBoundingClientRect();
    const tank = tankRef.current?.getBoundingClientRect();
    const can = canRef.current?.getBoundingClientRect();
    if (board && tank && can) setPos({ x: tank.left - board.left - can.width - 6, y: tank.top - board.top });
    setPicked(false);
    setPouring(true);
  };

  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pouring) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pressAt.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    const r = e.currentTarget.getBoundingClientRect();
    const board = boardRef.current!.getBoundingClientRect();
    dragOffset.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setPos({ x: r.left - board.left, y: r.top - board.top });
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pos || pouring) return;
    if (!moved.current && Math.hypot(e.clientX - pressAt.current.x, e.clientY - pressAt.current.y) > TAP_SLOP) {
      moved.current = true;
      setPicked(false);
    }
    const board = boardRef.current!.getBoundingClientRect();
    setPos({ x: e.clientX - board.left - dragOffset.current.dx, y: e.clientY - board.top - dragOffset.current.dy });
  };
  const onUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pos || pouring) return;
    const tank = tankRef.current!.getBoundingClientRect();
    const inTank = e.clientX >= tank.left && e.clientX <= tank.right && e.clientY >= tank.top && e.clientY <= tank.bottom;
    if (inTank) setPouring(true);
    else setPos(null);
  };
  const onCanClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const wasDrag = moved.current;
    moved.current = false;
    if (wasDrag && e.detail !== 0) return;
    if (e.detail === 0) pourAtTank();
    else setPicked((p) => !p);
  };

  return (
    <Panel className="impostor-fuel">
      <p className="impostor-task-hint" aria-live="polite">
        {pouring ? 'Заливаем топливо…' : 'Перетащите канистру к баку — или нажмите канистру, затем бак'}
      </p>
      <div className="impostor-fuel-board" ref={boardRef}>
        {/* Бак принимает касание только после выбора канистры; клавиатуре хватает Enter на ней. */}
        <div
          className={`impostor-fuel-tank${picked ? ' is-ready' : ''}`}
          ref={tankRef}
          aria-hidden="true"
          onClick={() => {
            if (picked) pourAtTank();
          }}
        >
          <span className="impostor-fuel-level" style={{ height: `${level * 100}%` }} />
        </div>
        <button
          ref={canRef}
          className={`impostor-fuel-can${picked ? ' is-picked' : ''}`}
          style={pos ? { left: pos.x, top: pos.y, position: 'absolute' } : undefined}
          aria-label="Канистра с топливом: поставить к баку"
          aria-pressed={picked}
          disabled={pouring}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onClick={onCanClick}
        >
          <CanSvg />
        </button>
      </div>
      <Keys>Tab — к канистре, Enter — поставить её к баку</Keys>
    </Panel>
  );
}

export const TASK_GAMES: Record<TaskKind, (props: GameProps) => React.JSX.Element> = {
  wires: Wires,
  hold: Hold,
  calibrate: Calibrate,
  code: Code,
  upload: Upload,
  asteroids: Asteroids,
  swipe: Swipe,
  leaves: Leaves,
  shields: Shields,
  align: Align,
  simon: Simon,
  fuel: Fuel,
};
