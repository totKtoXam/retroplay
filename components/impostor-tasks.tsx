'use client';

// Мини-игры заданий режима «Предатель». Каждая — короткое действие руками, после которого
// игра зовёт `onDone`. Засчитывает сервер (lib/impostor.ts): он проверит, что игрок у пульта
// и провёл там не меньше минимального времени, поэтому подделать прохождение нечем.
//
// Оформление — как приборная панель шаттла: тёмный металл со скошенными гранями, заклёпки по
// углам и подсвеченный «экран» внутри (класс `impostor-game`, задаётся в app/impostor.css).
// Рисунки — только инлайн-SVG и CSS, без внешних картинок и библиотек.
import { useEffect, useRef, useState } from 'react';
import type { TaskKind } from '@/lib/maps/types';

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

// ---------------------------------------------------------------- провода

const WIRE_COLORS = ['#e5484d', '#3e8ef7', '#f5d90a', '#c55ff0'];
// Разъёмы стоят по строгой сетке — координаты считаем формулой, а не измеряем DOM.
const WIRE_W = 230,
  WIRE_H = 176,
  WIRE_PAD = 20,
  WIRE_ROW = 44;
const wireAnchor = (side: 'left' | 'right', index: number) => ({
  x: side === 'left' ? WIRE_PAD : WIRE_W - WIRE_PAD,
  y: 22 + index * WIRE_ROW,
});

/** Провода: перетащить провод от разъёма к разъёму того же цвета — со искрой при соединении. */
function Wires({ onDone }: GameProps) {
  const [right] = useState(() => shuffled(WIRE_COLORS));
  const [joined, setJoined] = useState<string[]>([]);
  const [drag, setDrag] = useState<{ color: string; x: number; y: number } | null>(null);
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number }[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const sparkId = useRef(0);

  useEffect(() => {
    if (joined.length === WIRE_COLORS.length) onDone();
  }, [joined, onDone]);
  useEffect(() => {
    if (!sparks.length) return;
    const t = setTimeout(() => setSparks((s) => s.slice(1)), 500);
    return () => clearTimeout(t);
  }, [sparks]);

  const relative = (clientX: number, clientY: number) => {
    const r = boardRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const startDrag = (color: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (joined.includes(color)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const a = wireAnchor('left', WIRE_COLORS.indexOf(color));
    setDrag({ color, x: a.x, y: a.y });
  };
  const onDragMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const p = relative(e.clientX, e.clientY);
    setDrag((d) => (d ? { ...d, x: p.x, y: p.y } : d));
  };
  const onDragEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    // Под пальцем/курсором на момент отпускания — так соединение работает и на тач-экранах,
    // где события всё ещё приходят на исходную кнопку.
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const plug = el?.closest<HTMLElement>('[data-wire-right]');
    if (plug?.dataset.wireRight === drag.color) {
      const a = wireAnchor('right', right.indexOf(drag.color));
      setSparks((s) => [...s, { id: sparkId.current++, x: a.x, y: a.y }]);
      setJoined((j) => [...j, drag.color]);
    }
    setDrag(null);
  };

  return (
    <Panel className="impostor-wires">
      <p className="impostor-task-hint">Перетащите провод к разъёму того же цвета</p>
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
          return (
            <button
              key={c}
              className={`impostor-plug${joined.includes(c) ? ' is-joined' : ''}`}
              style={{ left: a.x, top: a.y, background: c }}
              disabled={joined.includes(c)}
              aria-label="Провод"
              onPointerDown={startDrag(c)}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
            />
          );
        })}
        {right.map((c, i) => {
          const a = wireAnchor('right', i);
          return (
            <span
              key={c}
              data-wire-right={c}
              className={`impostor-plug impostor-plug-socket${joined.includes(c) ? ' is-joined' : ''}`}
              style={{ left: a.x, top: a.y, background: joined.includes(c) ? c : undefined }}
              aria-hidden="true"
            />
          );
        })}
      </div>
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
  const release = () => {
    if (done.current) return;
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
        aria-label="Удерживать манометр"
        onPointerDown={() => {
          since.current = performance.now();
          setHolding(true);
        }}
        onPointerUp={release}
        onPointerLeave={release}
      >
        Удерживать
      </button>
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
      <p className="impostor-task-hint">
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
      <button className="primary impostor-scope-stop" onClick={stop}>
        Стоп
      </button>
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
          <button key={d} className="impostor-key" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button className="impostor-key impostor-key-wide" aria-label="Стереть" onClick={() => setTyped('')}>
          ⌫
        </button>
        <button className="impostor-key" onClick={() => press('0')}>
          0
        </button>
      </div>
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
      if (p >= 1) onDone();
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
    </Panel>
  );
}

