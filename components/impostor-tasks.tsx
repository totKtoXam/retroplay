'use client';

// Мини-игры заданий режима «Предатель». Каждая — короткое действие руками, после которого
// игра зовёт `onDone`. Засчитывает сервер (lib/impostor.ts): он проверит, что игрок у пульта
// и провёл там не меньше минимального времени, поэтому подделать прохождение нечем.
import { useEffect, useRef, useState } from 'react';
import type { TaskKind } from '@/lib/maps/types';

type GameProps = { onDone: () => void };

const WIRE_COLORS = ['#e5484d', '#3e8ef7', '#f5d90a', '#c55ff0'];
const shuffled = <T,>(list: T[]) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Провода: соединить каждый цвет слева с таким же справа. */
function Wires({ onDone }: GameProps) {
  const [right] = useState(() => shuffled(WIRE_COLORS));
  const [picked, setPicked] = useState<string | null>(null);
  const [joined, setJoined] = useState<string[]>([]);
  useEffect(() => {
    if (joined.length === WIRE_COLORS.length) onDone();
  }, [joined, onDone]);
  return (
    <div className="impostor-wires">
      <div className="impostor-wires-column">
        {WIRE_COLORS.map((c) => (
          <button
            key={c}
            className={`impostor-wire${picked === c ? ' is-picked' : ''}${joined.includes(c) ? ' is-joined' : ''}`}
            style={{ background: c }}
            disabled={joined.includes(c)}
            aria-label="Провод слева"
            onClick={() => setPicked(c)}
          />
        ))}
      </div>
      <p className="impostor-task-hint">{picked ? 'Теперь провод того же цвета справа' : 'Выберите провод слева'}</p>
      <div className="impostor-wires-column">
        {right.map((c) => (
          <button
            key={c}
            className={`impostor-wire${joined.includes(c) ? ' is-joined' : ''}`}
            style={{ background: c }}
            disabled={joined.includes(c)}
            aria-label="Провод справа"
            onClick={() => {
              if (picked === c) setJoined((j) => [...j, c]);
              setPicked(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Удержание: держать кнопку, пока шкала не заполнится; отпустил — начинай заново. */
function Hold({ onDone }: GameProps) {
  const NEED = 3000;
  const [progress, setProgress] = useState(0);
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
    setProgress(0);
  };
  return (
    <div className="impostor-hold">
      <div className="impostor-bar">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <button
        className="impostor-hold-button"
        onPointerDown={() => (since.current = performance.now())}
        onPointerUp={release}
        onPointerLeave={release}
      >
        Удерживайте
      </button>
    </div>
  );
}

/** Калибровка: трижды остановить бегающую метку в зелёной зоне. */
function Calibrate({ onDone }: GameProps) {
  const [hits, setHits] = useState(0);
  const [miss, setMiss] = useState(false);
  const marker = useRef<HTMLSpanElement>(null);
  const [phase] = useState(() => Math.random() * Math.PI * 2);
  const position = useRef(0);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const loop = (now: number) => {
      // Каждое следующее попадание — быстрее.
      const speed = 0.0022 + hits * 0.0009;
      position.current = (Math.sin((now - start) * speed + phase) + 1) / 2;
      if (marker.current) marker.current.style.left = `${position.current * 100}%`;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [hits, phase]);
  return (
    <div className="impostor-calibrate">
      <div className="impostor-calibrate-track">
        <span className="impostor-calibrate-zone" />
        <span className="impostor-calibrate-marker" ref={marker} />
      </div>
      <p className="impostor-task-hint">
        {miss ? 'Мимо — ещё раз' : 'Остановите метку в зелёной зоне'} · {hits} / 3
      </p>
      <button
        className="primary"
        onClick={() => {
          const inZone = Math.abs(position.current - 0.5) < 0.09;
          setMiss(!inZone);
          if (!inZone) return;
          if (hits + 1 >= 3) onDone();
          setHits((h) => h + 1);
        }}
      >
        Стоп
      </button>
    </div>
  );
}

/** Код: набрать на клавиатуре пульта показанные цифры. */
function Code({ onDone }: GameProps) {
  const [code] = useState(() => String(Math.floor(10000 + Math.random() * 90000)));
  const [typed, setTyped] = useState('');
  const press = (digit: string) => {
    const next = (typed + digit).slice(0, 5);
    if (!code.startsWith(next)) {
      setTyped('');
      return;
    }
    setTyped(next);
    if (next === code) onDone();
  };
  return (
    <div className="impostor-code">
      <div className="impostor-code-note">Код: {code}</div>
      <div className="impostor-code-screen">{typed.padEnd(5, '·')}</div>
      <div className="impostor-code-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => (
          <button key={d} onClick={() => press(d)}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Загрузка: нажать и дождаться, не закрывая пульт. */
function Upload({ onDone }: GameProps) {
  const NEED = 5000;
  const [started, setStarted] = useState(0);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!started) return;
    const timer = setInterval(() => {
      const p = Math.min(1, (performance.now() - started) / NEED);
      setProgress(p);
      if (p >= 1) {
        clearInterval(timer);
        onDone();
      }
    }, 100);
    return () => clearInterval(timer);
  }, [started, onDone]);
  return (
    <div className="impostor-upload">
      <div className="impostor-bar">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <button className="primary" disabled={!!started} onClick={() => setStarted(performance.now())}>
        {started ? `Загрузка ${Math.round(progress * 100)} %` : 'Загрузить'}
      </button>
    </div>
  );
}

export const TASK_GAMES: Record<TaskKind, (props: GameProps) => React.JSX.Element> = {
  wires: Wires,
  hold: Hold,
  calibrate: Calibrate,
  code: Code,
  upload: Upload,
};
