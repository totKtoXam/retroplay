/**
 * Вернуть захват мыши 3D-миру после закрытия диалога. Браузер вправе отказать
 * (окно не в фокусе, диалог только что закрылся, WrongDocumentError) — это не
 * ошибка приложения, поэтому отказ гасится, а не всплывает необработанным.
 */
export function relockWorld() {
  const canvas = document.querySelector('canvas');
  if (!canvas) return;
  try {
    const result = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    result?.catch?.(() => {});
  } catch {
    /* Старые браузеры бросают синхронно. */
  }
}
