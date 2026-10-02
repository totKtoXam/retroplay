// Настройки режима «Выживание» без геометрии карт: их читают и модель комнаты
// (lib/model.ts), и сервер (lib/survival.ts), и панель настроек в браузере.

export type SurvivalDifficulty = 'easy' | 'normal' | 'hard';

export type SurvivalSettings = {
  difficulty: SurvivalDifficulty;
  /** Сколько волн до победы; 0 — бесконечно, пока все не погибнут. */
  waves: number;
  /** Подготовка между волнами, секунд. */
  prepSeconds: number;
};

export const SURVIVAL_DEFAULTS: SurvivalSettings = {
  difficulty: 'normal',
  waves: 10,
  prepSeconds: 25,
};

/** Пределы числовых настроек — общие для модели комнаты и сервера. */
export const SURVIVAL_LIMITS = {
  waves: [0, 50],
  prepSeconds: [10, 90],
} as const satisfies Record<Exclude<keyof SurvivalSettings, 'difficulty'>, readonly [number, number]>;

export const SURVIVAL_DIFFICULTIES: readonly SurvivalDifficulty[] = ['easy', 'normal', 'hard'];
export const isSurvivalDifficulty = (v: unknown): v is SurvivalDifficulty =>
  typeof v === 'string' && (SURVIVAL_DIFFICULTIES as readonly string[]).includes(v);
