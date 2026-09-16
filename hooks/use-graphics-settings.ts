'use client';
import { useSyncExternalStore } from 'react';
import { GRAPHICS_KEY, normalizeGraphics, type GraphicsSettings } from '../lib/graphics-settings';
const event = 'jinaly-graphics-change';
let saved: GraphicsSettings | null = null;
let raw: string | null | undefined;
function read() {
  try {
    const next = localStorage.getItem(GRAPHICS_KEY);
    if (raw !== next) { raw = next; saved = next ? normalizeGraphics(JSON.parse(next)) : null; }
  } catch { /* Keep session settings if storage is restricted. */ }
  return saved;
}
function subscribe(cb: () => void) {
  window.addEventListener(event, cb); window.addEventListener('storage', cb);
  return () => { window.removeEventListener(event, cb); window.removeEventListener('storage', cb); };
}
export function setGraphicsSettings(value: GraphicsSettings | null) {
  saved = value && normalizeGraphics(value); raw = saved ? JSON.stringify(saved) : null;
  try { if (raw) localStorage.setItem(GRAPHICS_KEY, raw); else localStorage.removeItem(GRAPHICS_KEY); } catch { /* Session only. */ }
  window.dispatchEvent(new Event(event));
}
export function useGraphicsSettings() { return useSyncExternalStore(subscribe, read, () => null); }
