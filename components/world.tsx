'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as T from 'three';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import {
  ZONES,
  GAME_TOOLS,
  TOOL_HINTS,
  uid,
  type Person,
  type Pose,
  type Room,
  type RoomState,
  type WorldEffect,
  type Note,
} from '@/lib/model';
import { ItemWheel, type WheelGroup } from './item-wheel';
import { WorldTablet } from './world-tablet';
import { AmmoIndicator, WorldHud } from './world-hud';
import { WorldMinimap, type MinimapFrame } from './world-minimap';
import { minimapBlips, type MinimapBlip, type SpotMemory } from '@/lib/minimap-blips';
import type { VoiceChannel, VoiceView } from './voice-chat';
import { createMapScene, type WorldKit } from './world-map-scene';
import { useResourcePack } from '../hooks/use-resource-pack';
import { createVisualProvider } from './resource-packs/provider';
import { createFieldOptics } from './resource-packs/realistic/post';
import { useGraphicsSettings } from '../hooks/use-graphics-settings';
import { GRAPHICS_PRESETS } from '../lib/graphics-settings';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { visualBudget } from '../lib/resource-packs';
import { createFirstPersonHands } from './world-hands';
import { PAINTS, CONFETTI, GRENADES, FIREWORKS, SHOTGUN_PELLET_OFFSETS, type HitZone } from '@/lib/game-items';
import { createWorldVfx } from './world-vfx';
import { createWorldProjectiles } from './world-projectiles';
import { createWorldRemotePlayers } from './world-remote-players';
import {
  avatarMuzzle,
  createFlashlightBeam,
  createPlayerFlashlight,
} from './world-flashlight';
import { createGhostForm, setGhostLook, type GhostForm } from './world-ghost';
import {
  dayMix,
  dayPosition,
  sameMix,
  TIMES_OF_DAY,
  type DayMix,
} from '@/lib/day-cycle';
import { createWorldPlayer } from './world-player';
import { createWorldWeather } from './world-weather';
import { buildRoofMap, openShare, underRoof } from '@/lib/weather-shelter';
import { beaufort, weatherLook, windDrift, windLevel, windRelative, WIND_DRIFT } from '@/lib/weather';
import { footstepSurface } from '@/lib/footsteps';
import { setAvatarAnonymous } from './world-avatar';
import { AvatarPreview } from './avatar-preview';
import { attachCustomSkins, applyAvatarSkin } from './world-skins';
import { slotsFor, slotForDigit, cycleSlot } from '@/lib/loadout';
import { modeOf } from '@/lib/maps/catalog';
import { amGhost, impostorFrozen, inGame, inVentNow, minimapShows, visionRadius } from '@/lib/impostor-client';
import { createFootsteps } from './world-footsteps';
import { createWeaponSounds } from './world-weapon-sounds';
import { rayCastWorldObstacle } from '@/lib/world-collision';
import { CAPACITY, type Blaster } from '@/lib/tool-magazine';
import { WeaponPrediction } from '@/lib/weapon-prediction';
import type { WeaponCommand, WeaponReply } from '@/lib/weapon-protocol';
import { isBlaster } from '@/lib/weapon-definition';
import {
  blocksCamera,
  blocksProjectile,
  cameraFrame,
  eyeHeight,
  avoidCameraWalls,
  visibleInWorld,
  wrapAngle,
  type Perspective,
} from '@/lib/game-camera';
import { getMap } from '@/lib/maps';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { animateAvatar, avatarShoot } from './world-avatar';
import {
  MousePointer2,
  MoveUp,
  Crosshair,
  Users,
  Palette,
  PartyPopper,
  Tablet,
  Bomb,
  Sparkles,
  StickyNote,
  X,
  Heart,
  Flashlight,
  Bell,
} from 'lucide-react';

import { SNIPER_ZOOM_LEVELS, SNIPER_ZOOM_FOVS } from './world-constants';

import { readAimModes, type WeaponAimModes } from '@/lib/aim-settings';
import { PREF_KEYS, readChoice, writePref } from '@/lib/user-prefs';
import {
  PAINT_SIGHT_OPTIONS,
  DEFAULT_PAINT_SIGHT,
  readPaintSight,
  writePaintSight,
  type PaintSight,
} from '@/lib/weapon-sights';

// Shield aura mesh removed — immunity is now indicated only by HUD text/icon

type Props = {
  room: Room;
  host?: boolean;
  onRoomSettings?: (patch: Partial<RoomState>) => void;
  quality: string;
  fps: number;
  fpsLimit: number;
  now: number;
  onGraphics: () => void;
  packetLoss?: number;
  onPaintColor: (color: string) => void;
  tool: number;
  onTool: (n: number) => void;
  onZone: (z: string) => void;
  onUseTool: (zone: string) => void;
  onBoardTool: (tool: string) => void;
  sensitivity: number;
  invertCamera: boolean;
  aimModes?: WeaponAimModes;
  onPose: (p: Pose) => void;
  onMonitor: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Табло счёта открыто: нужно, чтобы снять залипание при закрытии извне. */
  monitor?: boolean;
  onFps: (v: number) => void;
  onAction: (kind: string) => void;
  onFire: (effect: WorldEffect) => Promise<WeaponReply>;
  onWeapon: (command: WeaponCommand) => Promise<WeaponReply>;
  onFailure: () => void;
  blocked: boolean;
  /** Растёт, когда окно поверх мира (чат) закрыто с клавиатуры: снова захватить мышь. */
  resume?: number;
  working?: boolean;
  paintColor: string;
  onOp?: (op: Record<string, unknown>) => Promise<unknown>;
  onEditNote?: (n: Note) => void;
  onAddNote?: (zone: string, x?: number, y?: number) => void;
  onCursor?: (x: number, y: number) => void;
  pendingJoinRequestsCount?: number;
  onOpenJoinRequests?: () => void;
  /** Состояние голосового чата для HUD (components/use-voice-chat.ts). */
  voice?: VoiceView;
  /** Нажали или отпустили T (своей команде) или Y (всем). */
  onTalk?: (channel: VoiceChannel, on: boolean) => void;
};
export type KillMessage = {
  id: string;
  killer: string;
  killerName: string;
  victim: string;
  victimName: string;
  assister?: string;
  assisterName?: string;
  color?: string;
  tool?: string;
  headshot?: boolean;
  scoped?: boolean;
  noScope?: boolean;
  pelletsHit?: number;
  at: number;
};
export type PersonalAlert = {
  text: string;
  sub?: string;
  type: 'kill' | 'assist' | 'death';
  key: string | number;
};
export type HitEffect = {
  color: string;
  key: number;
};
/** Запасной цвет вспышки, когда чужих выстрелов рядом не нашлось. */
const FALLBACK_HIT_COLOR = '#ff647c';
/**
 * Сервер не сообщает, чей именно выстрел снял здоровье, поэтому цвет вспышки
 * выбираем сами: среди свежих чужих эффектов берём тот, чья точка попадания
 * ближе всего к нам, при равной близости — более поздний. Граната взрывается
 * через 1100 мс после выстрела, отсюда и ширина окна.
 */
export function hitGlowColor(
  effects: WorldEffect[] | undefined,
  selfId: string,
  me: Person | undefined,
  now = Date.now(),
) {
  const enemy = (effects || []).filter(
    (e) => e.kind !== 'kill' && e.author !== selfId && !!e.color,
  );
  if (enemy.length === 0) return FALLBACK_HIT_COLOR;
  // Окно на всякий случай может оказаться пустым (расхождение часов) — тогда
  // смотрим на весь список, он и так ограничен временем жизни эффектов.
  const fresh = enemy.filter((e) => now - e.at <= 1800);
  const pool = fresh.length > 0 ? fresh : enemy;
  const center = me ? [me.pose.x, me.pose.y + 0.95, me.pose.z] : null;
  let best = pool[0];
  let bestDist = Infinity;
  for (const e of pool) {
    const d =
      center && e.target
        ? Math.hypot(
            e.target[0] - center[0],
            e.target[1] - center[1],
            e.target[2] - center[2],
          )
        : 0;
    if (d < bestDist || (d === bestDist && e.at > best.at)) {
      bestDist = d;
      best = e;
    }
  }
  return best.color || FALLBACK_HIT_COLOR;
}
function readPerspective(): Perspective {
  try {
    return localStorage.getItem('jinaly-perspective') === 'first'
      ? 'first'
      : 'third';
  } catch {
    return 'third';
  }
}
function subscribePerspective(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('jinaly-perspective', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('jinaly-perspective', callback);
  };
}
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

