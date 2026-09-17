import * as T from 'three';
import type { MapLight } from '@/lib/maps/types';

/**
 * Лампы боевых карт: настоящих `PointLight` в сцене меньше, чем ламп на карте.
 *
 * На картах 12–20 ламп, и раньше каждая была отдельным источником. Three.js
 * считает свет вперёд (forward): каждый пиксель каждой освещённой поверхности
 * перебирает все точечные источники, даже если до него лампа не достаёт. На
 * встроенной видеокарте (Intel Arc, 1920×1200) 18 ламп «Особняка» занимали
 * больше половины кадра: 27–32 мс GPU против 11–12 мс без них.
 *
 * Поэтому источников фиксированное число, и каждый кадр они стоят у ламп,
 * ближайших к камере. Число источников не меняется никогда — иначе Three.js
 * пересобирал бы шейдеры всех материалов при каждой смене набора. Лампа, которая
 * выпала из ближайших, гаснет плавно, и только погасший источник переезжает к
 * новой: вспышек и рывков света нет, а переезды случаются на дальнем краю,
 * куда близкие лампы и так не светят.
 */

/** Сколько метров «форы» у уже горящей лампы: без неё две равноудалённые лампы перемигивались бы. */
const KEEP_BONUS = 3;
/** Секунды на полное включение или гашение источника. */
const FADE_SECONDS = 0.35;

/**
 * Индексы ламп, которым сейчас положен настоящий свет: `count` ближайших к точке
 * обзора с учётом радиуса (далеко светящая лампа важнее тусклой рядом),
 * уже горящие — с форой `KEEP_BONUS`.
 */
export function pickLamps(
  lamps: readonly MapLight[],
  eye: { x: number; y: number; z: number },
  count: number,
  lit: ReadonlySet<number> = new Set(),
): Set<number> {
  const scored = lamps.map((l, i) => {
    const d = Math.hypot(l.x - eye.x, l.y - eye.y, l.z - eye.z) - l.distance;
    return { i, score: lit.has(i) ? d - KEEP_BONUS : d };
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return new Set(scored.slice(0, Math.max(0, count)).map((s) => s.i));
}

type Slot = { light: T.PointLight; lamp: number; level: number };

export function createLampLights(scene: T.Object3D, lamps: readonly MapLight[], slots: number) {
  const pool: Slot[] = Array.from({ length: Math.min(Math.max(0, slots), lamps.length) }, () => {
    const light = new T.PointLight('#ffffff', 0, 1);
    scene.add(light);
    return { light, lamp: -1, level: 0 };
  });
  const place = (slot: Slot, index: number) => {
    const lamp = lamps[index];
    slot.lamp = index;
    slot.light.position.set(lamp.x, lamp.y, lamp.z);
    slot.light.color.set(lamp.color);
    slot.light.distance = lamp.distance;
  };
  // До первого кадра — сразу у первых ламп, чтобы сцена не стартовала тёмной.
  pool.forEach((slot, i) => {
    place(slot, i);
    slot.level = 1;
    slot.light.intensity = lamps[i].intensity;
  });
  return {
    /** Сколько настоящих источников держит карта. */
    count: pool.length,
    update(eye: T.Vector3, dt: number) {
      if (!pool.length) return;
      const lit = new Set(pool.map((s) => s.lamp));
      const wanted = pickLamps(lamps, eye, pool.length, lit);
      const step = Math.min(1, dt / FADE_SECONDS);
      const waiting = [...wanted].filter((i) => !lit.has(i));
      for (const slot of pool) {
        const keep = wanted.has(slot.lamp);
        if (!keep && slot.level <= 0 && waiting.length) place(slot, waiting.shift()!);
        const on = wanted.has(slot.lamp);
        slot.level = on ? Math.min(1, slot.level + step) : Math.max(0, slot.level - step);
        slot.light.intensity = lamps[slot.lamp].intensity * slot.level;
      }
    },
    dispose() {
      for (const { light } of pool) {
        light.removeFromParent();
        light.dispose();
      }
    },
  };
}
