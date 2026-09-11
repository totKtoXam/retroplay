'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  type Pose,
  type Room,
  type RoomState,
  type WorldEffect,
  type Note,
} from '@/lib/model';
import { ItemWheel } from './item-wheel';
import { WorldTablet } from './world-tablet';
import { WorldHud } from './world-hud';
import { createWorldScene, STATIONS } from './world-scene';
import { useResourcePack } from '../hooks/use-resource-pack';
import { createVisualProvider } from './resource-packs/provider';
import { createFieldOptics } from './resource-packs/realistic/post';
import { visualBudget } from '../lib/resource-packs';
import { createFirstPersonHands } from './world-hands';
import { PAINTS, CONFETTI, GRENADES, FIREWORKS, SHOTGUN_PELLET_OFFSETS } from '@/lib/game-items';
import { createWorldVfx } from './world-vfx';
import { createWorldProjectiles } from './world-projectiles';
import { createWorldRemotePlayers } from './world-remote-players';
import { setAvatarAnonymous } from './world-avatar';
import { AvatarPreview } from './avatar-preview';
import { attachCustomSkins, applyAvatarSkin } from './world-skins';
import { QUICK_SLOTS, slotForDigit, cycleSlot } from '@/lib/loadout';
import { ToolMagazine, CAPACITY, type Blaster } from '@/lib/tool-magazine';
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
import {
  ALL_3D_COLLIDERS,
  getGroundHeight,
  getCeilingHeight,
  isBlocked3D,
} from '@/lib/world-collision';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  animateAvatar,
  avatarShoot,
  followCameraHeading,
} from './world-avatar';
import {
  MousePointer2,
  MoveUp,
  RotateCcw,
  Camera,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
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
  Bell,
} from 'lucide-react';

import { SNIPER_ZOOM_LEVELS, SNIPER_ZOOM_FOVS } from './world-constants';

