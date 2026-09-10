'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  type Pose,
  type Room,
  type WorldEffect,
} from '@/lib/model';
import { createWorldScene, STATIONS } from './world-scene';
import { createFirstPersonHands } from './world-hands';
import { ItemWheel } from './item-wheel';
import { PAINTS, CONFETTI, GRENADES } from '@/lib/game-items';
import { partyGeometry, grenadeParty, makeGrenade } from './party-geometry';
import { setAvatarAnonymous } from './world-avatar';
import { AvatarPreview } from './avatar-preview';
import { QUICK_SLOTS, slotForDigit } from '@/lib/loadout';
import { ToolMagazine, CAPACITY, type Blaster } from '@/lib/tool-magazine';
import {
  blocksCamera,
  blocksProjectile,
  cameraFrame,
  eyeHeight,
  firstProjectileHit,
  avoidCameraWalls,
  visibleInWorld,
  type Perspective,
} from '@/lib/game-camera';
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
  X,
} from 'lucide-react';
type Props = {
  room: Room;
  quality: string;
  fps: number;
  fpsLimit: number;
  now: number;
  onGraphics: () => void;
  onPaintColor: (color: string) => void;
  tool: number;
  onTool: (n: number) => void;
  onZone: (z: string) => void;
  onUseTool: (zone: string) => void;
  onBoardTool: (tool: string) => void;
  sensitivity: number;
  invertCamera: boolean;
  onPose: (p: Pose) => void;
  onMonitor: (v: boolean) => void;
  onFps: (v: number) => void;
  onAction: (kind: string) => void;
  onFire: (effect: WorldEffect) => void;
  onFailure: () => void;
  blocked: boolean;
  working?: boolean;
  paintColor: string;
};
type Particle = {
  mesh: T.InstancedMesh;
  velocity: T.Vector3[];
  positions: T.Vector3[];
  rotations: T.Euler[];
  born: number;
};
type Flight = {
  mesh: T.Object3D;
  variant: string;
  origin: T.Vector3;
  target: T.Vector3;
  normal: T.Vector3;
  born: number;
  duration: number;
  color: string;
  kind: string;
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
export default function World(props: Props) {
  const mount = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  }, [props]);
  const [contextWheel, setContextWheel] = useState(false);
  const [confettiStyle, setConfettiStyle] = useState('classic');
  const [grenadeStyle, setGrenadeStyle] = useState('pinata');
  const [tabletZone, setTabletZone] = useState('good');
  const selection = useRef({ confettiStyle, grenadeStyle, tabletZone });
  useEffect(() => {
    selection.current = { confettiStyle, grenadeStyle, tabletZone };
  }, [confettiStyle, grenadeStyle, tabletZone]);
  const self = props.room.members.find((m) => m.id === props.room.self);
  const dead = self?.hp === 0;
  const magazine = useRef(new ToolMagazine());
  const [showAgent, setShowAgent] = useState(false);
  const [rounds, setRounds] = useState({ ...CAPACITY }),
    [reloading, setReloading] = useState(false),
    [aiming, setAiming] = useState(false);
  const [locked, setLocked] = useState(false),
    [radial, setRadial] = useState(false),
    [near, setNear] = useState(''),
    [stance, setStance] = useState('stand'),
    [active, setActive] = useState(false),
    [shots, setShots] = useState(0),
    [captureError, setCaptureError] = useState('');
  const engine = useRef<{
    kit: ReturnType<typeof createWorldScene>;
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
  } | null>(null);
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
    } catch {}
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
        powerPreference: 'low-power',
      });
    } catch {
      latest.current.onFailure();
      return;
    }
    const kit = createWorldScene(renderer),
      { scene } = kit;
    renderer.setPixelRatio(
      Math.min(devicePixelRatio, props.quality === 'high' ? 1.5 : 1),
    );
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = props.quality === 'high';
    kit.sunlight.shadow.mapSize.setScalar(
      props.quality === 'high' ? 2048 : 1024,
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
    if (props.quality === 'high') {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new T.Vector2(1, 1), 0.22, 0.45, 1.05);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    }
    const avatar = kit.avatarFactory(
      latest.current.room.members.find((m) => m.id === latest.current.room.self)
        ?.color || '#718cdd',
    );
    avatar.traverse((o) => {
      if (o instanceof T.Mesh) o.castShadow = props.quality === 'high';
    });
    scene.add(avatar);
    const remoteAvatars = new Map<string, T.Group>(),
      labels = new Map<string, T.Sprite>();
    const addLabel = (name: string, color: string) => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#182237de';
      ctx.roundRect(0, 0, 256, 60, 15);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(8, 13, 4, 30);
      ctx.fillStyle = '#fff';
      ctx.font = '500 23px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name.slice(0, 18), 132, 39);
      const tex = new T.CanvasTexture(c);
      tex.colorSpace = T.SRGBColorSpace;
      const sprite = new T.Sprite(
        new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
      );
      sprite.scale.set(1.8, 0.45, 1);
      sprite.position.y = 2.55;
      return sprite;
    };
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
    const keys = new Set<string>(),
      ray = new T.Raycaster(),
      mouse = new T.Vector2(0, 0),
      splats: { mesh: T.Mesh; born: number }[] = [],
      flights: Flight[] = [],
      bursts: Particle[] = [],
      seen = new Set<string>();
    const dummy = new T.Object3D(),
      paintGeo = new T.SphereGeometry(0.105, 7, 5),
      confettiGeo = new T.PlaneGeometry(0.07, 0.13),
      normalUp = new T.Vector3(0, 0, 1);
    const partyGeometries = new Map(
      CONFETTI.map((c) => [c.id, partyGeometry(c.id)]),
    );
    const burst = (
      at: T.Vector3,
      color: string,
      now: number,
      style = 'classic',
    ) => {
      const count = props.quality === 'high' ? 70 : 40;
      const mesh = new T.InstancedMesh(
        partyGeometries.get(style) || confettiGeo,
        new T.MeshBasicMaterial({ side: T.DoubleSide, transparent: true }),
        count,
      );
      const velocity: T.Vector3[] = [],
        positions: T.Vector3[] = [],
        rotations: T.Euler[] = [];
      for (let i = 0; i < count; i++) {
        const a = i * 2.399;
        velocity.push(
          new T.Vector3(
            Math.cos(a) * (1 + (i % 5) * 0.3),
            1.8 + (i % 7) * 0.35,
            Math.sin(a) * (1 + (i % 4) * 0.4),
          ),
        );
        positions.push(at.clone());
        rotations.push(new T.Euler(a, a * 0.7, a * 1.2));
        mesh.setColorAt(
          i,
          new T.Color(
            style === 'snow'
              ? '#e7f7ff'
              : style === 'hearts'
                ? ['#ff647c', '#ffb1c8'][i % 2]
                : style === 'digital'
                  ? ['#7fe0b8', '#b6ffe5'][i % 2]
                  : [color, '#c8b6ff', '#80d8fa', '#ffbfd8', '#ffe29b'][i % 5],
          ),
        );
        dummy.position.copy(at);
        dummy.rotation.copy(rotations[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      scene.add(mesh);
      bursts.push({ mesh, velocity, positions, rotations, born: now });
    };
    const splat = (
      at: T.Vector3,
      normal: T.Vector3,
      color: string,
      now: number,
    ) => {
      const shape = new T.Shape();
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2,
          r = 0.38 + Math.sin(a * 7) * 0.09 + Math.cos(a * 5) * 0.06;
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const decal = new T.Mesh(
        new T.ShapeGeometry(shape),
        new T.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          side: T.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
        }),
      );
      decal.position.copy(at).addScaledVector(normal, 0.035);
      decal.quaternion.setFromUnitVectors(normalUp, normal.normalize());
      decal.userData.projectileCollision = 'ignore';
      scene.add(decal);
      splats.push({ mesh: decal, born: now });
    };
    const spawn = (e: WorldEffect) => {
      if (
        seen.has(e.id) ||
        Date.now() - e.at > (e.kind === 'paint' ? 14000 : 5000)
      )
        return;
      seen.add(e.id);
      const remote = remoteAvatars.get(e.author);
      if (remote) avatarShoot(remote);
      if (seen.size > 200) {
        const first = seen.values().next().value;
        if (first) seen.delete(first);
      }
      const start = new T.Vector3(...e.origin),
        target = new T.Vector3(...e.target),
        normal = new T.Vector3(...e.normal).normalize();
      const ball =
        e.kind === 'grenade'
          ? makeGrenade(e.color, e.variant)
          : new T.Mesh(paintGeo, new T.MeshBasicMaterial({ color: e.color }));
      ball.position.copy(start);
      scene.add(ball);
      flights.push({
        mesh: ball,
        origin: start,
        target,
        normal,
        born: performance.now() - Math.max(0, Date.now() - e.at),
        duration:
          e.kind === 'grenade'
            ? 1100
            : Math.max(130, start.distanceTo(target) * 22),
        variant: e.variant || 'classic',
        color: e.color,
        kind: e.kind,
      });
    };
    const updateAmmo = () => {
      setRounds({ ...magazine.current.rounds });
      setReloading(magazine.current.reloading);
    };
    const beginReload = () => {
      const tool = GAME_TOOLS[latest.current.tool]?.id;
      if (tool === 'paint' || tool === 'confetti') {
        magazine.current.reload(tool, performance.now());
        aimHeld = false;
        setAiming(false);
        updateAmmo();
      }
    };
    let lastGrenade = -Infinity;
    const isDead = () =>
      latest.current.room.members.find((m) => m.id === latest.current.room.self)
        ?.hp === 0;
    const shoot = () => {
      const p = latest.current;
      if (p.blocked || middle || isDead() || p.room.state.archived) return;
      const tool = GAME_TOOLS[p.tool]?.id;
      if (tool !== 'paint' && tool !== 'confetti' && tool !== 'grenade') return;
      const now = performance.now();
      if (tool === 'grenade') {
        if (now - lastGrenade < 1500) return;
        lastGrenade = now;
      }
      if (tool !== 'grenade' && !magazine.current.fire(tool, now)) {
        if (magazine.current.reloading) setReloading(true);
        return;
      }
      updateAmmo();
      ray.setFromCamera(
        document.pointerLockElement || softLook ? new T.Vector2(0, 0) : mouse,
        camera,
      );
      const targets: T.Object3D[] = [];
      scene.traverse((o) => {
        if (
          o instanceof T.Mesh &&
          visibleInWorld(o) &&
          !hands.group.getObjectById(o.id) &&
          !avatar.getObjectById(o.id) &&
          o !== shadow &&
          blocksProjectile(o) &&
          !flights.some((f) => f.mesh === o) &&
          !bursts.some((b) => b.mesh === o)
        )
          targets.push(o);
      });
      ray.far = 65;
      const hit = firstProjectileHit(ray, targets);
      ray.far = Infinity;
      const target = hit ? hit.point : ray.ray.at(35, new T.Vector3());
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
      const obstruction = firstProjectileHit(muzzleRay, targets, 0.01);
      if (obstruction) {
        target.copy(obstruction.point);
        origin.copy(camera.position);
        if (obstruction.face)
          normal
            .copy(obstruction.face.normal)
            .transformDirection(obstruction.object.matrixWorld);
      }
      // The camera ray only selects the aim point. The projectile itself starts
      // at the muzzle, so test its shifted path as well; otherwise it can clip
      // through the edge of a wall beside the crosshair.
      const flight = target.clone().sub(origin);
      const flightDistance = flight.length();
      if (flightDistance > 0.001) {
        const flightRay = new T.Raycaster(
          origin,
          flight.normalize(),
          0,
          flightDistance + 0.02,
        );
        const impact = firstProjectileHit(flightRay, targets, 0.01);
        if (impact) {
          target.copy(impact.point);
          if (impact.face)
            normal
              .copy(impact.face.normal)
              .transformDirection(impact.object.matrixWorld);
        }
      }
      const e: WorldEffect = {
        id: crypto.randomUUID(),
        kind: tool,
        origin: origin.toArray(),
        target: target.toArray(),
        normal: normal.toArray(),
        color:
          tool === 'grenade'
            ? GRENADES.find((g) => g.id === selection.current.grenadeStyle)!
                .color
            : tool === 'confetti'
              ? CONFETTI.find((c) => c.id === selection.current.confettiStyle)!
                  .color
              : p.paintColor,
        variant:
          tool === 'grenade'
            ? selection.current.grenadeStyle
            : selection.current.confettiStyle,
        author: p.room.self,
        at: Date.now(),
      };
      spawn(e);
      avatarShoot(avatar);
      hands.shoot();
      p.onFire(e);
      setShots((v) => v + 1);
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
      orbit: (d) => {
        cameraYaw += d;
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
      if (e.code === 'Tab') latest.current.onMonitor(true);
      if (e.code === 'KeyR') beginReload();
      if (e.code.startsWith('Control') && !crouchHeld) {
        beforeCrouch = currentStance;
        crouchHeld = true;
        currentStance = 'sit';
        setStance('sit');
      }
      if (isDead()) return;
      if (e.code === 'Space' && pos.y <= 0.01) {
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
      if (
        e.code === 'KeyE' &&
        (nearZone || GAME_TOOLS[latest.current.tool]?.id === 'pointer')
      ) {
        engine.current?.pause();
        if (document.pointerLockElement) document.exitPointerLock();
        latest.current.onUseTool(
          GAME_TOOLS[latest.current.tool]?.id === 'pointer'
            ? selection.current.tabletZone
            : nearZone,
        );
        clear();
      }
      if (e.code === 'KeyF') engine.current?.reset();
      if (e.code === 'KeyV')
        choosePerspective(
          perspectiveRef.current === 'first' ? 'third' : 'first',
        );
      if (e.code.startsWith('Digit')) {
        const slot = slotForDigit(e.code);
        if (slot !== undefined) latest.current.onTool(slot);
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
      if (e.code === 'Tab') latest.current.onMonitor(false);
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
        cameraYaw -= e.movementX * 0.0023 * latest.current.sensitivity;
        pitch = T.MathUtils.clamp(
          pitch +
            e.movementY *
              0.002 *
              latest.current.sensitivity *
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
      if (e.altKey) engine.current?.distance(e.deltaY > 0 ? 1 : -1);
      else engine.current?.openContext();
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
        aimHeld =
          (tool === 'paint' || tool === 'confetti') &&
          !magazine.current.reloading;
        setAiming(aimHeld);
      } else if (e.button === 0) {
        if (document.pointerLockElement !== canvas && !softLook) {
          capture();
          return;
        }
        left = true;
        const t = GAME_TOOLS[latest.current.tool]?.id;
        if (t === 'paint' || t === 'confetti' || t === 'grenade') shoot();
        else {
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
      if (e.button === 0) left = false;
      if (e.button === 2) {
        aimHeld = false;
        setAiming(false);
      }
      // Отпускание колеса не выбирает предмет: выбор подтверждается кликом.
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
    const blocked = (x: number, z: number) =>
      kit.colliders.some((c) => {
        if (latest.current.room.state.interior && c.z === -18) return false;
        return (
          Math.abs(x - c.x) < c.w / 2 + 0.28 &&
          Math.abs(z - c.z) < c.d / 2 + 0.28
        );
      });
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
      if (left && enabled() && !middle && !latest.current.blocked) shoot();
      let dx = 0,
        dz = 0;
      const control =
        enabled() && !latest.current.blocked && !middle && !isDead();
      if (control) {
        if (softLook && mouseInWorld && Math.abs(mouse.x) > 0.88)
          cameraYaw -= Math.sign(mouse.x) * 1.35 * dt;
        dx = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
        dz = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
        cameraYaw +=
          (Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'))) *
          dt *
          1.5;
        pitch = T.MathUtils.clamp(
          pitch +
            (Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'))) *
              dt *
              0.8,
          -1.35,
          1.4,
        );
      }
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
        const nx = T.MathUtils.clamp(pos.x + vx * speed * dt, -22, 22),
          nz = T.MathUtils.clamp(pos.z + vz * speed * dt, -23, 23);
        if (!blocked(nx, pos.z)) pos.x = nx;
        if (!blocked(pos.x, nz)) pos.z = nz;
      }
      heading = followCameraHeading(heading, cameraYaw, dt);
      vy -= 13 * dt;
      pos.y = Math.max(0, pos.y + vy * dt);
      if (pos.y === 0) vy = 0;
      avatar.position.copy(pos);
      avatar.position.y += 0.27;
      avatar.rotation.y = heading;
      animateAvatar(
        avatar,
        {
          speed: moving ? speed : 0,
          strafe: dx,
          forward: -dz,
          airborne: pos.y > 0.005,
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
        },
        dt,
        now / 1000,
      );
      shadow.position.set(pos.x, 0.24, pos.z);
      shadow.scale.setScalar(Math.max(0.5, 1 - pos.y * 0.1));
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
      const desired =
        mode === 'third'
          ? avoidCameraWalls(view.eye, view.position, cameraObstacles)
          : view.position;
      // При приближении к стене сокращаем дистанцию сразу, возвращаем её плавно.
      if (
        mode === 'first' ||
        camera.position.distanceTo(view.eye) >
          desired.distanceTo(view.eye) + 0.1
      )
        camera.position.copy(desired);
      else camera.position.lerp(desired, 1 - Math.exp(-14 * dt));
      camera.lookAt(
        camera.position.clone().addScaledVector(view.direction, 30),
      );
      avatar.visible = mode === 'third' && !isDead();
      shadow.visible = mode === 'third' && !isDead();
      hands.update(
        dt,
        now / 1000,
        moving ? speed : 0,
        GAME_TOOLS[latest.current.tool]?.id || 'other',
        GAME_TOOLS[latest.current.tool]?.id === 'confetti'
          ? CONFETTI.find((c) => c.id === selection.current.confettiStyle)!
              .color
          : latest.current.paintColor,
        mode === 'first' && !middle && !latest.current.working && !isDead(),
        aimBlend,
        magazine.current.progress(now),
        GAME_TOOLS[latest.current.tool]?.id === 'pointer'
          ? selection.current.tabletZone
          : selection.current.grenadeStyle,
      );
      const fov = T.MathUtils.lerp(
        camera.fov,
        T.MathUtils.lerp(
          mode === 'first' ? 80 : 68,
          mode === 'first' ? 56 : 50,
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
      for (const member of latest.current.room.members) {
        if (member.id === latest.current.room.self) continue;
        let remote = remoteAvatars.get(member.id);
        if (!remote) {
          remote = kit.avatarFactory(member.color);
          remoteAvatars.set(member.id, remote);
          remote.traverse((o) => {
            if (o instanceof T.Mesh) o.castShadow = props.quality === 'high';
          });
          scene.add(remote);
          const label = addLabel(member.name, member.color);
          labels.set(member.id, label);
          remote.add(label);
        }
        remote.visible =
          Date.now() - member.lastSeen < 15000 && member.hp !== 0;
        setAvatarAnonymous(
          remote,
          !!latest.current.room.state.anonymousPlayers,
        );
        const caption = latest.current.room.state.anonymousPlayers
          ? `${member.hp ?? 100} HP`
          : `${member.name.slice(0, 12)} · ${member.hp ?? 100}`;
        let label = labels.get(member.id);
        if (label?.userData.caption !== caption) {
          if (label) {
            label.removeFromParent();
            label.material.map?.dispose();
            label.material.dispose();
          }
          label = addLabel(caption, member.color);
          label.userData.caption = caption;
          labels.set(member.id, label);
          remote.add(label);
        }

        const p = member.pose;
        remote.position.lerp(
          new T.Vector3(p.x, p.y + 0.27, p.z),
          Math.min(1, dt * 7),
        );
        remote.rotation.y = p.yaw;
        animateAvatar(
          remote,
          {
            speed: p.speed ?? (p.moving ? 3.4 : 0),
            strafe: p.strafe || 0,
            forward: p.forward ?? 1,
            airborne: p.y > 0.01,
            velocityY: 0,
            stance: p.stance,
            tool: p.tool || 'other',
            variant: p.variant,
            pitch: p.pitch || 0,
            working: p.working,
            crouching: p.crouching,
            aiming: p.aiming,
            reload: p.reload,
          },
          dt,
          now / 1000,
        );
      }
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i],
          t = Math.min(1, (now - f.born) / f.duration);
        f.mesh.position.lerpVectors(f.origin, f.target, t);
        if (f.kind === 'grenade') {
          f.mesh.position.y += Math.sin(t * Math.PI) * 3;
          f.mesh.rotation.z = t * 7;
        }
        if (t >= 1) {
          if (f.kind === 'paint')
            splat(f.target, f.normal, f.color, f.born + f.duration);
          else {
            burst(
              f.target,
              f.color,
              f.born + f.duration,
              f.kind === 'grenade' ? grenadeParty(f.variant) : f.variant,
            );
            if (f.kind === 'grenade' && f.variant === 'paintburst')
              splat(f.target, f.normal, f.color, f.born + f.duration);
          }
          f.mesh.removeFromParent();
          f.mesh.traverse((o) => {
            if (o instanceof T.Mesh) {
              (o.material as T.Material).dispose();
              if (f.kind === 'grenade') o.geometry.dispose();
            }
          });
          flights.splice(i, 1);
        }
      }
      for (let i = splats.length - 1; i >= 0; i--) {
        const p = splats[i],
          age = (now - p.born) / 1000;
        (p.mesh.material as T.MeshBasicMaterial).opacity =
          0.9 * Math.min(1, (12 - age) / 3);
        if (age >= 12) {
          p.mesh.removeFromParent();
          p.mesh.geometry.dispose();
          (p.mesh.material as T.Material).dispose();
          splats.splice(i, 1);
        }
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i],
          age = (now - b.born) / 1000;
        for (let j = 0; j < b.positions.length; j++) {
          b.velocity[j].y -= 2.4 * dt;
          b.positions[j].addScaledVector(b.velocity[j], dt);
          b.rotations[j].x += dt * 3;
          b.rotations[j].z += dt * (j % 2 ? 2 : -2);
          dummy.position.copy(b.positions[j]);
          dummy.rotation.copy(b.rotations[j]);
          dummy.updateMatrix();
          b.mesh.setMatrixAt(j, dummy.matrix);
        }
        b.mesh.instanceMatrix.needsUpdate = true;
        (b.mesh.material as T.MeshBasicMaterial).opacity = Math.min(1, 4 - age);
        if (age > 4) {
          b.mesh.removeFromParent();
          (b.mesh.material as T.Material).dispose();
          bursts.splice(i, 1);
        }
      }
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
          tool: ['paint', 'confetti', 'grenade', 'pointer'].includes(
            GAME_TOOLS[latest.current.tool]?.id,
          )
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
      if (composer) {
        if (bloom)
          bloom.strength =
            latest.current.room.state.visualStyle === 'anime' ? 0.1 : 0.22;
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
      paintGeo.dispose();
      confettiGeo.dispose();
      partyGeometries.forEach((g) => g.dispose());
      kit.dispose();
      composer?.passes.forEach((pass) => pass.dispose());
      composer?.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [props.quality]);
  useEffect(() => {
    engine.current?.kit.update(latest.current.room.state);
    engine.current?.shadow();
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
  const current = GAME_TOOLS[props.tool];
  return (
    <div
      className={`world-container ${active ? 'play-active' : ''} ${props.room.state.visualStyle === 'anime' ? 'anime-world' : 'tactical-world'} ${aiming ? 'is-aiming' : ''}`}
    >
      <div ref={mount} className="world-canvas" />
      <div className="crosshair modern-crosshair">
        <i />
        <i />
      </div>
      <button
        className="world-location world-performance"
        onClick={props.onGraphics}
        aria-label="Настройки FPS"
      >
        <span className="live-dot" />
        <div>
          <strong>
            {props.fps} FPS <span> / {props.fpsLimit}</span>
          </strong>
          <span>{self?.ping || 0} мс · Графика и FPS ↗</span>
        </div>
      </button>
      <div className={`health-hud ${dead ? 'depleted' : ''}`}>
        <strong>{self?.hp ?? 100}</strong>
        <span>HP</span>
        <meter
          min="0"
          max="100"
          value={self?.hp ?? 100}
          aria-label="Здоровье"
        />
      </div>
      {dead && (
        <div className="respawn-overlay">
          <span>ПЕРЕРЫВ НА КОНФЕТТИ</span>
          <strong>
            {Math.max(
              0,
              Math.ceil(((self?.respawnAt || 0) - props.now) / 1000),
            )}
          </strong>
          <p>Возрождение через несколько секунд</p>
        </div>
      )}
      <fieldset className="view-switch" aria-label="Режим обзора">
        <button
          aria-pressed={perspective === 'first'}
          onClick={() => choosePerspective('first')}
        >
          1-е лицо <span>FPP</span>
        </button>
        <button
          aria-pressed={perspective === 'third'}
          onClick={() => choosePerspective('third')}
        >
          3-е лицо <span>TPP</span>
        </button>
        <kbd>V</kbd>
      </fieldset>
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
      {['paint', 'confetti'].includes(current?.id) && (
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
        ) : (
          <MousePointer2 size={21} />
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
          <kbd>Tab</kbd> кто в сети
        </span>
        <span>
          <kbd>1–4</kbd> предмет · <kbd>Q</kbd> снаряжение
        </span>
      </div>
      <div className="quick-loadout" aria-label="Быстрые предметы">
        {QUICK_SLOTS.map((slot, i) => {
          const Icon = [Crosshair, PartyPopper, Tablet, Bomb][i];
          return (
            <button
              key={slot.key}
              aria-pressed={props.tool === slot.index}
              onClick={() => props.onTool(slot.index)}
              title={slot.hint}
            >
              <kbd>{slot.key}</kbd>
              <Icon size={24} />
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
        onClick={() => engine.current?.openContext()}
      >
        <span style={{ color: props.paintColor }}>
          {current.id === 'paint'
            ? '●'
            : current.id === 'confetti'
              ? CONFETTI.find((c) => c.id === confettiStyle)?.icon
              : current.id === 'grenade'
                ? GRENADES.find((g) => g.id === grenadeStyle)?.icon
                : '▤'}
        </span>
        {current.id === 'paint'
          ? 'Выбрать краску'
          : current.id === 'confetti'
            ? CONFETTI.find((c) => c.id === confettiStyle)?.label
            : current.id === 'grenade'
              ? GRENADES.find((c) => c.id === grenadeStyle)?.label
              : tabletZone}
        <kbd>Колесо</kbd>
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
                  ? 'Гранаты'
                  : 'Планшет'
          }
          items={
            current.id === 'paint'
              ? PAINTS
              : current.id === 'confetti'
                ? CONFETTI
                : current.id === 'grenade'
                  ? GRENADES
                  : ['good', 'bad', 'stop', 'start'].map((id) => ({
                      id,
                      label: id,
                      color: ZONES.find((z) => z.id === id)!.color,
                      icon: '▤',
                    }))
          }
          selected={
            current.id === 'paint'
              ? PAINTS.find((p) => p.color === props.paintColor)?.id || 'violet'
              : current.id === 'confetti'
                ? confettiStyle
                : current.id === 'grenade'
                  ? grenadeStyle
                  : tabletZone
          }
          onSelect={(id) => {
            if (current.id === 'paint')
              props.onPaintColor(PAINTS.find((p) => p.id === id)!.color);
            else if (current.id === 'confetti') setConfettiStyle(id);
            else if (current.id === 'grenade') setGrenadeStyle(id);
            else setTabletZone(id);
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
            {QUICK_SLOTS.map((slot, i) => {
              const Icon = [Crosshair, PartyPopper, Tablet, Bomb][i];
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
                  'reaction',
                  'pointer',
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
