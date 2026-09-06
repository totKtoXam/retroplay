'use client';
import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import {
  ZONES,
  GAME_TOOLS,
  type Pose,
  type Room,
  type WorldEffect,
} from '@/lib/model';
import { createWorldScene, STATIONS } from './world-scene';
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
} from 'lucide-react';
type Props = {
  room: Room;
  quality: string;
  tool: number;
  onTool: (n: number) => void;
  onZone: (z: string) => void;
  onPose: (p: Pose) => void;
  onMonitor: (v: boolean) => void;
  onFps: (v: number) => void;
  onAction: (kind: string) => void;
  onFire: (effect: WorldEffect) => void;
  onFailure: () => void;
  blocked: boolean;
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
  mesh: T.Mesh;
  origin: T.Vector3;
  target: T.Vector3;
  normal: T.Vector3;
  born: number;
  duration: number;
  color: string;
  kind: string;
};
export default function World(props: Props) {
  const mount = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  }, [props]);
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
    keys: Set<string>;
  } | null>(null);
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
    const kit = createWorldScene(),
      { scene } = kit;
    renderer.setPixelRatio(
      Math.min(devicePixelRatio, props.quality === 'high' ? 1.5 : 1),
    );
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    host.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute(
      'aria-label',
      'Игровой мир: клик — играть, движение мыши — камера, WASD — движение, Esc — курсор',
    );
    const camera = new T.PerspectiveCamera(54, 1, 0.1, 300);
    kit.update(latest.current.room.state);
    kit.setNotes(latest.current.room.state);
    const avatar = kit.avatarFactory(
      latest.current.room.members.find((m) => m.id === latest.current.room.self)
        ?.color || '#718cdd',
    );
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
      initial?.x || 0,
      initial?.y || 0,
      initial?.z || 15,
    );
    let cameraYaw = initial?.yaw || 0,
      heading = cameraYaw,
      pitch = 0.38,
      distance = 8,
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
      lastShot = 0,
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
    const burst = (at: T.Vector3, color: string, now: number) => {
      const count = props.quality === 'high' ? 70 : 40;
      const mesh = new T.InstancedMesh(
        confettiGeo,
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
            [color, '#c8b6ff', '#80d8fa', '#ffbfd8', '#ffe29b'][i % 5],
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
      scene.add(decal);
      splats.push({ mesh: decal, born: now });
    };
    const spawn = (e: WorldEffect) => {
      if (seen.has(e.id) || Date.now() - e.at > 14000) return;
      seen.add(e.id);
      if (seen.size > 200) {
        const first = seen.values().next().value;
        if (first) seen.delete(first);
      }
      const start = new T.Vector3(...e.origin),
        target = new T.Vector3(...e.target),
        normal = new T.Vector3(...e.normal).normalize();
      const ball = new T.Mesh(
        paintGeo,
        new T.MeshBasicMaterial({ color: e.color }),
      );
      ball.position.copy(start);
      scene.add(ball);
      flights.push({
        mesh: ball,
        origin: start,
        target,
        normal,
        born: performance.now(),
        duration: Math.max(130, start.distanceTo(target) * 22),
        color: e.color,
        kind: e.kind,
      });
    };
    const shoot = () => {
      const p = latest.current;
      if (p.blocked || middle || p.room.state.archived) return;
      const tool = GAME_TOOLS[p.tool]?.id;
      if (tool !== 'paint' && tool !== 'confetti') return;
      const now = performance.now();
      if (now - lastShot < 260) return;
      lastShot = now;
      ray.setFromCamera(
        document.pointerLockElement || softLook ? new T.Vector2(0, 0) : mouse,
        camera,
      );
      const targets: T.Object3D[] = [];
      scene.traverse((o) => {
        if (
          o instanceof T.Mesh &&
          !avatar.getObjectById(o.id) &&
          o !== shadow &&
          o.geometry.type !== 'SphereGeometry' &&
          o.geometry.type !== 'ShapeGeometry' &&
          !flights.some((f) => f.mesh === o) &&
          !bursts.some((b) => b.mesh === o)
        )
          targets.push(o);
      });
      const hit = ray
        .intersectObjects(targets, false)
        .find((h) => h.distance < 65 && h.distance > 1);
      const target = hit ? hit.point : ray.ray.at(35, new T.Vector3());
      const normal = hit?.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : new T.Vector3(0, 1, 0);
      const origin = pos
        .clone()
        .add(new T.Vector3(0.4, currentStance === 'lie' ? 0.5 : 1.3, 0));
      const e: WorldEffect = {
        id: crypto.randomUUID(),
        kind: tool,
        origin: origin.toArray(),
        target: target.toArray(),
        normal: normal.toArray(),
        color: p.paintColor,
        author: p.room.self,
        at: Date.now(),
      };
      spawn(e);
      p.onFire(e);
      setShots((v) => v + 1);
      const gun = avatar.getObjectByName('gun');
      if (gun) gun.position.z = -0.24;
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
      pause: () => {
        softLook = false;
        activeControl = false;
        left = false;
        keys.clear();
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
        pitch = 0.38;
        distance = 8;
        canvas.focus();
      },
      keys,
    };
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setSize(width, Math.max(height, 1));
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
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
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        engine.current?.pause();
        if (document.pointerLockElement) document.exitPointerLock();
        return;
      }
      if (!enabled() || latest.current.blocked) return;
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
      if (e.code === 'Space' && pos.y <= 0.01) {
        currentStance = 'stand';
        setStance('stand');
        vy = 5.7;
      }
      if (e.code === 'KeyC') {
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
        document.exitPointerLock();
        latest.current.onZone(nearZone);
        clear();
      }
      if (e.code === 'KeyF') engine.current?.reset();
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(-1));
        latest.current.onTool(n === 0 ? 9 : n - 1);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
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
        cameraYaw -= e.movementX * 0.003;
        pitch = T.MathUtils.clamp(pitch + e.movementY * 0.0025, -0.05, 1.15);
      }
    };
    const wheel = (e: WheelEvent) => {
      if (latest.current.blocked) return;
      e.preventDefault();
      canvas.focus();
      if (e.altKey) engine.current?.distance(e.deltaY > 0 ? 1 : -1);
      else
        latest.current.onTool(
          (latest.current.tool + (e.deltaY > 0 ? 1 : 9)) % 10,
        );
    };
    const onDown = (e: MouseEvent) => {
      if (latest.current.blocked) return;
      canvas.focus();
      if (e.button === 1) {
        e.preventDefault();
        middle = true;
        setRadial(true);
        clear();
        softLook = false;
        if (document.pointerLockElement) document.exitPointerLock();
      } else if (e.button === 2) {
        e.preventDefault();
      } else if (e.button === 0) {
        if (document.pointerLockElement !== canvas && !softLook) {
          capture();
          return;
        }
        left = true;
        const t = GAME_TOOLS[latest.current.tool]?.id;
        if (t === 'paint' || t === 'confetti') shoot();
        else {
          ray.setFromCamera(
            document.pointerLockElement || softLook ? new T.Vector2() : mouse,
            camera,
          );
          const hit = ray.intersectObjects(kit.boards.map((b) => b.panel))[0];
          if (hit) {
            document.exitPointerLock();
            latest.current.onZone(hit.object.userData.zone);
            clear();
          } else if (t === 'reaction') latest.current.onAction('reaction');
        }
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) left = false;
      if (e.button === 1 && middle) {
        middle = false;
        setRadial(false);
        capture();
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
    const blocked = (x: number, z: number) =>
      kit.colliders.some((c) => {
        if (latest.current.room.state.interior && c.z === -18) return false;
        return (
          Math.abs(x - c.x) < c.w / 2 + 0.28 &&
          Math.abs(z - c.z) < c.d / 2 + 0.28
        );
      });
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const frameInterval =
        latest.current.quality === 'high' ? 1000 / 60 : 1000 / 30;
      if (now - last < frameInterval - 0.8) return;
      const dt = Math.min(0.06, (now - last) / 1000 || 0.033);
      last = now;
      if (document.hidden) return;
      frames++;
      if (now - fpsAt > 1000) {
        latest.current.onFps(Math.round((frames * 1000) / (now - fpsAt)));
        frames = 0;
        fpsAt = now;
      }
      if (left && enabled()) shoot();
      let dx = 0,
        dz = 0;
      const control = enabled() && !latest.current.blocked && !middle;
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
          -0.05,
          1.15,
        );
      }
      const moving = !!(dx || dz),
        slow = keys.has('ShiftLeft') || keys.has('ShiftRight'),
        run = keys.has('ControlLeft') || keys.has('ControlRight'),
        speed =
          currentStance === 'lie'
            ? 0.65
            : currentStance === 'sit'
              ? 1
              : slow
                ? 1.1
                : run
                  ? 6.5
                  : 3.4;
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
        const desired = Math.atan2(-vx, -vz);
        heading +=
          Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading)) *
          Math.min(1, dt * 12);
      }
      vy -= 13 * dt;
      pos.y = Math.max(0, pos.y + vy * dt);
      if (pos.y === 0) vy = 0;
      avatar.position.copy(pos);
      avatar.position.y += 0.27;
      avatar.rotation.y = heading;
      const rig = avatar.getObjectByName('rig')!;
      rig.rotation.x = currentStance === 'lie' ? Math.PI / 2 : 0;
      rig.position.y = currentStance === 'lie' ? 0.35 : 0;
      rig.scale.y = currentStance === 'sit' ? 0.65 : 1;
      for (const key of ['legL', 'legR', 'armL', 'armR']) {
        const limb = avatar.getObjectByName(key);
        if (limb)
          limb.rotation.x =
            currentStance === 'sit' && key.startsWith('leg')
              ? -Math.PI / 2
              : moving
                ? Math.sin(now * 0.011 * speed) *
                  (key.endsWith('L') ? 1 : -1) *
                  0.5
                : 0;
      }
      const gun = avatar.getObjectByName('gun');
      if (gun) {
        gun.visible = ['paint', 'confetti'].includes(
          GAME_TOOLS[latest.current.tool]?.id,
        );
        gun.position.z = T.MathUtils.lerp(gun.position.z, -0.4, dt * 12);
      }
      shadow.position.set(pos.x, 0.24, pos.z);
      shadow.scale.setScalar(Math.max(0.5, 1 - pos.y * 0.1));
      const target = new T.Vector3(pos.x, pos.y + 1.35, pos.z),
        desired = new T.Vector3(
          pos.x + Math.sin(cameraYaw) * distance * Math.cos(pitch),
          pos.y + 1.9 + Math.sin(pitch) * distance,
          pos.z + Math.cos(cameraYaw) * distance * Math.cos(pitch),
        );
      desired.y = Math.max(0.9, desired.y);
      camera.position.lerp(desired, Math.min(1, dt * 10));
      camera.lookAt(target);
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
          scene.add(remote);
          const label = addLabel(member.name, member.color);
          labels.set(member.id, label);
          remote.add(label);
        }
        remote.visible = Date.now() - member.lastSeen < 15000;
        const p = member.pose;
        remote.position.lerp(
          new T.Vector3(p.x, p.y + 0.27, p.z),
          Math.min(1, dt * 7),
        );
        remote.rotation.y = p.yaw;
        const rr = remote.getObjectByName('rig')!;
        rr.rotation.x = p.stance === 'lie' ? Math.PI / 2 : 0;
        rr.position.y = p.stance === 'lie' ? 0.35 : 0;
        rr.scale.y = p.stance === 'sit' ? 0.65 : 1;
        for (const key of ['legL', 'legR']) {
          const limb = remote.getObjectByName(key);
          if (limb)
            limb.rotation.x =
              p.stance === 'sit'
                ? -Math.PI / 2
                : p.moving
                  ? Math.sin(now * 0.014) * (key === 'legL' ? 1 : -1) * 0.5
                  : 0;
        }
      }
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i],
          t = Math.min(1, (now - f.born) / f.duration);
        f.mesh.position.lerpVectors(f.origin, f.target, t);
        if (t >= 1) {
          if (f.kind === 'paint') splat(f.target, f.normal, f.color, now);
          else burst(f.target, f.color, now);
          f.mesh.removeFromParent();
          (f.mesh.material as T.Material).dispose();
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
        });
        poseAt = now;
      }
      kit.clouds.position.x = Math.sin(now * 0.000015) * 2;
      renderer.render(scene, camera);
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
      renderer.dispose();
      canvas.remove();
    };
  }, [props.quality]);
  useEffect(() => {
    engine.current?.kit.update(latest.current.room.state);
    engine.current?.shadow();
  }, [
    props.room.state.theme,
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
    <div className={`world-container ${active ? 'play-active' : ''}`}>
      <div ref={mount} className="world-canvas" />
      <div className="crosshair modern-crosshair">
        <i />
        <i />
      </div>
      <div className="world-location">
        <span className="live-dot" />
        <div>
          <strong>
            {props.room.state.interior
              ? 'ATELIER / Мастерская'
              : 'ALATAU / Горный лагерь'}
          </strong>
          <span>
            {props.room.state.interior
              ? 'Внутреннее пространство'
              : 'Открытый мир'}{' '}
            · {props.quality === 'high' ? '60' : '30'} FPS MAX
          </span>
        </div>
      </div>
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
          aria-label="Приблизить камеру"
        >
          <Plus size={16} />
        </button>
        <button
          onClick={() => engine.current?.distance(1.5)}
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
      {!active && !radial && !props.blocked && (
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
      {near && !props.blocked && (
        <button className="interact-prompt" onClick={() => props.onZone(near)}>
          <kbd>E</kbd>
          {ZONES.find((z) => z.id === near)?.title}
          <span>Открыть доску</span>
        </button>
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
                : 'Подойдите к доске · E'}
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
          <kbd>WASD</kbd> движение
        </span>
        <span>
          <kbd>Пробел</kbd> прыжок
        </span>
        <span>
          <kbd>C</kbd> сесть · 2×C лечь
        </span>
        <span>
          <kbd>Ctrl</kbd> бег
        </span>
        <span>
          <kbd>Shift</kbd> шаг
        </span>
        <span>
          <kbd>Tab</kbd> кто в сети
        </span>
        <span>
          <kbd>Колесо</kbd> инвентарь
        </span>
      </div>
      {radial && (
        <div
          className="radial-backdrop"
          role="presentation"
          onMouseUp={() => setRadial(false)}
        >
          <div className="radial-center">
            <span className="eyebrow">ИНВЕНТАРЬ</span>
            <strong>{current?.label}</strong>
            <span>Наведите и отпустите колесо</span>
          </div>
          {GAME_TOOLS.map((t, i) => (
            <button
              key={t.id}
              onMouseEnter={() => props.onTool(i)}
              onClick={() => {
                props.onTool(i);
                setRadial(false);
              }}
              className={`radial-item ${props.tool === i ? 'selected' : ''}`}
              style={{
                left: `calc(50% + ${Math.sin((i / 10) * Math.PI * 2) * 195}px)`,
                top: `calc(50% - ${Math.cos((i / 10) * Math.PI * 2) * 195}px)`,
              }}
            >
              <kbd>{t.key}</kbd>
              {t.label}
            </button>
          ))}
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
