// Уровни ботов режима «Предатель» — только числа и подписи, без геометрии карт: файл читают и
// сервер комнаты (lib/impostor-bot.ts), и панель ботов в браузере. Уровни те же, что в бою
// (lib/bot-levels.ts), но качества другие: здесь важна не меткость, а внимательность и хитрость.
import type { BotLevel } from './bot-levels.ts';

export type ImpostorBotRules = {
  /** Короткое описание уровня для панели добавления ботов. */
  hint: string;
  /** Множитель скорости ходьбы. */
  speed: number;
  /** Множитель времени у пульта задания: новичок возится дольше. */
  taskTime: number;
  /** Вероятность заметить тело в поле зрения за одну проверку (раз в ~0,3 с). */
  notice: number;
  /** Сколько помнит, кого где видел, мс: по этому экипаж подозревает. */
  memory: number;
  /** Подозрения, после которых экипаж голосует против, а не пропускает. */
  suspectAt: number;
  /** Сколько секунд думает перед голосованием: [от, до]. */
  voteDelay: [number, number];
  /** Предатель убивает, только если никто не видит (иначе бьёт при свидетелях). */
  careful: boolean;
  /** Предатель уходит от тела через вентиляцию. */
  vents: boolean;
  /** Предатель изображает задания у пультов, а не бродит без дела. */
  fakeTasks: boolean;
  /** Аварии, которые устраивает предатель; пусто — не саботирует. */
  sabotage: ('lights' | 'comms' | 'reactor' | 'o2')[];
  /** Экипаж идёт чинить критическую аварию, а не продолжает задания. */
  repairs: boolean;
  /** На голосовании предатель голосует против того, кто нашёл тело (чужих голосов он не видит). */
  bandwagon: boolean;
  /** Разговорчивость на собрании: с этой вероятностью бот говорит необязательную реплику в чат. */
  chat: number;
  /**
   * Сколько весит для экипажа одно чужое обвинение в чате рядом с собственной уликой (улика у тела
   * — 2–3 очка). Новичок верит на слово, опытный полагается на то, что видел сам.
   */
  trust: number;
};

export const IMPOSTOR_BOT_LEVELS: Record<BotLevel, ImpostorBotRules> = {
  weak: {
    hint: 'Новичок: медленно делает задания, часто не замечает тела; предателем убивает при свидетелях',
    speed: 0.8,
    taskTime: 1.8,
    notice: 0.35,
    memory: 6_000,
    suspectAt: 99,
    voteDelay: [8, 20],
    careful: false,
    vents: false,
    fakeTasks: false,
    sabotage: [],
    repairs: false,
    bandwagon: false,
    chat: 0.6,
    trust: 1,
  },
  medium: {
    hint: 'Обычный игрок: репортит тела, голосует против явных подозреваемых; предателем ждёт, пока рядом никого',
    speed: 0.9,
    taskTime: 1.3,
    notice: 0.7,
    memory: 12_000,
    suspectAt: 3,
    voteDelay: [6, 15],
    careful: true,
    vents: false,
    fakeTasks: true,
    sabotage: ['lights'],
    repairs: true,
    bandwagon: false,
    chat: 0.8,
    trust: 1,
  },
  strong: {
    hint: 'Внимательный: помнит, кто был рядом с жертвой; предателем уходит через вентиляцию и устраивает аварии',
    speed: 1,
    taskTime: 1.1,
    notice: 0.9,
    memory: 25_000,
    suspectAt: 2,
    voteDelay: [4, 10],
    careful: true,
    vents: true,
    fakeTasks: true,
    sabotage: ['lights', 'comms', 'reactor'],
    repairs: true,
    bandwagon: true,
    chat: 1,
    trust: 0.8,
  },
  expert: {
    hint: 'Опытный: замечает всё и голосует по уликам; предателем заметает следы, саботирует и сваливает вину на нашедшего тело',
    speed: 1.05,
    taskTime: 1,
    notice: 1,
    memory: 45_000,
    suspectAt: 2,
    voteDelay: [3, 8],
    careful: true,
    vents: true,
    fakeTasks: true,
    sabotage: ['lights', 'comms', 'reactor', 'o2'],
    repairs: true,
    bandwagon: true,
    chat: 1,
    trust: 0.7,
  },
};
