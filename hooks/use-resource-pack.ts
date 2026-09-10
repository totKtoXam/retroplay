'use client';
import { useSyncExternalStore } from 'react';
import {
  PACK_STORAGE_KEY,
  parseResourcePack,
  type ResourcePackId,
} from '../lib/resource-packs';
const eventName = 'jinaly-resource-pack-changed';
let fallback: ResourcePackId = 'default';
function read() {
  try {
    return parseResourcePack(
      localStorage.getItem(PACK_STORAGE_KEY) ?? fallback,
    );
  } catch {
    return fallback;
  }
}
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(eventName, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(eventName, callback);
  };
}
export function chooseResourcePack(value: ResourcePackId) {
  fallback = parseResourcePack(value);
  try {
    localStorage.setItem(PACK_STORAGE_KEY, fallback);
  } catch {
    /* Restricted storage: session preference still works. */
  }
  window.dispatchEvent(new Event(eventName));
}
export function useResourcePack() {
  return useSyncExternalStore(
    subscribe,
    read,
    () => 'default' as ResourcePackId,
  );
}
