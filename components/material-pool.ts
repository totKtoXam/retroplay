import type * as T from 'three';

/**
 * Пул материалов для короткоживущих эффектов: снарядов, клякс, вспышек частиц.
 *
 * Раньше каждый выстрел создавал свой материал и освобождал его при попадании.
 * Three.js держит шейдерную программу, пока жив хотя бы один материал с ней, и
 * удаляет её вместе с последним. В перестрелке это случалось на каждом
 * выстреле: шарик долетал, программа удалялась, следующий шарик компилировал её
 * заново — синхронно, посреди кадра. На Windows (ANGLE → D3D11) такая сборка
 * стоит десятки и сотни миллисекунд, и при зажатой гашетке FPS падал до единиц.
 *
 * Материал из пула после `release` не освобождается, а ждёт следующего эффекта:
 * программа остаётся на GPU, и заодно не копируются заново uniforms.
 * Цвет, прозрачность и прочие изменяемые поля выставляет тот, кто берёт.
 */
export type MaterialPool<M extends T.Material> = {
  acquire(): M;
  release(material: M): void;
  /** Освободить свободные материалы; занятые освобождают их владельцы. */
  dispose(): void;
  readonly idle: number;
};

export function createMaterialPool<M extends T.Material>(
  create: () => M,
  /** Сколько свободных материалов держать; лишние освобождаются сразу. */
  limit = 64,
): MaterialPool<M> {
  const free: M[] = [];
  const known = new Set<M>();
  let disposed = false;
  return {
    acquire() {
      const material = free.pop() ?? create();
      known.add(material);
      return material;
    },
    release(material) {
      // Один материал не должен попасть в пул дважды: два эффекта делили бы
      // его цвет и прозрачность.
      if (!known.delete(material)) return;
      if (disposed || free.length >= limit) material.dispose();
      else free.push(material);
    },
    dispose() {
      disposed = true;
      for (const material of free) material.dispose();
      free.length = 0;
    },
    get idle() {
      return free.length;
    },
  };
}
