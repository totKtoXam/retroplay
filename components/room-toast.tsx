'use client';
import { useEffect, useRef } from 'react';
import { RotateCcw, Trash2, X } from 'lucide-react';

/** Столько живёт тост «Удалено · Отменить». */
export const UNDO_TOAST_MS = 6000;

/**
 * Тост после удаления: карточка или тема исчезает сразу, без лишнего
 * «Вы уверены?», но шесть секунд её можно вернуть. Возврат — серверная отмена
 * последнего действия (db/room-ops.ts), поэтому она работает, только пока
 * комнату никто не изменил после удаления.
 */
export function UndoToast({
  text,
  busy = false,
  onUndo,
  onClose,
}: {
  text: string;
  busy?: boolean;
  onUndo: () => void;
  onClose: () => void;
}) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const timer = setTimeout(() => close.current(), UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <output className="undo-toast">
      <Trash2 size={15} aria-hidden="true" />
      <span>{text}</span>
      <button
        type="button"
        className="undo-toast-action"
        disabled={busy}
        onClick={onUndo}
      >
        <RotateCcw size={14} aria-hidden="true" />
        {busy ? 'Возвращаем…' : 'Отменить'}
      </button>
      <button
        type="button"
        className="undo-toast-close"
        aria-label="Скрыть уведомление"
        title="Скрыть"
        onClick={onClose}
      >
        <X size={14} />
      </button>
    </output>
  );
}