export type AimMode = 'hold' | 'toggle';
export type WeaponAimModes = {
  paint: AimMode;
  confetti: AimMode;
  sniper: AimMode;
};
export const DEFAULT_AIM_MODES: WeaponAimModes = {
  paint: 'hold',
  confetti: 'hold',
  sniper: 'hold',
};
export function readAimModes(): WeaponAimModes {
  if (typeof window === 'undefined') return { ...DEFAULT_AIM_MODES };
  try {
    const raw = localStorage.getItem('jinaly-aim-modes');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WeaponAimModes>;
      return {
        paint: parsed.paint === 'toggle' ? 'toggle' : 'hold',
        confetti: parsed.confetti === 'toggle' ? 'toggle' : 'hold',
        sniper: parsed.sniper === 'toggle' ? 'toggle' : 'hold',
      };
    }
  } catch {}
  return { ...DEFAULT_AIM_MODES };
}

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
  onMonitor: (v: boolean) => void;
  onFps: (v: number) => void;
  onAction: (kind: string) => void;
  onFire: (effect: WorldEffect) => void;
  onFailure: () => void;
  blocked: boolean;
  working?: boolean;
  paintColor: string;
  onOp?: (op: Record<string, unknown>) => Promise<unknown>;
  onEditNote?: (n: Note) => void;
  onAddNote?: (zone: string, x?: number, y?: number) => void;
  onCursor?: (x: number, y: number) => void;
  pendingJoinRequestsCount?: number;
  onOpenJoinRequests?: () => void;
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
  const packRef = useRef(resourcePack);
  useEffect(() => {
    packRef.current = resourcePack;
  }, [resourcePack]);
  const [packStatus, setPackStatus] = useState<'default' | 'loading' | 'ready' | 'error'>('default');
  const mount = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  }, [props]);
  const [contextWheel, setContextWheel] = useState(false);
  const [confettiStyle, setConfettiStyle] = useState('classic');
  const [grenadeStyle, setGrenadeStyle] = useState('pinata');
  const [fireworkStyle, setFireworkStyle] = useState('salute');
  const [tabletZone, setTabletZone] = useState('good');
  const [tabletInWorld, setTabletInWorld] = useState(false);
  const [sniperZoomIndex, setSniperZoomIndex] = useState(1);
  const sniperZoomIndexRef = useRef(1);
  useEffect(() => {
    sniperZoomIndexRef.current = sniperZoomIndex;
  }, [sniperZoomIndex]);
  const tabletInWorldRef = useRef(false);
  const tabletInspectRef = useRef(0);

  const engine = useRef<{
    kit: ReturnType<typeof createWorldScene>;
    visuals: ReturnType<typeof createVisualProvider>;
    fire: (e: WorldEffect) => void;
    distance: (delta: number) => void;
    reset: () => void;
    orbit: (delta: number) => void;
    shadow: () => void;
    capture: () => void;
    pause: () => void;
    closeInventory: (resume?: boolean) => void;
    openInventory: () => void;
    openContext: () => void;
    keys: Set<string>;
    refreshTargets: () => void;
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
  });
  useEffect(() => {
    selection.current = {
      confettiStyle,
      grenadeStyle,
      fireworkStyle,
      tabletZone,
    };
  }, [confettiStyle, grenadeStyle, fireworkStyle, tabletZone]);
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
  const lastHitColorRef = useRef<string | null>(null);
  const lastGlowTimeRef = useRef<number>(0);
  const triggerHitGlow = (color: string) => {
    const now = Date.now();
    lastHitColorRef.current = color;
    lastGlowTimeRef.current = now;
    setHitEffect({ color, key: now });
  };
  const hitGlowHandler = useRef(triggerHitGlow);
  useEffect(() => {
    hitGlowHandler.current = triggerHitGlow;
  });

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
    if (prevHpRef.current > currentHp) {
      const now = Date.now();
      if (now - lastGlowTimeRef.current > 400) {
        const enemyEffects = (props.room.effects || []).filter(
          (e) => e.author !== props.room.self,
        );
        const latestEnemyEffect = enemyEffects[enemyEffects.length - 1];
        const color =
          lastHitColorRef.current || latestEnemyEffect?.color || '#ff647c';
        triggerHitGlow(color);
      }
    }
    prevHpRef.current = currentHp;
  }, [currentHp, props.room.effects, props.room.self]);

  useEffect(() => {
    if (!hitEffect) return;
    const t = setTimeout(() => {
      setHitEffect(null);
    }, 1000);
    return () => clearTimeout(t);
  }, [hitEffect]);
  const magazine = useRef(new ToolMagazine());
  const [showAgent, setShowAgent] = useState(false);
  const [rounds, setRounds] = useState({ ...CAPACITY }),
    [reloading, setReloading] = useState(false),
    [aiming, setAiming] = useState(false);
  const aimModes = props.aimModes || readAimModes();
  const aimModesRef = useRef<WeaponAimModes>(aimModes);
  useEffect(() => {
    aimModesRef.current = props.aimModes || readAimModes();
  }, [props.aimModes]);
  const [locked, setLocked] = useState(false),
    [radial, setRadial] = useState(false),
    [near, setNear] = useState(''),
    [stance, setStance] = useState('stand'),
    [active, setActive] = useState(false),
    [shots, setShots] = useState(0),
    [captureError, setCaptureError] = useState('');
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
    const kit = createWorldScene(renderer),
      { scene } = kit;
    const isCinematic = props.quality === 'cinematic' || props.quality === 'high';
    const isBalanced = props.quality === 'balanced' || (!isCinematic && props.quality !== 'low');
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
    kit.update(latest.current.room.state);
    kit.setNotes(latest.current.room.state);
    const cameraObstacles: T.Object3D[] = [];
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (blocksCamera(o)) {
        o.geometry.computeBoundingBox();
        cameraObstacles.push(o);
      }
    });
    scene.add(camera);
    const hands = createFirstPersonHands(camera);
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
    const optics = createFieldOptics();
    composer?.addPass(optics);
    const defaultExposure = renderer.toneMappingExposure;
    // Forward reference: `visuals.select` can call `restore` synchronously
    // (before the shot-target cache further below is defined), so route
    // through a reassignable hook instead of closing over `rebuildSceneryTargets` directly.
    let refreshSceneryTargets = () => {};
    const visuals = createVisualProvider({ scene, hands: hands.group, quality: props.quality, stations: STATIONS,
      restore: () => { kit.update(latest.current.room.state); renderer.toneMappingExposure = defaultExposure; refreshSceneryTargets(); },
      status: setPackStatus,
    });
    void visuals.select(packRef.current, latest.current.room.state).then(() => refreshSceneryTargets());
    const avatar = kit.avatarFactory(
      latest.current.room.members.find((m) => m.id === latest.current.room.self)
        ?.color || '#718cdd',
    );
    avatar.traverse((o) => {
      if (o instanceof T.Mesh) o.castShadow = props.quality !== 'low';
    });
    scene.add(avatar);
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
    const remotePlayers = createWorldRemotePlayers({
      scene,
      kit,
      quality: props.quality,
      latest,
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
    const pos = new T.Vector3(
      initial?.x ?? 0,
      initial?.y ?? 0,
      initial?.z ?? 15,
    );
    let cameraYaw = initial?.yaw || 0,
      heading = cameraYaw,
      viewHeight = eyeHeight(initial?.stance || 'stand'),
      pitch = 0.16,
      distance = 6.5,
      currentCamDist = 6.5,
      obstacleHoldTimer = 0,
      vy = 0,
      currentStance: 'stand' | 'sit' | 'lie' = initial?.stance || 'stand',
      lastC = -1000,
      raf = 0,
      last = 0,
      poseAt = 0,
      fpsAt = 0,
      frames = 0,
      nearZone = '',
      middle = false,
      left = false,
      aimHeld = false,
      aimBlend = 0,
      crouchHeld = false,
      beforeCrouch: 'stand' | 'sit' | 'lie' = 'stand',
      equippedTool = latest.current.tool,
      activeControl = false,
      softLook = false,
      mouseInWorld = false;
    let grenadeAiming = false;
    let continuousShots = 0;
    const keys = new Set<string>(),
      ray = new T.Raycaster(),
      mouse = new T.Vector2(0, 0);
    const vfx = createWorldVfx({ scene, quality: props.quality });
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
          if (o instanceof T.Mesh && !o.userData.transientProjectile)
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
    const projectiles = createWorldProjectiles({
      scene,
      latest,
      remoteAvatars,
      avatar,
      hands,
      pos,
      perspectiveRef,
      hitGlowHandler,
      burst,
      splat: vfx.splat,
      smearPlayerWithPaint: vfx.smearPlayerWithPaint,
      checkSceneryHit,
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
    const beginReload = () => {
      const tool = GAME_TOOLS[latest.current.tool]?.id;
      if (
        tool === 'paint' ||
        tool === 'confetti' ||
        tool === 'sniper' ||
        tool === 'like'
      ) {
        magazine.current.reload(tool as Blaster, performance.now());
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
      if (tool === 'grenade') {
        if (now - lastGrenade < 1200) return;
        lastGrenade = now;
      }
      if (
        tool !== 'grenade' &&
        !magazine.current.fire(tool as Blaster, now)
      ) {
        if (magazine.current.reloading) setReloading(true);
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
        magazine.current.reload('sniper', now);
        setReloading(true);
        updateAmmo();
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
          ? hands.group.localToWorld(new T.Vector3(0, 0.025, -0.69))
          : pos
            .clone()
            .add(
              new T.Vector3(
                Math.cos(cameraYaw) * 0.38,
                currentStance === 'lie'
                  ? 0.5
                  : currentStance === 'sit'
                    ? 1.05
                    : 1.5,
                -Math.sin(cameraYaw) * 0.38,
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
          const pelletBall = new T.Mesh(
            paintDropletGeo,
            new T.MeshBasicMaterial({ color }),
          );
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
      p.onFire(e);
      shotsFired++;
      if (now - lastShotsFlush >= 500) {
        lastShotsFlush = now;
        setShots(shotsFired);
      }
    };
    const capture = () => {
      if (latest.current.blocked || document.pointerLockElement === canvas)
        return;
      canvas.focus();
      setCaptureError('');
      const fallback = () => {
        softLook = true;
        activeControl = true;
        mouseInWorld = true;
        setActive(true);
        setCaptureError(
          'Обзор внутри окна · края экрана поворачивают камеру · Esc — курсор',
        );
      };
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
      capture,
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
        softLook = false;
        activeControl = false;
        setActive(false);
        if (document.pointerLockElement) document.exitPointerLock();
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
        cameraYaw = wrapAngle(cameraYaw + d);
        canvas.focus();
      },
      shadow: () => {
        renderer.shadowMap.needsUpdate = true;
      },
      distance: (d) => {
        distance = T.MathUtils.clamp(distance + d, 3, 17);
      },
      reset: () => {
        cameraYaw = heading;
        pitch = perspectiveRef.current === 'first' ? 0 : 0.16;
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
      if (crouchHeld) {
        currentStance = beforeCrouch;
        crouchHeld = false;
        setStance(currentStance);
      }
    };
    const onKey = (e: KeyboardEvent) => {
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
        const slot = slotForDigit(e.code);
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
          'ControlLeft',
          'ControlRight',
          'ShiftLeft',
          'ShiftRight',
          'Tab',
          'Backquote',
          'KeyE',
          'KeyF',
          'KeyV',
          'KeyR',
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
      if (e.code === 'Backquote' || e.key === 'ё' || e.key === 'Ё')
        latest.current.onMonitor(true);
      if (e.code === 'KeyR') beginReload();
      if (e.code.startsWith('Control') && !crouchHeld) {
        beforeCrouch = currentStance;
        crouchHeld = true;
        currentStance = 'sit';
        setStance('sit');
      }
      if (isDead()) return;
      const groundYNow = getGroundHeight(pos.x, pos.z, pos.y);
      if (e.code === 'Space' && Math.abs(pos.y - groundYNow) <= 0.08) {
        currentStance = 'stand';
        setStance('stand');
        vy = 5.7;
      }
      if (e.code === 'KeyC' && !crouchHeld) {
        const now = performance.now();
        currentStance =
          now - lastC < 360
            ? 'lie'
            : currentStance === 'stand'
              ? 'sit'
              : 'stand';
        lastC = now;
        setStance(currentStance);
      }
      if (e.code === 'KeyE' && nearZone) {
        engine.current?.pause();
        if (document.pointerLockElement) document.exitPointerLock();
        latest.current.onUseTool(nearZone);
        clear();
      }
      if (e.code === 'KeyF') engine.current?.reset();
      if (e.code === 'KeyV')
        choosePerspective(
          perspectiveRef.current === 'first' ? 'third' : 'first',
        );
      if (e.code.startsWith('Digit')) {
        const slot = slotForDigit(e.code);
        if (slot !== undefined) {
          latest.current.onTool(slot);
          aimHeld = false;
          setAiming(false);
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
      if (
        e.code.startsWith('Control') &&
        crouchHeld &&
        !keys.has('ControlLeft') &&
        !keys.has('ControlRight')
      ) {
        currentStance = beforeCrouch;
        crouchHeld = false;
        setStance(currentStance);
      }
      if (e.code === 'Backquote' || e.key === 'ё' || e.key === 'Ё')
        latest.current.onMonitor(false);
    };
    const onMouse = (e: MouseEvent) => {
      const b = canvas.getBoundingClientRect();
      mouseInWorld = e.target === canvas;
      mouse.set(
        ((e.clientX - b.left) / b.width) * 2 - 1,
        (-(e.clientY - b.top) / b.height) * 2 + 1,
      );
      if (latest.current.blocked || middle) return;
      if (
        document.pointerLockElement === canvas ||
        (softLook && mouseInWorld)
      ) {
        // Only filters pointer-lock spikes; ±120 used to cut real fast flicks.
        const mx = T.MathUtils.clamp(e.movementX, -400, 400);
        const my = T.MathUtils.clamp(e.movementY, -400, 400);
        // Scale sensitivity down when sniper is scoped
        const tool = GAME_TOOLS[latest.current.tool]?.id;
        const isSniperZoom = tool === 'sniper' && aimHeld;
        const zoomScale = isSniperZoom
          ? Math.max(0.12, 1 / (SNIPER_ZOOM_LEVELS[sniperZoomIndexRef.current] * 0.75))
          : 1;
        const sens = latest.current.sensitivity * zoomScale;
        cameraYaw = wrapAngle(cameraYaw - mx * 0.0023 * sens);
        pitch = T.MathUtils.clamp(
          pitch +
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
        const next = cycleSlot(latest.current.tool, e.deltaY > 0 ? 1 : -1);
        latest.current.onTool(next);
        aimHeld = false;
        setAiming(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (latest.current.blocked || middle) return;
      canvas.focus();
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
        } else if (t === 'pointer') {
          if (tabletInWorldRef.current) closeTabletInWorld();
          else openTabletInWorld();
        } else if (t === 'sticky') {
          engine.current?.pause();
          if (document.pointerLockElement) document.exitPointerLock();
          latest.current.onUseTool(selection.current.tabletZone || nearZone);
          clear();
        } else {
          ray.setFromCamera(
            document.pointerLockElement || softLook ? new T.Vector2() : mouse,
            camera,
          );
          const hit = ray.intersectObjects(kit.boards.map((b) => b.panel))[0];
          if (hit) {
            document.exitPointerLock();
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
      if (!captured) {
        softLook = false;
        clear();
      }
    };
    const context = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('mousemove', onMouse);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', clear);
    document.addEventListener('pointerlockchange', changed);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('contextmenu', context);
    canvas.addEventListener('auxclick', context);
    canvas.addEventListener('webglcontextlost', context);
    const blocked = (x: number, z: number, y = pos.y) =>
      isBlocked3D(x, z, y, 0.32, 1.8, ALL_3D_COLLIDERS);
    let life =
      latest.current.room.members.find((m) => m.id === latest.current.room.self)
        ?.life || 0;
    let nextFrame = 0;
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const frameInterval = 1000 / latest.current.fpsLimit;
      if (now + 0.8 < nextFrame) return;
      nextFrame += frameInterval;
      if (nextFrame < now - frameInterval) nextFrame = now + frameInterval;
      const dt = Math.min(0.06, (now - last) / 1000 || 0.033);
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
        pos.set(0, 0, 4);
        vy = 0;
        currentStance = 'stand';
        clear();
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
      let dx = 0,
        dz = 0;
      const control =
        enabled() && !latest.current.blocked && !middle && !isDead();
      if (control) {
        if (softLook && mouseInWorld && Math.abs(mouse.x) > 0.88)
          cameraYaw = wrapAngle(cameraYaw - Math.sign(mouse.x) * 1.35 * dt);
        dx = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
        dz = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
        cameraYaw = wrapAngle(
          cameraYaw +
          (Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'))) *
          dt *
          1.5,
        );
        pitch = T.MathUtils.clamp(
          pitch +
          (Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'))) *
          dt *
          0.8,
          -1.35,
          1.4,
        );
      }
      cameraYaw = wrapAngle(cameraYaw);
      const moving = !!(dx || dz),
        slow = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const speed =
        currentStance === 'lie'
          ? 0.65
          : currentStance === 'sit'
            ? 1.5
            : slow
              ? 2
              : aimHeld
                ? 3
                : 4.8;
      if (moving) {
        const len = Math.hypot(dx, dz);
        dx /= len;
        dz /= len;
        const vx = dx * Math.cos(cameraYaw) + dz * Math.sin(cameraYaw),
          vz = -dx * Math.sin(cameraYaw) + dz * Math.cos(cameraYaw);
        const nx = T.MathUtils.clamp(pos.x + vx * speed * dt, -36, 36),
          nz = T.MathUtils.clamp(pos.z + vz * speed * dt, -36, 36);

        // Try X movement with step-up assist:
        const nextGroundX = getGroundHeight(nx, pos.z, pos.y);
        const stepDeltaX = nextGroundX - pos.y;
        if (
          stepDeltaX <= 0.55 &&
          !blocked(nx, pos.z, Math.max(pos.y, nextGroundX))
        ) {
          pos.x = nx;
          if (stepDeltaX > 0.01 && pos.y < nextGroundX) {
            pos.y = T.MathUtils.lerp(pos.y, nextGroundX, Math.min(1, 20 * dt));
          }
        }

        // Try Z movement with step-up assist:
        const nextGroundZ = getGroundHeight(pos.x, nz, pos.y);
        const stepDeltaZ = nextGroundZ - pos.y;
        if (
          stepDeltaZ <= 0.55 &&
          !blocked(pos.x, nz, Math.max(pos.y, nextGroundZ))
        ) {
          pos.z = nz;
          if (stepDeltaZ > 0.01 && pos.y < nextGroundZ) {
            pos.y = T.MathUtils.lerp(pos.y, nextGroundZ, Math.min(1, 20 * dt));
          }
        }
      }
      heading = wrapAngle(followCameraHeading(heading, cameraYaw, dt));

      // Dynamic ground height detection & gravity:
      const groundY = getGroundHeight(pos.x, pos.z, pos.y);
      vy -= 13 * dt;
      pos.y = pos.y + vy * dt;
      if (pos.y <= groundY) {
        pos.y = groundY;
        vy = 0;
      }
      // Ceiling collision to prevent head clipping through floors/roofs:
      const ceilY = getCeilingHeight(pos.x, pos.z, pos.y);
      if (pos.y + 1.8 >= ceilY) {
        pos.y = ceilY - 1.8;
        if (vy > 0) vy = 0;
      }

      // Anti-stuck depenetration: guarantee player never gets stuck inside colliders
      const playerRadius = 0.32;
      const worldColliders = ALL_3D_COLLIDERS;
      for (const c of worldColliders) {
        if (
          pos.x + playerRadius > c.minX &&
          pos.x - playerRadius < c.maxX &&
          pos.z + playerRadius > c.minZ &&
          pos.z - playerRadius < c.maxZ
        ) {
          const feetY = pos.y + 0.35;
          const headY = pos.y + 1.75;
          if (headY > c.minY && feetY < c.maxY) {
            if (pos.y >= c.maxY - 0.55) {
              pos.y = c.maxY;
              if (vy < 0) vy = 0;
            } else {
              const overlapLeft = (pos.x + playerRadius) - c.minX;
              const overlapRight = c.maxX - (pos.x - playerRadius);
              const overlapBack = (pos.z + playerRadius) - c.minZ;
              const overlapFront = c.maxZ - (pos.z - playerRadius);
              const minOverlap = Math.min(overlapLeft, overlapRight, overlapBack, overlapFront);
              if (minOverlap === overlapLeft) pos.x = c.minX - playerRadius;
              else if (minOverlap === overlapRight) pos.x = c.maxX + playerRadius;
              else if (minOverlap === overlapBack) pos.z = c.minZ - playerRadius;
              else pos.z = c.maxZ + playerRadius;
            }
          }
        }
      }
      avatar.position.copy(pos);
      avatar.position.y += 0.27;
      avatar.rotation.y = heading;

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
          velocityY: vy,
          stance: currentStance,
          tool: GAME_TOOLS[latest.current.tool]?.id || 'pointer',
          variant: selection.current.grenadeStyle,
          pitch,
          working: latest.current.working,
          crouching: crouchHeld,
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
        eyeHeight(currentStance),
        1 - Math.exp(-10 * dt),
      );
      const mode = perspectiveRef.current;
      const view = cameraFrame(
        pos,
        cameraYaw,
        pitch,
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
      for (let i = 0; i < STATIONS.length; i++) {
        if (latest.current.room.state.template === 'three' && i === 1) continue;
        const [x, z] = STATIONS[i];
        if (Math.hypot(pos.x - x, pos.z - z) < 6) nearest = ZONES[i].id;
      }
      if (nearest !== nearZone) {
        nearZone = nearest;
        setNear(nearest);
      }
      remotePlayers.update(now, dt);
      projectiles.update(now, currentStance);
      vfx.update(now, dt);
      if (now - poseAt > 120) {
        latest.current.onPose({
          x: pos.x,
          z: pos.z,
          y: pos.y,
          yaw: heading,
          stance: currentStance,
          moving,
          speed: moving ? speed : 0,
          strafe: dx,
          forward: -dz,
          pitch,
          tool: [
            'paint',
            'confetti',
            'grenade',
            'sniper',
            'sticky',
            'pointer',
          ].includes(GAME_TOOLS[latest.current.tool]?.id)
            ? GAME_TOOLS[latest.current.tool].id
            : 'other',
          variant: selection.current.grenadeStyle,
          working: latest.current.working || middle,
          crouching: crouchHeld,
          aiming: aimHeld,
          reload: magazine.current.progress(now),
        });
        poseAt = now;
      }
      kit.clouds.position.x = Math.sin(now * 0.000015) * 2;
      kit.animate(now / 1000);
      // Keyed on live remote avatars so the pack re-syncs (and releases removed actors) on add/remove.
      const meteredExposure = visuals.update(dt, camera, latest.current.room.state,
        remotePlayers.remoteKey);
      remotePlayers.disposeRetired();
      if (meteredExposure !== undefined)
        renderer.toneMappingExposure = T.MathUtils.damp(renderer.toneMappingExposure, meteredExposure, 1.6, dt);
      optics.enabled = visuals.active;
      optics.uniforms.time.value = now / 1000;
      if (visuals.active && !composer) {
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        composer.addPass(new OutputPass());
        composer.addPass(optics);
        const size = renderer.getSize(new T.Vector2()); composer.setSize(size.x, size.y);
      }
      if (composer && (isCinematic || isBalanced || visuals.active)) {
        if (bloom)
          bloom.strength =
            visuals.active ? visualBudget(props.quality).bloom : latest.current.room.state.visualStyle === 'anime' ? 0.1 : 0.22;
        composer.render(dt);
      } else renderer.render(scene, camera);
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
      window.removeEventListener('blur', clear);
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
      projectiles.dispose();
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
  }, [props.quality, openTabletInWorld, closeTabletInWorld]);
  useEffect(() => {
    engine.current?.kit.update(latest.current.room.state);
    engine.current?.visuals.invalidate();
    engine.current?.shadow();
    engine.current?.refreshTargets();
  }, [
    props.room.state.theme,
    props.room.state.visualStyle,
    props.room.state.time,
    props.room.state.season,
    props.room.state.interior,
  ]);
  useEffect(() => {
    engine.current?.kit.setNotes(latest.current.room.state);
  }, [props.room.version]);
  useEffect(() => {
    for (const effect of props.room.effects || []) engine.current?.fire(effect);
  }, [props.room.effects]);
  useEffect(() => {
    void engine.current?.visuals
      .select(resourcePack, latest.current.room.state)
      .then(() => engine.current?.refreshTargets());
  }, [resourcePack]);
  const current = GAME_TOOLS[props.tool];
  return (
    <div
      className={`world-container ${active ? 'play-active' : ''} ${props.room.state.visualStyle === 'anime' ? 'anime-world' : 'tactical-world'} ${aiming ? 'is-aiming' : ''}`}
    >
      <div ref={mount} className="world-canvas" data-visual-pack={packStatus === 'ready' ? 'realistic-bodycam' : 'default'} />
      {packStatus === 'ready' && <div className="field-camera-mark" aria-hidden="true"><span>JNL / FIELD 01</span><span>● LIVE VIEW · {perspective === 'first' ? 'FPP' : 'TPP'}</span></div>}
      {packStatus === 'loading' && <output className="pack-status">Подготовка визуального пакета…</output>}
      {packStatus === 'error' && <div role="alert" className="pack-status">Пакет не загрузился. Игра продолжается с Default.</div>}
      <WorldHud
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
        shieldSeconds={shieldSeconds}
        killfeed={killfeed}
        personalAlert={personalAlert}
        respawnSeconds={respawnSeconds}
      />
      {tabletInWorld && (
        <WorldTablet
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
      <div className="camera-toolbar">
        <span>
          <Camera size={14} />
          КАМЕРА
        </span>
        <button
          onClick={() => engine.current?.orbit(0.4)}
          aria-label="Повернуть камеру влево"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => engine.current?.orbit(-0.4)}
          aria-label="Повернуть камеру вправо"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={() => engine.current?.distance(-1.5)}
          disabled={perspective === 'first'}
          aria-label="Приблизить камеру"
        >
          <Plus size={16} />
        </button>
        <button
          onClick={() => engine.current?.distance(1.5)}
          disabled={perspective === 'first'}
          aria-label="Отдалить камеру"
        >
          <Minus size={16} />
        </button>
        <button
          onClick={() => engine.current?.reset()}
          aria-label="Камера за персонажем"
        >
          <RotateCcw size={16} />
        </button>
        <button
          className={locked ? 'enabled' : ''}
          onClick={() => (locked ? document.exitPointerLock() : lock())}
          aria-label={locked ? 'Освободить курсор' : 'Играть: свободная камера'}
        >
          <Crosshair size={16} />
        </button>
      </div>
      {!active && !radial && !contextWheel && !dead && !props.blocked && (
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
      {['paint', 'confetti', 'sniper'].includes(current?.id) && (
        <div
          className={`ammo-panel ${reloading ? 'is-reloading' : ''}`}
          aria-live="polite"
        >
          <span>{reloading ? 'ПЕРЕЗАРЯДКА' : current.label}</span>
          <strong>
            {rounds[current.id as Blaster]}{' '}
            <small>/ {CAPACITY[current.id as Blaster]}</small>
          </strong>
          <div>
            <kbd>R</kbd> перезарядить <i /> <kbd>ПКМ</kbd> прицел
          </div>
        </div>
      )}
      <div className="equipped-card">
        <span className="weapon-number">{current?.key}</span>
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
      <div className="world-help">
        <span>
          <kbd>Мышь</kbd> камера · <kbd>Esc</kbd> курсор
        </span>
        <span>
          <kbd>V</kbd> 1-е / 3-е лицо · <kbd>WASD</kbd> движение
        </span>
        <span>
          <kbd>Пробел</kbd> прыжок
        </span>
        <span>
          <kbd>C</kbd> сесть · 2×C лечь
        </span>
        <span>
          <kbd>Ctrl</kbd> присесть
        </span>
        <span>
          <kbd>Shift</kbd> шаг
        </span>
        <span>
          <kbd>Ё</kbd> кто в сети
        </span>
        <span>
          <kbd>1–6</kbd> оружие · <kbd>Колесо</kbd> сменить · <kbd>СКМ</kbd> стили
        </span>
      </div>
      <div className="quick-loadout" aria-label="Быстрые предметы">
        {QUICK_SLOTS.map((slot) => {
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
          ? 'Выбрать краску'
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
            current.id === 'paint'
              ? 'Палитра'
              : current.id === 'confetti'
                ? 'Набор конфетти'
                : current.id === 'grenade'
                  ? 'Пиньято'
                  : current.id === 'sniper'
                    ? 'Фейерверки'
                    : current.id === 'sticky'
                      ? 'Зона стикера'
                      : 'Планшет'
          }
          items={
            current.id === 'paint'
              ? PAINTS
              : current.id === 'confetti'
                ? CONFETTI
                : current.id === 'grenade'
                  ? GRENADES
                  : current.id === 'sniper'
                    ? FIREWORKS
                    : current.id === 'sticky'
                      ? ZONES.map((z) => ({
                        id: z.id,
                        label: z.title,
                        color: z.color,
                        icon: z.emoji,
                      }))
                      : [
                        {
                          id: 'board',
                          label: 'Открыть доску',
                          color: '#64d4ef',
                          icon: '📱',
                        },
                      ]
          }
          selected={
            current.id === 'paint'
              ? PAINTS.find((p) => p.color === props.paintColor)?.id || 'violet'
              : current.id === 'confetti'
                ? confettiStyle
                : current.id === 'grenade'
                  ? grenadeStyle
                  : current.id === 'sniper'
                    ? fireworkStyle
                    : current.id === 'sticky'
                      ? tabletZone
                      : 'board'
          }
          onSelect={(id: string) => {
            if (current.id === 'paint')
              props.onPaintColor(PAINTS.find((p) => p.id === id)!.color);
            else if (current.id === 'confetti') setConfettiStyle(id);
            else if (current.id === 'grenade') setGrenadeStyle(id);
            else if (current.id === 'sniper') setFireworkStyle(id);
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
            {QUICK_SLOTS.map((slot) => {
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
          <h3>Работа с ретроспективой</h3>
          <p>
            Инструмент сразу откроет обычную доску. В 3D нажмите E рядом со
            стендом.
          </p>
          <div className="equipment-retro">
            {GAME_TOOLS.filter(
              (t) =>
                ![
                  'paint',
                  'confetti',
                  'grenade',
                  'sniper',
                  'sticky',
                  'reaction',
                  'pointer',
                  'like',
                ].includes(t.id),
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  engine.current?.closeInventory(false);
                  props.onBoardTool(t.id);
                }}
              >
                {t.label}
                <span>Открыть доску ↗</span>
              </button>
            ))}
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
        <button onClick={() => props.onMonitor(true)}>
          <Users />В сети
        </button>
      </div>
      <output className="sr-only">
        Выстрелов: {shots}. Поза: {stance}.
      </output>
    </div>
  );
}
