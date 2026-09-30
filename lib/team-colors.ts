/**
 * Цвета и названия команд — единый источник для HUD, миникарты, табло, выбора
 * стороны и 3D-сцены.
 *
 * Команды оранжевые и синие для всех игроков (решение продукта от 28.09, план
 * UX/UI, этап 3.4): пара различима при любом распространённом типе
 * дальтонизма, а красный остаётся только за уроном и опасностью.
 *
 * Идентификаторы команд при этом прежние — 'red' и 'blue': они живут в данных
 * сервера, в базе и в протоколе. Меняется только то, что видит человек.
 *
 * CSS-цвета совпадают с токенами --team-orange / --team-blue из app/tokens.css.
 * Модуль без зависимостей: его читают и мир, и сервер, и тесты под node.
 */

/** Идентификатор команды в данных. 'red' показывается как «Оранжевые». */
export type TeamId = 'red' | 'blue';

export const TEAM_IDS: readonly TeamId[] = ['red', 'blue'];

export type TeamLook = {
  /** Цвет команды для CSS и холстов (#rrggbb). */
  css: string;
  /** Тот же цвет числом для материалов Three.js (`new Color(hex)`). */
  hex: number;
  /**
   * Светлый оттенок для текста на тёмной подложке HUD (#0a101c): мелкий текст
   * цветом команды должен читаться, а не только полоска.
   */
  text: string;
  /** «Оранжевые» — подпись группы табло, карточки выбора стороны. */
  name: string;
  /** «оранжевых» — «победа оранжевых». */
  genitive: string;
  /** «оранжевыми» — «раунд за оранжевыми». */
  instrumental: string;
};

export const TEAM_LOOKS: Readonly<Record<TeamId, TeamLook>> = {
  red: {
    css: '#ff9a1f',
    hex: 0xff9a1f,
    text: '#ffc27a',
    name: 'Оранжевые',
    genitive: 'оранжевых',
    instrumental: 'оранжевыми',
  },
  blue: {
    css: '#4d9dff',
    hex: 0x4d9dff,
    text: '#9cc8ff',
    name: 'Синие',
    genitive: 'синих',
    instrumental: 'синими',
  },
};

/** Без команды (свободная игра, ещё не выбрал сторону) — нейтральный серый. */
export const TEAM_NEUTRAL: TeamLook = {
  css: '#d7dee9',
  hex: 0xd7dee9,
  text: '#d7dee9',
  name: 'Без команды',
  genitive: 'без команды',
  instrumental: 'без команды',
};

export function isTeam(team: unknown): team is TeamId {
  return team === 'red' || team === 'blue';
}

/** Как показывать команду; неизвестная или пустая — нейтрально. */
export function teamLook(team: string | null | undefined): TeamLook {
  return isTeam(team) ? TEAM_LOOKS[team] : TEAM_NEUTRAL;
}

/** Цвет команды для CSS; у игрока без команды — нейтральный. */
export function teamCss(team: string | null | undefined) {
  return teamLook(team).css;
}

/** Цвет команды для материалов Three.js; у игрока без команды — нейтральный. */
export function teamHex(team: string | null | undefined) {
  return teamLook(team).hex;
}

/** «Оранжевые» / «Синие» / «Без команды». */
export function teamName(team: string | null | undefined) {
  return teamLook(team).name;
}

/**
 * Знаки «свой / чужой», одинаковые на миникарте и в подписях над бойцами:
 * ромб — союзник, треугольник — враг. Форма дублирует цвет, чтобы свой и чужой
 * различались и без него (режим для дальтоников, план UX/UI, этап 3.4).
 */
export const ALLY_MARK = '◆';
export const ENEMY_MARK = '▲';
