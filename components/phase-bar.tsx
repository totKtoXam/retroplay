'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { PHASES } from '@/lib/model';
import type { PhaseAction, PhaseGuide } from '@/lib/room-phase';

type PhaseBarProps = {
  /** Текущий этап встречи — индекс в `PHASES`. */
  phase: number;
  /** Ведущий: только он двигает встречу по этапам. */
  host: boolean;
  /** Завершённая встреча доступна только на чтение. */
  archived: boolean;
  /** Отправляет `{ type: 'phase', phase }` — операцию комнаты. */
  onPhase: (phase: number) => void;
  /**
   * Что происходит на этапе и какой шаг следующий (lib/room-phase.ts).
   * Ведущему — подсказка и главная кнопка, участнику — строка о том, чего ждём.
   */
  guide?: PhaseGuide;
  /** Выполнить кнопку подсказки; что она делает, решает комната. */
  onGuideAction?: (action: PhaseAction) => void;
  /** Главная кнопка ждёт ответа сервера — защита от двойного щелчка. */
  guideBusy?: boolean;
};

/**
 * Этап ретроспективы поверх 3D-сцены.
 *
 * Раньше шесть этапов жили горизонтальным степпером в шапке и занимали всю её
 * середину, хотя этап переключают несколько раз за встречу: шапка была забита
 * тем, что почти не трогают. Здесь свёрнутый вид — одна плашка «3/6 ·
 * Группируем», а весь список раскрывается по клику.
 *
 * Участнику список тоже виден: ему важно понимать, на чём встреча, — но кнопки
 * заблокированы. Иначе любой посреди голосования перещёлкнет этап и собьёт
 * работу всей комнаты.
 */
export function PhaseBar({
  phase,
  host,
  archived,
  onPhase,
  guide,
  onGuideAction,
  guideBusy = false,
}: PhaseBarProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const locked = !host || archived;

  // Раскрытый список перекрывает сцену, поэтому закрываем его при первом же
  // клике мимо и по Escape — так же, как ведут себя всплывающие панели комнаты.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    // Плашка — соседка сцены, а не её содержимое: захват мыши вешается на сам
    // canvas (`canvas.addEventListener('mousedown')` в world.tsx), поэтому клики
    // по кнопкам до него не доходят и pointer lock не включается.
    <div className="phase-bar" ref={ref}>
      <button
        type="button"
        className={`phase-bar-current ${open ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          locked
            ? 'Этап встречи — переключает ведущий'
            : 'Этап встречи — нажмите, чтобы переключить'
        }
        onClick={() => setOpen((v) => !v)}
      >
        <span className="phase-bar-index">
          {phase + 1}/{PHASES.length}
        </span>
        <span className="phase-bar-name">{PHASES[phase]}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        // role=menu не только для скринридера: world.tsx глушит игровое
        // управление, пока фокус внутри `[role=menu]`, иначе пробел на кнопке
        // этапа заодно заставил бы персонажа прыгать.
        <div className="phase-bar-list" role="menu" aria-label="Этапы встречи">
          {PHASES.map((p, i) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              className={`phase-bar-step ${i === phase ? 'current' : ''} ${phase > i ? 'complete' : ''}`}
              disabled={locked}
              aria-current={i === phase ? 'step' : undefined}
              onClick={() => {
                onPhase(i);
                setOpen(false);
              }}
            >
              <span className="phase-bar-mark">
                {phase > i ? <Check size={11} /> : i + 1}
              </span>
              {p}
            </button>
          ))}
          {locked && (
            <p className="phase-bar-note">
              {archived ? 'Встреча завершена' : 'Этапы переключает ведущий'}
            </p>
          )}
        </div>
      )}
      {/* Подсказка этапа: встреча ведёт сама, ведущему не нужно помнить, что
          дальше, а участник видит, чего сейчас ждут. Прячется, пока открыт
          список этапов, — иначе две плашки спорят за одно место. */}
      {guide && !open && (
        <div className="phase-guide" aria-live="polite">
          <p className="phase-guide-hint">{guide.hint}</p>
          {(guide.action || guide.secondary) && onGuideAction && (
            <div className="phase-guide-actions">
              {guide.action && (
                <button
                  type="button"
                  className="phase-guide-main"
                  disabled={guideBusy}
                  aria-busy={guideBusy || undefined}
                  onClick={() => guide.action && onGuideAction(guide.action)}
                >
                  {guide.action.label}
                </button>
              )}
              {guide.secondary && (
                <button
                  type="button"
                  className="phase-guide-link"
                  onClick={() =>
                    guide.secondary && onGuideAction(guide.secondary)
                  }
                >
                  {guide.secondary.label}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
