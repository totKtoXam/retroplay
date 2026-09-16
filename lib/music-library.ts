/**
 * Своя музыка игрока: файлы лежат в IndexedDB этого браузера.
 *
 * На сервер ничего не уходит — музыку слышит только тот, кто её загрузил, как и
 * встроенные треки. IndexedDB, а не localStorage: туда помещаются мегабайты
 * бинарных данных, и треки переживают перезагрузку страницы.
 */

export type StoredTrack = { id: string; name: string; blob: Blob; addedAt: number };

const DB_NAME = 'jinaly-music';
const STORE = 'tracks';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadStoredTracks(): Promise<StoredTrack[]> {
  const all = await run('readonly', (s) => s.getAll() as IDBRequest<StoredTrack[]>);
  return all.sort((a, b) => a.addedAt - b.addedAt);
}

export function saveStoredTrack(track: StoredTrack) {
  return run('readwrite', (s) => s.put(track));
}

export function deleteStoredTrack(id: string) {
  return run('readwrite', (s) => s.delete(id));
}