/** Animates ref.current toward `to` on requestAnimationFrame; stops early when shouldContinue() turns false. */
function animateRef(
  ref: { current: number },
  to: number,
  duration: number,
  shouldContinue: () => boolean,
  onDone?: () => void,
) {
  const from = ref.current;
  const start = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / duration);
    ref.current = from + (to - from) * p;
    if (p >= 1) onDone?.();
    else if (shouldContinue()) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export default function World(props: Props) {
  const resourcePack = useResourcePack();
  const graphics = useGraphicsSettings();
  const graphicsRef = useRef(graphics);
  useEffect(() => { graphicsRef.current = graphics; }, [graphics]);
  const packRef = useRef(resourcePack);
  useEffect(() => {
    packRef.current = resourcePack;
  }, [resourcePack]);
  const [packStatus, setPackStatus] = useState<'default' | 'loading' | 'ready' | 'error'>('default');
  const [urbanSlow, setUrbanSlow] = useState(false);
  const slowUrban = resourcePack === 'urban-realism' && !props.blocked && props.fps > 0 && props.fps < 28;
  useEffect(() => {
    const timer = setTimeout(() => setUrbanSlow(slowUrban), slowUrban ? 12000 : 0);
    return () => clearTimeout(timer);
  }, [slowUrban]);
  const mount = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  }, [props]);
  // Погоде и ветру нужны серверные часы каждый кадр, а `props.now` приходит раз в
  // секунду. Держим поправку к локальным часам и считаем время сами.
  const clockOffset = useRef(0);
  useEffect(() => {
    clockOffset.current = props.now - Date.now();
  }, [props.now]);
  const windIndicator = useRef<HTMLDivElement>(null);
  const [contextWheel, setContextWheel] = useState(false);
  const [confettiStyle, setConfettiStyle] = useState('classic');
  const [grenadeStyle, setGrenadeStyle] = useState('pinata');
  const [fireworkStyle, setFireworkStyle] = useState('salute');
  const [tabletZone, setTabletZone] = useState('good');
  const [paintSight, setPaintSight] = useState<PaintSight>(DEFAULT_PAINT_SIGHT);
  useEffect(() => {
    // Читаем только после монтирования: на сервере localStorage нет, и разметка
    // первого кадра разошлась бы с гидрацией. `storage` заодно подхватывает
    // выбор, сделанный в соседней вкладке.
    const sync = () => {
      setPaintSight(readPaintSight());
      setConfettiStyle(readChoice(PREF_KEYS.confettiStyle, CONFETTI.map((c) => c.id), 'classic'));
      setGrenadeStyle(readChoice(PREF_KEYS.grenadeStyle, GRENADES.map((g) => g.id), 'pinata'));
      setFireworkStyle(readChoice(PREF_KEYS.fireworkStyle, FIREWORKS.map((f) => f.id), 'salute'));
    };
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const applyPaintSight = useCallback((value: PaintSight) => {
    setPaintSight(value);
    writePaintSight(value);
  }, []);
  const [tabletInWorld, setTabletInWorld] = useState(false);
  const [sniperZoomIndex, setSniperZoomIndex] = useState(1);
  const sniperZoomIndexRef = useRef(1);
  useEffect(() => {
    sniperZoomIndexRef.current = sniperZoomIndex;
  }, [sniperZoomIndex]);
  const tabletInWorldRef = useRef(false);
  const tabletInspectRef = useRef(0);

  const engine = useRef<{
    kit: WorldKit;
    visuals: ReturnType<typeof createVisualProvider>;
    fire: (e: WorldEffect) => void;
    distance: (delta: number) => void;
    reset: () => void;
    orbit: (delta: number) => void;
    shadow: () => void;
    /** Перестроить сцену под настройки комнаты (тема, стиль, сезон…). */
    restyle: (state: RoomState) => void;
    /** Свет, небо и экспозиция по ходу суток. */
    setDayMix: (mix: DayMix) => void;
    capture: () => void;
    pause: () => void;
    closeInventory: (resume?: boolean) => void;
    openInventory: () => void;
    openContext: () => void;
    keys: Set<string>;
    refreshTargets: () => void;
    /** Живая поза игрока: серверное эхо в `room.members` отстаёт на пинг. */
    player: ReturnType<typeof createWorldPlayer>;
  } | null>(null);

  const openTabletInWorld = useCallback(() => {
    tabletInWorldRef.current = true;
    setTabletInWorld(true);
    if (document.pointerLockElement) document.exitPointerLock();
    animateRef(tabletInspectRef, 1, 380, () => tabletInWorldRef.current);
  }, []);

  const closeTabletInWorld = useCallback(() => {
    tabletInWorldRef.current = false;
    setTabletInWorld(false);
    animateRef(tabletInspectRef, 0, 260, () => true, () => engine.current?.capture());
  }, []);
  const selection = useRef({
    confettiStyle,
    grenadeStyle,
    fireworkStyle,
    tabletZone,
    paintSight,
  });
  useEffect(() => {
    selection.current = {
      confettiStyle,
      grenadeStyle,
      fireworkStyle,
      tabletZone,
      paintSight,
    };
  }, [confettiStyle, grenadeStyle, fireworkStyle, tabletZone, paintSight]);
  /** Changing the room's map rebuilds the engine with that map's scene and collision. */
  const mapId = props.room.state.map ?? 'hub';
  const minimapMap = useMemo(() => getMap(mapId), [mapId]);
  const [mapExpanded, setMapExpanded] = useState(false);
  // Отметки пересобираются, когда пришёл новый снимок комнаты или сдвинулись
  // часы: кадр миникарты идёт 60 раз в секунду, а лучи засветки против всей
  // геометрии карты столько раз не нужны. Часы в ключе обязательны — без них
  // ушедший оставался бы «в сети», пока не придёт следующий снимок.
  const blipCache = useRef<{ from: Person[]; now: number; out: MinimapBlip[] } | null>(null);
  const spotted = useRef<SpotMemory>(new Map());
  /** Кадр миникарты; кого показывать, решает `minimapBlips` (lib/minimap-blips.ts). */
  const readMinimap = useCallback((): MinimapFrame | null => {
    const player = engine.current?.player;
    if (!player) return null;
    // Те же живые часы сервера, что и у таблицы по «Ё»: по ним оба решают, кто в сети.
    const { room, now } = latest.current;
    let cache = blipCache.current;
    if (!cache || cache.from !== room.members || cache.now !== now) {
      cache = blipCache.current = {
        from: room.members,
        now,
        out: minimapBlips({
          // В «Предателе» план не выдаёт чужих позиций (lib/impostor-client.ts, minimapShows).
          members: room.impostor
            ? room.members.filter((m) => m.id === room.self || minimapShows(room.impostor, m.id))
            : room.members,
          self: room.self,
          now,
          me: {
            x: player.pos.x,
            y: player.pos.y,
            z: player.pos.z,
            yaw: player.cameraYaw,
            pitch: player.pitch,
            stance: player.stance,
          },
          colliders: minimapMap.colliders,
          memory: spotted.current,
        }),
      };
    }
    return {
      x: player.pos.x,
      z: player.pos.z,
      yaw: player.cameraYaw,
      blips: cache.out,
    };
  }, [minimapMap]);
  const self = props.room.members.find((m) => m.id === props.room.self);
  const dead = self?.hp === 0;
  const [killfeed, setKillfeed] = useState<KillMessage[]>([]);
  const [personalAlert, setPersonalAlert] = useState<PersonalAlert | null>(null);
  const seenKillsRef = useRef<Set<string>>(new Set());
  const initialKillsProcessed = useRef(false);

  useEffect(() => {
    if (!props.room.effects) return;
    const now = Date.now();
    if (!initialKillsProcessed.current) {
      initialKillsProcessed.current = true;
      for (const e of props.room.effects) {
        if (e.kind === 'kill') seenKillsRef.current.add(e.id);
      }
      return;
    }

    const newKills: KillMessage[] = [];
    for (const e of props.room.effects) {
      if (e.kind === 'kill' && !seenKillsRef.current.has(e.id)) {
        seenKillsRef.current.add(e.id);
        if (now - (e.at || now) < 8000) {
          const item: KillMessage = {
            id: e.id,
            killer: e.killer || e.author,
            killerName: e.killerName || 'Игрок',
            victim: e.victim || '',
            victimName: e.victimName || 'Игрок',
            assister: e.assister,
            assisterName: e.assisterName,
            color: e.color || '#ff647c',
            tool: e.tool || 'paint',
            headshot: e.headshot,
            scoped: e.scoped,
            noScope: e.noScope,
            pelletsHit: e.pelletsHit,
            at: e.at || now,
          };
          newKills.push(item);

          if (item.killer === props.room.self) {
            queueMicrotask(() => {
              let text = `ВЫ УСТРАНИЛИ: ${item.victimName}`;
              if (item.tool === 'sniper' && item.noScope) {
                text = item.headshot
                  ? `ВЫ УСТРАНИЛИ NO-SCOPE В ГОЛОВУ! 🎯🔥💀 ${item.victimName}`
                  : `ВЫ УСТРАНИЛИ NO-SCOPE! 🎯🔥 ${item.victimName}`;
              } else if (item.headshot) {
                text = `ВЫ УСТРАНИЛИ В ГОЛОВУ! 💀 ${item.victimName}`;
              } else if (item.tool === 'confetti' && (item.pelletsHit || 0) >= 7) {
                text = `ВЫ УСТРАНИЛИ В УПОР! 💥🎉 ${item.victimName}`;
              }
              setPersonalAlert({
                type: 'kill',
                text,
                sub: item.assisterName ? `Помог: ${item.assisterName}` : undefined,
                key: `kill-${Date.now()}-${Math.random()}`,
              });
            });
          } else if (item.assister === props.room.self) {
            queueMicrotask(() => {
              setPersonalAlert({
                type: 'assist',
                text: `ПОМОЩЬ В УСТРАНЕНИИ: ${item.victimName}`,
                sub: `Устранил: ${item.killerName}`,
                key: `assist-${Date.now()}-${Math.random()}`,
              });
            });
          } else if (item.victim === props.room.self) {
            queueMicrotask(() => {
              let text = `ВАС УСТРАНИЛ: ${item.killerName}`;
              if (item.tool === 'sniper' && item.noScope) {
                text = item.headshot
                  ? `NO-SCOPE В ГОЛОВУ! ВАС УСТРАНИЛ: ${item.killerName} 🎯🔥💀`
                  : `NO-SCOPE! ВАС УСТРАНИЛ: ${item.killerName} 🎯🔥`;
              } else if (item.headshot) {
                text = `ХЕДШОТ! ВАС УСТРАНИЛ В ГОЛОВУ: ${item.killerName}`;
              }
              setPersonalAlert({
                type: 'death',
                text,
                sub: item.assisterName ? `Помощь: ${item.assisterName}` : undefined,
                key: `death-${Date.now()}-${Math.random()}`,
              });
            });
          }
        }
      }
    }

    if (newKills.length > 0) {
      queueMicrotask(() => {
        setKillfeed((prev) => [...prev, ...newKills].slice(-5));
      });
    }
  }, [props.room.effects, props.room.self]);

  useEffect(() => {
    if (killfeed.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setKillfeed((prev) => prev.filter((k) => now - k.at < 5000));
    }, 400);
    return () => clearInterval(timer);
  }, [killfeed.length]);

  useEffect(() => {
    if (!personalAlert) return;
    const timer = setTimeout(() => {
      setPersonalAlert(null);
    }, 3500);
    return () => clearTimeout(timer);
  }, [personalAlert]);

  const [hitEffect, setHitEffect] = useState<HitEffect | null>(null);
  // Каждая вспышка получает свой ключ: HUD перемонтирует виньетку и анимация
  // начинается заново, поэтому подряд идущие попадания видно все до одного.
  const glowKeyRef = useRef(0);
  const triggerHitGlow = (color: string) => {
    glowKeyRef.current += 1;
    setHitEffect({ color, key: glowKeyRef.current });
  };

  // Отметка своего попадания: голова, корпус или конечность.
  const [hitMark, setHitMark] = useState<{ zone: HitZone; key: number } | null>(null);
  const hitMarker = useRef((zone: HitZone) => {
    setHitMark({ zone, key: Date.now() });
  });
  useEffect(() => {
    if (!hitMark) return;
    const timer = setTimeout(() => setHitMark(null), 700);
    return () => clearTimeout(timer);
  }, [hitMark]);

  const [shieldSeconds, setShieldSeconds] = useState(0);
  const immuneExpireRef = useRef(0);
  const immuneRemaining = self?.immuneRemaining ?? 0;

  useEffect(() => {
    if (immuneRemaining > 0 && !dead) {
      const target = performance.now() + immuneRemaining;
      if (
        Math.abs(immuneExpireRef.current - target) > 400 ||
        immuneExpireRef.current <= performance.now()
      ) {
        immuneExpireRef.current = target;
      }
    } else if (immuneRemaining === 0) {
      immuneExpireRef.current = 0;
    }
  }, [immuneRemaining, dead]);

  useEffect(() => {
    const timer = setInterval(() => {
      const remainingMs = immuneExpireRef.current - performance.now();
      if (remainingMs > 0 && !dead) {
        setShieldSeconds(Math.ceil(remainingMs / 1000));
      } else {
        setShieldSeconds((prev) => (prev !== 0 ? 0 : prev));
      }
    }, 100);
    return () => clearInterval(timer);
  }, [dead]);

  const [respawnSeconds, setRespawnSeconds] = useState(0);
  const respawnExpireRef = useRef(0);
  const respawnRemaining = self?.respawnRemaining ?? 0;

  useEffect(() => {
    if (dead && respawnRemaining > 0) {
      const target = performance.now() + respawnRemaining;
      if (
        Math.abs(respawnExpireRef.current - target) > 400 ||
        respawnExpireRef.current <= performance.now()
      ) {
        respawnExpireRef.current = target;
      }
    } else if (!dead) {
      respawnExpireRef.current = 0;
    }
  }, [dead, respawnRemaining]);

  useEffect(() => {
    if (!dead) return;
    const timer = setInterval(() => {
      const remainingMs = respawnExpireRef.current - performance.now();
      setRespawnSeconds(remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0);
    }, 100);
    return () => clearInterval(timer);
  }, [dead]);

  const currentHp = self?.hp ?? 100;
  const prevHpRef = useRef(currentHp);

  useEffect(() => {
    // Источник истины по урону — только сервер. Клиентская геометрия попаданий не
    // совпадает с серверной (нет отмотки поз, коллайдеров карты, иммунитета и
    // огня по своим), поэтому вспышку даёт исключительно падение своего hp.
    if (!self) return; // без своего участника hp — не показатель, а заглушка
    const prev = prevHpRef.current;
    prevHpRef.current = currentHp;
    if (currentHp >= prev) return;
    triggerHitGlow(hitGlowColor(props.room.effects, props.room.self, self));
  }, [currentHp, self, props.room.effects, props.room.self]);

  useEffect(() => {
    if (!hitEffect) return;
    const t = setTimeout(() => {
      setHitEffect(null);
    }, 1000);
    return () => clearTimeout(t);
  }, [hitEffect]);
  const [weaponState] = useState(() => new WeaponPrediction());
  const prediction = useRef(weaponState);
  const magazine = useRef(weaponState.magazine);
  const [showAgent, setShowAgent] = useState(false);
  const [rounds, setRounds] = useState({ ...CAPACITY }),
    [reloading, setReloading] = useState(false),
    [aiming, setAiming] = useState(false);
  const aimModes = props.aimModes || readAimModes();
  const aimModesRef = useRef<WeaponAimModes>(aimModes);
  useEffect(() => {
    aimModesRef.current = props.aimModes || readAimModes();
  }, [props.aimModes]);
  const [, setLocked] = useState(false),
    [radial, setRadial] = useState(false),
    [near, setNear] = useState(''),
    [stance, setStance] = useState('stand'),
    [active, setActive] = useState(false),
    [shots, setShots] = useState(0),
    [captureError, setCaptureError] = useState('');
  // Табло счёта: «ё» держим — табло видно; ЛКМ при зажатой «ё» «залипает» —
  // табло остаётся с курсором мыши, выход только по Esc.
  const [scorePinned, setScorePinned] = useState(false);
  const scoreHeldRef = useRef(false);
  const scorePinnedRef = useRef(false);
  useEffect(() => {
    // Табло закрыли извне (крестик, переход к выбору стороны) — залипание снято.
    if (props.monitor === false && scorePinnedRef.current) {
      scorePinnedRef.current = false;
      setScorePinned(false);
    }
  }, [props.monitor]);
  const perspective = useSyncExternalStore(
    subscribePerspective,
    readPerspective,
    () => 'third' as Perspective,
  );
  const perspectiveRef = useRef<Perspective>(perspective);
  useEffect(() => {
    perspectiveRef.current = perspective;
  }, [perspective]);
  const choosePerspective = (value: Perspective) => {
    perspectiveRef.current = value;
    try {
      localStorage.setItem('jinaly-perspective', value);
      window.dispatchEvent(new Event('jinaly-perspective'));
    } catch { }
  };
  const lock = () => engine.current?.capture();
  useEffect(() => {
    if (props.blocked) {
      engine.current?.pause();
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }, [props.blocked]);
  // Закрыли чат клавишей — игрок хочет играть дальше, а не кликать по миру ещё раз.
  // Нажатие клавиши — жест игрока, поэтому браузер разрешит захват мыши.
  useEffect(() => {
    if (props.resume) engine.current?.capture();
  }, [props.resume]);
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({
        antialias: true,
        // Laptops with two GPUs otherwise render on the integrated one.
        powerPreference: 'high-performance',
      });
    } catch {
      latest.current.onFailure();
      return;
    }
    const map = getMap(mapId);
    const isCinematic = props.quality === 'cinematic' || props.quality === 'high';
    const isBalanced = props.quality === 'balanced' || (!isCinematic && props.quality !== 'low');
    // Каждая лампа — это цикл в шейдере каждого освещённого пикселя; на встроенной
    // видеокарте 18 ламп «Особняка» съедали больше половины кадра.
    const kit = createMapScene(map, renderer, { lampLights: isCinematic ? 6 : isBalanced ? 4 : 3 }),
      { scene } = kit;
    const pixelRatio = isCinematic
      ? Math.min(devicePixelRatio, 1.5)
      : isBalanced
        ? Math.min(devicePixelRatio, 1.25)
        : 1.0;
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = isCinematic ? 1.08 : isBalanced ? 0.98 : 0.92;
    renderer.shadowMap.enabled = props.quality !== 'low';
    renderer.shadowMap.type = isCinematic ? T.PCFSoftShadowMap : T.PCFShadowMap;
    renderer.shadowMap.autoUpdate = props.quality !== 'low';
    kit.sunlight.shadow.mapSize.setScalar(
      isCinematic ? 2048 : isBalanced ? 1024 : 512,
    );
    renderer.shadowMap.needsUpdate = true;
    host.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute(
      'aria-label',
      'Игровой мир: клик — играть, движение мыши — камера, WASD — движение, Esc — курсор',
    );
    const camera = new T.PerspectiveCamera(64, 1, 0.06, 350);
    /** Фаза суток по серверным часам: `props.now` приходит с поправкой сервера. */
    const currentMix = () =>
      dayMix(latest.current.room.state, latest.current.now);
    /** Та же фаза одним словом — для визуальных пакетов, которые живут на `time`. */
    const currentPhase = () =>
      TIMES_OF_DAY[
        Math.floor(dayPosition(latest.current.room.state, latest.current.now)) %
          TIMES_OF_DAY.length
      ];
    kit.update(latest.current.room.state, currentMix());
    kit.setNotes(latest.current.room.state);
    // Погода поверх любой карты. «Под крышей» — когда над камерой есть потолок или вся
    // карта внутри помещения (корабль): там ни осадков, ни ветра.
    const indoor = !!map.arena?.indoor;
    // Карта крыш: под перекрытием не идут осадки, не сносит игрока и пули.
    const roof = buildRoofMap(map);
    if (indoor) roof.heights.fill(1e4);
    let visionFog: { base: { near: number; far: number }; near: number; far: number } | null = null;
    const weather = createWorldWeather({
      scene,
      sunlight: kit.sunlight,
      roof,
    });
    const windOn = () => !indoor && latest.current.room.state.windEffects !== false;
    const cameraObstacles: T.Object3D[] = [];
    // Отладочный доступ к сцене: в dev и по ?debug=1 — чтобы разбирать визуальные баги с натуры.
    if (typeof location !== 'undefined' && location.search.includes('debug=1'))
      (window as unknown as { __world?: unknown }).__world = { scene, camera, renderer };
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (blocksCamera(o)) {
        o.geometry.computeBoundingBox();
        cameraObstacles.push(o);
      }
    });
    scene.add(camera);
    const hands = createFirstPersonHands(camera);
    // Свой фонарик светит от дула туда, куда смотрит игрок (кадр ставит его ниже).
    const flashlight = createPlayerFlashlight(scene);
    const flashlightOrigin = new T.Vector3(),
      flashlightDirection = new T.Vector3();
    let composer: EffectComposer | undefined,
      bloom: UnrealBloomPass | undefined;
    if (isCinematic || isBalanced) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloomStrength = isCinematic ? 0.28 : 0.14;
      const bloomRadius = isCinematic ? 0.52 : 0.35;
      const bloomThreshold = isCinematic ? 0.72 : 0.85;
      bloom = new UnrealBloomPass(
        new T.Vector2(1, 1),
        bloomStrength,
        bloomRadius,
        bloomThreshold,
      );
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    }
    const fxaa = new ShaderPass(FXAAShader);
    fxaa.enabled = false;
    composer?.addPass(fxaa);
    const optics = createFieldOptics();
    composer?.addPass(optics);
    /**
     * Экспозиция, которую задаёт сама сцена: кинематографичное небо меняет её
     * по ходу суток. Цикл рендера плавно ведёт к ней экспозицию кадра. Раньше
     * здесь был снимок на момент сборки сцены: раз в секунду сутки ставили
     * новую экспозицию, а цикл рендера снова тянул её к устаревшей — яркость
     * пульсировала, и свет солнца мигал.
     */
    let sceneExposure = renderer.toneMappingExposure;
    /** Применить свет сцены, не дёргая экспозицию кадра: к новой цели её доведёт цикл рендера. */
    const lightScene = (apply: () => void) => {
      const shown = renderer.toneMappingExposure;
      renderer.toneMappingExposure = sceneExposure;
      apply();
      sceneExposure = renderer.toneMappingExposure;
      renderer.toneMappingExposure = shown;
    };
    // Forward reference: `visuals.select` can call `restore` synchronously
    // (before the shot-target cache further below is defined), so route
    // through a reassignable hook instead of closing over `rebuildSceneryTargets` directly.
    let refreshSceneryTargets = () => {};
    const visuals = createVisualProvider({ scene, hands: hands.group, quality: props.quality, stations: kit.stations, renderer, graphics: () => graphicsRef.current,
      restore: () => { lightScene(() => kit.update(latest.current.room.state, currentMix())); renderer.toneMappingExposure = sceneExposure; refreshSceneryTargets(); },
      status: setPackStatus,
    });
    // Resource packs dress the hub around its board stations; battle maps keep their own look.
    void visuals.select(map.arena && packRef.current !== 'urban-realism' ? 'default' : packRef.current, latest.current.room.state).then(() => refreshSceneryTargets());
    const avatar = kit.avatarFactory(
      latest.current.room.members.find((m) => m.id === latest.current.room.self)
        ?.color || '#718cdd',
    );
    avatar.traverse((o) => {
      if (o instanceof T.Mesh) o.castShadow = props.quality !== 'low';
    });
    scene.add(avatar);
    // Тот же луч, что видят остальные, висит и на своём аватаре: в третьем лице
    // игрок видит собственный фонарик, а в первом луч пропадает вместе с
    // аватаром (`avatar.visible` ниже) и не светит в камеру.
    const localBeam = createFlashlightBeam();
    avatar.add(localBeam.group);
    // Погибший в «Предателе» видит себя в третьем лице тем же призраком, каким его видят другие.
    let localGhost: GhostForm | null = null;
    const avatarGun = avatar.getObjectByName('gun');
    // Attach custom skins & bandana to local avatar
    const localSkinResult = attachCustomSkins(avatar);
    const localBandanaMat = localSkinResult.bandanaMat;
    // Local skin prefs live in localStorage; re-read them occasionally instead
    // of every frame, and only re-apply to the avatar when they actually change.
    let cachedLocalSkinId = 'agent';
    let cachedLocalBandanaColor = '#3b82f6';
    let lastLocalSkinRead = 0;
    const readLocalSkinPrefs = () => {
      cachedLocalSkinId = typeof localStorage !== 'undefined' ? localStorage.getItem('jinaly-custom-skin') || 'agent' : 'agent';
      cachedLocalBandanaColor = typeof localStorage !== 'undefined' ? localStorage.getItem('jinaly-bandana-color') || '#3b82f6' : '#3b82f6';
    };
    readLocalSkinPrefs();
    let appliedLocalSkinId = cachedLocalSkinId;
    let appliedLocalBandanaColor = cachedLocalBandanaColor;
    applyAvatarSkin(avatar, appliedLocalSkinId, appliedLocalBandanaColor, localBandanaMat);
    // Обзор в «Предателе»: дальше радиуса и за стенами других игроков не видно. Сервер
    // позиции всё равно присылает — это правило игры, а не защита от читов.
    const visionEye = new T.Vector3();
    const remotePlayers = createWorldRemotePlayers({
      scene,
      kit,
      quality: props.quality,
      latest,
      map,
      hidden: (at) => {
        const radius = visionRadius(latest.current.room.impostor);
        if (radius === null) return false;
        const dx = at.x - visionEye.x,
          dz = at.z - visionEye.z;
        if (dx * dx + dz * dz > radius * radius) return true;
        return !!rayCastWorldObstacle([visionEye.x, visionEye.y + 1.5, visionEye.z], [at.x, at.y + 1.2, at.z], map.colliders)?.hit;
      },
    });
    const { remoteAvatars, deadTimers } = remotePlayers;
    const shadow = new T.Mesh(
      new T.CircleGeometry(0.5, 20),
      new T.MeshBasicMaterial({
        color: '#354462',
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.24;
    scene.add(shadow);
    const initial = latest.current.room.members.find(
      (m) => m.id === latest.current.room.self,
    )?.pose;
    let viewHeight = eyeHeight(initial?.stance || 'stand'),
      distance = 6.5,
      currentCamDist = 6.5,
      obstacleHoldTimer = 0,
      raf = 0,
      last = 0,
      poseAt = 0,
      fpsAt = 0,
      frames = 0,
      nearZone = '',
      middle = false,
      left = false,
      flashlightOn = false,
      aimHeld = false,
      aimBlend = 0,
      equippedTool = latest.current.tool,
      activeControl = false,
      softLook = false,
      // Кнопка мыши зажата: единственный способ осмотреться, когда захват
      // мыши недоступен (обзор по краям экрана убран — он уводил камеру сам).
      dragLook = false,
      // Первое движение после захвата мыши браузер отдаёт скачком.
      skipNextMove = false;
    // В «Предателе» фонарик — единственный предмет в руках, и на тёмном корабле он включён сразу.
    if (modeOf(latest.current.room.state) === 'impostor') flashlightOn = flashlight.toggle();
    const footsteps = createFootsteps({
      surfaceAt: (x, y, z) => {
        const state = latest.current.room.state;
        const sheltered = indoor || underRoof(roof, x, y + 1, z);
        const look = sheltered ? null : weatherLook(state, Date.now() + clockOffset.current);
        return footstepSurface(
          { map, season: state.season, sheltered, rain: look?.rain ?? 0, snow: look?.snow ?? 0 },
          x,
          y,
          z,
        );
      },
    });
    let grenadeAiming = false;
    let continuousShots = 0;
    const keys = new Set<string>(),
      ray = new T.Raycaster(),
      mouse = new T.Vector2(0, 0);
    const player = createWorldPlayer({
      map,
      keys,
      initial,
      // `isDead` is declared further down; wrap it so the player factory does
      // not read it before its initializer has run.
      isDead: () => isDead(),
      onStance: setStance,
      // Под крышей ветра нет: иначе игрока сносило бы посреди комнаты.
      wind: () => (windOn() && !underRoof(roof, pos.x, pos.y + 1, pos.z) ? weather.wind : null),
      ghost: () => amGhost(latest.current.room.impostor),
    });
    const { pos } = player;
    // Тела режима «Предатель»: лежащая капсула цвета погибшего и торчащая кость.
    const bodies = new Map<string, T.Group>();
    const syncBodies = () => {
      const list = latest.current.room.impostor?.bodies ?? [];
      const wanted = new Set(list.map((b) => b.victim + ':' + b.at));
      for (const [key, group] of bodies)
        if (!wanted.has(key)) {
          scene.remove(group);
          group.traverse((o) => {
            if (o instanceof T.Mesh) {
              o.geometry.dispose();
              (o.material as T.Material).dispose();
            }
          });
          bodies.delete(key);
        }
      for (const b of list) {
        const key = b.victim + ':' + b.at;
        if (bodies.has(key)) continue;
        const group = new T.Group();
        const torso = new T.Mesh(
          new T.CapsuleGeometry(0.32, 0.5, 4, 12),
          new T.MeshStandardMaterial({ color: b.color, roughness: 0.6 }),
        );
        torso.rotation.z = Math.PI / 2;
        torso.position.set(-0.15, 0.3, 0);
        const bone = new T.Mesh(
          new T.CylinderGeometry(0.06, 0.06, 0.45, 8),
          new T.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.5 }),
        );
        bone.position.set(0.45, 0.4, 0);
        bone.rotation.z = -Math.PI / 3;
        group.add(torso, bone);
        group.position.set(b.x, b.y, b.z);
        group.rotation.y = (b.at % 628) / 100;
        scene.add(group);
        bodies.set(key, group);
      }
    };
    const vfx = createWorldVfx({ scene, quality: props.quality, camera });
    const { burst, paintDropletGeo } = vfx;
    // Per-frame camera-update scratch vectors, reused to avoid allocating on every tick.
    const scratchCamDir = new T.Vector3(),
      scratchLookTarget = new T.Vector3();

    const trajectoryGeo = new T.BufferGeometry();
    const trajectoryMat = new T.LineBasicMaterial({
      color: '#ffe066',
      transparent: true,
      opacity: 0.85,
    });
    const trajectoryLine = new T.Line(trajectoryGeo, trajectoryMat);
    trajectoryLine.visible = false;
    scene.add(trajectoryLine);

    const landingMarker = new T.Mesh(
      new T.RingGeometry(0.18, 0.42, 16),
      new T.MeshBasicMaterial({
        color: '#ffe066',
        transparent: true,
        opacity: 0.8,
        side: T.DoubleSide,
      }),
    );
    landingMarker.rotation.x = -Math.PI / 2;
    landingMarker.visible = false;
    scene.add(landingMarker);

    // Shot/trajectory hit-testing used to re-traverse the whole scene (plus
    // recursive getObjectById lookups and flights/bursts .some scans) on every
    // shot and every frame while aiming a grenade. Instead, cache the static
    // scenery mesh candidates once and rebuild only when scenery actually
    // changes (style/interior/season/pack switches, or periodically as a
    // safety net for content packs that resync scenery outside those events).
    // Local avatar, hands, shadow and landingMarker never change shape, so a
    // one-time id set is enough to exclude them cheaply. Remote avatars come
    // and go, so they're excluded from the cache and gathered fresh (but only
    // from their own small subtree, not the whole scene) where needed.
    const staticTargetExclusions = new Set<number>();
    avatar.traverse((o) => staticTargetExclusions.add(o.id));
    hands.group.traverse((o) => staticTargetExclusions.add(o.id));
    staticTargetExclusions.add(shadow.id);
    staticTargetExclusions.add(landingMarker.id);
    let sceneryTargetCache: T.Mesh[] = [];
    const rebuildSceneryTargets = () => {
      const excluded = new Set(staticTargetExclusions);
      for (const remote of remoteAvatars.values())
        remote.traverse((o) => excluded.add(o.id));
      const list: T.Mesh[] = [];
      scene.traverse((o) => {
        if (
          o instanceof T.Mesh &&
          !excluded.has(o.id) &&
          !o.userData.transientProjectile
        )
          list.push(o);
      });
      sceneryTargetCache = list;
    };
    rebuildSceneryTargets();
    refreshSceneryTargets = rebuildSceneryTargets;
    let lastSceneryTargetRebuild = performance.now();
    const gatherRemoteAvatarMeshes = () => {
      const list: T.Mesh[] = [];
      for (const remote of remoteAvatars.values())
        remote.traverse((o) => {
          // `presentationOnly` — декор вроде луча фонарика: он виден, но не
          // является ни мишенью, ни препятствием для дуги броска.
          if (
            o instanceof T.Mesh &&
            !o.userData.transientProjectile &&
            !o.userData.presentationOnly
          )
            list.push(o);
        });
      return list;
    };

    const checkSceneryHit = (at: T.Vector3, normal: T.Vector3) => {
      const rayOrigin = at.clone().addScaledVector(normal, 0.25);
      const rayDir = normal.clone().negate().normalize();
      if (rayDir.lengthSq() < 0.01) rayDir.set(0, -1, 0);
      const testRay = new T.Raycaster(rayOrigin, rayDir, 0.01, 0.6);
      const sceneryHitTargets: T.Mesh[] = [];
      for (const o of sceneryTargetCache)
        if (
          visibleInWorld(o) &&
          o.geometry.type !== 'SphereGeometry' &&
          o.geometry.type !== 'ShapeGeometry'
        )
          sceneryHitTargets.push(o);
      const hits = testRay.intersectObjects(sceneryHitTargets, false);
      if (hits.length > 0 && hits[0].face) {
        return {
          point: hits[0].point,
          normal: hits[0].face.normal
            .clone()
            .transformDirection(hits[0].object.matrixWorld),
        };
      }
      if (at.y <= 0.25 && at.y >= -0.1) {
        return {
          point: new T.Vector3(at.x, 0.02, at.z),
          normal: new T.Vector3(0, 1, 0),
        };
      }
      return null;
    };
    const weaponSounds = createWeaponSounds({
      listener: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: player.cameraYaw }),
      occluded: (from, to) => !!rayCastWorldObstacle([...from], [...to], map.colliders)?.hit,
    });
    // В хабе на ретроспективе выстрелы тише, как и шаги.
    const weaponVolume = () => (modeOf(latest.current.room.state) === 'retro' ? 0.6 : 1);
    /** Включён ли фонарик у других игроков — по прошлому кадру, чтобы щёлкнуть на смене. */
    const remoteLights = new Map<string, boolean>();
    const projectiles = createWorldProjectiles({
      scene,
      latest,
      remoteAvatars,
      avatar,
      hands,
      pos,
      perspectiveRef,
      hitMarker,
      burst,
      splat: vfx.splat,
      smearPlayerWithPaint: vfx.smearPlayerWithPaint,
      checkSceneryHit,
      colliders: map.colliders,
      onLaunch: (e) => {
        const [x, y, z] = e.origin ?? [];
        if (z !== undefined) weaponSounds.fire(e.kind, [x, y, z], e.author === latest.current.room.self, weaponVolume());
      },
      onLand: (kind, at) => weaponSounds.impact(kind, [at.x, at.y, at.z], weaponVolume()),
    });
    const { flights, spawn } = projectiles;
    let lastReportedRounds = { ...magazine.current.rounds };
    let lastReportedReloading = magazine.current.reloading;
    const updateAmmo = () => {
      const rounds = magazine.current.rounds;
      if (
        rounds.paint !== lastReportedRounds.paint ||
        rounds.confetti !== lastReportedRounds.confetti ||
        rounds.sniper !== lastReportedRounds.sniper ||
        rounds.like !== lastReportedRounds.like
      ) {
        lastReportedRounds = { ...rounds };
        setRounds(lastReportedRounds);
      }
      if (magazine.current.reloading !== lastReportedReloading) {
        lastReportedReloading = magazine.current.reloading;
        setReloading(lastReportedReloading);
      }
    };
    let weaponDisposed = false;
    const applyWeaponReply = (reply: WeaponReply) => {
      if (weaponDisposed) return;
      prediction.current.acknowledge(reply, performance.now());
      updateAmmo();
    };
    const weaponFailure = (id: string, error: unknown) => {
      prediction.current.forget(id);
      if (!weaponDisposed) setCaptureError(error instanceof Error ? error.message : 'Действие не подтверждено');
    };
    const sendWeaponControl = (action: WeaponCommand['action'], tool?: Blaster) => {
      const id = uid();
      prediction.current.remember(id, action, tool, performance.now());
      const life = latest.current.room.members.find((m) => m.id === latest.current.room.self)?.life ?? 0;
      void latest.current.onWeapon({ id, action, tool, life }).then(applyWeaponReply).catch((error) => weaponFailure(id, error));
    };
    prediction.current.reset(latest.current.room.members.find((m) => m.id === latest.current.room.self)?.life ?? 0);
    sendWeaponControl('sync');
    const beginReload = () => {
      const tool = GAME_TOOLS[latest.current.tool]?.id;
      if (
        tool === 'paint' ||
        tool === 'confetti' ||
        tool === 'sniper' ||
        tool === 'like'
      ) {
        magazine.current.reload(tool as Blaster, performance.now());
        sendWeaponControl('reload', tool as Blaster);
        aimHeld = false;
        setAiming(false);
        updateAmmo();
      }
    };
    let lastGrenade = -Infinity;
    // `shots` only feeds the aria-live announcement; avoid a full component
    // re-render on every single shot by throttling the state flush.
    let shotsFired = 0;
    let lastShotsFlush = 0;
    const isDead = () =>
      latest.current.room.members.find((m) => m.id === latest.current.room.self)
        ?.hp === 0;
    const isImmune = () => {
      return immuneExpireRef.current > performance.now();
    };
    const shoot = () => {
      if (latest.current.room.match?.phase === 'freeze') return;
      const p = latest.current;
      if (p.blocked || middle || isDead() || isImmune() || p.room.state.archived)
        return;
      const tool = GAME_TOOLS[p.tool]?.id;
      if (
        tool !== 'paint' &&
        tool !== 'confetti' &&
        tool !== 'grenade' &&
        tool !== 'sniper' &&
        tool !== 'like'
      )
        return;
      const now = performance.now();
      const wasReloading = magazine.current.reloading;
      if (tool === 'grenade') {
        if (now - lastGrenade < 1200) return;
        lastGrenade = now;
      }
      if (
        tool !== 'grenade' &&
        !magazine.current.fire(tool as Blaster, now)
      ) {
        if (magazine.current.reloading) {
          setReloading(true);
          if (!wasReloading) sendWeaponControl('reload', tool as Blaster);
        }
        if (tool === 'sniper') {
          aimHeld = false;
          setAiming(false);
        }
        return;
      }
      updateAmmo();

      if (tool === 'sniper' && magazine.current.rounds.sniper === 0) {
        aimHeld = false;
        setAiming(false);
      }

      const screenCoord = (
        document.pointerLockElement || softLook
          ? new T.Vector2(0, 0)
          : mouse.clone()
      );
      if (tool === 'paint' && !aimHeld) {
        const spread = Math.min(0.048, 0.016 + continuousShots * 0.0032);
        continuousShots++;
        const ang = Math.random() * Math.PI * 2;
        const mag = Math.sqrt(Math.random()) * spread;
        screenCoord.add(new T.Vector2(Math.cos(ang) * mag, Math.sin(ang) * mag));
      } else if (tool === 'sniper' && !aimHeld) {
        const isMoving =
          keys.has('KeyW') ||
          keys.has('KeyA') ||
          keys.has('KeyS') ||
          keys.has('KeyD');
        const spread = 0.2 + (isMoving ? 0.09 : 0);
        const ang = Math.random() * Math.PI * 2;
        const mag = (0.35 + Math.random() * 0.65) * spread;
        screenCoord.add(new T.Vector2(Math.cos(ang) * mag, Math.sin(ang) * mag));
        continuousShots = 0;
      } else {
        continuousShots = 0;
      }

      ray.setFromCamera(screenCoord, camera);
      const targets: T.Mesh[] = [];
      for (const o of sceneryTargetCache) if (blocksProjectile(o)) targets.push(o);
      for (const o of gatherRemoteAvatarMeshes())
        if (blocksProjectile(o)) targets.push(o);
      const maxDistance = tool === 'sniper' ? 75 : 65;
      // Ветер сносит снаряд: сначала узнаём, как далеко цель по прицелу, затем
      // поворачиваем луч к точке, смещённой ветром на этой дистанции. Сервер
      // проверяет попадание по отрезку до `target`, поэтому снос у всех один.
      if (windOn() && WIND_DRIFT[tool]) {
        const aimed = ray
          .intersectObjects(targets, false)
          .find(
            (h) =>
              h.distance < maxDistance &&
              h.distance > 0.08 &&
              blocksProjectile(h.object, h.face?.materialIndex),
          );
        const distance = aimed ? aimed.distance : tool === 'sniper' ? 65 : 35;
        const aimPoint = ray.ray.at(distance, new T.Vector3());
        // Сносит только на открытой части пути: из дома через окно — лишь снаружи.
        const share = openShare(roof, ray.ray.origin.toArray(), aimPoint.toArray());
        const drift = windDrift(tool, weather.wind, distance);
        aimPoint.x += drift.x * share;
        aimPoint.z += drift.z * share;
        ray.ray.direction.copy(aimPoint.sub(ray.ray.origin).normalize());
      }
      const hit = ray
        .intersectObjects(targets, false)
        .find(
          (h) =>
            h.distance < maxDistance &&
            h.distance > 0.08 &&
            blocksProjectile(h.object, h.face?.materialIndex),
        );
      const target = hit
        ? hit.point
        : ray.ray.at(tool === 'sniper' ? 65 : 35, new T.Vector3());
      const normal = hit?.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : new T.Vector3(0, 1, 0);
      const origin =
        perspectiveRef.current === 'first'
          ? hands.muzzle(tool)
          : pos
            .clone()
            .add(
              new T.Vector3(
                Math.cos(player.cameraYaw) * 0.38,
                player.stance === 'lie'
                  ? 0.5
                  : player.stance === 'sit'
                    ? 1.05
                    : 1.5,
                -Math.sin(player.cameraYaw) * 0.38,
              ),
            );
      // Ствол не должен стрелять через препятствие, находящееся ближе центра прицела.
      const muzzleRay = new T.Raycaster(
        camera.position,
        origin.clone().sub(camera.position).normalize(),
        0,
        camera.position.distanceTo(origin),
      );
      const obstruction = muzzleRay
        .intersectObjects(targets, false)
        .find((h) => blocksProjectile(h.object, h.face?.materialIndex));
      if (obstruction) {
        target.copy(obstruction.point);
        origin.copy(camera.position);
        if (obstruction.face)
          normal
            .copy(obstruction.face.normal)
            .transformDirection(obstruction.object.matrixWorld);
      }
      if (tool === 'like') {
        const boardHits = ray.intersectObjects(
          kit.boards.map((b) => b.panel),
          false,
        );
        const boardHit = boardHits.find(
          (h) => h.distance < 75 && h.distance > 0.08,
        );
        if (boardHit && boardHit.uv) {
          const zoneId = (boardHit.object.userData as { zone?: string })?.zone;
          const notes = p.room.state.notes.filter(
            (n) =>
              n.zone === zoneId &&
              !['draw', 'connector', 'frame'].includes(n.kind),
          );
          const cx = boardHit.uv.x * 1024;
          const cy = (1 - boardHit.uv.y) * 512;
          if (cx >= 25 && cx <= 1025 && cy >= 126 && cy <= 494) {
            const col = Math.floor((cx - 25) / 250);
            const row = Math.floor((cy - 126) / 184);
            if (col >= 0 && col < 4 && row >= 0 && row < 2) {
              const noteIdx = col + row * 4;
              const targetNote = notes.slice(0, 8)[noteIdx];
              if (targetNote) {
                void p.onOp?.({ type: 'vote', id: targetNote.id, force: true });
                setPersonalAlert({
                  text: '💖 +1 ГОЛОС!',
                  sub: targetNote.text
                    ? `"${targetNote.text.slice(0, 30)}"`
                    : 'Стикер',
                  type: 'assist',
                  key: Date.now(),
                });
                burst(boardHit.point, '#ff647c', now, 'hearts');
              }
            }
          }
        }
      }
      const color =
        tool === 'like'
          ? '#ff647c'
          : tool === 'grenade'
            ? GRENADES.find((g) => g.id === selection.current.grenadeStyle)!.color
            : tool === 'confetti'
              ? CONFETTI.find((c) => c.id === selection.current.confettiStyle)!.color
              : tool === 'sniper'
                ? FIREWORKS.find((f) => f.id === selection.current.fireworkStyle)!.color
                : p.paintColor;
      const variant =
        tool === 'like'
          ? 'hearts'
          : tool === 'grenade'
            ? selection.current.grenadeStyle
            : tool === 'confetti'
              ? selection.current.confettiStyle
              : tool === 'sniper'
                ? selection.current.fireworkStyle
                : 'classic';
      const isScoped = tool === 'sniper' ? !!aimHeld : undefined;
      const isNoScope = tool === 'sniper' ? !aimHeld : undefined;
      const e: WorldEffect = {
        id: uid(),
        kind: tool,
        origin: origin.toArray(),
        target: target.toArray(),
        normal: normal.toArray(),
        color,
        variant,
        author: p.room.self,
        at: Date.now(),
        scoped: isScoped,
        noScope: isNoScope,
      };
      spawn(e);
      if (tool === 'confetti') {
        const dir = target.clone().sub(origin).normalize();
        const perpX = new T.Vector3()
          .crossVectors(dir, new T.Vector3(0, 1, 0))
          .normalize();
        if (perpX.lengthSq() < 0.01) perpX.set(1, 0, 0);
        const perpY = new T.Vector3().crossVectors(perpX, dir).normalize();
        const dist = origin.distanceTo(target);

        const coneHalfAngle = 0.082;
        for (let s = 0; s < 8; s++) {
          const [ang, rFrac] = SHOTGUN_PELLET_OFFSETS[s];
          const spreadRadius = Math.tan(coneHalfAngle) * rFrac;
          const spreadDir = dir
            .clone()
            .addScaledVector(perpX, Math.cos(ang) * spreadRadius)
            .addScaledVector(perpY, Math.sin(ang) * spreadRadius)
            .normalize();
          const pelletTarget = origin.clone().addScaledVector(spreadDir, dist);
          const pelletBall = projectiles.ball(color, paintDropletGeo);
          pelletBall.position.copy(origin);
          pelletBall.userData.transientProjectile = true;
          scene.add(pelletBall);
          flights.push({
            mesh: pelletBall,
            origin: origin.clone(),
            target: pelletTarget,
            normal: normal.clone(),
            born: performance.now(),
            duration: Math.max(65, dist * 16),
            variant,
            color,
            kind: 'confetti',
            author: p.room.self,
          });
        }
      }
      avatarShoot(avatar);
      hands.shoot(tool);
      prediction.current.remember(e.id, 'fire', isBlaster(tool) ? tool : undefined, now);
      void p.onFire(e).then((reply) => {
        applyWeaponReply(reply);
        if (!reply.ok && !weaponDisposed) setCaptureError('Выстрел не принят: ' + (reply.reason ?? 'состояние комнаты'));
      }).catch((error) => weaponFailure(e.id, error));
      if (tool === 'sniper' && magazine.current.rounds.sniper === 0) beginReload();
      shotsFired++;
      if (now - lastShotsFlush >= 500) {
        lastShotsFlush = now;
        setShots(shotsFired);
      }
    };
    const capture = () => {
      // Клик по миру — жест игрока: теперь браузер разрешит звук шагов.
      footsteps.resume();
      weaponSounds.resume();
      if (latest.current.blocked || document.pointerLockElement === canvas)
        return;
      canvas.focus();
      setCaptureError('');
      const fallback = () => {
        softLook = true;
        activeControl = true;
        setActive(true);
        setCaptureError(
          'Захват мыши недоступен · зажмите кнопку мыши, чтобы осмотреться · Esc — курсор',
        );
      };
      skipNextMove = true;
      try {
        if (!canvas.requestPointerLock)
          throw new Error('Захват мыши недоступен');
        const result = canvas.requestPointerLock();
        void Promise.resolve(result).catch(fallback);
      } catch {
        fallback();
      }
    };
    engine.current = {
      visuals,
      restyle: (state) => {
        lightScene(() => kit.update(state, dayMix(state, latest.current.now)));
        visuals.invalidate();
      },
      setDayMix: (mix) => {
        lightScene(() => kit.setDayMix(mix));
        // Пакет ставит свой свет поверх базового, а сутки его только что сбросили.
        visuals.relight();
      },
      capture,
      player,
      closeInventory: (resume = true) => {
        middle = false;
        setRadial(false);
        setContextWheel(false);
        if (resume) capture();
        else {
          activeControl = false;
          softLook = false;
          setActive(false);
          clear();
        }
      },
      openContext: () => {
        middle = true;
        setContextWheel(true);
        setRadial(false);
        clear();
        // Захват мыши сохраняется: сектор выбирается движением мыши, а камера
        // не дёргается от повторного захвата при закрытии меню.
      },
      openInventory: () => {
        setContextWheel(false);
        middle = true;
        setRadial(true);
        clear();
        softLook = false;
        activeControl = false;
        setActive(false);
        if (document.pointerLockElement) document.exitPointerLock();
      },
      pause: () => {
        softLook = false;
        activeControl = false;
        clear();
        setActive(false);
      },
      kit,
      fire: spawn,
      refreshTargets: rebuildSceneryTargets,
      orbit: (d) => {
        player.cameraYaw = wrapAngle(player.cameraYaw + d);
        canvas.focus();
      },
      shadow: () => {
        renderer.shadowMap.needsUpdate = true;
      },
      distance: (d) => {
        distance = T.MathUtils.clamp(distance + d, 3, 17);
      },
      reset: () => {
        player.cameraYaw = player.heading;
        player.pitch = perspectiveRef.current === 'first' ? 0 : 0.16;
        distance = 6.5;
        canvas.focus();
      },
      keys,
    };
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setSize(width, Math.max(height, 1));
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      composer?.setSize(width, Math.max(height, 1));
      weather.resize(Math.max(height, 1) * renderer.getPixelRatio(), camera.fov);
      fxaa.uniforms.resolution.value.set(1 / (width * renderer.getPixelRatio()), 1 / (Math.max(height, 1) * renderer.getPixelRatio()));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    const enabled = () =>
      document.pointerLockElement === canvas ||
      (activeControl &&
        !(document.activeElement as HTMLElement | null)?.closest(
          'input,textarea,select,[role=dialog],[role=combobox],[role=listbox],[role=menu]',
        ));
    const clear = () => {
      keys.clear();
      left = false;
      continuousShots = 0;
      if (grenadeAiming) {
        grenadeAiming = false;
        trajectoryLine.visible = false;
        landingMarker.visible = false;
      }
      aimHeld = false;
      setAiming(false);
      player.releaseCrouch();
    };
    // Табло счёта: удержание «ё» — показать, ЛКМ при зажатой «ё» — залипание.
    const releaseScoreHold = () => {
      if (!scoreHeldRef.current) return;
      scoreHeldRef.current = false;
      if (!scorePinnedRef.current) latest.current.onMonitor(false);
    };
    const pinScore = () => {
      scoreHeldRef.current = false;
      scorePinnedRef.current = true;
      setScorePinned(true);
      latest.current.onMonitor(true);
      // Единственное место, кроме Esc, где курсор освобождается намеренно:
      // по табло надо кликать (например сменить сторону).
      if (document.pointerLockElement) document.exitPointerLock();
      softLook = false;
      activeControl = false;
      setActive(false);
      clear();
    };
    const closeScore = () => {
      scoreHeldRef.current = false;
      scorePinnedRef.current = false;
      setScorePinned(false);
      latest.current.onMonitor(false);
    };
    const onBlur = () => {
      // Окно потеряло фокус — keyup по «ё» не придёт, табло зависло бы открытым.
      releaseScoreHold();
      clear();
    };
    const onKey = (e: KeyboardEvent) => {
      // Сочетания с Ctrl / Alt / Cmd принадлежат браузеру и системе: Ctrl+W
      // закрывает вкладку, Ctrl+T открывает новую, Ctrl+R перезагружает,
      // Alt+F4 закрывает окно. Перехватить их со страницы нельзя, поэтому
      // игра на них просто не реагирует — иначе служебная комбинация вдобавок
      // дёргала бы игрока. Игровые клавиши работают только без модификаторов.
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (
        (e.code === 'KeyQ' || e.code === 'KeyI') &&
        !e.repeat &&
        !latest.current.blocked &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !(e.target as HTMLElement | null)?.closest(
          'input,textarea,select,[contenteditable=true]',
        )
      ) {
        e.preventDefault();
        if (middle) {
          engine.current?.closeInventory();
        } else {
          engine.current?.openInventory();
        }
        return;
      }
      if (e.code === 'Escape') {
        if (scorePinnedRef.current || scoreHeldRef.current) {
          const wasPinned = scorePinnedRef.current;
          closeScore();
          // Залипшее табло Esc снимает и возвращает игрока к управлению;
          // остальное (пауза, освобождение курсора) — как обычно.
          if (wasPinned) {
            e.preventDefault();
            capture();
            return;
          }
        }
        if (tabletInWorldRef.current) {
          e.preventDefault();
          closeTabletInWorld();
          return;
        }
        middle = false;
        setRadial(false);
        setContextWheel(false);
        engine.current?.pause();
        if (document.pointerLockElement) document.exitPointerLock();
        return;
      }
      if ((!enabled() && !middle) || latest.current.blocked) return;
      if (middle) {
        const slot = slotForDigit(modeOf(latest.current.room.state), e.code);
        if (slot !== undefined) {
          e.preventDefault();
          latest.current.onTool(slot);
          engine.current?.closeInventory();
        }
        return;
      }
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'Space',
          'KeyC',
          'KeyX',
          'ShiftLeft',
          'ShiftRight',
          'Tab',
          'Backquote',
          'KeyE',
          'KeyF',
          'KeyV',
          'KeyR',
          'KeyZ',
          'KeyM',
          'KeyT',
          'KeyY',
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          ...Array.from({ length: 10 }, (_, i) => 'Digit' + i),
        ].includes(e.code)
      )
        e.preventDefault();
      keys.add(e.code);
      if (e.repeat) return;
      // Удержание: табло видно, пока «ё» зажата. Нужны кнопки в табло —
      // ЛКМ при зажатой «ё» залипает (см. onDown), снимается по Esc.
      if (e.code === 'Backquote' || e.key === 'ё' || e.key === 'Ё') {
        if (
          !scorePinnedRef.current &&
          !(document.activeElement as HTMLElement | null)?.closest(
            'input,textarea,select,[contenteditable=true]',
          )
        ) {
          scoreHeldRef.current = true;
          latest.current.onMonitor(true);
        }
      }
      if (e.code === 'KeyR') beginReload();
      // План по M разворачивается и сворачивается и живым, и убитым: смотреть
      // карту в ожидании возрождения — обычное дело.
      if (e.code === 'KeyM') setMapExpanded((v) => !v);
      if (e.code === 'KeyX') player.holdCrouch();
      if (isDead()) return;
      if (e.code === 'Space') player.jump();
      if (e.code === 'KeyC') player.toggleStance(performance.now());
      if (e.code === 'KeyE' && nearZone) {
        // Курсор освободит сам диалог карточки (эффект на props.blocked):
        // лишний exitPointerLock здесь возвращал мышь даже без диалога.
        latest.current.onUseTool(nearZone);
        clear();
      }
      // F занял фонарик — привычная по шутерам клавиша, и нажимают её в бою
      // куда чаще, чем выравнивают камеру. Сброс угла обзора переехал на Z:
      // соседняя с WASD свободная клавиша, до которой дотягивается та же рука.
      // Проверка на Ctrl/Alt/Cmd выше по обработчику остаётся общей для обеих.
      if (e.code === 'KeyZ') engine.current?.reset();
      if (e.code === 'KeyF') {
        flashlightOn = flashlight.toggle();
        localBeam.set(flashlightOn && !isDead(), player.pitch);
        weaponSounds.click(flashlightOn, [0, 0, 0], true, weaponVolume());
      }
      if (e.code === 'KeyV')
        choosePerspective(
          perspectiveRef.current === 'first' ? 'third' : 'first',
        );
      // Рация: пока клавиша зажата, голос идёт своим (T) или всем (Y).
      // Разговор не зависит от того, жив ли игрок: мёртвому тем более есть что
      // сказать команде, и молчать в ожидании возрождения незачем.
      if (e.code === 'KeyT') latest.current.onTalk?.('team', true);
      if (e.code === 'KeyY') latest.current.onTalk?.('all', true);
      if (e.code.startsWith('Digit')) {
        const slot = slotForDigit(modeOf(latest.current.room.state), e.code);
        if (slot !== undefined) {
          latest.current.onTool(slot);
          aimHeld = false;
          setAiming(false);
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
      if (e.code === 'Backquote' || e.key === 'ё' || e.key === 'Ё')
        releaseScoreHold();
      // Отпускание обрабатываем и с модификаторами: иначе приседание залипло бы
      // после X + случайно нажатого Ctrl. По той же причине — и рация: зажатая
      // T плюс случайный Alt оставили бы микрофон открытым.
      if (e.code === 'KeyX') player.releaseCrouch();
      if (e.code === 'KeyT') latest.current.onTalk?.('team', false);
      if (e.code === 'KeyY') latest.current.onTalk?.('all', false);

    };
    const onMouse = (e: MouseEvent) => {
      const b = canvas.getBoundingClientRect();
      mouse.set(
        ((e.clientX - b.left) / b.width) * 2 - 1,
        (-(e.clientY - b.top) / b.height) * 2 + 1,
      );
      if (latest.current.blocked || middle) return;
      // Без захвата мыши камера вращается только при зажатой кнопке (drag-look):
      // прежний «обзор по краям экрана» сам уводил камеру в сторону.
      if (document.pointerLockElement === canvas || (softLook && dragLook)) {
        // Браузер иногда отдаёт один огромный movement — сразу после захвата
        // мыши, после сворачивания окна или скачка курсора. Такое событие
        // нужно отбросить целиком: обрезанный до предела скачок — это тот же
        // рывок камеры, только на 25° вместо 50°.
        if (skipNextMove) {
          skipNextMove = false;
          return;
        }
        if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
        const mx = T.MathUtils.clamp(e.movementX, -180, 180);
        const my = T.MathUtils.clamp(e.movementY, -180, 180);
        // Scale sensitivity down when sniper is scoped
        const tool = GAME_TOOLS[latest.current.tool]?.id;
        const isSniperZoom = tool === 'sniper' && aimHeld;
        const zoomScale = isSniperZoom
          ? Math.max(0.12, 1 / (SNIPER_ZOOM_LEVELS[sniperZoomIndexRef.current] * 0.75))
          : 1;
        const sens = latest.current.sensitivity * zoomScale;
        player.cameraYaw = wrapAngle(player.cameraYaw - mx * 0.0023 * sens);
        player.pitch = T.MathUtils.clamp(
          player.pitch +
          my *
          0.002 *
          sens *
          (latest.current.invertCamera ? -1 : 1),
          -1.35,
          1.4,
        );
      }
    };
    const wheel = (e: WheelEvent) => {
      if (latest.current.blocked || middle || !enabled()) return;
      e.preventDefault();
      canvas.focus();
      const tool = GAME_TOOLS[latest.current.tool]?.id;
      if (tool === 'sniper' && aimHeld) {
        if (e.deltaY < 0) {
          setSniperZoomIndex((i) =>
            Math.min(i + 1, SNIPER_ZOOM_LEVELS.length - 1),
          );
        } else if (e.deltaY > 0) {
          setSniperZoomIndex((i) => Math.max(i - 1, 0));
        }
        return;
      }
      if (e.altKey) engine.current?.distance(e.deltaY > 0 ? 1 : -1);
      else {
        const next = cycleSlot(
          modeOf(latest.current.room.state),
          latest.current.tool,
          e.deltaY > 0 ? 1 : -1,
        );
        latest.current.onTool(next);
        aimHeld = false;
        setAiming(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (latest.current.blocked || middle) return;
      // Залипшее табло: мимо него по миру не стреляем и захват не возвращаем —
      // выход только по Esc.
      if (scorePinnedRef.current) {
        e.preventDefault();
        return;
      }
      // «Ё» зажата и щёлкнули ЛКМ — табло остаётся на экране вместе с курсором.
      if (e.button === 0 && scoreHeldRef.current) {
        e.preventDefault();
        pinScore();
        return;
      }
      canvas.focus();
      // Пока кнопка зажата, события мыши приходят даже за пределами окна —
      // курсор больше не «выскакивает» с экрана посреди прицеливания.
      if (e.button === 0 || e.button === 2) {
        dragLook = true;
        try {
          canvas.setPointerCapture?.(
            (e as MouseEvent & { pointerId?: number }).pointerId ?? 1,
          );
        } catch {
          // Старый браузер без pointer capture: обзор всё равно работает.
        }
      }
      if (e.button === 1) {
        e.preventDefault();
        engine.current?.openContext();
      } else if (e.button === 2) {
        e.preventDefault();
        if (!enabled()) {
          capture();
          return;
        }
        const tool = GAME_TOOLS[latest.current.tool]?.id;
        if (tool === 'paint' || tool === 'confetti' || tool === 'sniper') {
          if (magazine.current.reloading) return;
          if (tool === 'sniper' && magazine.current.rounds.sniper === 0) {
            aimHeld = false;
            setAiming(false);
            beginReload();
            return;
          }
          const mode = aimModesRef.current[tool as keyof WeaponAimModes] || 'hold';
          if (mode === 'toggle') {
            aimHeld = !aimHeld;
          } else {
            aimHeld = true;
          }
          setAiming(aimHeld);
        }
      } else if (e.button === 0) {
        if (document.pointerLockElement !== canvas && !softLook) {
          capture();
          return;
        }
        left = true;
        const t = GAME_TOOLS[latest.current.tool]?.id;
        if (t === 'grenade') {
          grenadeAiming = true;
          trajectoryLine.visible = true;
          landingMarker.visible = true;
        } else if (
          t === 'paint' ||
          t === 'confetti' ||
          t === 'sniper' ||
          t === 'like'
        ) {
          shoot();
        } else if (t === 'flashlight') {
          flashlightOn = flashlight.toggle();
          localBeam.set(flashlightOn && !isDead(), player.pitch);
          weaponSounds.click(flashlightOn, [0, 0, 0], true, weaponVolume());
        } else if (t === 'pointer') {
          // В «Предателе» планшет — пустые руки: доска ретро в этом режиме не нужна.
          if (modeOf(latest.current.room.state) === 'impostor') return;
          if (tabletInWorldRef.current) closeTabletInWorld();
          else openTabletInWorld();
        } else if (t === 'sticky') {
          latest.current.onUseTool(selection.current.tabletZone || nearZone);
          clear();
        } else {
          ray.setFromCamera(
            document.pointerLockElement || softLook ? new T.Vector2() : mouse,
            camera,
          );
          const hit = ray.intersectObjects(kit.boards.map((b) => b.panel))[0];
          if (hit) {
            latest.current.onUseTool(hit.object.userData.zone);
            clear();
          } else if (t === 'reaction') latest.current.onAction('reaction');
          else if (nearZone) {
            latest.current.onUseTool(nearZone);
            clear();
          }
        }
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 2) {
        dragLook = false;
        try {
          canvas.releasePointerCapture?.(
            (e as MouseEvent & { pointerId?: number }).pointerId ?? 1,
          );
        } catch {
          // Захват мог не начаться — освобождать нечего.
        }
      }
      if (e.button === 0) {
        left = false;
        continuousShots = 0;
        if (grenadeAiming) {
          grenadeAiming = false;
          trajectoryLine.visible = false;
          landingMarker.visible = false;
          shoot();
        }
      }
      if (e.button === 2) {
        const tool = GAME_TOOLS[latest.current.tool]?.id;
        const mode = (tool && aimModesRef.current[tool as keyof WeaponAimModes]) || 'hold';
        if (mode === 'hold') {
          aimHeld = false;
          setAiming(false);
        }
      }
    };
    const changed = () => {
      const captured = document.pointerLockElement === canvas;
      activeControl = captured;
      setLocked(captured);
      setActive(captured);
      if (captured) skipNextMove = true;
      else {
        softLook = false;
        dragLook = false;
        clear();
      }
    };
    const context = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('mousemove', onMouse);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', changed);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('contextmenu', context);
    canvas.addEventListener('auxclick', context);
    canvas.addEventListener('webglcontextlost', context);
    let life =
      latest.current.room.members.find((m) => m.id === latest.current.room.self)
        ?.life || 0;
    let positionRevision = latest.current.room.members.find((m) => m.id === latest.current.room.self)?.positionRevision ?? 0;
    let nextFrame = 0;
    let appliedGraphics = '';
    let smoothExposure = renderer.toneMappingExposure;
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const frameInterval = 1000 / latest.current.fpsLimit;
      if (now + 0.8 < nextFrame) return;
      nextFrame += frameInterval;
      if (nextFrame < now - frameInterval) nextFrame = now + frameInterval;
      const elapsed = Math.max(0, (now - last) / 1000);
      const dt = Math.min(0.06, elapsed);
      last = now;
      if (document.hidden) return;
      frames++;
      if (now - fpsAt > 1000) {
        latest.current.onFps(Math.round((frames * 1000) / (now - fpsAt)));
        frames = 0;
        fpsAt = now;
        // Readable diagnostics for graphics QA; no access to room/game state.
        canvas.dataset.drawCalls = String(renderer.info.render.calls);
        canvas.dataset.triangles = String(renderer.info.render.triangles);
        canvas.dataset.textures = String(renderer.info.memory.textures);
        canvas.dataset.packTextureMib = (visuals.textureBytes / 1048576).toFixed(1);
      }
      const own = latest.current.room.members.find(
        (m) => m.id === latest.current.room.self,
      );
      if ((own?.life || 0) !== life) {
        life = own?.life || 0;
        prediction.current.reset(life);
        sendWeaponControl('sync');
        player.teleport(own?.pose.x ?? 0, own?.pose.y ?? 0, own?.pose.z ?? 4);
        clear();
      }
      if (own && (own.positionRevision ?? 0) !== positionRevision) {
        positionRevision = own.positionRevision ?? 0;
        player.correctPosition(own.pose);
      }
      if (isDead()) clear();
      // Cheap safety net: content packs can resync scenery outside the
      // explicit rebuild hooks below, so refresh the shot-target cache at a
      // low, bounded rate rather than never (or every frame/shot).
      if (now - lastSceneryTargetRebuild > 1500) {
        lastSceneryTargetRebuild = now;
        rebuildSceneryTargets();
      }
      setAvatarAnonymous(avatar, !!latest.current.room.state.anonymousPlayers);
      if (equippedTool !== latest.current.tool) {
        equippedTool = latest.current.tool;
        magazine.current.cancel();
        sendWeaponControl('cancel');
        aimHeld = false;
        setAiming(false);
        updateAmmo();
      }
      if (magazine.current.tick(now)) updateAmmo();
      aimBlend = T.MathUtils.lerp(
        aimBlend,
        aimHeld && !latest.current.blocked ? 1 : 0,
        1 - Math.exp(-18 * dt),
      );
      if (left && enabled() && !middle && !latest.current.blocked) {
        const t = GAME_TOOLS[latest.current.tool]?.id;
        if (t === 'paint') shoot();
      }
      if (grenadeAiming && GAME_TOOLS[latest.current.tool]?.id === 'grenade') {
        ray.setFromCamera(
          document.pointerLockElement || softLook ? new T.Vector2(0, 0) : mouse,
          camera,
        );
        const trajTargets: T.Mesh[] = [];
        for (const o of sceneryTargetCache)
          if (
            visibleInWorld(o) &&
            o.geometry.type !== 'SphereGeometry' &&
            o.geometry.type !== 'ShapeGeometry'
          )
            trajTargets.push(o);
        for (const o of gatherRemoteAvatarMeshes())
          if (
            visibleInWorld(o) &&
            o.geometry.type !== 'SphereGeometry' &&
            o.geometry.type !== 'ShapeGeometry'
          )
            trajTargets.push(o);
        const hit = ray
          .intersectObjects(trajTargets, false)
          .find((h) => h.distance < 50 && h.distance > 0.1);
        const arcTarget = hit ? hit.point : ray.ray.at(25, new T.Vector3());
        const arcOrigin =
          perspectiveRef.current === 'first'
            ? hands.group.localToWorld(new T.Vector3(0, 0.025, -0.69))
            : pos.clone().add(new T.Vector3(0, 1.4, 0));

        const pts: T.Vector3[] = [];
        for (let k = 0; k <= 24; k++) {
          const t = k / 24;
          const pt = arcOrigin.clone().lerp(arcTarget, t);
          pt.y += Math.sin(t * Math.PI) * 3;
          pts.push(pt);
        }
        trajectoryLine.geometry.setFromPoints(pts);
        trajectoryLine.visible = true;

        landingMarker.position.copy(arcTarget);
        if (hit?.face) {
          const norm = hit.face.normal
            .clone()
            .transformDirection(hit.object.matrixWorld);
          landingMarker.position.addScaledVector(norm, 0.02);
          landingMarker.quaternion.setFromUnitVectors(
            new T.Vector3(0, 0, 1),
            norm,
          );
        } else {
          landingMarker.position.y = Math.max(0.02, arcTarget.y);
          landingMarker.quaternion.setFromUnitVectors(
            new T.Vector3(0, 0, 1),
            new T.Vector3(0, 1, 0),
          );
        }
        landingMarker.visible = true;
      } else if (trajectoryLine.visible) {
        trajectoryLine.visible = false;
        landingMarker.visible = false;
      }
      // Подготовка раунда: сервер всё равно не примет шаг, поэтому и локально
      // игрок стоит — иначе картинка «уезжает», а потом возвращается назад.
      const frozen =
        latest.current.room.match?.phase === 'freeze' ||
        impostorFrozen(latest.current.room.impostor) ||
        inVentNow(latest.current.room.impostor);
      const control =
        enabled() && !latest.current.blocked && !middle && !isDead() && !frozen;
      const { moving, speed, dx, dz, groundY } = player.advance(elapsed, {
        control,
        aimHeld,
      });
      avatar.position.copy(pos);
      avatar.position.y += 0.27;
      avatar.rotation.y = player.heading;
      visionEye.copy(pos);
      syncBodies();

      const myMember = latest.current.room.members.find(
        (m) => m.id === latest.current.room.self,
      );
      const myHp = myMember?.hp ?? 100;
      if (myHp === 0) {
        if (!deadTimers.has(latest.current.room.self)) {
          deadTimers.set(latest.current.room.self, now);
        }
      } else {
        deadTimers.delete(latest.current.room.self);
      }
      const myDeathTime = deadTimers.get(latest.current.room.self);
      const isMyDeathRecent = myHp === 0 && now - (myDeathTime || now) < 3800;

      animateAvatar(
        avatar,
        {
          speed: moving ? speed : 0,
          strafe: dx,
          forward: -dz,
          airborne: Math.abs(pos.y - groundY) > 0.03,
          velocityY: player.vy,
          stance: player.stance,
          tool: GAME_TOOLS[latest.current.tool]?.id || 'pointer',
          variant: selection.current.grenadeStyle,
          pitch: player.pitch,
          working: latest.current.working,
          crouching: player.crouching,
          aiming: aimHeld,
          reload: magazine.current.progress(now),
          inventory: middle,
          hp: myHp,
        },
        dt,
        now / 1000,
      );
      shadow.position.set(pos.x, groundY + 0.02, pos.z);
      shadow.scale.setScalar(Math.max(0.5, 1 - (pos.y - groundY) * 0.1));
      viewHeight = T.MathUtils.lerp(
        viewHeight,
        eyeHeight(player.stance),
        1 - Math.exp(-10 * dt),
      );
      const mode = perspectiveRef.current;
      const view = cameraFrame(
        pos,
        player.cameraYaw,
        player.pitch,
        viewHeight,
        mode,
        distance,
      );
      if (mode === 'first') {
        camera.position.copy(view.position);
        currentCamDist = 0.01;
        obstacleHoldTimer = 0;
      } else {
        const desired = avoidCameraWalls(
          view.eye,
          view.position,
          cameraObstacles,
          // Ближе персонаж закрывает весь экран, а его самого уже не видно.
          1.45,
        );
        const hitDist = desired.distanceTo(view.eye);
        const fullDist = view.position.distanceTo(view.eye);
        const isObstructed = hitDist < fullDist - 0.05;

        if (isObstructed) {
          if (hitDist < currentCamDist) {
            // Rapidly tuck camera in to avoid clipping into wall
            currentCamDist = T.MathUtils.damp(currentCamDist, hitDist, 24, dt);
          } else {
            // Camera wants to move further away: apply gentle damping
            currentCamDist = T.MathUtils.damp(currentCamDist, hitDist, 14, dt);
          }
          obstacleHoldTimer = 0.08; // 80ms hysteresis hold to avoid edge flickers
        } else {
          if (obstacleHoldTimer > 0) {
            obstacleHoldTimer -= dt;
          } else {
            // Smoothly ease back out to full distance
            currentCamDist = T.MathUtils.damp(currentCamDist, fullDist, 9, dt);
          }
        }
        scratchCamDir.copy(view.position).sub(view.eye).normalize();
        camera.position.copy(view.eye).addScaledVector(scratchCamDir, currentCamDist);
      }
      camera.lookAt(
        scratchLookTarget.copy(camera.position).addScaledVector(view.direction, 30),
      );
      avatar.visible = mode === 'third' && (!isDead() || isMyDeathRecent);
      shadow.visible = mode === 'third' && (!isDead() || isMyDeathRecent);
      {
        const spectral = amGhost(latest.current.room.impostor);
        if (spectral && !localGhost) localGhost = createGhostForm(avatar.userData.color ?? '#9fb7ff');
        if (localGhost) {
          setGhostLook(avatar, localGhost, spectral, [localBeam.group]);
          if (spectral) {
            const me = latest.current.room.members.find((m) => m.id === latest.current.room.self);
            if (me?.color) localGhost.setColor(me.color);
            localGhost.animate(now / 1000, moving);
          }
        }
        // У призрака нет тени: он парит и светится сам.
        if (spectral) shadow.visible = false;
      }
      // (shield aura removed — immunity is HUD-only now)
      if (localBandanaMat) {
        if (now - lastLocalSkinRead > 400) {
          lastLocalSkinRead = now;
          readLocalSkinPrefs();
        }
        const myMember = latest.current.room.members.find((m) => m.id === latest.current.room.self);
        const localSkinId = myMember?.hat || cachedLocalSkinId;
        const localBandanaColor = myMember?.color || cachedLocalBandanaColor;
        if (
          localSkinId !== appliedLocalSkinId ||
          localBandanaColor !== appliedLocalBandanaColor
        ) {
          appliedLocalSkinId = localSkinId;
          appliedLocalBandanaColor = localBandanaColor;
          applyAvatarSkin(avatar, localSkinId, localBandanaColor, localBandanaMat);
        }
      }
      hands.update(
        dt,
        now / 1000,
        moving ? speed : 0,
        GAME_TOOLS[latest.current.tool]?.id || 'other',
        GAME_TOOLS[latest.current.tool]?.id === 'confetti'
          ? CONFETTI.find((c) => c.id === selection.current.confettiStyle)!
            .color
          : GAME_TOOLS[latest.current.tool]?.id === 'sniper'
            ? FIREWORKS.find((f) => f.id === selection.current.fireworkStyle)!
              .color
            : GAME_TOOLS[latest.current.tool]?.id === 'sticky'
              ? ZONES.find((z) => z.id === selection.current.tabletZone)?.color || '#8db9a1'
              : latest.current.paintColor,
        mode === 'first' && !middle && !latest.current.working && !isDead(),
        aimBlend,
        magazine.current.progress(now),
        GAME_TOOLS[latest.current.tool]?.id === 'pointer' ||
          GAME_TOOLS[latest.current.tool]?.id === 'sticky'
          ? selection.current.tabletZone
          : selection.current.grenadeStyle,
        tabletInspectRef.current,
        selection.current.paintSight,
      );
      const sniperFov = SNIPER_ZOOM_FOVS[sniperZoomIndexRef.current];
      const baseTargetFov =
        GAME_TOOLS[latest.current.tool]?.id === 'sniper'
          ? mode === 'first'
            ? sniperFov
            : sniperFov + 6
          : mode === 'first'
            ? 56
            : 50;
      const targetFov =
        tabletInspectRef.current > 0
          ? T.MathUtils.lerp(mode === 'first' ? 80 : 68, 52, tabletInspectRef.current)
          : baseTargetFov;
      const fov = T.MathUtils.lerp(
        camera.fov,
        tabletInspectRef.current > 0
          ? targetFov
          : T.MathUtils.lerp(
            mode === 'first' ? 80 : 68,
            targetFov,
            aimBlend,
          ),
        1 - Math.exp(-8 * dt),
      );
      if (Math.abs(fov - camera.fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      let nearest = '';
      for (let i = 0; i < kit.stations.length; i++) {
        if (latest.current.room.state.template === 'three' && i === 1) continue;
        const [x, z] = kit.stations[i];
        if (Math.hypot(pos.x - x, pos.z - z) < 6) nearest = ZONES[i].id;
      }
      if (nearest !== nearZone) {
        nearZone = nearest;
        setNear(nearest);
      }
      // Луч на своём аватаре идёт за взглядом: его видят остальные, значит и
      // направление должно совпадать с тем, куда игрок смотрит.
      const heldTool = GAME_TOOLS[latest.current.tool]?.id || 'pointer';
      localBeam.set(flashlightOn && !isDead() && !amGhost(latest.current.room.impostor), player.pitch, heldTool);
      if (flashlightOn) {
        // Свет — от дула того оружия, что видно на экране: в первом лице это
        // оружие в руках, в третьем — оружие аватара.
        if (mode === 'first') {
          hands.group.updateWorldMatrix(true, false);
          flashlightOrigin.copy(hands.muzzle(heldTool));
        } else if (avatarGun) avatarMuzzle(avatarGun, heldTool, flashlightOrigin);
        else avatar.localToWorld(flashlightOrigin.set(0.2, 1.5, -0.12));
        flashlight.aim(flashlightOrigin, camera.getWorldDirection(flashlightDirection));
      }
      remotePlayers.update(now, dt);
      // Шаги во всех режимах: в бою и в «Предателе» на слух узнают, что кто-то идёт за
      // поворотом. Призраки «Предателя» парят беззвучно — и сам призрак, и чужие (их видят
      // только другие призраки); павшие в бою тоже не шагают. В хабе шаги тише.
      {
        const room = latest.current.room;
        const impostorView = room.impostor;
        const partyGhost = (id: string) => {
          if (!inGame(impostorView)) return false;
          const p = impostorView.players.find((x) => x.id === id);
          return !p || !p.alive;
        };
        const others = [];
        for (const m of room.members) {
          if (m.id === room.self || m.hp === 0 || partyGhost(m.id)) continue;
          const avatarOf = remoteAvatars.get(m.id);
          if (!avatarOf) continue;
          const at = avatarOf.position;
          // Луч до стены считаем только для слышимых: дальние шаги всё равно отбрасываются.
          const near = Math.hypot(at.x - pos.x, at.z - pos.z) <= 16;
          // Чужой фонарик щёлкает там, где его включили; первый снимок игрока — не щелчок.
          const light = !!m.pose.light;
          const before = remoteLights.get(m.id);
          remoteLights.set(m.id, light);
          if (before !== undefined && before !== light)
            weaponSounds.click(light, [at.x, at.y + 1.4, at.z], false, weaponVolume());
          others.push({
            id: m.id,
            x: at.x,
            y: at.y,
            z: at.z,
            speed: m.pose.moving ? (m.pose.speed ?? 3.4) : 0,
            occluded:
              near && !!rayCastWorldObstacle([pos.x, pos.y + 1.5, pos.z], [at.x, at.y + 1.2, at.z], map.colliders)?.hit,
          });
        }
        footsteps.update(
          {
            x: pos.x,
            y: pos.y,
            z: pos.z,
            yaw: player.cameraYaw,
            speed: moving ? speed : 0,
            grounded: Math.abs(pos.y - groundY) < 0.15 && !amGhost(impostorView) && !isDead(),
          },
          others,
          modeOf(room.state) === 'retro' ? 0.5 : 1,
        );
      }
      projectiles.update(now, player.stance);
      vfx.update(now, dt);
      if (now - poseAt > 120) {
        latest.current.onPose({
          // The life this pose belongs to: until the engine has moved us to a new spawn,
          // the server keeps ignoring poses of the previous life.
          life,
          x: pos.x,
          z: pos.z,
          y: pos.y,
          yaw: player.heading,
          stance: player.stance,
          moving,
          speed: moving ? speed : 0,
          strafe: dx,
          forward: -dz,
          pitch: player.pitch,
          tool: [
            'paint',
            'confetti',
            'grenade',
            'sniper',
            'sticky',
            'pointer',
            'flashlight',
          ].includes(GAME_TOOLS[latest.current.tool]?.id)
            ? GAME_TOOLS[latest.current.tool].id
            : 'other',
          variant: selection.current.grenadeStyle,
          working: latest.current.working || middle,
          crouching: player.crouching,
          aiming: aimHeld,
          reload: magazine.current.progress(now),
          light: flashlightOn,
        });
        poseAt = now;
      }
      kit.clouds.position.x = Math.sin(now * 0.000015) * 2;
      kit.animate(now / 1000);
      kit.view?.(camera.position, dt);
      weather.update(
        dt,
        Date.now() + clockOffset.current,
        camera,
        // Внутри корабля погода всегда ясная: ни тумана, ни пасмурного света.
        indoor
          ? { ...latest.current.room.state, weather: 'clear', weatherTuning: undefined }
          : latest.current.room.state,
        !map.arena && latest.current.room.state.interior,
        pos.y,
      );
      // Обзор «Предателя» — туман на радиусе видимости. Исходные границы тумана карты
      // запоминаем один раз, чтобы вернуть их, когда ограничение снимется.
      // Своё значение держим отдельно: погода каждый кадр пересчитывает туман от того,
      // что видит в сцене, и не даёт ему быть ближе 18 м.
      if (indoor && scene.fog instanceof T.Fog) {
        const radius = visionRadius(latest.current.room.impostor);
        // Туман считается от камеры, а обзор — от игрока: в третьем лице камера позади.
        const behind = camera.position.distanceTo(pos);
        const base = visionFog?.base ?? { near: scene.fog.near, far: scene.fog.far };
        const far = radius === null ? base.far : radius * 1.15 + behind;
        const near = radius === null ? base.near : radius * 0.45 + behind;
        // Первый кадр — сразу на месте (вход посреди аварии), дальше плавно, чтобы авария
        // света гасила свет, а не щёлкала.
        visionFog ??= { base, near, far };
        const k = Math.min(1, dt * 6);
        visionFog.far += (far - visionFog.far) * k;
        visionFog.near += (near - visionFog.near) * k;
        scene.fog.far = visionFog.far;
        scene.fog.near = visionFog.near;
      }
      // Индикатор ветра у прицела: стрелка — куда сносит относительно взгляда,
      // число — скорость. Пишем прямо в DOM: React-рендер каждый кадр не нужен.
      const indicator = windIndicator.current;
      if (indicator) {
        const show = windOn() && !isDead() && !latest.current.blocked;
        indicator.hidden = !show;
        if (show) {
          const wind = weather.wind;
          const relative = windRelative(wind, player.cameraYaw);
          indicator.style.setProperty('--wind-angle', `${relative.angle}rad`);
          indicator.dataset.level = String(windLevel(wind.speed));
          const label = indicator.lastElementChild as HTMLElement | null;
          const text = `${wind.speed.toFixed(1)} м/с · ${beaufort(wind.speed)} б.`;
          if (label && label.textContent !== text) label.textContent = text;
        }
      }
      // Keyed on live remote avatars so the pack re-syncs (and releases removed actors) on add/remove.
      const custom = graphicsRef.current ?? (visuals.id === 'urban-realism' ? GRAPHICS_PRESETS.high : null);
      const graphicsKey = JSON.stringify([custom, visuals.id]);
      if (graphicsKey !== appliedGraphics) {
        appliedGraphics = graphicsKey;
        renderer.setPixelRatio(custom?.scale ?? pixelRatio);
        renderer.shadowMap.enabled = custom ? custom.shadows > 0 : props.quality !== 'low';
        renderer.shadowMap.autoUpdate = renderer.shadowMap.enabled;
        const shadowSize = custom?.shadows || (isCinematic ? 2048 : isBalanced ? 1024 : 512);
        if (kit.sunlight.shadow.mapSize.x !== shadowSize) {
          kit.sunlight.shadow.mapSize.setScalar(shadowSize);
          kit.sunlight.shadow.map?.dispose(); kit.sunlight.shadow.map = null;
          renderer.shadowMap.needsUpdate = true;
        }
        if (!composer && (custom || visuals.active)) {
          composer = new EffectComposer(renderer);
          composer.addPass(new RenderPass(scene, camera));
          composer.addPass(new OutputPass()); composer.addPass(fxaa); composer.addPass(optics);
        }
        if (composer && custom?.bloom && !bloom) {
          bloom = new UnrealBloomPass(new T.Vector2(1,1), .15, .4, .85);
          composer.insertPass(bloom, 1);
        }
        composer?.setPixelRatio(renderer.getPixelRatio());
        resize();
      }
      const meteredExposure = visuals.update(dt, camera, latest.current.room.state, remotePlayers.remoteKey, currentPhase());
      remotePlayers.disposeRetired();
      const desiredExposure = (meteredExposure ?? sceneExposure) * (custom?.exposure ?? 1) * weather.exposure;
      // Молния — вспышка поверх сглаженной экспозиции: сглаживание растянуло бы её в зарево.
      smoothExposure = T.MathUtils.damp(smoothExposure, desiredExposure, 1.6, dt);
      renderer.toneMappingExposure = smoothExposure * weather.flash;
      optics.enabled = visuals.id === 'realistic-bodycam';
      optics.uniforms.time.value = now / 1000;
      fxaa.enabled = custom?.antialias ?? false;
      if (bloom) {
        bloom.enabled = custom ? custom.bloom : isCinematic || isBalanced;
        bloom.strength = visuals.id === 'urban-realism' ? .15 : visuals.active ? visualBudget(props.quality).bloom : latest.current.room.state.visualStyle === 'anime' ? .1 : .22;
      }
      if (composer && (isCinematic || isBalanced || visuals.active || custom)) composer.render(dt);
      else renderer.render(scene, camera);
    };
    camera.position.set(pos.x, 6, pos.z + 8);
    raf = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clear();
      engine.current = null;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', changed);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('contextmenu', context);
      canvas.removeEventListener('auxclick', context);
      canvas.removeEventListener('webglcontextlost', context);
      visuals.dispose();
      scene.traverse((o) => {
        if (
          o instanceof T.Mesh ||
          o instanceof T.Points ||
          o instanceof T.Sprite
        ) {
          if ('geometry' in o) o.geometry.dispose();
          const materials = Array.isArray(o.material)
            ? o.material
            : [o.material];
          materials.forEach((m) => {
            if ('map' in m && m.map) (m.map as T.Texture).dispose();
            m.dispose();
          });
        }
      });
      weaponDisposed = true;
      flashlight.dispose();
      localGhost?.dispose();
      footsteps.dispose();
      weaponSounds.dispose();
      localBeam.dispose();
      projectiles.dispose();
      weather.dispose();
      vfx.dispose();
      trajectoryGeo.dispose();
      trajectoryMat.dispose();
      landingMarker.geometry.dispose();
      (landingMarker.material as T.Material).dispose();
      kit.dispose();
      composer?.passes.forEach((pass) => pass.dispose());
      composer?.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [props.quality, openTabletInWorld, closeTabletInWorld, mapId]);
  useEffect(() => {
    engine.current?.restyle(latest.current.room.state);
    engine.current?.shadow();
    engine.current?.refreshTargets();
  }, [
    props.room.state.theme,
    props.room.state.visualStyle,
    props.room.state.time,
    props.room.state.season,
    props.room.state.interior,
    props.room.state.dayCycle,
  ]);
  // Ход суток: свет пересчитывается по серверным часам раз в секунду вместе с
  // `props.now`. Полный `kit.update` для этого не нужен — он обходит сцену и
  // перекрашивает стили, а по ходу суток меняются только свет, небо и туман.
  // За 3-минутную фазу это 180 шагов, каждый настолько мал, что переход читается
  // как непрерывный.
  const appliedMix = useRef<DayMix | null>(null);
  useEffect(() => {
    const mix = dayMix(props.room.state, props.now);
    if (appliedMix.current && sameMix(mix, appliedMix.current)) return;
    appliedMix.current = mix;
    engine.current?.setDayMix(mix);
  }, [props.now, props.room.state]);
  useEffect(() => {
    engine.current?.kit.setNotes(latest.current.room.state);
  }, [props.room.version]);
  useEffect(() => {
    for (const effect of props.room.effects || []) engine.current?.fire(effect);
  }, [props.room.effects]);
  useEffect(() => {
    void engine.current?.visuals
      .select(getMap(latest.current.room.state.map).arena && resourcePack !== 'urban-realism' ? 'default' : resourcePack, latest.current.room.state)
      .then(() => engine.current?.refreshTargets());
  }, [resourcePack, graphics]);
  const current = GAME_TOOLS[props.tool];
  const gameMode = modeOf(props.room.state);
  const slots = slotsFor(gameMode);
  const currentSlot = slots.find((s) => s.index === props.tool);
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
              PAINTS.find((p) => p.color === props.paintColor)?.id || 'violet',
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
    <div
      className={`world-container ${active ? 'play-active' : ''} ${props.room.state.visualStyle === 'anime' ? 'anime-world' : 'tactical-world'} ${aiming ? 'is-aiming' : ''}`}
    >
      <div ref={mount} className="world-canvas" data-visual-pack={packStatus === 'ready' ? resourcePack : 'default'} />
      <div ref={windIndicator} className="wind-indicator" hidden aria-label="Ветер" title="Ветер: куда сносит пули и игрока, скорость и балл по шкале Бофорта">
        <span className="wind-indicator-arrow" aria-hidden="true" />
        <b />
      </div>
      {packStatus === 'ready' && resourcePack === 'realistic-bodycam' && <div className="field-camera-mark" aria-hidden="true"><span>JNL / FIELD 01</span><span>● LIVE VIEW · {perspective === 'first' ? 'FPP' : 'TPP'}</span></div>}
      {packStatus === 'loading' && <output className="pack-status">Подготовка визуального пакета…</output>}
      {packStatus === 'error' && <div role="alert" className="pack-status">Пакет не загрузился. Игра продолжается с Default.</div>}
      {urbanSlow && slowUrban && <output className="pack-status">Urban Realism: частота кадров ниже 28 FPS. <button type="button" onClick={props.onGraphics}>Настроить графику</button></output>}
      <WorldHud
        mode={gameMode}
        room={props.room}
        host={props.host}
        onOp={props.onOp}
        onGraphics={props.onGraphics}
        packetLoss={props.packetLoss}
        fps={props.fps}
        fpsLimit={props.fpsLimit}
        self={self}
        perspective={perspective}
        choosePerspective={choosePerspective}
        current={current}
        aiming={aiming}
        dead={dead}
        sniperZoomIndex={sniperZoomIndex}
        hitEffect={hitEffect}
        hitMark={hitMark}
        shieldSeconds={shieldSeconds}
        killfeed={killfeed}
        personalAlert={personalAlert}
        respawnSeconds={respawnSeconds}
        voice={props.voice}
        freezeSeconds={Math.max(
          0,
          Math.ceil(((props.room.match?.until ?? 0) - props.now) / 1000),
        )}
      />
      {tabletInWorld && (
        <WorldTablet
          now={props.now}
          room={props.room}
          host={props.host}
          onRoomSettings={props.onRoomSettings}
          onOp={props.onOp}
          onEditNote={props.onEditNote}
          onAddNote={props.onAddNote}
          onCursor={props.onCursor}
          closeTabletInWorld={closeTabletInWorld}
        />
      )}
      {!active && !radial && !contextWheel && !dead && !props.blocked && !scorePinned && (
        <div className="camera-onboarding">
          <MousePointer2 size={24} />
          <div>
            <strong>Кликните, чтобы играть</strong>
            <span>Двигайте мышь — камера следует за вами.</span>
            <small>
              Esc — свободный курсор · ЛКМ — стрелять · Alt + колесо — масштаб
            </small>
            {captureError && <small role="alert">{captureError}</small>}
          </div>
          <button className="play-capture" onClick={lock}>
            Играть
          </button>
        </div>
      )}
      {near && active && !radial && !props.blocked && (
        <button className="interact-prompt" onClick={() => props.onZone(near)}>
          <kbd>E</kbd>
          {ZONES.find((z) => z.id === near)?.title}
          <span>Работать с идеями</span>
        </button>
      )}
      {/* Вид индикатора (цифры или графика) выбирается в настройках, поэтому
          разметка и подписка на настройку живут в world-hud.tsx. Место —
          слева от панели предметов: правый нижний угол занят миникартой. */}
      {['paint', 'confetti', 'sniper'].includes(current?.id) && (
        <AmmoIndicator
          rounds={rounds[current.id as Blaster]}
          capacity={CAPACITY[current.id as Blaster]}
          reloading={reloading}
        />
      )}
      {/* В «Предателе» план крупнее и с названиями отсеков: по ним договариваются на собраниях. */}
      <WorldMinimap
        map={minimapMap}
        read={readMinimap}
        expanded={mapExpanded}
        size={gameMode === 'impostor' ? 250 : undefined}
        labels={gameMode === 'impostor'}
      />
      <div className="equipped-card">
        <span className="weapon-number">{currentSlot?.key ?? '—'}</span>
        <div>
          <strong>{current?.label}</strong>
          <span>
            {current?.id === 'paint'
              ? 'Краска исчезает через 12 секунд'
              : current?.id === 'confetti'
                ? 'Направленный залп · без лимита'
                : TOOL_HINTS[current?.id]}
          </span>
        </div>
        {current?.id === 'paint' ? (
          <Palette size={21} style={{ color: props.paintColor }} />
        ) : current?.id === 'confetti' ? (
          <PartyPopper size={21} />
        ) : current?.id === 'grenade' ? (
          <Bomb size={21} />
        ) : current?.id === 'sniper' ? (
          <Sparkles size={21} />
        ) : current?.id === 'sticky' ? (
          <StickyNote size={21} />
        ) : (
          <Tablet size={21} />
        )}
      </div>
      {active && captureError && (
        <div className="camera-fallback-hint">{captureError}</div>
      )}
      <div className="quick-loadout" aria-label="Быстрые предметы">
        {slots.map((slot) => {
          const Icon = getSlotIcon(slot.index);
          return (
            <button
              key={slot.key}
              aria-pressed={props.tool === slot.index}
              onClick={() => {
                if (slot.index === 9) {
                  if (props.tool === 9) {
                    if (tabletInWorld) closeTabletInWorld();
                    else openTabletInWorld();
                  } else {
                    props.onTool(9);
                    openTabletInWorld();
                  }
                } else {
                  if (tabletInWorld) closeTabletInWorld();
                  props.onTool(slot.index);
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
        <span style={{ color: props.paintColor }}>
          {current.id === 'paint'
            ? '●'
            : current.id === 'confetti'
              ? CONFETTI.find((c) => c.id === confettiStyle)?.icon
              : current.id === 'grenade'
                ? GRENADES.find((g) => g.id === grenadeStyle)?.icon
                : current.id === 'sniper'
                  ? FIREWORKS.find((f) => f.id === fireworkStyle)?.icon
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
              props.onPaintColor(PAINTS.find((p) => p.id === id)!.color);
            else if (current.id === 'confetti') {
              setConfettiStyle(id);
              writePref(PREF_KEYS.confettiStyle, id);
            } else if (current.id === 'grenade') {
              setGrenadeStyle(id);
              writePref(PREF_KEYS.grenadeStyle, id);
            } else if (current.id === 'sniper') {
              setFireworkStyle(id);
              writePref(PREF_KEYS.fireworkStyle, id);
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
              <span className="eyebrow">JINALY / LOADOUT</span>
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
                props.room.members.find((m) => m.id === props.room.self)
                  ?.color || '#718cdd'
              }
              anime={props.room.state.visualStyle === 'anime'}
              anonymous={!!props.room.state.anonymousPlayers}
            />
          )}
          <div className="equipment-items">
            {slots.map((slot) => {
              const Icon = getSlotIcon(slot.index);
              return (
                <button
                  key={slot.key}
                  aria-pressed={props.tool === slot.index}
                  onClick={() => {
                    props.onTool(slot.index);
                    engine.current?.closeInventory();
                  }}
                >
                  <kbd>{slot.key}</kbd>
                  <Icon size={42} />
                  <strong>{slot.label}</strong>
                  <small>{slot.hint}</small>
                  <span>
                    {props.tool === slot.index ? 'В руках' : 'Взять в руки'}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            className="equipment-reaction"
            onClick={() => {
              props.onAction('reaction');
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
      {props.host && (props.pendingJoinRequestsCount || 0) > 0 && (
        <div className="world-join-requests-hud">
          <button
            type="button"
            onClick={() => props.onOpenJoinRequests?.()}
            title="Ожидают подтверждения"
          >
            <Bell size={16} className="bell-pulse" />
            <span>Запросы на вход ({props.pendingJoinRequestsCount})</span>
          </button>
        </div>
      )}
      <div className="mobile-world">
        <button onClick={() => props.onZone(near || 'good')}>
          <MoveUp />
          Доска
        </button>
        <button onClick={() => props.onMonitor((v) => !v)}>
          <Users />В сети
        </button>
      </div>
      <output className="sr-only">
        Выстрелов: {shots}. Поза: {stance}.
      </output>
    </div>
  );
}
