'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, CloudOff, LoaderCircle, RefreshCw } from 'lucide-react';
import {
  CONNECTION_HINTS,
  CONNECTION_LABELS,
  type ConnectionStatus,
} from '@/lib/room-connection';

const ICONS = {
  saved: Check,
  saving: LoaderCircle,
  reconnecting: RefreshCw,
  offline: CloudOff,
} as const;

/**
 * Статус связи в шапке: «Сохранено», «Сохраняем…», «Переподключаемся…»,
 * «Офлайн — изменения не отправлены». Скринридер слышит только смену
 * состояния: живой регион пуст при входе и заполняется, когда статус меняется.
 */
export function ConnectionIndicator({
  status,
  compact = false,
}: {
  status: ConnectionStatus;
  /** Строка в меню «⋯»: без рамки чипа, с пояснением. */
  compact?: boolean;
}) {
  const [announce, setAnnounce] = useState('');
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    // Смена статуса — внешнее событие сети, объявляем её скринридеру.
    // oxlint-disable-next-line react/react-compiler
    setAnnounce(CONNECTION_LABELS[status]);
  }, [status]);
  const Icon = ICONS[status];
  if (compact)
    return (
      <p className={`sync-status-row is-${status}`}>
        <Icon size={15} aria-hidden="true" />
        <span>
          <strong>{CONNECTION_LABELS[status]}</strong>
          <small>{CONNECTION_HINTS[status]}</small>
        </span>
      </p>
    );
  return (
    <span
      className={`sync-status is-${status}`}
      title={`${CONNECTION_LABELS[status]}. ${CONNECTION_HINTS[status]}`}
    >
      <Icon size={14} aria-hidden="true" />
      <span className="sync-status-text" aria-hidden="true">
        {CONNECTION_LABELS[status]}
      </span>
      <span className="sr-only">Статус связи: {CONNECTION_LABELS[status]}</span>
      <output className="sr-only" aria-live="polite">
        {announce}
      </output>
    </span>
  );
}
