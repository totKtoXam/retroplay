// Уровни ботов режима «Предатель» — только числа и подписи, без геометрии карт: файл читают и
// сервер комнаты (lib/impostor-bot.ts), и панель ботов в браузере. Уровни те же, что в бою
// (lib/bot-levels.ts), но качества другие: здесь важна не меткость, а внимательность и хитрость.
//
// Всё, чем уровни отличаются, собрано здесь, а не спрятано числами в мозге бота. Три блока — это
// три стороны игрока: что он **помнит** (`memory`), как он **рассуждает** за экипаж (`think`) и
// как он **врёт** за предателя (`lying`). Новичок мало замечает, держится за первое впечатление и
// верит любому громкому обвинению; опытный помнит долго, слушает поручительства, честно
// сомневается в выцветшем воспоминании и переводит стрелки, когда сам предатель.
import type { BotLevel } from './bot-levels.ts';
import type { MemoryRules } from './impostor-bot-memory.ts';

/** Как бот рассуждает и за кого голосует на собрании. */
export type ImpostorThinking = {
  /**
   * Подозрения, после которых экипаж голосует против, а не пропускает. Улика у тела — до трёх
   * очков, но каждое взвешено уверенностью воспоминания, так что чистых трёх почти не бывает.
   */
  suspectAt: number;
  /**
   * Сколько весит одно чужое обвинение в чате рядом с собственной уликой. Новичок верит на слово,
   * опытный полагается на то, что видел сам.
   */
  trust: number;
  /**
   * Прибавка к весу обвинения, в котором есть подробность из первых рук («видел его прямо у тела»).
   * Новичок таких слов от общего «он подозрительный» не отличает, опытный верит очевидцу.
   */
  detail: number;
  /** Сколько весит поручительство («он был со мной»); 0 — бот таких слов попросту не слышит. */
  vouch: number;
  /**
   * Насколько подозрение выцветает вместе с воспоминанием, на котором оно построено: 1 — бот
   * честно сомневается в том, что уже плохо помнит, 0 — держится за первое впечатление.
   */
  fades: number;
  /**
   * Во сколько раз дольше обычной встречи держится улика: увиденное у тела человек обдумывает и
   * пересказывает, поэтому к собранию помнит это куда лучше, чем случайного прохожего. Чем опытнее
   * игрок, тем дольше улика остаётся при нём — новичок к голосованию помнит только «мне показалось».
   */
  holds: number;
  /**
   * Сколько очков подозрения бот ставит тому, кто обвинил его самого: он-то знает, что не предатель,
   * значит, обвинитель ошибается или отводит глаза. 0 — такая мысль в голову не приходит.
   */
  counters: number;
  /** Поддерживает вслух чужое обвинение, когда видел то же самое. */
  agrees: boolean;
  /**
   * Без своих улик идёт за самым громким обвинением в чате. Не слушать других вовсе — тоже не
   * по-человечески: уверенному очевидцу на собрании верят и опытные, просто не всякому подряд.
   */
  follows: number;
  /** Без улик и без чужих обвинений голосует наугад, лишь бы не пропускать. */
  guesses: number;
};

/** Как бот врёт и подставляет других, когда сам предатель. */
export type ImpostorLying = {
  /** Валит вину на того, кто нашёл тело. */
  blameReporter: number;
  /** Валит вину на случайного члена экипажа. */
  blameRandom: number;
  /** Подхватывает чужое обвинение против экипажа. */
  joinsBlame: number;
  /** Вступается за союзника, когда того обвиняют. */
  defendsAlly: number;
  /** Договаривается с союзниками в командном канале, кого топить. */
  plansWithAllies: boolean;
};

export type ImpostorBotRules = {
  /** Короткое описание уровня для панели добавления ботов. */
  hint: string;
  /** Множитель скорости ходьбы. */
  speed: number;
  /** Множитель времени у пульта задания: новичок возится дольше. */
  taskTime: number;
  /** Вероятность заметить тело в поле зрения за одну проверку (раз в ~0,3 с). */
  notice: number;
  /** Что и насколько точно бот запоминает (lib/impostor-bot-memory.ts). */
  memory: MemoryRules;
  /** Как бот рассуждает за экипаж. */
  think: ImpostorThinking;
  /** Как бот врёт за предателя. */
  lying: ImpostorLying;
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
  /** Разговорчивость на собрании: с этой вероятностью бот говорит необязательную реплику в чат. */
  chat: number;
};

