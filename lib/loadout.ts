/** Быстрые слоты не включают инструменты редактирования доски. */
export const QUICK_SLOTS = [
  { index: 0, key: '1', label: 'Краскомёт', hint: 'ЛКМ выстрел · ПКМ прицел' },
  { index: 1, key: '2', label: 'Конфетти', hint: 'ЛКМ праздничный залп' },
  { index: 9, key: '3', label: 'Планшет', hint: 'E открыть ближайшую доску' },
];
export function cycleSlot(current: number, direction: number) {
  const slot = Math.max(
    0,
    QUICK_SLOTS.findIndex((s) => s.index === current),
  );
  return QUICK_SLOTS[(slot + (direction > 0 ? 1 : 2)) % 3].index;
}
export function slotForDigit(code: string) {
  return QUICK_SLOTS.find((s) => `Digit${s.key}` === code)?.index;
}
