// Единая раскладка клавиш (план UX/UI, п. 3.1). Отсюда строятся справка, карточка входа,
// подсказки <kbd> в HUD, правила «Предателя» и таблица в README. Источник правды — код
// обработчиков: components/world.tsx (onKey/onUp/onDown/wheel), components/world-player.ts
// (движение), components/impostor-overlay.tsx, components/survival-overlay.tsx, components/game-chat.tsx,
// components/item-wheel.tsx,
// components/room-app.tsx (G). Новая клавиша в коде — новая строка здесь, и наоборот:
// tests/keymap.test.mjs сверяет раскладку с обработчиками.
import { MODES, type GameMode } from './maps/catalog.ts';
import { slotsFor } from './loadout.ts';

export type KeyGroup = 'move' | 'camera' | 'items' | 'combat' | 'social' | 'interface' | 'impostor' | 'survival';

/**
 * Одна клавиша или кнопка мыши.
 * `code` — `KeyboardEvent.code` (раскладконезависимый: «KeyQ» и в русской раскладке, где это «й»)
 * либо мышь: `Mouse0` ЛКМ, `Mouse1` СКМ, `Mouse2` ПКМ (как `'Mouse' + MouseEvent.button`),
 * `Wheel` — прокрутка колеса, `MouseMove` — движение мыши.
 */
export type KeySpec = {
  code: string;
  /** Подпись на клавише: «Q», «Пробел», «Ё», «ЛКМ». */
  label: string;
  /** Пояснение, где искать клавишу, — показывается в полной справке. */
  hint?: string;
  /** Полное название для всплывающей подсказки и скринридера: «левая кнопка мыши». */
  title?: string;
  /** Работает только с зажатым Alt (Alt + колесо). */
  alt?: boolean;
};

/**
 * Когда действует привязка. `world` (по умолчанию) — обычное управление в мире, курсор
 * захвачен. Одна и та же клавиша в разных контекстах — не конфликт: Enter в мире открывает
 * чат, а в открытом чате отправляет сообщение.
 */
export type KeyContext = 'world' | 'free-cursor' | 'chat' | 'wheel' | 'overlay' | 'scope';

export type KeyBinding = {
  /** Стабильный идентификатор действия: `reload`, `slot-1`, `impostor-kill`. */
  action: string;
  /** Что делает клавиша, по-русски. */
  label: string;
  keys: KeySpec[];
  group: KeyGroup;
  /** Режимы, где привязка действует; нет — во всех, кроме `exceptModes`. */
  modes?: GameMode[];
  /** Режимы, где привязки нет (новый режим, например зомби, получает её по умолчанию). */
  exceptModes?: GameMode[];
  /** Действует, пока клавиша зажата. */
  hold?: boolean;
  context?: KeyContext;
  note?: string;
  /**
   * Осознанный конфликт: та же клавиша в другом режиме делает другое, и по привычке легко
   * ошибиться. Тест требует пометку у каждой такой клавиши.
   */
  conflictNote?: string;
};

export const GROUP_TITLES: Record<KeyGroup, string> = {
  move: 'Движение',
  camera: 'Камера',
  items: 'Предметы',
  combat: 'Бой',
  social: 'Общение',
  interface: 'Интерфейс',
  impostor: 'Предатель',
  survival: 'Выживание',
};
export const GROUP_ORDER: KeyGroup[] = [
  'move',
  'camera',
  'items',
  'combat',
  'impostor',
  'survival',
  'social',
  'interface',
];

export const CONTEXT_TITLES: Record<KeyContext, string> = {
  world: 'в игре',
  'free-cursor': 'пока курсор свободен',
  chat: 'в открытом чате',
  wheel: 'в круге вариантов',
  overlay: 'в открытом окне',
  scope: 'в оптике снайперки',
};

const key = (code: string, label: string, extra: Partial<KeySpec> = {}): KeySpec => ({
  code,
  label,
  ...extra,
});

