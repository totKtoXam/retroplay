/**
 * Личные настройки, которые переезжают вместе с аккаунтом между устройствами.
 * Сами значения живут в localStorage под своими ключами; аккаунт хранит их
 * копию как есть (строки), не разбирая. Модуль общий для клиента и сервера,
 * поэтому ключи здесь строками, а не импортом из клиентских файлов.
 *
 * Намеренно НЕ синхронизируются настройки, зависящие от железа: графика,
 * качество, лимит FPS и ресурс-пак — то, что тянет мощный компьютер, может
 * не потянуть ноутбук. Имя в комнате у аккаунта своё (`users.name`).
 */
export const SYNCED_SETTING_KEYS = [
  'jinaly-theme', // hooks/use-theme.ts
  'jinaly-sensitivity',
  'jinaly-invert-camera',
  'jinaly-aim-modes', // lib/aim-settings.ts
  'jinaly-perspective',
  'jinaly-ammo-display', // lib/ammo-display.ts
  'jinaly-paint-sight', // lib/weapon-sights.ts
  'jinaly-custom-skin',
  'jinaly-bandana-color',
  'jinaly-music-prefs', // lib/soundtrack.ts
  'jinaly-sound', // lib/user-prefs.ts
  'jinaly-paint-color',
  'jinaly-confetti-style',
  'jinaly-grenade-style',
  'jinaly-firework-style',
] as const;

/** Шлётся в окно, когда настройки с аккаунта записаны в localStorage. */
export const SETTINGS_APPLIED_EVENT = 'jinaly-settings-applied';

/** Любая из настроек — короткая строка; всё длиннее — мусор или атака. */
export const MAX_SETTING_LENGTH = 2000;

export type SettingsValues = Record<string, string>;

/** Только известные ключи со строковыми значениями разумной длины. */
export function cleanSettings(input: unknown): SettingsValues {
  const out: SettingsValues = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  const source = input as Record<string, unknown>;
  for (const key of SYNCED_SETTING_KEYS) {
    const value = Object.hasOwn(source, key) ? source[key] : undefined;
    if (typeof value === 'string' && value.length <= MAX_SETTING_LENGTH)
      out[key] = value;
  }
  return out;
}

export function sameSettings(a: SettingsValues, b: SettingsValues) {
  return SYNCED_SETTING_KEYS.every((key) => a[key] === b[key]);
}

/**
 * Слияние трёх версий. `base` — то, что это устройство последний раз
 * согласовало с аккаунтом; `null`, если с этим аккаунтом оно ещё не
 * синхронизировалось.
 *
 * - Ключ, изменённый здесь после последней синхронизации, берётся отсюда.
 * - Остальные берутся с аккаунта: их могли поменять на другом устройстве.
 * - Устройство, впервые вошедшее в аккаунт, получает настройки аккаунта, а
 *   своими дополняет только то, чего в аккаунте ещё нет.
 */
export function mergeSettings({
  local,
  remote,
  base,
}: {
  local: SettingsValues;
  remote: SettingsValues;
  base: SettingsValues | null;
}): SettingsValues {
  const merged: SettingsValues = {};
  for (const key of SYNCED_SETTING_KEYS) {
    const changedHere = base !== null && local[key] !== base[key];
    const value = changedHere
      ? local[key]
      : key in remote
        ? remote[key]
        : base === null
          ? local[key]
          : undefined;
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}
