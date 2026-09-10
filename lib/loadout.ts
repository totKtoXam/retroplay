/** Быстрые слоты не включают инструменты редактирования доски. */
export const QUICK_SLOTS = [
  { index: 0, key: '1', label: 'Краскомёт', hint: 'ЛКМ выстрел · ПКМ прицел' },
  { index: 1, key: '2', label: 'Дробовик', hint: 'ЛКМ залп конфетти' },
  {
    index: 10,
    key: '3',
    label: 'Пиньято',
    hint: 'Зажмите ЛКМ траектория · отпустите бросок',
  },
  {
    index: 11,
    key: '4',
    label: 'Снайперка',
    hint: 'ЛКМ фейерверк · ПКМ оптический зум',
  },
  {
    index: 2,
    key: '5',
    label: 'Стикер',
    hint: 'Колесо раздел · E написать стикер',
  },
  {
    index: 9,
    key: '6',
    label: 'Планшет',
    hint: 'ЛКМ / E — заглянуть и открыть доску',
  },
  {
    index: 12,
    key: '7',
    label: 'Лайкомёт',
    hint: 'ЛКМ выстрел сердечками · +1 голос стикерам на досках',
  },
];
export function cycleSlot(current: number, direction: number) {
  const slot = Math.max(
    0,
    QUICK_SLOTS.findIndex((s) => s.index === current),
  );
  return QUICK_SLOTS[
    (slot + (direction > 0 ? 1 : QUICK_SLOTS.length - 1)) % QUICK_SLOTS.length
  ].index;
}
export function slotForDigit(code: string) {
  return QUICK_SLOTS.find((s) => `Digit${s.key}` === code)?.index;
}
