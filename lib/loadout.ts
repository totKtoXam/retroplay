// Инвентарь зависит от режима комнаты: на ретроспективе — только безобидные
// предметы, в бою — оружие. Слоты ссылаются на индексы GAME_TOOLS: это один
// общий список, по которому 3D-мир узнаёт, что у игрока в руках.
import type { GameMode } from './maps/catalog.ts';

export type Slot = { index: number; key: string; label: string; hint: string };

const TABLET = {
  index: 9,
  label: 'Планшет',
  hint: 'ЛКМ / E — заглянуть и открыть доску',
};
const SLOTS: Record<GameMode, Omit<Slot, 'key'>[]> = {
  retro: [
    TABLET,
    { index: 2, label: 'Стикер', hint: 'Колесо раздел · E написать стикер' },
    { index: 0, label: 'Краскомёт', hint: 'ЛКМ выстрел · ПКМ прицел' },
    { index: 1, label: 'Дробовик', hint: 'ЛКМ залп конфетти' },
    {
      index: 12,
      label: 'Лайкомёт',
      hint: 'ЛКМ выстрел сердечками · +1 голос стикерам на досках',
    },
  ],
  battle: [
    { index: 0, label: 'Краскомёт', hint: 'ЛКМ выстрел · ПКМ прицел' },
    { index: 1, label: 'Дробовик', hint: 'ЛКМ залп конфетти' },
    {
      index: 10,
      label: 'Пиньято',
      hint: 'Зажмите ЛКМ траектория · отпустите бросок',
    },
    {
      index: 11,
      label: 'Снайперка',
      hint: 'ЛКМ фейерверк · ПКМ оптический зум',
    },
  ],
};

/** Слоты режима с клавишами 1…N по порядку. */
export const slotsFor = (mode: GameMode): Slot[] =>
  SLOTS[mode].map((s, i) => ({ ...s, key: String(i + 1) }));
/** Предмет в руках при входе в режим. */
export const defaultSlot = (mode: GameMode) => SLOTS[mode][0].index;
/** Доступен ли предмет в этом режиме (индекс из GAME_TOOLS). */
export const hasSlot = (mode: GameMode, index: number) =>
  SLOTS[mode].some((s) => s.index === index);

export function cycleSlot(mode: GameMode, current: number, direction: number) {
  const slots = SLOTS[mode];
  const slot = Math.max(
    0,
    slots.findIndex((s) => s.index === current),
  );
  return slots[(slot + (direction > 0 ? 1 : slots.length - 1)) % slots.length]
    .index;
}
export function slotForDigit(mode: GameMode, code: string) {
  return slotsFor(mode).find((s) => `Digit${s.key}` === code)?.index;
}
