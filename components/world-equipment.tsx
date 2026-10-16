'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { ZONES, type GAME_TOOLS, type Room } from '@/lib/model';
import { ItemWheel, type WheelGroup } from './item-wheel';
import { AvatarPreview } from './avatar-preview';
import { PAINTS, CONFETTI, GRENADES, FIREWORKS } from '@/lib/game-items';
import { MELEE } from '@/lib/melee';
import type { Slot } from '@/lib/loadout';
import { PAINT_SIGHT_OPTIONS, type PaintSight } from '@/lib/weapon-sights';
import { PREF_KEYS, writePref } from '@/lib/user-prefs';
import {
  Crosshair,
  Palette,
  PartyPopper,
  Tablet,
  Bomb,
  Sparkles,
  StickyNote,
  X,
  Heart,
  Flashlight,
} from 'lucide-react';

function getSlotIcon(slotIndex: number) {
  if (slotIndex === 0) return Palette;
  if (slotIndex === 1) return PartyPopper;
  if (slotIndex === 10) return Bomb;
  if (slotIndex === 11) return Sparkles;
  if (slotIndex === 2) return StickyNote;
  if (slotIndex === 9) return Tablet;
  if (slotIndex === 12) return Heart;
  if (slotIndex === 13) return Flashlight;
  return Crosshair;
}

/**
 * Снаряжение поверх мира: панель быстрых предметов, кнопка вариантов предмета
 * в руках, колесо вариантов (СКМ) и окно «Снаряжение» (Q / I).
 *
 * Вынесено из world.tsx дословно. Выбор вариантов (конфетти, гранаты…)
 * по-прежнему живёт в World: его каждый кадр читает движок. Открыть и
 * закрыть снаряжение — методы движка (`engine`).
 */
