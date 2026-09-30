// Статус связи комнаты для шапки (components/room-status.tsx). Данные собирает
// components/use-room-sync.ts; здесь только правило, какое из состояний показать.

export type ConnectionStatus = 'saved' | 'saving' | 'reconnecting' | 'offline';

export type ConnectionFacts = {
  /** navigator.onLine: браузер сам знает, что сети нет. */
  browserOnline: boolean;
  /** Сокет комнаты открыт прямо сейчас. */
  socketOpen: boolean;
  /**
   * Сокет хоть раз открывался. Без Durable Object (локальная разработка) он не
   * открывается никогда, и тогда комната живёт на HTTP-опросе — это не обрыв.
   */
  socketEverOpened: boolean;
  /** Сколько запросов подряд не дошли до сервера из-за сети. */
  networkFailures: number;
  /** Последняя запись не ушла из-за сети и после неё не было успешной. */
  unsentWrite: boolean;
  /** Запись идёт дольше порога (SAVING_DELAY_MS). */
  slowWrite: boolean;
};

/** «Сохраняем…» появляется только у записи дольше этого, иначе шапка мигает на каждом клике. */
export const SAVING_DELAY_MS = 400;

export function connectionStatus(f: ConnectionFacts): ConnectionStatus {
  if (!f.browserOnline || f.unsentWrite || f.networkFailures >= 2) return 'offline';
  if (f.networkFailures === 1 || (f.socketEverOpened && !f.socketOpen)) return 'reconnecting';
  if (f.slowWrite) return 'saving';
  return 'saved';
}

export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  saved: 'Сохранено',
  saving: 'Сохраняем…',
  reconnecting: 'Переподключаемся…',
  offline: 'Офлайн — изменения не отправлены',
};

export const CONNECTION_HINTS: Record<ConnectionStatus, string> = {
  saved: 'Все изменения на сервере',
  saving: 'Отправляем изменения на сервер',
  reconnecting: 'Связь прервалась, восстанавливаем. Доска пока обновляется реже',
  offline: 'Нет связи с сервером. Проверьте интернет — последние изменения могли не сохраниться',
};

/**
 * Ошибка сети, а не отказ сервера. lib/client.ts переводит сбой fetch, таймаут
 * и страницу ошибки вместо JSON в эти русские тексты; отказ по правилам
 * комнаты («Доступно только ведущему») приходит другим текстом и связью не считается.
 */
export function isNetworkError(message: string) {
  return /Нет связи с сервером|Сервер не ответил вовремя|Сервер временно недоступен|неполный ответ/.test(
    message,
  );
}

/**
 * Повтор записи при сбое сети. Запись могла дойти до сервера, а ответ — нет
 * (таймаут 6 с): тогда повтор с тем же ключом `opId` сервер узнаёт и не
 * применяет второй раз (db/room-ops.ts). Отказ сервера по правилам не
 * повторяется — только сетевые сбои.
 */
export const OP_RETRY_DELAYS_MS = [700, 2000] as const;

/** Ключ одной операции: одинаков у всех её повторов. */
export function newOpId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Отправить и при сетевом сбое повторить с паузами `delays`. */
export async function sendWithRetry<T>(
  send: () => Promise<T>,
  delays: readonly number[] = OP_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (e) {
      if (attempt >= delays.length || !isNetworkError((e as Error)?.message ?? '')) throw e;
      await sleep(delays[attempt]);
    }
  }
}
