'use client';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  /** Подпись кнопки действия — глаголом: «Завершить встречу», а не «ОК». */
  confirmLabel: string;
  cancelLabel?: string;
  /** Необратимое или заметное для всех действие: кнопка красная. */
  danger?: boolean;
};

/**
 * Подтверждение перед действием, которое трудно отменить или которое меняет
 * комнату для всех участников. Кнопка действия подписана тем, что произойдёт,
 * фокус по умолчанию — на «Отмене», Esc и щелчок мимо тоже отменяют.
 *
 * Если диалог нужен поверх другого диалога или всплывающего окна, его
 * разметку кладут внутрь того окна: тогда щелчок по подтверждению не считается
 * «щелчком мимо» и не закрывает родителя.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Отмена',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmOptions & {
  open: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent
        className="app-dialog confirm-dialog"
        initialFocus={cancelRef}
        showCloseButton={false}
      >
        <DialogTitle>{title}</DialogTitle>
        {description ? (
          <DialogDescription>{description}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">
            Подтвердите действие
          </DialogDescription>
        )}
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'danger-button' : 'primary'}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Подтверждение как обещание: `if (await confirm({...})) act(...)`.
 * `dialog` нужно один раз отрисовать в дереве компонента.
 */
export function useConfirm() {
  const [request, setRequest] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setRequest((old) => {
          // Новый вопрос поверх незакрытого старого: старый считаем отменённым.
          old?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );
  const finish = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  const dialog = (
    <ConfirmDialog
      open={!!request}
      title={request?.title ?? ''}
      description={request?.description}
      confirmLabel={request?.confirmLabel ?? 'Подтвердить'}
      cancelLabel={request?.cancelLabel}
      danger={request?.danger}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />
  );
  return { confirm, dialog };
}
