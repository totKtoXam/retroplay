'use client';
import { useEffect } from 'react';
import {
  SETTINGS_APPLIED_EVENT,
  SYNCED_SETTING_KEYS,
  cleanSettings,
  mergeSettings,
  sameSettings,
  type SettingsValues,
} from '@/lib/settings-sync';

/**
 * Синхронизация личных настроек с аккаунтом (lib/settings-sync.ts).
 *
 * Код приложения по-прежнему пишет настройки прямо в localStorage — отсюда
 * они раз в несколько секунд сверяются со слепком последней синхронизации и
 * уходят на сервер. Настройки с других устройств подтягиваются при открытии
 * страницы, возврате на вкладку и после входа в аккаунт.
 */
const MARKER_KEY = 'jinaly-settings-sync';
const WATCH_MS = 3000;
/** Возврат на вкладку не чаще раза в это время: переключения туда-сюда не должны спамить сервер. */
const FOCUS_SYNC_MS = 30_000;

type Marker = { user: string; updated: number; snapshot: SettingsValues };
type Remote = { user: string | null; settings: SettingsValues; updated: number };

function readLocal(): SettingsValues {
  const out: SettingsValues = {};
  try {
    for (const key of SYNCED_SETTING_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) out[key] = value;
    }
  } catch {
    /* Хранилище недоступно — синхронизировать нечего. */
  }
  return out;
}

function readMarker(): Marker | null {
  try {
    const raw = JSON.parse(localStorage.getItem(MARKER_KEY) || 'null');
    if (raw && typeof raw.user === 'string' && Number.isFinite(raw.updated))
      return { user: raw.user, updated: raw.updated, snapshot: cleanSettings(raw.snapshot) };
  } catch {
    /* Повреждённый слепок — синхронизируемся как в первый раз. */
  }
  return null;
}

function writeMarker(marker: Marker) {
  try {
    localStorage.setItem(MARKER_KEY, JSON.stringify(marker));
  } catch {
    /* Без хранилища слепок живёт только в памяти. */
  }
  current = marker;
}

/** Записывает пришедшие настройки и будит подписчиков, которые читают localStorage. */
function applyLocal(next: SettingsValues, local: SettingsValues) {
  let changed = false;
  try {
    for (const key of SYNCED_SETTING_KEYS) {
      if (next[key] === local[key]) continue;
      changed = true;
      if (next[key] === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, next[key]);
    }
  } catch {
    return;
  }
  if (!changed) return;
  // `storage` сам браузер шлёт только другим вкладкам; тема, прицел, вид
  // магазина и обзор уже слушают его — им хватит этого же события.
  window.dispatchEvent(new StorageEvent('storage'));
  window.dispatchEvent(new Event(SETTINGS_APPLIED_EVENT));
}

async function request(body?: unknown, keepalive = false) {
  const response = await fetch('/api/settings', {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    keepalive,
    cache: 'no-store',
  });
  if (response.status !== 200 && response.status !== 409) return null;
  const data = (await response.json()) as Remote;
  return {
    conflict: response.status === 409,
    remote: {
      user: typeof data.user === 'string' ? data.user : null,
      settings: cleanSettings(data.settings),
      updated: Number(data.updated) || 0,
    },
  };
}

/** Последний слепок для вошедшего аккаунта; `null` — гость или ещё не знаем. */
let current: Marker | null = null;
let busy: Promise<void> | null = null;
let lastFullSync = 0;

async function fullSync() {
  const got = await request();
  if (!got?.remote.user) {
    current = null;
    return;
  }
  let remote = got.remote;
  // Две попытки: если между чтением и записью настройки сохранило другое
  // устройство, сливаем ещё раз уже с его версией.
  for (let attempt = 0; attempt < 2; attempt++) {
    const saved = readMarker();
    const base = saved?.user === remote.user ? saved.snapshot : null;
    const local = readLocal();
    const merged = mergeSettings({ local, remote: remote.settings, base });
    applyLocal(merged, local);
    if (sameSettings(merged, remote.settings)) {
      writeMarker({ user: remote.user!, updated: remote.updated, snapshot: merged });
      return;
    }
    const pushed = await request({ base: remote.updated, settings: merged });
    if (!pushed?.remote.user) return;
    if (!pushed.conflict) {
      writeMarker({ user: pushed.remote.user, updated: pushed.remote.updated, snapshot: merged });
      return;
    }
    remote = pushed.remote;
  }
}

/** Отправляет локальные изменения, если они есть; при конфликте — полное слияние. */
async function pushChanges(keepalive = false) {
  if (!current) return;
  const local = readLocal();
  if (sameSettings(local, current.snapshot)) return;
  const pushed = await request({ base: current.updated, settings: local }, keepalive);
  if (!pushed?.remote.user) return;
  if (pushed.conflict || pushed.remote.user !== current.user) return fullSync();
  writeMarker({ user: pushed.remote.user, updated: pushed.remote.updated, snapshot: local });
}

function exclusive(task: () => Promise<void>) {
  if (busy) return busy;
  busy = task()
    .catch(() => {
      /* Нет сети — попробуем на следующем круге. */
    })
    .finally(() => {
      busy = null;
    });
  return busy;
}

/** Полная синхронизация сейчас: после входа или выхода из аккаунта. */
export function syncSettingsNow(): Promise<void> {
  // Идёт отправка изменений — дождаться её, а не пропустить слияние после входа.
  if (busy) return busy.then(() => syncSettingsNow());
  lastFullSync = Date.now();
  return exclusive(fullSync);
}

export function SettingsSync() {
  useEffect(() => {
    void syncSettingsNow();
    const watch = setInterval(() => {
      if (current && !busy) void exclusive(() => pushChanges());
    }, WATCH_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Страницу могут закрыть: keepalive даёт запросу пережить выгрузку.
        if (current && !busy) void exclusive(() => pushChanges(true));
      } else if (Date.now() - lastFullSync > FOCUS_SYNC_MS) void syncSettingsNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(watch);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return null;
}