export const IMPOSTOR_BOT_LEVELS: Record<BotLevel, ImpostorBotRules> = {
  weak: {
    hint: 'Новичок: мало что замечает и путает, кого где видел; на собрании верит любому громкому обвинению',
    speed: 0.8,
    taskTime: 1.8,
    notice: 0.35,
    memory: { horizon: 6_000, attention: 0.35, mixUp: 0.5, capacity: 2 },
    think: {
      suspectAt: 2,
      trust: 1,
      detail: 0,
      vouch: 0,
      // Что показалось — то и правда: за своё первое впечатление держится до конца собрания.
      fades: 0.15,
      holds: 3,
      counters: 0,
      agrees: false,
      follows: 0.6,
      guesses: 0.25,
    },
    lying: { blameReporter: 0, blameRandom: 0.15, joinsBlame: 0.2, defendsAlly: 0, plansWithAllies: false },
    voteDelay: [8, 20],
    careful: false,
    vents: false,
    fakeTasks: false,
    sabotage: [],
    repairs: false,
    chat: 0.6,
  },
  medium: {
    hint: 'Обычный игрок: репортит тела, рассказывает, где был, и голосует против явного подозреваемого',
    speed: 0.9,
    taskTime: 1.3,
    notice: 0.7,
    memory: { horizon: 12_000, attention: 0.7, mixUp: 0.25, capacity: 5 },
    think: {
      suspectAt: 1.5,
      trust: 0.8,
      detail: 0.4,
      vouch: 0.5,
      fades: 0.65,
      holds: 6,
      counters: 0.6,
      agrees: true,
      follows: 0.45,
      guesses: 0.1,
    },
    lying: { blameReporter: 0.25, blameRandom: 0.3, joinsBlame: 0.5, defendsAlly: 0.2, plansWithAllies: false },
    voteDelay: [6, 15],
    careful: true,
    vents: false,
    fakeTasks: true,
    sabotage: ['lights'],
    repairs: true,
    chat: 0.8,
  },
  strong: {
    hint: 'Внимательный: надолго запоминает, кто был рядом с жертвой, слушает алиби; предателем уходит вентиляцией и саботирует',
    speed: 1,
    taskTime: 1.1,
    notice: 0.9,
    memory: { horizon: 25_000, attention: 0.85, mixUp: 0.12, capacity: 8 },
    think: {
      suspectAt: 1.1,
      trust: 0.7,
      detail: 1,
      vouch: 0.8,
      fades: 0.85,
      holds: 10,
      counters: 1.2,
      agrees: true,
      follows: 0.4,
      guesses: 0,
    },
    lying: { blameReporter: 0.5, blameRandom: 0.4, joinsBlame: 0.8, defendsAlly: 0.5, plansWithAllies: true },
    voteDelay: [4, 10],
    careful: true,
    vents: true,
    fakeTasks: true,
    sabotage: ['lights', 'comms', 'reactor'],
    repairs: true,
    chat: 1,
  },
  expert: {
    hint: 'Опытный: помнит почти всё, голосует по уликам и сомневается в смутном; предателем сваливает вину на нашедшего тело',
    speed: 1.05,
    taskTime: 1,
    notice: 1,
    memory: { horizon: 45_000, attention: 0.95, mixUp: 0.06, capacity: 12 },
    think: {
      suspectAt: 0.9,
      trust: 0.6,
      detail: 1.2,
      vouch: 1,
      // Чем хуже помнит, тем меньше настаивает: выцветшее воспоминание уликой не считает.
      fades: 1,
      holds: 14,
      counters: 1.8,
      agrees: true,
      follows: 0.35,
      guesses: 0,
    },
    lying: { blameReporter: 0.6, blameRandom: 0.4, joinsBlame: 1, defendsAlly: 0.6, plansWithAllies: true },
    voteDelay: [3, 8],
    careful: true,
    vents: true,
    fakeTasks: true,
    sabotage: ['lights', 'comms', 'reactor', 'o2'],
    repairs: true,
    chat: 1,
  },
};
