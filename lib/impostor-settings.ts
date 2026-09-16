// Настройки режима «Предатель» без геометрии карт: их читает и модель комнаты (lib/model.ts),
// и сервер (lib/impostor.ts).

/** Настройки режима, которые задаёт ведущий (lib/model.ts). */
export type ImpostorSettings = {
  /** Предателей в партии; 0 — по числу игроков. */
  impostors: number;
  killCooldownSeconds: number;
  discussionSeconds: number;
  votingSeconds: number;
  tasksPerPlayer: number;
  emergencyMeetings: number;
  /** Показывать ли после изгнания, был ли изгнанный предателем. */
  confirmEjects: boolean;
};

export const IMPOSTOR_DEFAULTS: ImpostorSettings = {
  impostors: 0,
  killCooldownSeconds: 25,
  discussionSeconds: 45,
  votingSeconds: 30,
  tasksPerPlayer: 4,
  emergencyMeetings: 1,
  confirmEjects: true,
};

/** Пределы настроек — общие для модели комнаты и сервера. */
export const IMPOSTOR_LIMITS = {
  impostors: [0, 3],
  killCooldownSeconds: [10, 60],
  discussionSeconds: [0, 120],
  votingSeconds: [15, 120],
  tasksPerPlayer: [1, 8],
  emergencyMeetings: [0, 3],
} as const satisfies Record<Exclude<keyof ImpostorSettings, 'confirmEjects'>, readonly [number, number]>;