const K = {
  W: key('KeyW', 'W'),
  A: key('KeyA', 'A'),
  S: key('KeyS', 'S'),
  D: key('KeyD', 'D'),
  space: key('Space', 'Пробел'),
  C: key('KeyC', 'C'),
  X: key('KeyX', 'X'),
  shiftL: key('ShiftLeft', 'Shift'),
  shiftR: key('ShiftRight', 'Shift'),
  left: key('ArrowLeft', '←'),
  right: key('ArrowRight', '→'),
  up: key('ArrowUp', '↑'),
  down: key('ArrowDown', '↓'),
  V: key('KeyV', 'V'),
  Z: key('KeyZ', 'Z'),
  Q: key('KeyQ', 'Q'),
  I: key('KeyI', 'I'),
  E: key('KeyE', 'E'),
  F: key('KeyF', 'F'),
  R: key('KeyR', 'R'),
  B: key('KeyB', 'B'),
  T: key('KeyT', 'T'),
  Y: key('KeyY', 'Y'),
  G: key('KeyG', 'G'),
  M: key('KeyM', 'M'),
  N: key('KeyN', 'N'),
  tab: key('Tab', 'Tab'),
  enter: key('Enter', 'Enter'),
  numEnter: key('NumpadEnter', 'Enter'),
  esc: key('Escape', 'Esc'),
  // На английской раскладке на этой клавише «`», буквы «Ё» там нет.
  backquote: key('Backquote', 'Ё', {
    hint: 'клавиша слева от 1, на английской раскладке `',
    title: 'Ё — клавиша слева от 1 (на английской раскладке `)',
  }),
  lmb: key('Mouse0', 'ЛКМ', { title: 'левая кнопка мыши' }),
  mmb: key('Mouse1', 'СКМ', { title: 'средняя кнопка мыши (нажатие колёсика)' }),
  rmb: key('Mouse2', 'ПКМ', { title: 'правая кнопка мыши' }),
  wheel: key('Wheel', 'Колесо', { title: 'прокрутка колёсика мыши' }),
  mouse: key('MouseMove', 'Мышь', { title: 'движение мыши' }),
};
const ARROWS = [K.left, K.right, K.up, K.down];

