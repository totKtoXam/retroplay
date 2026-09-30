'use client';
import {
  Bomb,
  Croissant,
  Crosshair,
  Flame,
  Hammer,
  HandFist,
  Heart,
  Palette,
  PartyPopper,
  Slice,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { GAME_TOOLS } from '@/lib/model';
import { MELEE } from '@/lib/melee';

/*
 * Иконки оружия и событий HUD — один набор lucide вместо эмодзи: эмодзи рисует
 * система, и на разных устройствах лента убийств выглядела по-разному, а цвет
 * у них не меняется вместе с остальным HUD. У lucide одна толщина линии и один
 * цвет — currentColor.
 */
const WEAPON_ICON: Record<string, LucideIcon> = {
  paint: Palette,
  confetti: PartyPopper,
  sniper: Sparkles,
  grenade: Bomb,
  like: Heart,
  // У ближнего боя в `tool` — само оружие (lib/room-hub-core.ts).
  hammer: Hammer,
  knife: Slice,
  baguette: Croissant,
  fists: HandFist,
  melee: Hammer,
};

/** Название оружия по-русски: из списка предметов или из вариантов ближнего боя. */
export function weaponName(tool?: string) {
  if (!tool) return 'Оружие';
  return (
    MELEE.find((m) => m.id === tool)?.label ??
    GAME_TOOLS.find((t) => t.id === tool)?.label ??
    'Оружие'
  );
}

export function WeaponIcon({ tool, size = 15 }: { tool?: string; size?: number }) {
  const Icon = (tool && WEAPON_ICON[tool]) || Crosshair;
  return <Icon size={size} strokeWidth={2.25} aria-hidden="true" focusable="false" />;
}

/** Попадание в голову — перекрестие; без оптики — пламя. */
export function HeadshotIcon({ size = 14 }: { size?: number }) {
  return <Crosshair size={size} strokeWidth={2.5} aria-hidden="true" focusable="false" />;
}

export function NoScopeIcon({ size = 14 }: { size?: number }) {
  return <Flame size={size} strokeWidth={2.5} aria-hidden="true" focusable="false" />;
}
