// Which maps exist and what mode each belongs to — names only, no geometry, so the
// lobby and lib/model.ts can reason about modes without loading every map's boxes.
export type GameMode = 'retro' | 'battle';

export const MAP_CATALOG = [
  { id: 'hub', title: 'Хаб', mode: 'retro' },
  { id: 'mansion', title: 'Особняк', mode: 'battle' },
  { id: 'bazaar', title: 'Базар', mode: 'battle' },
  { id: 'mountain', title: 'Горный лагерь', mode: 'battle' },
  { id: 'valley', title: 'Ледниковая долина', mode: 'battle' },
] as const satisfies readonly { id: string; title: string; mode: GameMode }[];

export type MapId = (typeof MAP_CATALOG)[number]['id'];
export const MAP_IDS: MapId[] = MAP_CATALOG.map((m) => m.id);

export const MODES: { id: GameMode; title: string; hint: string }[] = [
  {
    id: 'retro',
    title: 'Ретроспектива',
    hint: 'Встреча в хабе: доска в планшете, стикеры и безобидные предметы',
  },
  { id: 'battle', title: 'Командный бой', hint: 'Две команды на боевой карте, оружие и счёт' },
];

/** Maps the host can pick in this mode. */
export const mapsForMode = (mode: GameMode) => MAP_CATALOG.filter((m) => m.mode === mode);
/** Where a room lands when the mode changes and the old map does not fit. */
export const defaultMapFor = (mode: GameMode): MapId => mapsForMode(mode)[0].id;
/** The mode of a map id; unknown ids are hub-like, i.e. retro. */
export const modeOfMap = (id?: string): GameMode =>
  MAP_CATALOG.find((m) => m.id === id)?.mode ?? 'retro';
/** The mode a room is in: its own setting, or the one its map belongs to. */
export const modeOf = (state: { mode?: string; map?: string }): GameMode =>
  state.mode === 'battle' || state.mode === 'retro' ? state.mode : modeOfMap(state.map);
