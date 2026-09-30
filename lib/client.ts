export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  timeoutMs = 6000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let r: Response;
    try {
      r = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      // Браузер сообщает обрыв сети и таймаут по-английски («Failed to fetch»,
      // «signal is aborted»); пользователю нужен понятный русский текст.
      throw Error(
        (e as Error)?.name === 'AbortError'
          ? 'Сервер не ответил вовремя. Проверьте подключение и попробуйте ещё раз.'
          : 'Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.',
      );
    }
    let data: Record<string, unknown>;
    try {
      data = (await r.json()) as Record<string, unknown>;
    } catch {
      // Вместо JSON пришла страница ошибки (502, перезапуск сервера) или ответ оборвался.
      throw Error(
        r.ok
          ? 'Сервер прислал неполный ответ. Попробуйте ещё раз.'
          : 'Сервер временно недоступен. Попробуйте через минуту.',
      );
    }
    if (!r.ok)
      throw Error(
        typeof data.error === 'string'
          ? data.error
          : 'Не удалось выполнить запрос',
      );
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}
export async function ready() {
  return api('/api/session', {});
}
export function download(
  name: string,
  content: string,
  type = 'application/json',
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw Error('Незакрытая кавычка в CSV');
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