export function WorldEquipment({
  slots,
  current,
  tool,
  onTool,
  paintColor,
  onPaintColor,
  onAction,
  room,
  paintSight,
  applyPaintSight,
  confettiStyle,
  setConfettiStyle,
  grenadeStyle,
  setGrenadeStyle,
  fireworkStyle,
  setFireworkStyle,
  meleeStyle,
  setMeleeStyle,
  tabletZone,
  setTabletZone,
  tabletInWorld,
  openTabletInWorld,
  closeTabletInWorld,
  contextWheel,
  radial,
  engine,
}: {
  slots: Slot[];
  current: (typeof GAME_TOOLS)[number];
  tool: number;
  onTool: (n: number) => void;
  paintColor: string;
  onPaintColor: (color: string) => void;
  onAction: (kind: string) => void;
  room: Room;
  paintSight: PaintSight;
  applyPaintSight: (value: PaintSight) => void;
  confettiStyle: string;
  setConfettiStyle: (id: string) => void;
  grenadeStyle: string;
  setGrenadeStyle: (id: string) => void;
  fireworkStyle: string;
  setFireworkStyle: (id: string) => void;
  meleeStyle: string;
  setMeleeStyle: (id: string) => void;
  tabletZone: string;
  setTabletZone: (id: string) => void;
  tabletInWorld: boolean;
  openTabletInWorld: () => void;
  closeTabletInWorld: () => void;
  /** Колесо вариантов (СКМ) открыто. */
  contextWheel: boolean;
  /** Окно «Снаряжение» открыто. */
  radial: boolean;
  engine: {
    readonly current: {
      openInventory: () => void;
      openContext: () => void;
      closeInventory: (resume?: boolean) => void;
    } | null;
  };
}) {
  const [showAgent, setShowAgent] = useState(false);
  /*
   * Что лежит в колесе СКМ для нынешнего инструмента. У краскомёта групп две —
   * прицелы сверху, краска снизу: и то и другое меняют посреди боя, а второй
   * кнопки под это нет. У остальных инструментов группа одна, и колесо
   * выглядит как раньше.
   */
  const wheelGroups: WheelGroup[] =
    current.id === 'paint'
      ? [
          {
            id: 'sight',
            title: 'Прицел',
            selected: paintSight,
            items: PAINT_SIGHT_OPTIONS,
          },
          {
            id: 'paint',
            title: 'Краска',
            selected:
              PAINTS.find((p) => p.color === paintColor)?.id || 'violet',
            items: PAINTS,
          },
        ]
      : [
          current.id === 'confetti'
            ? {
                id: 'confetti',
                title: 'Набор конфетти',
                selected: confettiStyle,
                items: CONFETTI,
              }
            : current.id === 'grenade'
              ? {
                  id: 'grenade',
                  title: 'Пиньято',
                  selected: grenadeStyle,
                  items: GRENADES,
                }
              : current.id === 'sniper'
                ? {
                    id: 'sniper',
                    title: 'Фейерверки',
                    selected: fireworkStyle,
                    items: FIREWORKS,
                  }
                : current.id === 'melee'
                ? {
                    id: 'melee',
                    title: 'Ближний бой',
                    selected: meleeStyle,
                    items: MELEE,
                  }
                : current.id === 'sticky'
                  ? {
                      id: 'sticky',
                      title: 'Зона стикера',
                      selected: tabletZone,
                      items: ZONES.map((z) => ({
                        id: z.id,
                        label: z.title,
                        color: z.color,
                        icon: z.emoji,
                      })),
                    }
                  : {
                      id: 'board',
                      title: 'Планшет',
                      selected: 'board',
                      items: [
                        {
                          id: 'board',
                          label: 'Открыть доску',
                          color: '#64d4ef',
                          icon: '📱',
                        },
                      ],
                    },
        ];
  return (
    <>
      <div className="quick-loadout" aria-label="Быстрые предметы">
        {slots.map((slot) => {
          const Icon = getSlotIcon(slot.index);
          return (
            <button
              key={slot.key}
              aria-pressed={tool === slot.index}
              onClick={() => {
                if (slot.index === 9) {
                  if (tool === 9) {
                    if (tabletInWorld) closeTabletInWorld();
                    else openTabletInWorld();
                  } else {
                    onTool(9);
                    openTabletInWorld();
                  }
                } else {
                  if (tabletInWorld) closeTabletInWorld();
                  onTool(slot.index);
                }
              }}
              title={slot.hint}
            >
              <kbd>{slot.key}</kbd>
              <Icon size={20} />
              <span>{slot.label}</span>
            </button>
          );
        })}
        <button
          className="open-kit"
          onClick={() => engine.current?.openInventory()}
        >
          <kbd>Q</kbd>
          <span>Снаряжение</span>
        </button>
      </div>
      <button
        className="item-options-button"
        onClick={() => {
          if (current.id === 'pointer') {
            if (tabletInWorld) closeTabletInWorld();
            else openTabletInWorld();
          } else {
            engine.current?.openContext();
          }
        }}
      >
        <span style={{ color: paintColor }}>
          {current.id === 'paint'
            ? '●'
            : current.id === 'confetti'
              ? CONFETTI.find((c) => c.id === confettiStyle)?.icon
              : current.id === 'grenade'
                ? GRENADES.find((g) => g.id === grenadeStyle)?.icon
                : current.id === 'sniper'
                  ? FIREWORKS.find((f) => f.id === fireworkStyle)?.icon
                  : current.id === 'melee'
                  ? MELEE.find((m) => m.id === meleeStyle)?.icon
                  : current.id === 'sticky'
                    ? ZONES.find((z) => z.id === tabletZone)?.emoji || '📝'
                    : '📱'}
        </span>
        {current.id === 'paint'
          ? 'Краска и прицел'
          : current.id === 'confetti'
            ? CONFETTI.find((c) => c.id === confettiStyle)?.label
            : current.id === 'grenade'
              ? GRENADES.find((g) => g.id === grenadeStyle)?.label
              : current.id === 'sniper'
                ? FIREWORKS.find((f) => f.id === fireworkStyle)?.label
                : current.id === 'melee'
                ? MELEE.find((m) => m.id === meleeStyle)?.label
                : current.id === 'sticky'
                  ? ZONES.find((z) => z.id === tabletZone)?.short || 'Стикер'
                  : 'Открыть доску ↗'}
        <kbd>{current.id === 'pointer' ? 'ЛКМ' : 'СКМ'}</kbd>
      </button>
      {contextWheel && (
        <ItemWheel
          key={current.id}
          title={
            current.id === 'paint' ? 'Краскомёт' : wheelGroups[0].title
          }
          groups={wheelGroups}
          onSelect={(id: string, group: string) => {
            if (group === 'sight') applyPaintSight(id as PaintSight);
            else if (current.id === 'paint')
              onPaintColor(PAINTS.find((p) => p.id === id)!.color);
            else if (current.id === 'confetti') {
              setConfettiStyle(id);
              writePref(PREF_KEYS.confettiStyle, id);
            } else if (current.id === 'grenade') {
              setGrenadeStyle(id);
              writePref(PREF_KEYS.grenadeStyle, id);
            } else if (current.id === 'sniper') {
              setFireworkStyle(id);
              writePref(PREF_KEYS.fireworkStyle, id);
            } else if (current.id === 'melee') {
              setMeleeStyle(id);
              writePref(PREF_KEYS.meleeStyle, id);
            }
            else if (current.id === 'sticky') setTabletZone(id);
            else if (current.id === 'pointer') openTabletInWorld();
            engine.current?.closeInventory();
          }}
          onClose={() => engine.current?.closeInventory(false)}
        />
      )}
      <Dialog
        open={radial}
        onOpenChange={(open) => {
          if (!open) engine.current?.closeInventory(false);
        }}
      >
        <DialogContent
          className="equipment-panel"
          showCloseButton={false}
          finalFocus={false}
        >
          <header>
            <div>
              <span className="eyebrow">JINALY / СНАРЯЖЕНИЕ</span>
              <DialogTitle>Снаряжение</DialogTitle>
            </div>
            <button
              aria-label="Закрыть снаряжение"
              onClick={() => engine.current?.closeInventory()}
            >
              <X />
            </button>
          </header>
          <DialogDescription>
            Выберите предмет. Колесо мыши открывает варианты предмета в руках.
          </DialogDescription>
          <button
            className="agent-preview-toggle"
            aria-expanded={showAgent}
            onClick={() => setShowAgent(!showAgent)}
          >
            {showAgent ? 'Скрыть персонажа' : 'Посмотреть персонажа'} ↗
          </button>
          {showAgent && (
            <AvatarPreview
              color={
                room.members.find((m) => m.id === room.self)
                  ?.color || '#718cdd'
              }
              anime={room.state.visualStyle === 'anime'}
              anonymous={!!room.state.anonymousPlayers}
              seed={room.self}
            />
          )}
          <div className="equipment-items">
            {slots.map((slot) => {
              const Icon = getSlotIcon(slot.index);
              return (
                <button
                  key={slot.key}
                  aria-pressed={tool === slot.index}
                  onClick={() => {
                    onTool(slot.index);
                    engine.current?.closeInventory();
                  }}
                >
                  <kbd>{slot.key}</kbd>
                  <Icon size={42} />
                  <strong>{slot.label}</strong>
                  <small>{slot.hint}</small>
                  <span>
                    {tool === slot.index ? 'В руках' : 'Взять в руки'}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            className="equipment-reaction"
            onClick={() => {
              onAction('reaction');
              engine.current?.closeInventory();
            }}
          >
            👍 Поддержать команду
          </button>
          <footer>
            <kbd>Q / I</kbd> снаряжение <kbd>1–4</kbd> быстрый выбор{' '}
            <kbd>Esc</kbd> закрыть
          </footer>
        </DialogContent>
      </Dialog>
    </>
  );
}
