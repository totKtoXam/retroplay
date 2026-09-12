import {
  Bomb,
  Crosshair,
  Folder,
  Heart,
  ListChecks,
  MousePointer2,
  MoveUpRight,
  PartyPopper,
  PenLine,
  Smile,
  SprayCan,
  Square,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';

/** Значок предмета по его id из GAME_TOOLS. */
export const TOOL_ICONS: Record<string, LucideIcon> = {
  paint: SprayCan,
  confetti: PartyPopper,
  grenade: Bomb,
  sniper: Crosshair,
  sticky: StickyNote,
  pointer: MousePointer2,
  like: Heart,
  group: Folder,
  draw: PenLine,
  shape: Square,
  connector: MoveUpRight,
  reaction: Smile,
  action: ListChecks,
};