const BASE: KeyBinding[] = [
  // Движение — components/world-player.ts (update) и world.tsx (onKey/onUp).
  {
    action: 'move',
    label: 'Ходить',
    keys: [K.W, K.A, K.S, K.D],
    group: 'move',
    note: 'A и D — шаг вбок, S — назад',
  },
  { action: 'jump', label: 'Прыжок', keys: [K.space], group: 'move' },
  {
    action: 'stance',
    label: 'Сесть / встать',
    keys: [K.C],
    group: 'move',
    note: 'Дважды C — лечь',
  },
  { action: 'crouch', label: 'Присесть', keys: [K.X], group: 'move', hold: true },
  {
    action: 'walk-slow',
    label: 'Медленный тихий шаг',
    keys: [K.shiftL, K.shiftR],
    group: 'move',
    hold: true,
  },

  // Камера.
  {
    action: 'capture',
    label: 'Начать игру и захватить мышь',
    keys: [K.lmb],
    group: 'camera',
    context: 'free-cursor',
    note: 'Первый щелчок не стреляет',
  },
  { action: 'look', label: 'Осмотреться', keys: [K.mouse], group: 'camera' },
  { action: 'look-keys', label: 'Повернуть камеру', keys: ARROWS, group: 'camera' },
  { action: 'perspective', label: 'Первое / третье лицо', keys: [K.V], group: 'camera' },
  { action: 'camera-reset', label: 'Вернуть камеру за спину', keys: [K.Z], group: 'camera' },
  {
    action: 'camera-distance',
    label: 'Отдалить / приблизить камеру',
    keys: [{ ...K.wheel, alt: true }],
    group: 'camera',
    note: 'В третьем лице',
  },

  // Предметы. Цифры 1…N добавляются ниже из lib/loadout.ts.
  {
    action: 'slot-cycle',
    label: 'Следующий / предыдущий предмет',
    keys: [K.wheel],
    group: 'items',
  },
  {
    action: 'inventory',
    label: 'Снаряжение',
    keys: [K.Q, K.I],
    group: 'items',
    // В «Предателе» Q — нож, I — правила: overlay забирает обе клавиши раньше мира.
    exceptModes: ['impostor'],
    note: 'Цифры выбирают предмет, Esc закрывает',
  },
  {
    action: 'item-options',
    label: 'Варианты предмета: краска, прицел, стиль, раздел доски',
    keys: [K.mmb],
    group: 'items',
    hold: true,
    note: 'Ведите мышью и отпустите колёсико на нужном варианте',
  },
  {
    action: 'wheel-browse',
    label: 'Листать варианты',
    keys: ARROWS,
    group: 'items',
    context: 'wheel',
  },
  {
    action: 'wheel-confirm',
    label: 'Выбрать вариант',
    keys: [K.enter],
    group: 'items',
    context: 'wheel',
  },
  { action: 'flashlight', label: 'Фонарик', keys: [K.F], group: 'items' },
  {
    action: 'use-board',
    label: 'Открыть доску у стенда',
    keys: [K.E],
    group: 'items',
    modes: ['retro'],
  },

  // Бой.
  {
    action: 'fire',
    label: 'Действие предметом в руках: выстрел, удар, бросок',
    keys: [K.lmb],
    group: 'combat',
    note: 'Граната: зажмите — видна траектория, отпустите — бросок',
  },
  {
    action: 'aim',
    label: 'Прицел',
    keys: [K.rmb],
    group: 'combat',
    hold: true,
    exceptModes: ['impostor'],
    note: 'Удерживать или переключать — выбирается в настройках',
  },
  {
    action: 'sniper-zoom',
    label: 'Кратность оптики',
    keys: [K.wheel],
    group: 'combat',
    modes: ['battle', 'survival'],
    context: 'scope',
  },
  {
    action: 'reload',
    label: 'Перезарядка',
    keys: [K.R],
    group: 'combat',
    exceptModes: ['impostor'],
  },

  // «Предатель» — components/impostor-overlay.tsx. E, R, Q, B перехватываются только во время
  // партии, I — в любой фазе.
  {
    action: 'impostor-use',
    label: 'Использовать: пульт, авария, вентиляция, кнопка собрания',
    keys: [K.E],
    group: 'impostor',
    modes: ['impostor'],
    conflictNote: 'Как E у стенда доски в ретроспективе: клавиша «использовать»',
  },
  {
    action: 'impostor-report',
    label: 'Сообщить о теле рядом',
    keys: [K.R],
    group: 'impostor',
    modes: ['impostor'],
    conflictNote: 'В других режимах R — перезарядка: рядом с телом по привычке можно созвать собрание',
  },
  {
    action: 'impostor-kill',
    label: 'Нож (предатель)',
    keys: [K.Q],
    group: 'impostor',
    modes: ['impostor'],
    conflictNote: 'В других режимах Q открывает снаряжение: по привычке легко ударить соседа',
  },
  {
    action: 'impostor-sabotage',
    label: 'Меню саботажа (предатель)',
    keys: [K.B],
    group: 'impostor',
    modes: ['impostor'],
  },
  {
    action: 'impostor-rules',
    label: 'Правила режима',
    keys: [K.I],
    group: 'impostor',
    modes: ['impostor'],
    conflictNote: 'В других режимах I открывает снаряжение',
  },
  // То же действие «закрыть», что и в интерфейсе, — подпись под режим.
  {
    action: 'close',
    label: 'Закрыть мини-игру, меню саботажа или правила',
    keys: [K.esc],
    group: 'impostor',
    modes: ['impostor'],
    context: 'overlay',
  },

  // «Выживание» — components/survival-overlay.tsx. N открывает панель навыков в любой фазе:
  // очки тратят между волнами, а читают описания и в лобби.
  {
    action: 'perks',
    label: 'Навыки',
    keys: [K.N],
    group: 'survival',
    modes: ['survival'],
    note: 'Очки навыков дают уровни; Esc или N закрывает',
  },
  {
    action: 'close',
    label: 'Закрыть панель навыков',
    keys: [K.esc],
    group: 'survival',
    modes: ['survival'],
    context: 'overlay',
  },

  // Общение — components/game-chat.tsx и голосовая рация в world.tsx.
  {
    action: 'chat-open',
    label: 'Открыть текстовый чат',
    keys: [K.enter, K.numEnter],
    group: 'social',
  },
  {
    action: 'chat-send',
    label: 'Отправить сообщение',
    keys: [K.enter, K.numEnter],
    group: 'social',
    context: 'chat',
  },
  {
    action: 'chat-channel',
    label: 'Сменить канал: всем / своим',
    keys: [K.tab],
    group: 'social',
    context: 'chat',
  },
  { action: 'chat-close', label: 'Закрыть чат', keys: [K.esc], group: 'social', context: 'chat' },
  {
    action: 'talk-team',
    label: 'Голос своей команде',
    keys: [K.T],
    group: 'social',
    hold: true,
  },
  {
    action: 'talk-all',
    label: 'Голос всем',
    keys: [K.Y],
    group: 'social',
    hold: true,
    note: 'Кого слышно, решает режим: в «Предателе» — на собраниях и среди призраков',
  },

  // Интерфейс.
  {
    action: 'pause',
    label: 'Пауза и свободный курсор',
    keys: [K.esc],
    group: 'interface',
  },
  {
    action: 'close',
    label: 'Закрыть снаряжение, круг вариантов, планшет или закреплённое табло',
    keys: [K.esc],
    group: 'interface',
    context: 'overlay',
  },
  {
    action: 'scoreboard',
    label: 'Табло: участники и задержка',
    keys: [K.backquote],
    group: 'interface',
    hold: true,
    note: 'ЛКМ при зажатой клавише закрепляет табло, Esc снимает',
  },
  { action: 'map', label: 'Большая карта', keys: [K.M], group: 'interface' },
  {
    action: 'side',
    label: 'Сторона, скин и бандана',
    keys: [K.G],
    group: 'interface',
    note: 'Повторное нажатие или Esc закрывает',
  },
];

