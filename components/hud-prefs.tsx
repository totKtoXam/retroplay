'use client';
import { useEffect, useState } from 'react';
import { DEFAULT_HUD_PREFS, readHudPrefs, sameHudPrefs, type HudPrefs } from '@/lib/hud-prefs';
import { PREF_CHANGED_EVENT } from '@/lib/user-prefs';
import { SETTINGS_APPLIED_EVENT } from '@/lib/settings-sync';

/**
 * Настройки игрока для мира и HUD. Меню настроек живёт в другой ветке дерева,
 * поэтому подписываемся на события окна: своя вкладка шлёт PREF_CHANGED_EVENT,
 * настройки с аккаунта — SETTINGS_APPLIED_EVENT, соседняя вкладка — `storage`.
 * Читаем только после монтирования: на сервере localStorage нет, и первый кадр
 * разошёлся бы с гидрацией.
 */
export function useHudPrefs(): HudPrefs {
  const [prefs, setPrefs] = useState<HudPrefs>(DEFAULT_HUD_PREFS);
  useEffect(() => {
    const sync = () => {
      const next = readHudPrefs();
      setPrefs((prev) => (sameHudPrefs(prev, next) ? prev : next));
    };
    sync();
    window.addEventListener(PREF_CHANGED_EVENT, sync);
    window.addEventListener(SETTINGS_APPLIED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PREF_CHANGED_EVENT, sync);
      window.removeEventListener(SETTINGS_APPLIED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return prefs;
}

/**
 * Устройство без мыши: основной указатель грубый (палец) и точного нет вовсе.
 * Ноутбук с сенсорным экраном сюда не попадает — у него есть тачпад или мышь.
 */
export function useTouchOnly() {
  const [touchOnly, setTouchOnly] = useState(false);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const coarse = matchMedia('(pointer: coarse)');
    const fine = matchMedia('(any-pointer: fine)');
    const sync = () => setTouchOnly(coarse.matches && !fine.matches);
    sync();
    coarse.addEventListener?.('change', sync);
    fine.addEventListener?.('change', sync);
    return () => {
      coarse.removeEventListener?.('change', sync);
      fine.removeEventListener?.('change', sync);
    };
  }, []);
  return touchOnly;
}