// ---------------------------------------------------------------- астероиды (Оружейная)

const ASTEROID_NEED = 10;

function RockSvg() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M6 18 L14 6 L28 4 L36 14 L34 30 L20 37 L8 32 Z" fill="#8a7f74" stroke="#332c26" strokeWidth="2" />
      <circle cx="16" cy="16" r="3" fill="#4d453d" />
      <circle cx="26" cy="24" r="2.4" fill="#4d453d" />
    </svg>
  );
}

/** Астероиды: сбить кликом падающие обломки — орудийная башня Оружейной. */
function Asteroids({ onDone }: GameProps) {
  const [rocks, setRocks] = useState<{ id: number; x: number; size: number; dur: number }[]>([]);
  const [destroyed, setDestroyed] = useState(0);
  const rockId = useRef(0);
  const destroyedRef = useRef(0);
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
  return (
    <Panel className="impostor-asteroids">
      <p className="impostor-task-hint">
        Сбито {destroyed} / {ASTEROID_NEED}
      </p>
      <div className="impostor-asteroids-field">
        {rocks.map((r) => (
          <button
            key={r.id}
            className="impostor-asteroid"
            style={{ left: `${r.x}%`, width: r.size, height: r.size, animationDuration: `${r.dur}s` }}
            aria-label="Сбить астероид"
            onClick={() => hit(r.id)}
            onAnimationEnd={() => setRocks((list) => list.filter((x) => x.id !== r.id))}
          >
            <RockSvg />
          </button>
        ))}
        <div className="impostor-asteroids-turret" aria-hidden="true" />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- пропуск (Администрация)

const SWIPE_LEN = 210;
const SWIPE_MIN_MS = 260;
const SWIPE_MAX_MS = 900;

/** Пропуск: провести карту через считыватель не быстрее и не медленнее нужного. */
function Swipe({ onDone }: GameProps) {
  const [x, setX] = useState(0);
  const [msg, setMsg] = useState('Проведите картой слева направо');
  const dragging = useRef(false);
  const startAt = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
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
  const onUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const ms = performance.now() - startAt.current;
    if (x < SWIPE_LEN * 0.92) setMsg('Карта не дошла до конца — ещё раз');
    else if (ms < SWIPE_MIN_MS) setMsg('Слишком быстро — ещё раз');
    else if (ms > SWIPE_MAX_MS) setMsg('Слишком медленно — ещё раз');
    else {
      setMsg('Пропуск принят');
      onDone();
      return;
    }
    setX(0);
  };

  return (
    <Panel className="impostor-swipe">
      <p className="impostor-task-hint">{msg}</p>
      <div className="impostor-swipe-track" ref={trackRef}>
        <span className="impostor-swipe-slot" aria-hidden="true" />
        <button
          className="impostor-swipe-card"
          style={{ transform: `translateX(${x}px)` }}
          aria-label="Провести пропуском по считывателю"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>
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

/** Листья: перетащить каждый лист с решётки фильтра O2 в сторону — она забита ими. */
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
  const doneCount = useRef(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const grateRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ dx: 0, dy: 0 });

  const onDown = (id: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    dragOffset.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    const board = boardRef.current!.getBoundingClientRect();
    setLeaves((list) => list.map((l) => (l.id === id ? { ...l, dragging: true, x: r.left - board.left, y: r.top - board.top } : l)));
  };
  const onMove = (id: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    const board = boardRef.current!.getBoundingClientRect();
    const x = e.clientX - board.left - dragOffset.current.dx;
    const y = e.clientY - board.top - dragOffset.current.dy;
    setLeaves((list) => list.map((l) => (l.id === id && l.dragging ? { ...l, x, y } : l)));
  };
  const onUp = (id: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = grateRef.current?.getBoundingClientRect();
    const inGrate = !!g && e.clientX >= g.left && e.clientX <= g.right && e.clientY >= g.top && e.clientY <= g.bottom;
    setLeaves((list) =>
      list.map((l) => {
        if (l.id !== id) return l;
        if (inGrate) {
          doneCount.current += 1;
          return { ...l, done: true, dragging: false };
        }
        return { ...l, dragging: false };
      }),
    );
    if (inGrate && doneCount.current >= LEAF_COUNT) onDone();
  };

  return (
    <Panel className="impostor-leaves">
      <p className="impostor-task-hint">Перетащите листья с решётки в сторону</p>
      <div className="impostor-leaves-board" ref={boardRef}>
        <div className="impostor-leaves-grate" ref={grateRef} aria-hidden="true" />
        {leaves
          .filter((l) => !l.done)
          .map((l) => (
            <button
              key={l.id}
              className="impostor-leaf"
              style={l.dragging ? { left: l.x, top: l.y } : { left: l.startX, top: l.startY }}
              aria-label="Лист на фильтре"
              onPointerDown={onDown(l.id)}
              onPointerMove={onMove(l.id)}
              onPointerUp={onUp(l.id)}
              onPointerCancel={onUp(l.id)}
            >
              <LeafSvg />
            </button>
          ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- щиты

const SHIELD_COUNT = 9;

/** Щиты: кликами погасить все красные шестиугольники защитного поля. */
function Shields({ onDone }: GameProps) {
  const [lit, setLit] = useState<boolean[]>(() => Array(SHIELD_COUNT).fill(true));
  useEffect(() => {
    if (lit.every((v) => !v)) onDone();
  }, [lit, onDone]);
  return (
    <Panel className="impostor-shields">
      <p className="impostor-task-hint">Погасите все красные сегменты поля</p>
      <div className="impostor-shields-grid">
        {lit.map((on, i) => (
          <button
            key={i}
            className={`impostor-hex${on ? ' is-red' : ' is-clear'}`}
            disabled={!on}
            aria-label={on ? 'Погасить сегмент щита' : 'Сегмент в порядке'}
            onClick={() => setLit((list) => list.map((v, idx) => (idx === i ? false : v)))}
          >
            <svg viewBox="0 0 100 88" aria-hidden="true">
              <polygon points="25,4 75,4 98,44 75,84 25,84 2,44" />
            </svg>
          </button>
        ))}
      </div>
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

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    const r = trackRef.current!.getBoundingClientRect();
    const v = clamp((e.clientX - r.left) / r.width, 0, 1);
    valueRef.current = v;
    setValue(v);
  };

  return (
    <Panel className="impostor-align">
      <p className="impostor-task-hint">Совместите ползунок с меткой и удержите</p>
      <div className="impostor-align-track" ref={trackRef} onPointerDown={move} onPointerMove={move}>
        <span className="impostor-align-target" style={{ left: `${target * 100}%` }} />
        <span className="impostor-align-handle" style={{ left: `${value * 100}%` }} />
      </div>
      <div className="impostor-bar">
        <span style={{ width: `${Math.min(1, holdMs / ALIGN_HOLD_MS) * 100}%` }} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- симон (Реактор)

const SIMON_COLORS = ['#e5484d', '#3e8ef7', '#f5d90a', '#4ade80'];
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
      <p className="impostor-task-hint">
        {msg} · раунд {sequence.length} / {SIMON_ROUNDS}
      </p>
      <div className="impostor-simon-pad">
        {SIMON_COLORS.map((c, i) => (
          <button
            key={c}
            className={`impostor-simon-btn${active === i ? ' is-active' : ''}`}
            style={{ background: c }}
            aria-label={`Кнопка реактора ${i + 1}`}
            disabled={playing}
            onClick={() => press(i)}
          />
        ))}
      </div>
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

/** Топливо: перетащить канистру к баку и дождаться, пока он заполнится. */
function Fuel({ onDone }: GameProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [pouring, setPouring] = useState(false);
  const [level, setLevel] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const tankRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ dx: 0, dy: 0 });
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

  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pouring) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const board = boardRef.current!.getBoundingClientRect();
    dragOffset.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setPos({ x: r.left - board.left, y: r.top - board.top });
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pos || pouring) return;
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

  return (
    <Panel className="impostor-fuel">
      <p className="impostor-task-hint">{pouring ? 'Заливаем топливо…' : 'Перетащите канистру к баку'}</p>
      <div className="impostor-fuel-board" ref={boardRef}>
        <div className="impostor-fuel-tank" ref={tankRef}>
          <span className="impostor-fuel-level" style={{ height: `${level * 100}%` }} />
        </div>
        <button
          className="impostor-fuel-can"
          style={pos ? { left: pos.x, top: pos.y, position: 'absolute' } : undefined}
          aria-label="Канистра с топливом"
          disabled={pouring}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <CanSvg />
        </button>
      </div>
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