/** Режимы из каталога. Если у нового режима ещё нет слотов в loadout — без цифр. */
const slotBindings = (): KeyBinding[] =>
  MODES.flatMap(({ id: mode }) => {
    let slots: ReturnType<typeof slotsFor> = [];
    try {
      slots = slotsFor(mode);
    } catch {
      slots = [];
    }
    return slots.map(
      (slot): KeyBinding => ({
        action: `slot-${slot.key}`,
        label: slot.label,
        keys: [key(`Digit${slot.key}`, slot.key)],
        group: 'items',
        modes: [mode],
        note: slot.hint,
      }),
    );
  });

export const KEYMAP: readonly KeyBinding[] = [...BASE, ...slotBindings()];

/** Действует ли привязка в режиме. */
export const appliesTo = (binding: KeyBinding, mode: GameMode) =>
  (!binding.modes || binding.modes.includes(mode)) && !binding.exceptModes?.includes(mode);

/** Все привязки режима в порядке KEYMAP. */
export const bindingsFor = (mode: GameMode): KeyBinding[] => KEYMAP.filter((b) => appliesTo(b, mode));

const find = (action: string, mode?: GameMode) =>
  KEYMAP.filter((b) => b.action === action && (!mode || appliesTo(b, mode)));

/** Подпись одной клавиши: «Ё», «Alt + Колесо». */
export const specLabel = (spec: KeySpec) => (spec.alt ? `Alt + ${spec.label}` : spec.label);

/**
 * Подпись клавиш действия для подсказок: «Q / I», «W A S D», «Shift». Одинаковые подписи
 * (левый и правый Shift, два Enter) склеиваются. Нет такого действия — пустая строка.
 */
export function keyLabel(action: string, mode?: GameMode): string {
  const binding = find(action, mode)[0];
  if (!binding) return '';
  const labels = [...new Set(binding.keys.map(specLabel))];
  const sep = binding.action === 'move' ? ' ' : ' / ';
  return labels.join(sep);
}

/** Коды событий для действия (`KeyboardEvent.code` или `Mouse0`…`Wheel`), без повторов. */
export function codesFor(action: string, mode?: GameMode): string[] {
  return [...new Set(find(action, mode).flatMap((b) => b.keys.map((k) => k.code)))];
}
