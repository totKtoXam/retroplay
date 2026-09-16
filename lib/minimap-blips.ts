// Какие отметки видит на миникарте конкретный игрок. Вынесено из world.tsx в
// чистую функцию: правила «кто на плане» — это логика игры, а не отрисовка, и
// проверять их нужно тестами, а не глазами на холсте.
import { isOnline, type Person } from './model.ts';
import { SPOT_MEMORY_MS, spotTargets, type Target, type Watcher } from './spotting.ts';
import type { BoxCollider3D } from './world-collision.ts';

/**
 * Одна отметка на плане. Свои — всегда; враги — только засвеченные, и `fresh`
 * гаснет по мере того, как отметка стареет: на плане остаётся последнее
 * известное место, а не текущее.
 */
export type MinimapBlip = {
  x: number;
  z: number;
  team?: string;
  dead?: boolean;
  enemy?: boolean;
  /** 1 — только что видели, 0 — отметка вот-вот погаснет. */
  fresh?: number;
};

/** Последнее известное место засвеченного врага и когда его видели (время сервера). */
export type SpotMemory = Map<string, { x: number; z: number; team?: string; at: number }>;

/**
 * Отметки для игрока `self`.
 *
 * На плане только те, кто сейчас в сети: у ушедшего и у отошедшего от экрана
 * поза устарела, и отметка вела бы к пустому месту. Себя план рисует стрелкой,
 * поэтому в отметки он не попадает.
 *
 * Враг появляется, только если кто-то из своих держит его в секторе вокруг
 * прицела и видит не через стену (lib/spotting.ts), — иначе план показывал бы
 * то, чего игрок глазами не видит. `memory` живёт между вызовами и помнит
 * засветку `SPOT_MEMORY_MS`.
 *
 * `now` — часы сервера, идущие и без новых снимков: `lastSeen` тоже серверный,
 * а время из последнего снимка останавливается вместе с ними, и ушедший так и
 * оставался бы «в сети».
 */
export function minimapBlips(opts: {
  members: Person[];
  self: string;
  now: number;
  /** Живая поза своего игрока: серверная отстаёт на пинг, а сектор узкий. */
  me: Watcher;
  colliders: BoxCollider3D[];
  memory: SpotMemory;
}): MinimapBlip[] {
  const { members, self, now, memory } = opts;
  const mine = members.find((m) => m.id === self);
  const alive = (m: Person) => (m.hp ?? 100) > 0;
  const here = (m: Person) => isOnline(m.lastSeen, now);
  const allies = members.filter(
    (m) => m.id !== self && here(m) && (!mine?.team || m.team === mine.team),
  );

  if (mine?.team) {
    // Смотрят все свои живые, включая себя.
    const watchers: Watcher[] = [opts.me];
    for (const m of allies)
      if (alive(m))
        watchers.push({
          x: m.pose.x,
          y: m.pose.y,
          z: m.pose.z,
          yaw: m.pose.yaw,
          pitch: m.pose.pitch,
          stance: m.pose.stance,
        });
    const enemies = members.filter(
      (m) => m.team && m.team !== mine.team && alive(m) && here(m),
    );
    const targets: Target[] = enemies.map((m) => ({
      id: m.id,
      x: m.pose.x,
      y: m.pose.y,
      z: m.pose.z,
      stance: m.pose.stance,
    }));
    for (const id of spotTargets(watchers, targets, opts.colliders)) {
      const m = enemies.find((e) => e.id === id);
      if (m) memory.set(id, { x: m.pose.x, z: m.pose.z, team: m.team, at: now });
    }
    // Погибший, ушедший или давно не виденный враг с плана пропадает.
    const live = new Set(enemies.map((m) => m.id));
    for (const [id, mark] of memory)
      if (now - mark.at > SPOT_MEMORY_MS || !live.has(id)) memory.delete(id);
  } else {
    // Каждый сам за себя: врагов в этом смысле нет, помнить нечего.
    memory.clear();
  }

  const out: MinimapBlip[] = [];
  for (const m of allies) out.push({ x: m.pose.x, z: m.pose.z, team: m.team, dead: !alive(m) });
  for (const mark of memory.values())
    out.push({
      x: mark.x,
      z: mark.z,
      team: mark.team,
      enemy: true,
      fresh: 1 - (now - mark.at) / SPOT_MEMORY_MS,
    });
  return out;
}
