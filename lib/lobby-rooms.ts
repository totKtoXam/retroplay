/**
 * Список комнат в лобби: слияние «своих» и публичных комнат, фильтр и подпись
 * статуса на карточке. Чистая логика без React, чтобы её можно было проверить
 * тестом и не держать в компоненте.
 */
import { PHASES } from './model.ts';
import { MODES, type GameMode } from './maps/catalog.ts';

export type PublicRoomStatus = 'available' | 'full' | 'in_progress' | 'closed';

/**
 * Режим из сводки комнаты. Неизвестное значение (старый сервер без `mode`) —
 * это `null`, а не «ретро»: иначе боевая комната получит этап ретро в статусе.
 */
export function summaryMode(value: unknown): GameMode | null {
  return MODES.find((m) => m.id === value)?.id ?? null;
}

/** Своя комната: `GET /api/rooms`. */
export type MyRoomSummary = {
  id: string;
  title: string;
  theme: string;
  archived: boolean;
  phase: number;
  created: number;
  notes: number;
  mode?: string;
};

/** Публичная комната: `GET /api/rooms?browse=public`. */
export type PublicRoomSummary = {
  id: string;
  title: string;
  theme: string;
  archived: boolean;
  phase: number;
  created: number;
  hostName: string;
  membersCount: number;
  maxPlayers: number;
  status: PublicRoomStatus;
  mode?: string;
};

/** Комната в едином списке: свои и публичные слиты по id, `mine` помечает свои. */
export type RoomItem = {
  id: string;
  title: string;
  theme: string;
  archived: boolean;
  phase: number;
  created: number;
  mine: boolean;
  mode: GameMode | null;
  notes: number | null;
  hostName: string | null;
  membersCount: number | null;
  maxPlayers: number | null;
  /** `null` — комнаты нет в публичном списке, то есть она приватная. */
  status: PublicRoomStatus | null;
};

export type RoomFilter = 'all' | 'mine' | 'active' | 'archive';

export function mergeRooms(
  mine: MyRoomSummary[],
  publicRooms: PublicRoomSummary[],
): RoomItem[] {
  const byId = new Map<string, RoomItem>();
  for (const r of publicRooms)
    byId.set(r.id, {
      id: r.id,
      title: r.title,
      theme: r.theme,
      archived: r.archived,
      phase: r.phase,
      created: r.created,
      mine: false,
      mode: summaryMode(r.mode),
      notes: null,
      hostName: r.hostName,
      membersCount: r.membersCount,
      maxPlayers: r.maxPlayers,
      status: r.status,
    });
  for (const r of mine) {
    const prev = byId.get(r.id);
    byId.set(r.id, {
      id: r.id,
      title: r.title,
      theme: r.theme,
      archived: r.archived,
      phase: r.phase,
      created: r.created,
      mine: true,
      mode: summaryMode(r.mode) ?? prev?.mode ?? null,
      notes: r.notes,
      hostName: prev?.hostName ?? null,
      membersCount: prev?.membersCount ?? null,
      maxPlayers: prev?.maxPlayers ?? null,
      status: prev?.status ?? null,
    });
  }
  return [...byId.values()].sort((a, b) => b.created - a.created);
}

export function filterRooms(rooms: RoomItem[], query: string, filter: RoomFilter) {
  const needle = query.trim().toLowerCase();
  return rooms.filter(
    (r) =>
      (!needle || (r.title || '').toLowerCase().includes(needle)) &&
      (filter === 'all'
        ? true
        : filter === 'mine'
          ? r.mine
          : filter === 'archive'
            ? r.archived
            : !r.archived),
  );
}

// Partial: новый режим без записи получает нейтральное «Уже идёт».
const RUNNING: Partial<Record<GameMode, string>> = {
  retro: 'Идёт ретро',
  battle: 'Идёт бой',
  impostor: 'Идёт партия',
};

/**
 * Подпись статуса на обложке карточки. Этап ретро («Знакомство», «Итоги»)
 * показывается только у ретро: у боя и «Предателя» этапов встречи нет. Если
 * режим неизвестен, статус нейтральный.
 */
export function roomStatusLabel(
  room: Pick<RoomItem, 'mine' | 'archived' | 'phase' | 'status' | 'mode'>,
) {
  if (room.archived || room.status === 'closed')
    return room.mine ? 'Завершена' : 'Закрыта';
  // Своя комната открыта и заполненной: показываем, где идёт встреча.
  if (room.mode === 'retro' && room.mine) return PHASES[room.phase] ?? 'Ретро';
  if (room.status === 'full') return 'Заполнена';
  if (room.status === 'in_progress')
    return (room.mode && RUNNING[room.mode]) || 'Уже идёт';
  return room.mine ? 'Активна' : 'Доступна';
}
