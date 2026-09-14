'use client';
import { useSyncExternalStore } from 'react';

/** Ключ в localStorage, под которым хранится выбор темы. */
export const THEME_STORAGE_KEY = 'jinaly-theme';
/** Событие синхронизации подписчиков внутри одной вкладки. */
const THEME_EVENT = 'jinaly-theme-changed';
/** Медиа-запрос системной темы. */
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Что выбрал пользователь: системная тема, светлая или тёмная. */
export type ThemeChoice = 'system' | 'light' | 'dark';
/** Тема, которая реально применяется к документу. */
export type ResolvedTheme = 'light' | 'dark';
export type ThemeState = { choice: ThemeChoice; resolved: ResolvedTheme };

/** Порядок перебора темы по кругу в переключателе. */
const THEME_ORDER: ThemeChoice[] = ['system', 'light', 'dark'];

/** Приводит произвольное значение к допустимому выбору темы. */
export function parseThemeChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : 'system';
}

function readChoice(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    /* Хранилище запрещено настройками браузера — считаем тему системной. */
    return 'system';
  }
}

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    /* Нет matchMedia — по умолчанию светлая. */
    return 'light';
  }
}

/** Превращает выбор пользователя в конкретную тему. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice;
}

/**
 * Ставит тему на <html>: атрибут data-theme для CSS и color-scheme
 * для нативных элементов (скроллбары, выпадающие списки, поля ввода).
 * Тот же результат даёт встроенный скрипт из app/layout.tsx.
 */
export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  return resolved;
}

const serverState: ThemeState = { choice: 'system', resolved: 'light' };
let cached: ThemeState = serverState;

function getSnapshot(): ThemeState {
  const choice = readChoice();
  const resolved = resolveTheme(choice);
  if (cached.choice !== choice || cached.resolved !== resolved)
    cached = { choice, resolved };
  return cached;
}

function getServerSnapshot(): ThemeState {
  return serverState;
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  const handle = () => {
    // Системная тема могла измениться — пересчитываем и обновляем <html>.
    applyTheme(readChoice());
    onChange();
  };
  window.addEventListener('storage', handle);
  window.addEventListener(THEME_EVENT, handle);
  media.addEventListener('change', handle);
  return () => {
    window.removeEventListener('storage', handle);
    window.removeEventListener(THEME_EVENT, handle);
    media.removeEventListener('change', handle);
  };
}

/** Сохраняет выбор темы и применяет его ко всем подписчикам. */
export function chooseTheme(choice: ThemeChoice) {
  const next = parseThemeChoice(choice);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* Без хранилища выбор действует до перезагрузки страницы. */
  }
  applyTheme(next);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Следующая тема в круговом переключении. */
export function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  return THEME_ORDER[(THEME_ORDER.indexOf(choice) + 1) % THEME_ORDER.length];
}

/** Текущий выбор темы и применённая тема. */
export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
