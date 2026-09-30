'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as T from 'three';
import {
  ZONES,
  GAME_TOOLS,
  TOOL_HINTS,
  type Person,
  type Pose,
  type Room,
  type RoomState,
  type WorldEffect,
  type Note,
} from '@/lib/model';
import { WorldTablet } from './world-tablet';
import { AmmoIndicator, GrenadeRecharge, WorldHud } from './world-hud';
import { WorldMinimap, type MinimapFrame } from './world-minimap';
import { minimapBlips, type MinimapBlip, type SpotMemory } from '@/lib/minimap-blips';
import type { VoiceChannel, VoiceView } from './voice-chat';
import { createMapScene, type WorldKit } from './world-map-scene';
import { useResourcePack } from '../hooks/use-resource-pack';
import { createVisualProvider } from './resource-packs/provider';
import { createFieldOptics } from './resource-packs/realistic/post';
import { useGraphicsSettings } from '../hooks/use-graphics-settings';
import { defaultCharacters, GRAPHICS_PRESETS } from '../lib/graphics-settings';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { visualBudget } from '../lib/resource-packs';
import { createFirstPersonHands } from './world-hands';
import { CONFETTI, GRENADES, FIREWORKS } from '@/lib/game-items';
import { createWorldVfx } from './world-vfx';
import { createWorldProjectiles } from './world-projectiles';
import { createWorldWeapons } from './world-weapons';
import { createWorldInput } from './world-input';
import { createGrenadeAim } from './world-grenade-aim';
import { useKillFeed } from './use-kill-feed';
import { WorldEquipment } from './world-equipment';
import { createWorldRemotePlayers } from './world-remote-players';
import {
  avatarMuzzle,
  createFlashlightBeam,
  createPlayerFlashlight,
} from './world-flashlight';
import { createGhostForm, setGhostLook, type GhostForm } from './world-ghost';
import { humanOutfit, syncHuman, unmountHuman, updateHumanLod } from './world-human';
import { preloadFighterModel } from './world-fighter-file';
import { preloadWeaponModels } from './world-weapon-models';
import { createViewArms } from './world-view-arms';
import {
  dayMix,
  dayPosition,
  sameMix,
  TIMES_OF_DAY,
  type DayMix,
} from '@/lib/day-cycle';
import { createWorldPlayer } from './world-player';
import { createWorldWeather } from './world-weather';
import { buildRoofMap, underRoof } from '@/lib/weather-shelter';
import { beaufort, weatherLook, windLevel, windRelative } from '@/lib/weather';
import { footstepSurface } from '@/lib/footsteps';
import { setAvatarAnonymous } from './world-avatar';
import { attachCustomSkins, applyAvatarSkin } from './world-skins';
import { slotsFor } from '@/lib/loadout';
import { modeOf } from '@/lib/maps/catalog';
import { aimFov, viewFov } from '@/lib/hud-prefs';
import { damageSource } from '@/lib/hud-feedback';
import { useHudPrefs, useTouchOnly } from './hud-prefs';
import type { DamageHit } from './hud-feedback';
import { HudGraphicsLost, HudPause, HudStartCard } from './hud-states';
import { amGhost, impostorFrozen, inGame, inVentNow, minimapShows, visionRadius } from '@/lib/impostor-client';
import { createFootsteps } from './world-footsteps';
import { createWeaponSounds } from './world-weapon-sounds';
import { rayCastWorldObstacle } from '@/lib/world-collision';
import { CAPACITY, type Blaster } from '@/lib/tool-magazine';
import { WeaponPrediction } from '@/lib/weapon-prediction';
import type { WeaponCommand, WeaponReply } from '@/lib/weapon-protocol';
import { GRENADE_COOLDOWN_MS } from '@/lib/weapon-definition';
import { MELEE } from '@/lib/melee';
import { ViewRecoil } from '@/lib/weapon-recoil';
import {
  blocksCamera,
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
import { animateAvatar, fighterShared } from './world-avatar';
import {
  MoveUp,
  Users,
  Palette,
  PartyPopper,
  Tablet,
  Bomb,
  Sparkles,
  StickyNote,
  Bell,
} from 'lucide-react';

import { SNIPER_ZOOM_FOVS } from './world-constants';

import { readAimModes, type WeaponAimModes } from '@/lib/aim-settings';
import { PREF_KEYS, readChoice } from '@/lib/user-prefs';
import {
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
export type { KillMessage, PersonalAlert } from './use-kill-feed';
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

/** Сколько держится дуга урона; анимация угасания в app/hud.css той же длины. */
const DAMAGE_ARC_MS = 1200;

// Шаблон бойца (оружие, скины) — файлом, пока собирается остальное: бойцы
// копируются из него, а не собираются каждый заново (world-fighter-file.ts).
if (typeof window !== 'undefined') {
  void preloadFighterModel();
  // Модели оружия — для рук от первого лица и для бойцов в мире.
  void preloadWeaponModels();
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
  const [meleeStyle, setMeleeStyle] = useState('hammer');
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
      setMeleeStyle(readChoice(PREF_KEYS.meleeStyle, MELEE.map((m) => m.id), 'hammer'));
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
    meleeStyle,
    tabletZone,
    paintSight,
  });
  useEffect(() => {
    selection.current = {
      confettiStyle,
      grenadeStyle,
      fireworkStyle,
      meleeStyle,
      tabletZone,
      paintSight,
    };
  }, [confettiStyle, grenadeStyle, fireworkStyle, meleeStyle, tabletZone, paintSight]);
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
  // Лента убийств, личные плашки, карточка смерти и хитмаркер (use-kill-feed.ts).
  const {
    killfeed,
    personalAlert,
    setPersonalAlert,
    deathInfo,
    setDeathInfo,
    announce,
    hitMark,
    hitMarker,
    killSoundRef,
  } = useKillFeed(props.room.effects, props.room.self, engine, latest);

  // Попадания по игроку для дуг урона. Каждое со своим ключом: подряд идущие
  // попадания видно все, а не одно перезапущенное.
  const [damageHits, setDamageHits] = useState<(DamageHit & { at: number })[]>([]);
  const damageKeyRef = useRef(0);
  const damageView = useCallback(() => {
    const player = engine.current?.player;
    return player ? { x: player.pos.x, z: player.pos.z, yaw: player.cameraYaw } : null;
  }, []);

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
    damageKeyRef.current += 1;
    const hit = {
      key: damageKeyRef.current,
      at: performance.now(),
      source: damageSource(props.room.effects, props.room.self, self, props.room.members),
    };
    // Не больше четырёх дуг: под шквалом огня края экрана не должны гореть сплошь.
    setDamageHits((list) => [...list, hit].slice(-4));
  }, [currentHp, self, props.room.effects, props.room.self, props.room.members]);

  useEffect(() => {
    if (!damageHits.length) return;
    const oldest = damageHits[0];
    const t = setTimeout(
      () => setDamageHits((list) => list.filter((h) => h.key !== oldest.key)),
      Math.max(0, oldest.at + DAMAGE_ARC_MS - performance.now()),
    );
    return () => clearTimeout(t);
  }, [damageHits]);
  // Возродился — карточка убийцы больше не нужна. Только на переходе: эффект
  // убийства может прийти на снимок раньше, чем обнулится своё здоровье.
  const wasDeadRef = useRef(dead);
  useEffect(() => {
    if (wasDeadRef.current && !dead) setDeathInfo(null);
    wasDeadRef.current = dead;
  }, [dead, setDeathInfo]);
  const [weaponState] = useState(() => new WeaponPrediction());
  const prediction = useRef(weaponState);
  const magazine = useRef(weaponState.magazine);
  // Доля перезарядки для кольца у патронов: читается каждый кадр, без ре-рендера.
  const readReload = useCallback(() => magazine.current.progress(performance.now()), []);
  const [rounds, setRounds] = useState({ ...CAPACITY }),
    [reloading, setReloading] = useState(false),
    // Когда показали «Перезарядка» посреди экрана (Date.now()); 0 — подсказки нет.
    [reloadHint, setReloadHint] = useState(0),
    [grenadeReadyAt, setGrenadeReadyAt] = useState(0),
    [aiming, setAiming] = useState(false);
  // Пока «Перезарядка» у прицела, индикатор ветра под ней прячется: у них один
  // слот, и кадр рендера читает это из ref, а не из состояния React.
  const reloadHintRef = useRef(false);
  useEffect(() => {
    reloadHintRef.current = reloadHint > 0;
    if (!reloadHint) return;
    const hide = setTimeout(() => setReloadHint(0), 900);
    return () => clearTimeout(hide);
  }, [reloadHint]);
  // Настройки игрока: поле зрения и громкость нужны кадру рендера — через ref.
  const hudPrefs = useHudPrefs();
  const hudPrefsRef = useRef(hudPrefs);
  useEffect(() => {
    hudPrefsRef.current = hudPrefs;
  }, [hudPrefs]);
  const touchOnly = useTouchOnly();
  // Игрок уже был в игре: Esc дальше открывает паузу, а не карточку первого входа.
  const [played, setPlayed] = useState(false);
  // Браузер ещё не отдаёт мышь после Esc — повторяем захват и просим секунду.
  const [captureWait, setCaptureWait] = useState(false);
  // Видеокарта сбросила WebGL-контекст: ждём восстановления.
  const [glLost, setGlLost] = useState(false);
  const aimModes = props.aimModes || readAimModes();
  const aimModesRef = useRef<WeaponAimModes>(aimModes);
  useEffect(() => {
    aimModesRef.current = props.aimModes || readAimModes();
  }, [props.aimModes]);
  const [, setLocked] = useState(false),
    [radial, setRadial] = useState(false),
    [near, setNear] = useState(''),
    [active, setActive] = useState(false),
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
    const viewArms = createViewArms(camera, hands);
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
    /** Модели бойцов: из настроек графики, иначе по профилю качества. */
    const characterMode = () => graphicsRef.current?.characters ?? defaultCharacters(props.quality);
    const remotePlayers = createWorldRemotePlayers({
      characters: () => ({ mode: characterMode(), eye: camera.position }),
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
      // Краска не переживает смерть. vfx создаётся ниже, но зовётся это уже из кадра.
      onDied: (remote) => vfx.clearPaint(remote),
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
      softLook = false;
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
    // Отдача уводит сам взгляд; разброс зависит от того, как игрок двигался в прошлом кадре.
    const viewRecoil = new ViewRecoil();
    let lastMoving = false,
      lastAirborne = false;
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
      // Поза нужна только самому движку: объявлять её скринридеру незачем.
      onStance: () => {},
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
    let lastGrenade = -Infinity;
    /**
     * `let` движка, которые делят кадр и вынесенные модули (ввод, оружие,
     * прицел гранаты). Геттеры и сеттеры читают и пишут те же переменные:
     * запись из модуля сразу видна кадру, и наоборот.
     */
    const shared = {
      get middle() { return middle; },
      set middle(v: boolean) { middle = v; },
      get left() { return left; },
      set left(v: boolean) { left = v; },
      get aimHeld() { return aimHeld; },
      set aimHeld(v: boolean) { aimHeld = v; },
      get softLook() { return softLook; },
      set softLook(v: boolean) { softLook = v; },
      get activeControl() { return activeControl; },
      set activeControl(v: boolean) { activeControl = v; },
      get grenadeAiming() { return grenadeAiming; },
      set grenadeAiming(v: boolean) { grenadeAiming = v; },
      get continuousShots() { return continuousShots; },
      set continuousShots(v: number) { continuousShots = v; },
      get flashlightOn() { return flashlightOn; },
      set flashlightOn(v: boolean) { flashlightOn = v; },
      get nearZone() { return nearZone; },
      set nearZone(v: string) { nearZone = v; },
      get lastGrenade() { return lastGrenade; },
      set lastGrenade(v: number) { lastGrenade = v; },
      get lastMoving() { return lastMoving; },
      set lastMoving(v: boolean) { lastMoving = v; },
      get lastAirborne() { return lastAirborne; },
      set lastAirborne(v: boolean) { lastAirborne = v; },
    };

    const grenadeAim = createGrenadeAim({
      scene,
      camera,
      ray,
      mouse,
      map,
      state: shared,
      sceneryTargets: () => sceneryTargetCache,
      // Кэш мишеней и точка вылета объявлены ниже; зовутся они уже из кадра.
      gatherRemoteAvatarMeshes: () => gatherRemoteAvatarMeshes(),
      weaponOrigin: (tool) => weaponOrigin(tool),
    });
    const { trajectoryLine, landingMarker } = grenadeAim;

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
    // В хабе на ретроспективе выстрелы тише, как и шаги. Сверху — громкость
    // эффектов из настроек игрока (выстрелы, попадания, щелчки, шаги).
    const weaponVolume = () =>
      (modeOf(latest.current.room.state) === 'retro' ? 0.6 : 1) * hudPrefsRef.current.sfxVolume;
    killSoundRef.current = () => weaponSounds.confirm(weaponVolume());
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
      world: map,
      onLaunch: (e) => {
        const [x, y, z] = e.origin ?? [];
        if (z !== undefined) weaponSounds.fire(e.kind, [x, y, z], e.author === latest.current.room.self, weaponVolume());
      },
      onLand: (kind, at) => weaponSounds.impact(kind, [at.x, at.y, at.z], weaponVolume()),
      onBounce: (at) => weaponSounds.knock([at.x, at.y, at.z], weaponVolume()),
      // Вспышка у дула, искры ракеты и фитиля гранаты.
      vfx,
    });
    const { flights, spawn } = projectiles;
    let weaponDisposed = false;
    const isDead = () =>
      latest.current.room.members.find((m) => m.id === latest.current.room.self)
        ?.hp === 0;
    const { updateAmmo, sendWeaponControl, beginReload, reloadingFeedback, weaponOrigin, shoot } =
      createWorldWeapons({
        latest,
        selection,
        magazine,
        prediction,
        perspectiveRef,
        immuneExpireRef,
        state: shared,
        disposed: () => weaponDisposed,
        isDead,
        setRounds,
        setReloading,
        setReloadHint,
        setGrenadeReadyAt,
        setAiming,
        setCaptureError,
        setPersonalAlert,
        weaponSounds,
        weaponVolume,
        scene,
        camera,
        ray,
        mouse,
        map,
        roof,
        weather,
        windOn,
        kit,
        avatar,
        hands,
        pos,
        player,
        projectiles,
        flights,
        spawn,
        burst,
        paintDropletGeo,
        viewRecoil,
        sceneryTargets: () => sceneryTargetCache,
        gatherRemoteAvatarMeshes,
      });
    /** Толчки, что уже отыграны: эффект лежит в комнате ещё 15 секунд. */
    const knocked = new Set<string>();
    const input = createWorldInput({
      canvas,
      latest,
      engine,
      keys,
      mouse,
      ray,
      camera,
      kit,
      player,
      hands,
      magazine,
      selection,
      state: shared,
      disposed: () => weaponDisposed,
      isDead,
      footsteps,
      weaponSounds,
      weaponVolume,
      flashlight,
      localBeam,
      trajectoryLine,
      landingMarker,
      shoot,
      beginReload,
      reloadingFeedback,
      scoreHeldRef,
      scorePinnedRef,
      tabletInWorldRef,
      sniperZoomIndexRef,
      aimModesRef,
      perspectiveRef,
      openTabletInWorld,
      closeTabletInWorld,
      choosePerspective,
      setActive,
      setPlayed,
      setLocked,
      setCaptureError,
      setCaptureWait,
      setAiming,
      setRadial,
      setContextWheel,
      setScorePinned,
      setMapExpanded,
      setSniperZoomIndex,
    });
    const { capture, enabled, clear } = input;
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
      fire: (e: WorldEffect) => {
        // Толчок от молота — только своему телу и только свежий: старый уже отыгран.
        if (e.kind !== 'knock') return spawn(e);
        if (knocked.has(e.id) || Date.now() + clockOffset.current - e.at > 1500 || !e.normal || !e.victim)
          return;
        knocked.add(e.id);
        // Отлетает своё тело; чужого — показываем сразу, не дожидаясь его поз.
        if (e.victim === latest.current.room.self) player.knock(e.normal[0], e.normal[1], e.normal[2]);
        else remotePlayers.knock(e.victim, e.normal, performance.now());
      },
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
    /*
     * Потеря WebGL-контекста: видеокарта сбросила графику (сон ноутбука, смена
     * драйвера, нехватка памяти). preventDefault — просьба к браузеру вернуть
     * контекст; Three.js сам пересоздаёт свои ресурсы по webglcontextrestored,
     * нам остаётся показать, что происходит, и перерисовать тени.
     */
    const contextLost = (e: Event) => {
      e.preventDefault();
      setGlLost(true);
    };
    const contextRestored = () => {
      renderer.shadowMap.needsUpdate = true;
      resize();
      setGlLost(false);
    };
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('webglcontextrestored', contextRestored);
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
        // Краскомёт стреляет очередью, ближний бой бьёт, пока держат кнопку.
        if (t === 'paint' || t === 'melee') shoot();
      }
      grenadeAim.update(grenadeAiming && GAME_TOOLS[latest.current.tool]?.id === 'grenade');
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
          // Своя смерть смывает краску и с аватара, и с экрана.
          vfx.clearPaint(avatar);
          vfx.clearPaint(hands.group.parent ?? hands.group);
        }
      } else {
        deadTimers.delete(latest.current.room.self);
      }
      const myDeathTime = deadTimers.get(latest.current.room.self);
      const isMyDeathRecent = myHp === 0 && now - (myDeathTime || now) < 3800;

      // Свой боец — тем же человеком, что его видят другие. В первом лице он не
      // виден, и анимировать его каждый кадр незачем.
      const characters = characterMode();
      if (syncHuman(avatar, characters !== 'classic', latest.current.room.self, myMember?.color || '#718cdd'))
        updateHumanLod(avatar, perspectiveRef.current === 'first' ? 60 : 0, characters === 'human-lite');
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
          variant:
            GAME_TOOLS[latest.current.tool]?.id === 'melee'
              ? selection.current.meleeStyle
              : selection.current.grenadeStyle,
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
      lastMoving = moving;
      lastAirborne = pos.y - groundY > 0.08;
      {
        const kick = viewRecoil.step(dt);
        player.pitch = T.MathUtils.clamp(player.pitch + kick.pitch, -1.35, 1.4);
        player.cameraYaw = wrapAngle(player.cameraYaw + kick.yaw);
      }
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
      hands.setGrenadeLoaded(now - lastGrenade >= GRENADE_COOLDOWN_MS);
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
          : GAME_TOOLS[latest.current.tool]?.id === 'melee'
            ? selection.current.meleeStyle
            : selection.current.grenadeStyle,
        tabletInspectRef.current,
        selection.current.paintSight,
      );
      // Руки от первого лица — руки своего бойца-человека, его цвета костюма.
      // В классическом облике бойцов остаются простые перчатки.
      {
        const outfit = characters !== 'classic' ? humanOutfit(avatar) : null;
        viewArms.update(
          GAME_TOOLS[latest.current.tool]?.id || 'other',
          outfit
            ? { female: outfit.female, suit: outfit.suit, gear: outfit.gear }
            : characters !== 'classic'
              ? { female: false, suit: myMember?.color || '#718cdd', gear: '#1c1f26' }
              : null,
          dt,
        );
      }
      const sniperFov = SNIPER_ZOOM_FOVS[sniperZoomIndexRef.current];
      // Поле зрения из настроек игрока (lib/hud-prefs.ts): третье лицо и
      // прицеливание держат прежние пропорции к нему. Оптика снайперки — свои
      // кратности, от настройки не зависят.
      const restFov = viewFov(hudPrefsRef.current.fov, mode);
      const baseTargetFov =
        GAME_TOOLS[latest.current.tool]?.id === 'sniper'
          ? mode === 'first'
            ? sniperFov
            : sniperFov + 6
          : aimFov(hudPrefsRef.current.fov, mode);
      const targetFov =
        tabletInspectRef.current > 0
          ? T.MathUtils.lerp(restFov, 52, tabletInspectRef.current)
          : baseTargetFov;
      const fov = T.MathUtils.lerp(
        camera.fov,
        tabletInspectRef.current > 0
          ? targetFov
          : T.MathUtils.lerp(
            restFov,
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
          (modeOf(room.state) === 'retro' ? 0.5 : 1) * hudPrefsRef.current.sfxVolume,
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
            'melee',
            'sticky',
            'pointer',
            'flashlight',
          ].includes(GAME_TOOLS[latest.current.tool]?.id)
            ? GAME_TOOLS[latest.current.tool].id
            : 'other',
          variant:
            GAME_TOOLS[latest.current.tool]?.id === 'melee'
              ? selection.current.meleeStyle
              : selection.current.grenadeStyle,
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
        // У «Перезарядки» и ветра один слот под прицелом: пока идёт подсказка,
        // ветер ждёт.
        const show = windOn() && !isDead() && !latest.current.blocked && !reloadHintRef.current;
        indicator.hidden = !show;
        // В бою без оптики ветер — фон: приглушаем. С оптикой снайперки снос
        // решает выстрел, и индикатор снова в полную силу.
        const scoped = GAME_TOOLS[latest.current.tool]?.id === 'sniper' && aimHeld;
        const quiet = modeOf(latest.current.room.state) === 'battle' && !scoped;
        if (indicator.dataset.quiet !== String(quiet)) indicator.dataset.quiet = String(quiet);
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
      input.dispose();
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      visuals.dispose();
      // Геометрия и текстуры людей общие для всех бойцов и сцен — общая чистка ниже их не трогает.
      unmountHuman(avatar);
      viewArms.dispose();
      for (const remote of remoteAvatars.values()) unmountHuman(remote);
      scene.traverse((o) => {
        if (
          o instanceof T.Mesh ||
          o instanceof T.Points ||
          o instanceof T.Sprite
        ) {
          // Общее с шаблоном бойца остаётся для следующей сцены (world-avatar.ts).
          if ('geometry' in o && !fighterShared(o.geometry)) o.geometry.dispose();
          const materials = Array.isArray(o.material)
            ? o.material
            : [o.material];
          materials.forEach((m) => {
            if (fighterShared(m)) return;
            if ('map' in m && m.map) (m.map as T.Texture).dispose();
            m.dispose();
          });
        }
      });
      weaponDisposed = true;
      flashlight.dispose();
      localGhost?.dispose();
      footsteps.dispose();
      killSoundRef.current = null;
      weaponSounds.dispose();
      localBeam.dispose();
      projectiles.dispose();
      weather.dispose();
      vfx.dispose();
      grenadeAim.dispose();
      kit.dispose();
      composer?.passes.forEach((pass) => pass.dispose());
      composer?.dispose();
      renderer.dispose();
      canvas.remove();
    };
    // Сеттер и ref-объекты из useKillFeed стабильны: движок из-за них не пересобирается.
  }, [props.quality, openTabletInWorld, closeTabletInWorld, mapId, setPersonalAlert, hitMarker, killSoundRef]);
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
  const match = props.room.match;
  // Матч в разгаре: по игроку стреляют, в том числе пока он в паузе.
  const matchLive = gameMode === 'battle' && (!match || match.phase === 'live');
  // Идёт бой: второстепенное (часы, ветер без оптики, панель кадров) приглушено.
  const inCombat = matchLive && !dead;
  // Курсор свободен, и ничего другого поверх мира не открыто.
  const freeCursor =
    !active && !radial && !contextWheel && !dead && !props.blocked && !scorePinned && !tabletInWorld;
  return (
    <div
      className={`world-container ${active ? 'play-active' : ''} ${props.room.state.visualStyle === 'anime' ? 'anime-world' : 'tactical-world'} ${aiming ? 'is-aiming' : ''} ${inCombat ? 'in-combat' : ''} ${hudPrefs.colorblind ? 'is-colorblind' : ''}`}
      style={{ '--hud-scale': hudPrefs.hudScale } as React.CSSProperties}
    >
      <div ref={mount} className="world-canvas" data-visual-pack={packStatus === 'ready' ? resourcePack : 'default'} />
      <div ref={windIndicator} className="wind-indicator" hidden aria-label="Ветер" title="Ветер: куда сносит пули и игрока, скорость и балл по шкале Бофорта">
        <span className="wind-indicator-arrow" aria-hidden="true" />
        <b />
      </div>
      {packStatus === 'ready' && resourcePack === 'realistic-bodycam' && <div className="field-camera-mark" aria-hidden="true"><span>НАТЕЛЬНАЯ КАМЕРА 01</span><span>● ЗАПИСЬ · {perspective === 'first' ? 'ОТ 1-ГО ЛИЦА' : 'ОТ 3-ГО ЛИЦА'}</span></div>}
      {packStatus === 'loading' && <output className="pack-status">Подготовка визуального пакета…</output>}
      {packStatus === 'error' && <div role="alert" className="pack-status">Пакет не загрузился. Игра продолжается в обычном виде.</div>}
      {urbanSlow && slowUrban && <output className="pack-status">Пакет «Urban Realism»: меньше 28 кадров в секунду. <button type="button" onClick={props.onGraphics}>Настроить графику</button></output>}
      {glLost && <HudGraphicsLost />}
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
        damageHits={damageHits}
        damageView={damageView}
        hitMark={hitMark}
        shieldSeconds={shieldSeconds}
        killfeed={killfeed}
        personalAlert={personalAlert}
        respawnSeconds={respawnSeconds}
        respawnTotal={props.room.state.respawnSeconds ?? 5}
        waitsForRound={gameMode === 'battle' && match?.mode === 'rounds'}
        deathInfo={deathInfo}
        prefs={hudPrefs}
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
      {/* Первый вход — карточка «Кликните, чтобы играть»; дальше Esc — пауза. */}
      {freeCursor &&
        (played && !touchOnly ? (
          <HudPause
            mode={gameMode}
            vulnerable={matchLive}
            waiting={captureWait}
            error={captureError}
            onResume={lock}
          />
        ) : (
          <HudStartCard
            mode={gameMode}
            touchOnly={touchOnly}
            waiting={captureWait}
            error={captureError}
            onPlay={lock}
          />
        ))}
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
      {reloadHint > 0 && (
        <div key={reloadHint} className="hud-reload-hint" aria-hidden="true">
          Перезарядка
        </div>
      )}
      {current?.id === 'grenade' && (
        <GrenadeRecharge readyAt={grenadeReadyAt} cooldown={GRENADE_COOLDOWN_MS} />
      )}
      {['paint', 'confetti', 'sniper'].includes(current?.id) && (
        <AmmoIndicator
          rounds={rounds[current.id as Blaster]}
          capacity={CAPACITY[current.id as Blaster]}
          reloading={reloading}
          readProgress={readReload}
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
      <WorldEquipment
        slots={slots}
        current={current}
        tool={props.tool}
        onTool={props.onTool}
        paintColor={props.paintColor}
        onPaintColor={props.onPaintColor}
        onAction={props.onAction}
        room={props.room}
        paintSight={paintSight}
        applyPaintSight={applyPaintSight}
        confettiStyle={confettiStyle}
        setConfettiStyle={setConfettiStyle}
        grenadeStyle={grenadeStyle}
        setGrenadeStyle={setGrenadeStyle}
        fireworkStyle={fireworkStyle}
        setFireworkStyle={setFireworkStyle}
        meleeStyle={meleeStyle}
        setMeleeStyle={setMeleeStyle}
        tabletZone={tabletZone}
        setTabletZone={setTabletZone}
        tabletInWorld={tabletInWorld}
        openTabletInWorld={openTabletInWorld}
        closeTabletInWorld={closeTabletInWorld}
        contextWheel={contextWheel}
        radial={radial}
        engine={engine}
      />
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
      {/* Скринридеру — только своё убийство и своя смерть: счётчик выстрелов и
          поза в постоянной живой области зачитывались поверх всего боя. */}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
