// Уровни сложности серверных ботов — только числа и подписи, без геометрии карт:
// файл читают и сервер комнаты (lib/bot-brain.ts), и настройки в браузере.

export type BotLevel = 'weak' | 'medium' | 'strong' | 'expert';
export type BotTeam = 'red' | 'blue' | '';

/** Бот в настройках комнаты (`RoomState.bots`). Всё остальное о нём знает сервер. */
export type BotSpec = {
  /** `bot-` и 12 шестнадцатеричных знаков: личность человека — чистый hex, совпасть не может. */
  id: string;
  name: string;
  level: BotLevel;
  /** Сторона, которую выбрал ведущий; пусто — сервер поставит в меньшую команду. */
  team: BotTeam;
};

export type BotLevelRules = {
  label: string;
  hint: string;
  /** Задержка от «увидел» до первого выстрела, мс. */
  reaction: [number, number];
  /** Множитель разброса прицела. */
  spread: number;
  /** Множитель скорости доворота прицела. */
  turn: number;
  /** Множитель сектора обзора. */
  fov: number;
  /** Дальше этого врага не заметит, м. */
  sight: number;
  /** Множитель того, как долго помнится пропавший из виду враг. */
  memory: number;
  /** Ошибка в оценке скорости цели при упреждении: множитель из этого диапазона. */
  lead: [number, number];
  /** Доля выстрелов в голову вместо туловища. */
  headshot: number;
  /** Множитель дальности, на которой слышны чужие выстрелы. */
  hearing: number;
  /** Отходит ли раненым или с пустым магазином за укрытие. */
  cover: boolean;
  /** Насколько активно кружит вокруг цели в бою (0…1). */
  strafe: number;
  /** Множитель скорости бега. */
  speed: number;
  /** Множитель пауз между очередями. */
  pause: number;
};

/**
 * Четыре уровня — это не «больше урона» и не «видит сквозь стены»: все боты
 * играют по одним правилам сервера и знают только то, что видят. Разница в
 * человеческих качествах — как быстро замечает, как точно и быстро доводит
 * прицел, как читает движение цели и умеет ли вовремя уйти за укрытие.
 *
 * Ориентиры: «слабый» — новичок, который реагирует через полсекунды и почти не
 * попадает на ходу; «эксперт» — реакция опытного игрока (~170 мс) и заметная
 * доля выстрелов в голову, но не аимбот: разброс у него есть.
 */
export const BOT_LEVELS: Record<BotLevel, BotLevelRules> = {
  weak: {
    label: 'Слабый',
    hint: 'Поздно замечает, часто мажет, не прячется',
    reaction: [560, 820],
    spread: 3.2,
    turn: 0.5,
    fov: 0.8,
    sight: 18,
    memory: 0.5,
    lead: [0.2, 1.8],
    headshot: 0,
    hearing: 0.5,
    cover: false,
    strafe: 0.3,
    speed: 0.8,
    pause: 1.6,
  },
  medium: {
    label: 'Средний',
    hint: 'Обычный игрок: попадает, но не сразу',
    reaction: [340, 500],
    spread: 1.9,
    turn: 0.75,
    fov: 0.9,
    sight: 24,
    memory: 0.8,
    lead: [0.45, 1.45],
    headshot: 0.05,
    hearing: 0.8,
    cover: true,
    strafe: 0.65,
    speed: 0.9,
    pause: 1.25,
  },
  strong: {
    label: 'Сильный',
    hint: 'Быстрая реакция, точный огонь, держит укрытия',
    reaction: [220, 310],
    spread: 1,
    turn: 1,
    fov: 1,
    sight: 30,
    memory: 1,
    lead: [0.7, 1.25],
    headshot: 0.15,
    hearing: 1,
    cover: true,
    strafe: 0.9,
    speed: 1,
    pause: 1,
  },
  expert: {
    label: 'Эксперт',
    hint: 'Реакция опытного игрока и выстрелы в голову',
    reaction: [150, 200],
    spread: 0.6,
    turn: 1.35,
    fov: 1.12,
    sight: 36,
    memory: 1.4,
    lead: [0.9, 1.1],
    headshot: 0.35,
    hearing: 1.3,
    cover: true,
    strafe: 1,
    speed: 1.1,
    pause: 0.8,
  },
};

export const BOT_LEVEL_IDS = Object.keys(BOT_LEVELS) as BotLevel[];
export const isBotLevel = (value: unknown): value is BotLevel =>
  typeof value === 'string' && Object.hasOwn(BOT_LEVELS, value);
/** Ботов в одной комнате не больше: каждый — работа сервера комнаты десять раз в секунду. */
export const MAX_BOTS = 32;
/** За один раз добавляется не больше. */
export const MAX_BOTS_PER_ADD = 16;
const BOT_ID = /^bot-[0-9a-f]{12}$/;
export const isBotId = (id: unknown): id is string => typeof id === 'string' && BOT_ID.test(id);

export const BOT_NAMES = [
  'Алма', 'Ерлан', 'Айгуль', 'Тимур', 'Динара', 'Нурлан', 'Асель', 'Дархан',
  'Камила', 'Ринат', 'Сауле', 'Азамат', 'Жанна', 'Мади', 'Гульнар', 'Санжар',
  'Айдана', 'Бекзат', 'Жанель', 'Ильяс', 'Мадина', 'Олжас', 'Перизат', 'Руслан',
  'Сабина', 'Талгат', 'Улан', 'Фарида', 'Шынар', 'Ерасыл', 'Аружан', 'Арман',
];
/** Бота видно по имени везде — в ленте убийств, над головой и в таблице. */
export const BOT_PREFIX = '🤖 ';
