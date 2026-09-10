'use client';
/* oxlint-disable next/no-html-link-for-pages -- Полная навигация обходит ошибку RSC prefetch в production-сборке vinext. */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from 'react';
import {
  ArrowLeft,
  Plus,
  Users,
  Link2,
  Sun,
  Settings2,
  Play,
  Pause,
  RotateCcw,
  Check,
  MousePointer2,
  StickyNote,
  Folder,
  PenLine,
  Square,
  Type,
  MoveUpRight,
  Maximize,
  Minimize,
  Smile,
  ImageIcon,
  ListChecks,
  Timer,
  Vote,
  Flag,
  PanelTop,
  Box,
  ChevronRight,
  Search,
  Download,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  Sunrise,
  Sunset,
  Moon,
  SprayCan,
  Dices,
  Bell,
  PartyPopper,
  HelpCircle,
  Menu,
  X,
  Wifi,
  Bomb,
  Monitor,
  Send,
  Crosshair,
  Heart,
  Lock,
  Globe,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ZONES,
  THEMES,
  PHASES,
  TOOLS,
  GAME_TOOLS,
  TOOL_HINTS,
  voteCount,
  type RoomState,
  type Room,
  type Note,
  type Pose,
  type WorldEffect,
} from '@/lib/model';
import { api, ready, download, parseCSV } from '@/lib/client';
import { Choice, Toggle } from './controls';
import { StylePicker } from './style-picker';
import { MusicPlayer } from './music-player';
import Board, { Card } from './board';
import { ResourcePackPicker } from './resource-pack-picker';
import { useResourcePack } from '../hooks/use-resource-pack';

const World = lazy(() => import('./world'));
const icons = [
  MousePointer2,
  StickyNote,
  Folder,
  PenLine,
  Square,
  Type,
  MoveUpRight,
  Smile,
  ImageIcon,
  ListChecks,
];
const kinds: Record<string, string> = {
  pointer: 'sticky',
  sticky: 'sticky',
  group: 'sticky',
  draw: 'draw',
  shape: 'shape',
  text: 'text',
  connector: 'connector',
  reaction: 'token',
  image: 'image',
  action: 'action',
  like: 'sticky',
};
function compressPose(p: Pose): Pose {
  return {
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
    z: Math.round(p.z * 100) / 100,
    yaw: Math.round(p.yaw * 1000) / 1000,
    stance: p.stance,
    moving: !!p.moving,
    speed: p.speed != null ? Math.round(p.speed * 100) / 100 : undefined,
    strafe: p.strafe != null ? Math.round(p.strafe * 100) / 100 : undefined,
    forward: p.forward != null ? Math.round(p.forward * 100) / 100 : undefined,
    pitch: p.pitch != null ? Math.round(p.pitch * 1000) / 1000 : undefined,
    tool: p.tool,
    variant: p.variant,
    working: !!p.working,
    crouching: !!p.crouching,
    aiming: !!p.aiming,
    reload: p.reload != null ? Math.round(p.reload * 100) / 100 : undefined,
  };
}
type Draft = {
  id?: string;
  kind: string;
  text: string;
  zone: string;
  color: string;
  url: string;
  x: number;
  y: number;
  owner: string;
  due: string;
  group: string;
  tags: string;
  hidden: boolean;
  locked: boolean;
  done: boolean;
  width: number;
  height: number;
  rotation: number;
};
export default function RoomApp({ id }: { id: string }) {
  const resourcePack = useResourcePack();
  const [fpsLimit, setFpsLimit] = useState(30);
  const [editingTitle, setEditingTitle] = useState(false);
  const [quickSticky, setQuickSticky] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false),
    [sensitivity, setSensitivity] = useState(1),
    [invertCamera, setInvertCamera] = useState(false);
  const [paintColor, setPaintColor] = useState('#bc91f5'),
    [environment, setEnvironment] = useState(false);
  const [room, setRoom] = useState<Room | null>(null),
    [join, setJoin] = useState<{
      title: string;
      isPrivate?: boolean;
      requestStatus?: 'none' | 'pending' | 'accepted' | 'rejected';
      requestId?: string;
      hostName?: string;
      membersCount?: number;
      maxPlayers?: number;
    } | null>(null),
    [joinRequests, setJoinRequests] = useState<
      {
        id: string;
        session: string;
        name: string;
        status: string;
        created: number;
      }[]
    >([]),
    [joinRequestSent, setJoinRequestSent] = useState(false),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState('3d'),
    [packetLoss, setPacketLoss] = useState(0),
    [tool, setTool] = useState(0),
    [panel, setPanel] = useState(''),
    [selectedZone, setSelectedZone] = useState(''),
    [draft, setDraft] = useState<Draft | null>(null),
    [comment, setComment] = useState(''),
    [quality, setQuality] = useState('balanced'),
    [fps, setFps] = useState(0),
    [ping, setPing] = useState(0),
    [monitor, setMonitor] = useState(false),
    [now, setNow] = useState(() => Date.now()),
    [seconds, setSeconds] = useState('300'),
    [voteLimit, setVoteLimit] = useState('5'),
    [groupTitle, setGroupTitle] = useState(''),
    [search, setSearch] = useState(''),
    [sound, setSound] = useState(false),
    [spinner, setSpinner] = useState(''),
    [spinOptions, setSpinOptions] = useState(''),
    [deleteConfirm, setDeleteConfirm] = useState(false),
    [celebrate, setCelebrate] = useState('');
  useEffect(() => {
    if (mode !== 'board' || !room) return;
    const key = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        draft ||
        selectedZone ||
        monitor ||
        musicOpen ||
        (panel && panel !== 'tools')
      )
        return;
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      if (e.code === 'KeyQ') {
        e.preventDefault();
        setPanel((p) => (p === 'tools' ? '' : 'tools'));
      } else if (/^Digit[0-9]$/.test(e.code)) {
        e.preventDefault();
        setTool((Number(e.code.slice(-1)) + 9) % 10);
        if (panel === 'tools') setPanel('');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [mode, room, draft, selectedZone, monitor, musicOpen, panel]);
  const activeTools = mode === '3d' ? GAME_TOOLS : TOOLS;
  const activeIcons =
    mode === '3d'
      ? [
          SprayCan,
          PartyPopper,
          StickyNote,
          Folder,
          PenLine,
          Square,
          MoveUpRight,
          Smile,
          ListChecks,
          MousePointer2,
          Bomb,
          Crosshair,
          Heart,
        ]
      : icons;
  const cursor = useRef({ x: 0, y: 0, mode: '3d' });
  useEffect(() => {
    cursor.current.mode = mode;
  }, [mode]);
  const [history, setHistory] = useState<
    { version: number; action: string; name: string; at: number }[]
  >([]);
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  const pose = useRef<Pose>({
      x: 0,
      z: 14,
      y: 0,
      yaw: 0,
      stance: 'stand',
      moving: false,
    }),
    pingRef = useRef(0),
    eventTime = useRef(0),
    lastFocus = useRef(0),
    audio = useRef<AudioContext | null>(null),
    soundRef = useRef(false);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const lossHistory = useRef<boolean[]>([]);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  const flash = useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(''), 4000);
  }, []);
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const enterRef = useRef<((name?: string) => Promise<void>) | null>(null);
  const lastEffectAtRef = useRef(0);
  const lastActivityRef = useRef(0);

  useEffect(() => {
    lastActivityRef.current = Date.now();
    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('keydown', onActivity, { passive: true });
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('wheel', onActivity, { passive: true });
    return () => {
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('wheel', onActivity);
    };
  }, []);

  const handleRoomData = useCallback(
    (
      data: Room & {
        join?: boolean;
        title?: string;
        isPrivate?: boolean;
        requestStatus?: 'none' | 'pending' | 'accepted' | 'rejected';
        requestId?: string;
        hostName?: string;
        membersCount?: number;
        maxPlayers?: number;
        joinRequests?: {
          id: string;
          session: string;
          name: string;
          status: string;
          created: number;
        }[];
        effects?: WorldEffect[];
      },
      responseTimeMs?: number,
    ) => {
      if (responseTimeMs !== undefined) {
        setPing(responseTimeMs);
        pingRef.current = responseTimeMs;
      }
      if (data.join) {
        setJoin(data as Room & { title: string });
        if (data.requestStatus === 'accepted') {
          const savedName =
            localStorage.getItem('jinaly-name') || nameRef.current;
          if (savedName && !busyRef.current) {
            void enterRef.current?.(savedName);
          }
        }
        return;
      }
      setJoin(null);
      if (data.joinRequests) {
        setJoinRequests(data.joinRequests);
      }
      if (Array.isArray(data.effects) && data.effects.length > 0) {
        let maxAt = lastEffectAtRef.current;
        for (const e of data.effects) {
          if (e.at && e.at > maxAt) maxAt = e.at;
        }
        lastEffectAtRef.current = maxAt;
      }
      setRoom((old) => {
        if (!old) return data;
        const cutoff = Date.now() - 15000;
        const oldEffects = (old.effects || []).filter(
          (e) => (e.at || 0) > cutoff,
        );
        const newEffects = data.effects || [];
        const seenIds = new Set(oldEffects.map((e) => e.id));
        const mergedEffects = [...oldEffects];
        for (const e of newEffects) {
          if (!seenIds.has(e.id)) {
            seenIds.add(e.id);
            mergedEffects.push(e);
          }
        }
        if (data.version >= old.version) {
          return {
            ...data,
            state: data.state || old.state,
            effects: mergedEffects,
          };
        } else {
          return {
            ...old,
            members: data.members,
            effects: mergedEffects,
          };
        }
      });
      setError('');
    },
    [],
  );

  const refresh = useCallback(async () => {
    const start = performance.now();
    const inviteParam =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('invite')
        : null;
    const query = new URLSearchParams();
    if (roomRef.current) query.set('version', String(roomRef.current.version));
    if (inviteParam) query.set('invite', inviteParam);
    if (lastEffectAtRef.current > 0) {
      query.set(
        'sinceEffect',
        String(Math.max(0, lastEffectAtRef.current - 100)),
      );
    }
    const qs = query.toString() ? '?' + query.toString() : '';

    const data = await api<
      Room & {
        join?: boolean;
        title: string;
        isPrivate?: boolean;
        requestStatus?: 'none' | 'pending' | 'accepted' | 'rejected';
        requestId?: string;
        hostName?: string;
        membersCount?: number;
        maxPlayers?: number;
        joinRequests?: {
          id: string;
          session: string;
          name: string;
          status: string;
          created: number;
        }[];
        effects?: WorldEffect[];
      }
    >('/api/rooms/' + id + qs);

    const ms = Math.round(performance.now() - start);
    handleRoomData(data, ms);
  }, [id, handleRoomData]);
  const op = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const data = await api<{
          state?: RoomState;
          version: number;
          ok?: boolean;
        }>('/api/rooms/' + id, body);
        if (data.state)
          setRoom((old) =>
            old && data.version >= old.version
              ? { ...old, state: data.state!, version: data.version }
              : old,
          );
        return data;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      }
    },
    [id],
  );
  // События UI обрабатывают ошибку в общем баннере, не оставляя unhandled rejection.
  const act = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        return await op(body);
      } catch {
        return null;
      }
    },
    [op],
  );
  useEffect(() => {
    let stop = false,
      handle: ReturnType<typeof setTimeout>;
    eventTime.current = Date.now();
    const tick = async () => {
      let ok = true;
      try {
        if (!document.hidden) {
          if (roomRef.current) {
            const start = performance.now();
            const sinceEffectTime =
              lastEffectAtRef.current > 0
                ? Math.max(0, lastEffectAtRef.current - 100)
                : undefined;
            const res = await api<
              Room & {
                ok?: boolean;
                members?: Room['members'];
                joinRequests?: {
                  id: string;
                  session: string;
                  name: string;
                  status: string;
                  created: number;
                }[];
                effects?: WorldEffect[];
              }
            >('/api/rooms/' + id, {
              type: 'presence',
              life:
                roomRef.current.members.find(
                  (m) => m.id === roomRef.current?.self,
                )?.life || 0,
              pose: compressPose(pose.current),
              ping: pingRef.current,
              cursor: cursor.current,
              version: roomRef.current.version,
              sinceEffect: sinceEffectTime,
            });
            const ms = Math.round(performance.now() - start);
            if (res && res.members) {
              handleRoomData(res, ms);
            } else {
              await refresh();
            }
          } else {
            await refresh();
          }
        }
      } catch (e) {
        ok = false;
        if (!stop) setError((e as Error).message);
      }
      if (!document.hidden) {
        lossHistory.current.push(ok);
        if (lossHistory.current.length > 40) lossHistory.current.shift();
        const lost = lossHistory.current.filter((v) => !v).length;
        setPacketLoss(Math.round((lost / lossHistory.current.length) * 100));
      }
      const idleTime = lastActivityRef.current
        ? Date.now() - lastActivityRef.current
        : 0;
      const interval =
        modeRef.current === '3d'
          ? idleTime > 2000
            ? 300
            : 120
          : idleTime > 3000
            ? 1400
            : 800;
      if (!stop) handle = setTimeout(tick, interval);
    };
    void ready()
      .then(() => {
        if (!stop) {
          setName(localStorage.getItem('jinaly-name') || '');
          const savedSensitivity = Number(
            localStorage.getItem('jinaly-sensitivity') || 1,
          );
          setSensitivity(
            Number.isFinite(savedSensitivity)
              ? Math.min(2, Math.max(0.4, savedSensitivity))
              : 1,
          );
          setInvertCamera(
            localStorage.getItem('jinaly-invert-camera') === 'true',
          );
          const savedQuality = localStorage.getItem('jinaly-quality');
          setQuality(
            savedQuality === 'high' ? 'cinematic' : savedQuality || 'balanced',
          );
          const savedFps = Number(localStorage.getItem('jinaly-fps-limit'));
          setFpsLimit([20, 30, 60].includes(savedFps) ? savedFps : 30);
          void tick();
        }
      })
      .catch((e) => setError(e.message));
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearTimeout(handle);
      clearInterval(clock);
    };
  }, [id, refresh, handleRoomData]);
  const beep = useCallback((frequency = 520) => {
    if (!soundRef.current) return;
    try {
      const ctx = audio.current || (audio.current = new AudioContext());
      void ctx.resume();
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {}
  }, []);
  useEffect(() => {
    if (!room) return;
    for (const e of room.state.events) {
      if (e.at <= eventTime.current) continue;
      if (e.kind === 'confetti' || e.kind === 'reaction' || e.kind === 'hat') {
        // Серверное одноразовое событие запускает временный визуальный эффект.
        // oxlint-disable-next-line react/react-compiler
        setCelebrate(e.kind === 'hat' ? '🎩' : e.value || '🎉');
        setTimeout(() => setCelebrate(''), 2500);
      }
      if (e.kind === 'buzzer') beep();
      if (e.kind === 'spin') {
        setSpinner(e.value);
        flash('Выбор: ' + e.value);
      }
      if (e.kind === 'ping')
        flash(
          (room.members.find((m) => m.id === e.author)?.name || 'Участник') +
            ' привлекает внимание',
        );
    }
    eventTime.current = Math.max(
      eventTime.current,
      ...room.state.events.map((e) => e.at),
    );
    if (room.state.focus.at > lastFocus.current) {
      if (lastFocus.current !== 0 && room.host !== room.self)
        setSelectedZone(room.state.focus.zone);
      lastFocus.current = room.state.focus.at;
    }
  }, [room, beep, flash]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  const hasRoom = !!room;
  useEffect(() => {
    if (!hasRoom) return;
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context) return;
    const abort = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'read_retro_room',
            description:
              'Read the current visible retrospective room, notes and meeting phase.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: () => ({
              title: roomRef.current?.state.title,
              phase: roomRef.current?.state.phase,
              notes: roomRef.current?.state.notes,
            }),
          },
          { signal: abort.signal },
        ),
      ).catch(() => {});
      void Promise.resolve(
        context.registerTool(
          {
            name: 'create_retro_note',
            description:
              'Create and save a sticky note in the current room, respecting private writing.',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string', maxLength: 8000 },
                zone: { type: 'string', enum: ZONES.map((z) => z.id) },
              },
              required: ['text', 'zone'],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute: async (input: unknown) => {
              if (!input || typeof input !== 'object')
                throw Error('Invalid input');
              const p = input as { text: unknown; zone: unknown };
              if (
                typeof p.text !== 'string' ||
                !p.text.trim() ||
                !ZONES.some((z) => z.id === p.zone)
              )
                throw Error('Invalid note');
              const result = await op({
                type: 'note.add',
                kind: 'sticky',
                text: p.text,
                zone: p.zone,
              });
              return { saved: true, version: result.version };
            },
          },
          { signal: abort.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => abort.abort();
  }, [hasRoom, op]);
  const enterFullscreen = async () => {
    try {
      const keyboard = (
        navigator as Navigator & {
          keyboard?: {
            lock: (keys: string[]) => Promise<void>;
            unlock: () => void;
          };
        }
      ).keyboard;
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        keyboard?.unlock();
        setFullscreen(false);
      } else {
        await document.documentElement.requestFullscreen();
        setFullscreen(true);
        try {
          await keyboard?.lock([
            'KeyW',
            'KeyA',
            'KeyS',
            'KeyD',
            'Tab',
            'Backquote',
            'Space',
            'KeyC',
          ]);
        } catch {
          flash('Полный экран включён. Захват системных клавиш недоступен.');
        }
        document
          .querySelector<HTMLCanvasElement>('.world-canvas canvas')
          ?.focus();
      }
    } catch {
      flash(
        'Полный экран недоступен в этом окне. Откройте игру в Chrome или Edge.',
      );
    }
  };
  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const me = room?.members.find((m) => m.id === room.self),
    host = room?.host === room?.self,
    s = room?.state,
    online = room?.members.filter((m) => now - m.lastSeen < 15000) || [],
    theme = THEMES.find((t) => t.id === s?.theme) || THEMES[0];
  const enter = async (overrideName?: string) => {
    const playerName = (overrideName || name).trim();
    if (!playerName) return;
    setBusy(true);
    setError('');
    try {
      await op({ type: 'join', name: playerName });
      localStorage.setItem('jinaly-name', playerName);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    enterRef.current = enter;
  });
  const sendJoinRequest = async (overrideName?: string) => {
    const playerName = (overrideName || name).trim();
    if (!playerName) return;
    setBusy(true);
    setError('');
    try {
      const invite =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('invite') || ''
          : '';
      await api('/api/rooms/' + id, {
        type: 'join_request.create',
        name: playerName,
        inviteToken: invite,
      });
      localStorage.setItem('jinaly-name', playerName);
      setJoinRequestSent(true);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const newNote = (
    zone: string,
    x?: number,
    y?: number,
    stickyOnly = false,
  ) => {
    if (!stickyOnly && activeTools[tool].id === 'group') {
      setPanel('group');
      return;
    }
    const count = s?.notes.filter((n) => n.zone === zone).length || 0;
    let kind = stickyOnly ? 'sticky' : kinds[activeTools[tool].id] || 'sticky';
    if (['draw', 'connector'].includes(kind)) kind = 'sticky';
    setQuickSticky(kind === 'sticky');
    setDraft({
      kind,
      text: kind === 'token' ? '💡' : '',
      zone,
      color:
        kind === 'sticky'
          ? ZONES.find((z) => z.id === zone)!.color
          : kind === 'shape'
            ? '#b5d1c0'
            : '#f5e6a9',
      url: '',
      x: x ?? 25 + (count % 2) * 280,
      y: y ?? 60 + Math.floor(count / 2) * 230,
      owner: '',
      due: '',
      group: '',
      tags: '',
      hidden: !!s?.privateWriting,
      locked: false,
      done: false,
      width: 220,
      height: 165,
      rotation: 0,
    });
  };
  const editNote = (n: Note) => {
    if (n.redacted) return;
    setQuickSticky(false);
    setComment('');
    setDraft({ ...n, tags: n.tags.join(', ') });
  };
  const saveNote = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const data = {
        ...draft,
        tags: draft.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };
      if (draft.id) await op({ type: 'note.edit', id: draft.id, patch: data });
      else await op({ type: 'note.add', ...data });
      setDraft(null);
      if (mode === '3d') {
        setTimeout(() => {
          void document.querySelector('canvas')?.requestPointerLock();
        }, 50);
      }
      flash('Карточка сохранена');
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const copyLink = async () => {
    try {
      const inviteUrl =
        typeof location !== 'undefined'
          ? location.origin +
            '/room/' +
            id +
            (s?.access?.type === 'private' && s.access.inviteToken
              ? '?invite=' + s.access.inviteToken
              : '')
          : '';
      await navigator.clipboard.writeText(inviteUrl || location.href);
      flash('Ссылка скопирована');
    } catch {
      setPanel('share');
    }
  };
  const exportRoom = (format: string) => {
    if (!room) return;
    const filename =
      room.state.title.replace(/[^\p{L}\p{N}\-_ ]/gu, '').slice(0, 60) ||
      'retrospective';
    if (format === 'json')
      download(
        filename + '.json',
        JSON.stringify(
          {
            format: 'jinaly',
            version: 1,
            title: s?.title,
            notes: s?.notes,
            groups: s?.groups,
            rounds: s?.rounds,
          },
          null,
          2,
        ),
      );
    if (format === 'csv') {
      const rows = [
        [
          'Текст',
          'Зона',
          'Тип',
          'Ответственный',
          'Срок',
          'Завершено',
          'Голоса',
          'Теги',
        ],
        ...room.state.notes.map((n) => [
          n.text,
          ZONES.find((z) => z.id === n.zone)?.title || n.zone,
          n.kind,
          n.owner,
          n.due,
          n.done ? 'Да' : 'Нет',
          String(voteCount(room.state, n.id)),
          n.tags.join('; '),
        ]),
      ];
      download(
        filename + '.csv',
        '\ufeff' +
          rows
            .map((r) =>
              r.map((c) => '"' + c.replaceAll('"', '""') + '"').join(','),
            )
            .join('\r\n'),
        'text/csv;charset=utf-8',
      );
    }
    if (format === 'md')
      download(
        filename + '.md',
        '# ' +
          s?.title +
          '\n\n' +
          ZONES.map(
            (z) =>
              '## ' +
              z.title +
              '\n\n' +
              s?.notes
                .filter((n) => n.zone === z.id)
                .map(
                  (n) =>
                    `- ${n.done ? '[x] ' : ''}${n.text}${n.owner ? ' — ' + n.owner : ''}${n.due ? ' (' + n.due + ')' : ''}`,
                )
                .join('\n'),
          ).join('\n\n'),
        'text/markdown',
      );
  };
  const importFile = async (file: File) => {
    try {
      if (file.size > 250000) throw Error('Размер файла — до 250 КБ');
      const text = await file.text();
      let notes;
      if (file.name.endsWith('.json')) notes = JSON.parse(text).notes;
      else {
        const rows = parseCSV(text);
        if (rows[0]?.[0] === 'Текст') rows.shift();
        notes = rows.map((r, i) => ({
          kind: 'sticky',
          text: r[0],
          zone:
            ZONES.find((z) => z.title === r[1] || z.id === r[1])?.id || 'good',
          owner: r[3] || '',
          x: 25 + (i % 2) * 280,
          y: 60 + Math.floor(i / 2) * 230,
        }));
      }
      await op({ type: 'import', notes });
      flash('Импорт завершён');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (join) {
    const isPrivate = !!join.isPrivate;
    const isPending = join.requestStatus === 'pending' || joinRequestSent;
    const isRejected = join.requestStatus === 'rejected';
    const isFull = (join.membersCount || 0) >= (join.maxPlayers || 8);

    return (
      <main className="join-screen">
        <a className="brand" href="/">
          <span className="brand-symbol">Ж</span>jinaly
        </a>
        <div className="join-card">
          {isPrivate && (
            <span className="private-room-badge">
              <Lock size={13} /> Приватная комната
            </span>
          )}
          <span className="join-emoji">{isPrivate ? '🔐' : '🤝'}</span>
          <h1>{join.title}</h1>
          <div className="join-room-meta-info">
            <span>
              Ведущий: <b>{join.hostName || 'Ведущий'}</b>
            </span>
            <span>
              Участники:{' '}
              <b>
                {join.membersCount || 0} / {join.maxPlayers || 8}
              </b>
            </span>
          </div>

          {isPrivate ? (
            isPending ? (
              <div className="join-waiting-box">
                <div className="waiting-spinner" />
                <span className="waiting-title">
                  Ожидание одобрения ведущего…
                </span>
                <p className="waiting-text">
                  Ведущий ({join.hostName || 'Ведущий'}) получил ваш запрос на
                  вход. Комната откроется автоматически сразу после одобрения.
                </p>
                <a href="/" className="secondary">
                  К списку комнат
                </a>
              </div>
            ) : isRejected ? (
              <div className="join-rejected-box">
                <span className="rejected-icon">🚫</span>
                <span className="rejected-title">Запрос отклонён</span>
                <p className="rejected-text">
                  Ведущий отклонил ваш запрос на вход в эту комнату.
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    setJoinRequestSent(false);
                    setError('');
                  }}
                >
                  Попробовать снова
                </button>
                <a href="/" className="secondary">
                  К списку комнат
                </a>
              </div>
            ) : (
              <>
                <p className="muted">
                  Для входа в эту комнату требуется подтверждение ведущего.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendJoinRequest(name);
                  }}
                >
                  <label className="field">
                    Ваше имя
                    <input
                      required
                      maxLength={40}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Как вас зовут?"
                    />
                  </label>
                  <button
                    className="primary full-width"
                    disabled={busy || isFull}
                  >
                    {busy
                      ? 'Отправка запроса…'
                      : isFull
                        ? 'Комната заполнена'
                        : 'Отправить запрос на вход'}{' '}
                    <ChevronRight size={17} />
                  </button>
                </form>
              </>
            )
          ) : (
            <>
              <p className="muted">
                Команда ждёт вас. Представьтесь, чтобы присоединиться.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void enter();
                }}
              >
                <label className="field">
                  Ваше имя
                  <input
                    required
                    maxLength={40}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Как вас зовут?"
                  />
                </label>
                <button
                  className="primary full-width"
                  disabled={busy || isFull}
                >
                  {busy
                    ? 'Подключаемся…'
                    : isFull
                      ? 'Комната заполнена'
                      : 'Войти в комнату'}{' '}
                  <ChevronRight size={17} />
                </button>
              </form>
            </>
          )}

          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  }
  if (!room || !s)
    return (
      <main className="join-screen">
        <a href="/" className="brand">
          <span className="brand-symbol">Ж</span>jinaly
        </a>
        <div className="join-card">
          <CompassPlaceholder />
          <h2>
            {error
              ? 'Не удалось открыть комнату'
              : 'Готовим место для встречи…'}
          </h2>
          <p className="muted">
            {error || 'Подключаем общую доску и участников'}
          </p>
          {error && (
            <>
              <button
                className="primary"
                onClick={() => void refresh().catch((e) => setError(e.message))}
              >
                Повторить
              </button>
              <a href="/" className="secondary">
                К комнатам
              </a>
            </>
          )}
        </div>
      </main>
    );
  const edited = s.notes.find((n) => n.id === draft?.id),
    canEdit = !draft?.id || (!!edited && (edited.author === room.self || host)),
    remaining = s.timer.running
      ? Math.max(0, Math.ceil((s.timer.end - now) / 1000))
      : s.timer.remaining,
    timeText =
      String(Math.floor(remaining / 60)).padStart(2, '0') +
      ':' +
      String(remaining % 60).padStart(2, '0'),
    round = s.rounds.at(-1),
    used = Object.values(round?.votes[room.self] || {}).reduce(
      (a, b) => a + b,
      0,
    );
  return (
    <main
      data-resource-pack={resourcePack}
      className={
        'room-app mode-' +
        mode +
        (s.visualStyle === 'anime' ? ' style-anime' : ' style-classic')
      }
    >
      <header className="room-header">
        <a href="/" className="back-button" aria-label="К комнатам">
          <ArrowLeft size={19} />
        </a>
        <a className="brand room-brand" href="/">
          <span className="brand-symbol">Ж</span>
        </a>
        <div className="room-heading">
          {editingTitle ? (
            <input
              className="inline-room-title"
              aria-label="Название встречи"
              ref={(node) => node?.focus()}
              defaultValue={s.title}
              maxLength={100}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  e.currentTarget.value = s.title;
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                setEditingTitle(false);
                if (e.target.value.trim() && e.target.value !== s.title)
                  void act({
                    type: 'room.settings',
                    patch: { title: e.target.value },
                  });
              }}
            />
          ) : (
            <h1>
              <button
                className="editable-room-title"
                disabled={!host}
                title={host ? 'Нажмите, чтобы изменить название' : undefined}
                onClick={() => setEditingTitle(true)}
              >
                {s.title}
              </button>
            </h1>
          )}
          <span>
            {host ? 'Вы — ведущий' : 'Вы — участник'}
            <i />
            {s.archived
              ? 'Встреча завершена'
              : s.template === 'three'
                ? 'Start / Stop / Continue'
                : 'Good / Bad / Start / Stop'}
          </span>
        </div>
        <Tabs
          className="mode-tabs"
          value={mode}
          onValueChange={(v) => {
            setMode(String(v));
            setTool(0);
          }}
        >
          <TabsList>
            <TabsTrigger value="3d">
              <Box />
              3D-мир
            </TabsTrigger>
            <TabsTrigger value="board">
              <PanelTop />
              Доска
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <button
          className="header-people"
          onClick={() => setMonitor(true)}
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setMonitor(true)}
          aria-label="Участники комнаты"
        >
          {online.slice(0, 4).map((m) => (
            <span
              key={m.id}
              className="avatar"
              style={{ background: m.color, color: '#fff' }}
              title={m.name}
            >
              {m.name[0]}
            </span>
          ))}
          <span className="online-count">{online.length}</span>
        </button>
        <button
          className="icon-button fullscreen-button"
          onClick={() => void enterFullscreen()}
          aria-label={
            fullscreen ? 'Выйти из полного экрана' : 'Полный экран для игры'
          }
          title="Полный экран · игровой ввод"
        >
          {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
        {host && joinRequests.length > 0 && (
          <button
            type="button"
            className="join-requests-alert-btn"
            onClick={() => setPanel('join_requests')}
            aria-label="Запросы на вход"
            title="Ожидают подтверждения"
          >
            <Bell size={16} className="bell-pulse" />
            <span>Запросы ({joinRequests.length})</span>
          </button>
        )}
        <button
          className="secondary invite-button"
          onClick={() => setPanel('share')}
        >
          <Link2 size={16} />
          Пригласить
        </button>
        <button
          className="icon-button"
          onClick={() => setPanel('settings')}
          aria-label="Настройки встречи"
        >
          <Settings2 size={19} />
        </button>
      </header>
      <div className="meeting-bar">
        <div className="phase-list">
          {PHASES.map((p, i) => (
            <button
              key={p}
              className={`${s.phase === i ? 'current' : ''} ${s.phase > i ? 'complete' : ''}`}
              disabled={!host || s.archived}
              onClick={() => void act({ type: 'phase', phase: i })}
            >
              <span>{s.phase > i ? <Check size={12} /> : i + 1}</span>
              {p}
            </button>
          ))}
        </div>
        <div className="meeting-actions">
          <button
            className={s.privateWriting ? 'active-tool' : ''}
            onClick={() =>
              host
                ? void act({
                    type: 'room.settings',
                    patch: { privateWriting: !s.privateWriting },
                  })
                : flash('Режим приватного написания меняет ведущий')
            }
            title="Приватное написание"
          >
            <EyeOff size={16} />
            <span>{s.privateWriting ? 'Приватно' : 'Открыто'}</span>
          </button>
          <button
            onClick={() => setPanel('timer')}
            className={s.timer.running ? 'timer-active' : ''}
          >
            <Timer size={16} />
            <b>{timeText}</b>
          </button>
          <button onClick={() => setPanel('vote')}>
            <Vote size={16} />
            <span>
              {round?.active ? `${round.limit - used} голосов` : 'Голосование'}
            </span>
          </button>
        </div>
      </div>
      <div className="room-workspace">
        <aside className="session-sidebar">
          <div className="sidebar-section-heading">
            <span>ЭТА ВСТРЕЧА</span>
            <button
              onClick={() => setPanel('settings')}
              aria-label="Настроить встречу"
            >
              <Settings2 size={15} />
            </button>
          </div>
          <div className="world-preview">
            <span className="world-preview-icon">{theme.icon}</span>
            <div>
              <strong>{theme.name}</strong>
              <span>{s.interior ? 'Мастерская' : 'Алатау · Открытый мир'}</span>
            </div>
            <button onClick={() => setPanel('world')} aria-label="Изменить мир">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="sidebar-section-heading space-top">
            <span>ЗОНЫ РЕТРОСПЕКТИВЫ</span>
          </div>
          <div className="zone-nav">
            {ZONES.filter((z) => s.template !== 'three' || z.id !== 'bad').map(
              (z) => (
                <button
                  key={z.id}
                  className={selectedZone === z.id ? 'selected' : ''}
                  onClick={() => setSelectedZone(z.id)}
                >
                  <span className="zone-dot" style={{ background: z.color }} />
                  <span>
                    {s.template === 'three' && z.id === 'good'
                      ? 'Продолжать делать'
                      : z.title}
                  </span>
                  <small>
                    {
                      s.notes.filter(
                        (n) =>
                          n.zone === z.id &&
                          !['draw', 'connector'].includes(n.kind),
                      ).length
                    }
                  </small>
                </button>
              ),
            )}
          </div>
          <button
            className="add-note-side"
            disabled={s.archived}
            onClick={() => newNote(selectedZone || 'good')}
          >
            <Plus size={16} />
            Добавить идею
          </button>
          <div className="sidebar-divider" />
          <button
            className="sidebar-action"
            onClick={() => setPanel('actions')}
          >
            <ListChecks size={17} />
            План действий
            <span>
              {s.notes.filter((n) => n.kind === 'action' && !n.done).length}
            </span>
          </button>
          <button
            className="sidebar-action"
            onClick={() => setPanel('widgets')}
          >
            <Dices size={17} />
            Для живой встречи
          </button>
          <button className="sidebar-action" onClick={() => setPanel('export')}>
            <Download size={17} />
            Импорт / экспорт
          </button>
          <button
            className="sidebar-action"
            onClick={() => {
              setPanel('history');
              void api<{ history: typeof history }>('/api/rooms/' + id, {
                type: 'history',
              })
                .then((r) => setHistory(r.history))
                .catch((e) => setError(e.message));
            }}
          >
            <RotateCcw size={17} />
            История изменений
          </button>
          <div className="sidebar-bottom">
            <div className="session-tip">
              <span>💡</span>
              <p>
                {s.phase === 0
                  ? 'Начните с настроения: как команда чувствует себя сегодня?'
                  : s.phase === 1
                    ? 'Одна мысль — один стикер. Конкретные примеры помогают обсуждению.'
                    : s.phase === 2
                      ? 'Объедините похожие наблюдения в общие темы.'
                      : s.phase === 3
                        ? 'Отдайте голоса тем идеям, которые важнее обсудить.'
                        : 'Выберите конкретные действия и назначьте ответственных.'}
              </p>
            </div>
            <div className="connection-state">
              <span
                className="live-dot"
                style={error ? { background: '#c87b68' } : undefined}
              />
              {error ? 'Переподключение…' : 'Вы в комнате'}
              <span>{ping} мс</span>
            </div>
          </div>
        </aside>
        <section
          className="main-surface"
          aria-label={mode === '3d' ? 'Игровой мир' : 'Общая доска'}
        >
          {mode === '3d' ? (
            <Suspense
              fallback={
                <div className="loading-world">Собираем мир Алатау…</div>
              }
            >
              <World
                room={room}
                quality={quality}
                fps={fps}
                fpsLimit={fpsLimit}
                packetLoss={packetLoss}
                now={now}
                onGraphics={() => setPanel('fps')}
                onPaintColor={setPaintColor}
                tool={tool}
                onTool={setTool}
                pendingJoinRequestsCount={joinRequests.length}
                onOpenJoinRequests={() => setPanel('join_requests')}
                onBoardTool={(id) => {
                  setMode('board');
                  setSelectedZone('');
                  setTool(
                    Math.max(
                      0,
                      TOOLS.findIndex((t) => t.id === id),
                    ),
                  );
                  flash(
                    'Инструмент выбран. Нажмите на доску, чтобы применить.',
                  );
                }}
                onZone={(zone) => newNote(zone, undefined, undefined, true)}
                sensitivity={sensitivity}
                invertCamera={invertCamera}
                onUseTool={(zone) => newNote(zone, undefined, undefined, true)}
                onPose={(p) => {
                  if (
                    p.moving ||
                    p.aiming ||
                    p.working ||
                    (p.speed && p.speed > 0.1)
                  ) {
                    lastActivityRef.current = Date.now();
                  }
                  pose.current = p;
                }}
                onMonitor={setMonitor}
                onFps={setFps}
                onAction={() =>
                  void act({ type: 'event', kind: 'reaction', value: '👍' })
                }
                onFire={(effect) => void act({ type: 'effect', ...effect })}
                paintColor={paintColor}
                working={!!draft || !!selectedZone}
                host={host}
                onRoomSettings={(patch) =>
                  void act({ type: 'room.settings', patch })
                }
                onOp={act}
                onEditNote={editNote}
                onAddNote={newNote}
                onCursor={(x, y) => {
                  lastActivityRef.current = Date.now();
                  cursor.current = { x, y, mode: 'tablet' };
                }}
                onFailure={() => {
                  setMode('board');
                  flash('WebGL недоступен. Открыта обычная доска.');
                }}
                blocked={
                  !!panel ||
                  !!draft ||
                  !!selectedZone
                }
              />
            </Suspense>
          ) : (
            <Board
              room={room}
              tool={activeTools[tool].id}
              onEdit={editNote}
              onAdd={newNote}
              onOp={act}
              search={search}
              onCursor={(x, y) => {
                lastActivityRef.current = Date.now();
                cursor.current = { x, y, mode };
              }}
            />
          )}
          {mode === '3d' && (
            <div className="game-zone-buttons">
              {ZONES.filter(
                (z) => s.template !== 'three' || z.id !== 'bad',
              ).map((z) => (
                <button
                  title={z.title}
                  aria-label={z.title}
                  key={z.id}
                  onClick={() => setSelectedZone(z.id)}
                >
                  <span style={{ background: z.color }} />
                  {z.short}
                </button>
              ))}
            </div>
          )}
          <div className="surface-top-right">
            <button className="surface-chip" onClick={() => setPanel('world')}>
              <Sun size={15} />
              {
                (
                  {
                    dawn: 'Рассвет',
                    day: 'День',
                    sunset: 'Закат',
                    night: 'Ночь',
                  } as Record<string, string>
                )[s.time]
              }
              <span>·</span>
              {
                (
                  {
                    spring: 'Весна',
                    summer: 'Лето',
                    autumn: 'Осень',
                    winter: 'Зима',
                  } as Record<string, string>
                )[s.season]
              }
            </button>
            <button
              className="surface-icon"
              onClick={() => setPanel('help')}
              aria-label="Управление и помощь"
            >
              <HelpCircle size={18} />
            </button>
          </div>
          {mode === 'board' && (
            <div className="board-search">
              <Search size={15} />
              <input
                placeholder="Найти идею…"
                aria-label="Поиск заметок"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
          {mode === 'board' && <MusicPlayer onOpenChange={setMusicOpen} />}
          <div className="tool-status" aria-live="polite">
            <span>{activeTools[tool]?.label}</span>
            <small>
              {mode === '3d'
                ? TOOL_HINTS[activeTools[tool]?.id]
                : 'Выберите инструмент и работайте на доске'}
            </small>
            <kbd>1–0 / Q</kbd>
          </div>
          <div className="hotbar" aria-label="Инвентарь и инструменты">
            {activeTools.map((t, i) => {
              const Icon = activeIcons[i] || MousePointer2;
              return (
                <button
                  key={t.id}
                  title={
                    t.label + ' · ' + t.key + ' · ' + (TOOL_HINTS[t.id] || '')
                  }
                  aria-label={t.label}
                  aria-pressed={tool === i}
                  className={
                    (tool === i ? 'selected ' : '') +
                    (mode === '3d' && i === 2 ? 'tool-category-start' : '')
                  }
                  onClick={() => {
                    setTool(i);
                  }}
                >
                  <kbd>{t.key}</kbd>
                  <Icon size={20} />
                  <span>{t.label}</span>
                </button>
              );
            })}
            <div className="hotbar-separator" />
            <button
              title="Все инструменты"
              aria-label="Все инструменты"
              onClick={() => setPanel('tools')}
            >
              <Menu size={20} />
            </button>
          </div>
          {s.notes.some((n) => n.hidden && n.author === room.self) && (
            <button
              className="reveal-button primary"
              onClick={() => void act({ type: 'reveal' })}
            >
              <Eye size={16} />
              Раскрыть мои заметки
            </button>
          )}
          {s.archived && (
            <div className="archived-banner">
              <Check size={18} /> Встреча завершена
              {host && (
                <button
                  onClick={() => void act({ type: 'archive', value: false })}
                >
                  Открыть снова
                </button>
              )}
            </div>
          )}
          {celebrate && (
            <div className="celebration" aria-live="polite">
              {Array.from({ length: 18 }, (_, i) => (
                <span
                  key={i}
                  style={{
                    left: ((i * 37) % 100) + '%',
                    animationDelay: (i % 4) * 0.08 + 's',
                    fontSize: 22 + (i % 3) * 11,
                  }}
                >
                  {celebrate}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
      {notice && (
        <output className="toast-message">
          <Check size={16} />
          {notice}
        </output>
      )}
      {error && (
        <div className="floating-error" role="alert">
          {error}
          <button aria-label="Закрыть ошибку" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      <Sheet
        open={!!selectedZone}
        onOpenChange={(v) => !v && setSelectedZone('')}
      >
        <SheetContent className="zone-sheet">
          <SheetTitle>
            {ZONES.find((z) => z.id === selectedZone)?.title}
          </SheetTitle>
          <SheetDescription>
            {ZONES.find((z) => z.id === selectedZone)?.hint}
          </SheetDescription>
          <div className="sheet-actions">
            <button
              className="primary"
              disabled={s.archived}
              onClick={() => newNote(selectedZone)}
            >
              <Plus size={16} />
              Новая идея
            </button>
            {host && (
              <button
                className="secondary"
                onClick={() => void act({ type: 'focus', zone: selectedZone })}
              >
                <Flag size={15} />
                Собрать всех
              </button>
            )}
          </div>
          <div className="sheet-notes">
            {s.notes
              .filter(
                (n) =>
                  n.zone === selectedZone &&
                  !['draw', 'connector'].includes(n.kind),
              )
              .map((n) => (
                <Card
                  key={n.id}
                  note={n}
                  room={room}
                  onEdit={() => editNote(n)}
                  onOp={act}
                />
              ))}
            {!s.notes.some((n) => n.zone === selectedZone) && (
              <div className="empty-notes">
                <StickyNote size={30} />
                <p>Пока здесь чистый лист</p>
                <span>Поделитесь первым наблюдением</span>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {monitor && (
        <section
          className="monitor-hud-overlay"
          aria-live="polite"
          aria-label="Комната в реальном времени"
        >
          <div className="monitor-card">
            <div className="monitor-header">
              <div className="monitor-title-wrap">
                <h3>Комната в реальном времени</h3>
                <span>
                  {online.length} в сети · {room.members.length} участников
                </span>
              </div>
              <button
                type="button"
                className="monitor-close"
                onClick={() => setMonitor(false)}
                aria-label="Закрыть"
                title="Закрыть (Ё)"
              >
                <X size={14} />
              </button>
            </div>
            <div className="monitor-metrics-bar">
              <div className="metric-pill">
                <Wifi size={12} />
                <strong>{ping}</strong>
                <small>мс</small>
              </div>
              <div className="metric-pill">
                <Monitor size={12} />
                <strong>{mode === '3d' ? fps : '—'}</strong>
                <small>FPS</small>
              </div>
              <div className="metric-pill">
                <Users size={12} />
                <strong>{online.length}</strong>
                <small>в сети</small>
              </div>
            </div>
            <div className="monitor-table-wrap">
              <div className="monitor-table-header">
                <span className="col-user">УЧАСТНИК</span>
                <span className="col-status">СТАТУС</span>
                <span className="col-num">HP</span>
                <span className="col-num col-k">K</span>
                <span className="col-num col-d">D</span>
                <span className="col-num col-a">A</span>
                <span className="col-num col-ping">ПИНГ</span>
              </div>
              <div className="monitor-table-body">
                {room.members.map((m) => (
                  <div key={m.id} className="monitor-table-row">
                    <div className="col-user">
                      <span
                        className="avatar mini-avatar"
                        style={{ background: m.color, color: 'white' }}
                      >
                        {m.name[0]}
                      </span>
                      <span className="user-name-box">
                        <strong className="name-text">
                          {m.name}
                          {m.id === room.self ? ' (вы)' : ''}
                        </strong>
                        <small className="role-text">
                          {m.id === room.host ? 'Ведущий' : 'Участник'}
                        </small>
                      </span>
                    </div>
                    <span
                      className={`col-status ${
                        now - m.lastSeen < 15000 ? 'is-online' : 'is-offline'
                      }`}
                    >
                      {now - m.lastSeen < 15000 ? 'в сети' : 'не в сети'}
                    </span>
                    <span
                      className={`col-num col-hp ${
                        m.hp === 0 ? 'is-dead' : ''
                      }`}
                    >
                      {m.hp ?? 100}
                    </span>
                    <span className="col-num col-k">{m.kills ?? 0}</span>
                    <span className="col-num col-d">{m.deaths ?? 0}</span>
                    <span className="col-num col-a">{m.assists ?? 0}</span>
                    <span className="col-num col-ping">
                      {now - m.lastSeen < 15000 ? `${m.ping} мс` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="monitor-footer-note">
              Синхронизация ~1 раз/сек · Для скрытия отпустите «Ё»
            </p>
          </div>
        </section>
      )}
      <Dialog
        open={!!draft && quickSticky}
        onOpenChange={(v) => {
          if (!v) {
            setDraft(null);
            if (mode === '3d') {
              setTimeout(() => {
                void document.querySelector('canvas')?.requestPointerLock();
              }, 50);
            }
          }
        }}
      >
        <DialogContent
          className="quick-sticky-dialog"
          style={{ background: draft?.color }}
          aria-describedby={undefined}
        >
          <DialogTitle>{draft?.zone}</DialogTitle>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveNote();
            }}
          >
            <textarea
              aria-label="Текст стикера"
              placeholder="Напишите вашу мысль…"
              value={draft?.text || ''}
              maxLength={8000}
              required
              onChange={(e) =>
                draft && setDraft({ ...draft, text: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  if (draft?.text.trim()) void saveNote();
                }
              }}
            />
            <button
              disabled={busy || s.archived || !draft?.text.trim()}
              aria-label="Сохранить стикер"
              title="Сохранить · Ctrl+Enter"
            >
              <Check size={24} />
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!draft && !quickSticky}
        onOpenChange={(v) => {
          if (!v) {
            setDraft(null);
            setDeleteConfirm(false);
            if (mode === '3d') {
              setTimeout(() => {
                void document.querySelector('canvas')?.requestPointerLock();
              }, 50);
            }
          }
        }}
      >
        <DialogContent className="app-dialog note-dialog">
          <DialogTitle>
            {draft?.id ? 'Карточка и обсуждение' : 'Новая идея'}
          </DialogTitle>
          <DialogDescription>
            {draft?.hidden
              ? 'Приватная заметка: её видите только вы.'
              : 'Идеи становятся лучше, когда их обсуждают вместе.'}
          </DialogDescription>
          {draft && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveNote();
                }}
              >
                <div className="two-fields">
                  <Choice
                    label="Тип"
                    disabled={!!draft.id}
                    value={draft.kind}
                    onChange={(kind) => setDraft({ ...draft, kind })}
                    options={[
                      ['sticky', 'Стикер'],
                      ['index', 'Карточка'],
                      ['task', 'Задача'],
                      ['roadmap', 'План'],
                      ['page', 'Страница'],
                      ['shape', 'Фигура'],
                      ['text', 'Текст'],
                      ['token', 'Эмодзи / жетон'],
                      ['frame', 'Рамка'],
                      ['image', 'Изображение / ссылка'],
                      ['action', 'План действий'],
                      ['draw', 'Рисунок'],
                      ['connector', 'Связь'],
                    ].map(([value, label]) => ({ value, label }))}
                  />
                  <Choice
                    label="Зона"
                    disabled={!canEdit}
                    value={draft.zone}
                    onChange={(zone) => setDraft({ ...draft, zone })}
                    options={ZONES.map((z) => ({
                      value: z.id,
                      label: z.title,
                    }))}
                  />
                </div>
                <label className="field">
                  {draft.kind === 'image' ? 'Подпись' : 'Ваша мысль'}
                  <textarea
                    value={draft.text}
                    maxLength={8000}
                    placeholder="Что стоит обсудить с командой?"
                    disabled={!canEdit}
                    onChange={(e) =>
                      setDraft({ ...draft, text: e.target.value })
                    }
                  />
                </label>
                {draft.kind === 'image' && (
                  <label className="field">
                    HTTPS-ссылка на изображение, GIF или видео
                    <input
                      type="url"
                      value={draft.url}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setDraft({ ...draft, url: e.target.value })
                      }
                    />
                  </label>
                )}
                {/* Видео открывается отдельной ссылкой, без внешних iframe. */}
                {draft.url && (
                  <a
                    href={draft.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-button"
                  >
                    Открыть вложение ↗
                  </a>
                )}
                <div className="color-picker">
                  <span>Цвет</span>
                  {[
                    '#f5e6a9',
                    '#b5d1c0',
                    '#edc5b6',
                    '#cdc4e0',
                    '#b7d2df',
                    '#ffffff',
                  ].map((c) => (
                    <button
                      type="button"
                      key={c}
                      disabled={!canEdit}
                      aria-label={'Цвет ' + c}
                      className={draft.color === c ? 'selected' : ''}
                      style={{ background: c }}
                      onClick={() => setDraft({ ...draft, color: c })}
                    >
                      {draft.color === c && <Check size={15} />}
                    </button>
                  ))}
                </div>
                <div className="two-fields">
                  <Choice
                    label="Общая тема"
                    disabled={!canEdit}
                    value={draft.group}
                    onChange={(group) => setDraft({ ...draft, group })}
                    options={[
                      { value: '', label: 'Без группы' },
                      ...s.groups.map((g) => ({ value: g.id, label: g.title })),
                    ]}
                  />
                  <label className="field">
                    Теги через запятую
                    <input
                      value={draft.tags}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setDraft({ ...draft, tags: e.target.value })
                      }
                      placeholder="процессы, команда"
                    />
                  </label>
                </div>
                {['action', 'task', 'roadmap'].includes(draft.kind) && (
                  <>
                    <div className="two-fields">
                      <label className="field">
                        Ответственный
                        <input
                          value={draft.owner}
                          maxLength={80}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setDraft({ ...draft, owner: e.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        Срок
                        <input
                          type="date"
                          value={draft.due}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setDraft({ ...draft, due: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <Toggle
                      label="Выполнено"
                      value={draft.done}
                      disabled={!canEdit}
                      onChange={(done) => setDraft({ ...draft, done })}
                    />
                  </>
                )}
                <details className="note-details">
                  <summary>Размер и дополнительные настройки</summary>
                  <div className="three-fields">
                    {(['width', 'height', 'rotation'] as const).map(
                      (key, i) => (
                        <label className="field" key={key}>
                          {['Ширина', 'Высота', 'Поворот'][i]}
                          <input
                            type="number"
                            value={draft[key]}
                            disabled={!canEdit}
                            min={key === 'rotation' ? -180 : 40}
                            max={key === 'rotation' ? 180 : 1800}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                [key]: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      ),
                    )}
                  </div>
                  <Toggle
                    label="Заблокировать объект"
                    value={draft.locked}
                    disabled={!canEdit}
                    onChange={(locked) => setDraft({ ...draft, locked })}
                  />
                  {(!edited || edited.author === room.self) && (
                    <Toggle
                      label="Приватная заметка"
                      value={draft.hidden}
                      onChange={(hidden) => setDraft({ ...draft, hidden })}
                    />
                  )}
                </details>
                {canEdit && (
                  <button
                    className="primary full-width"
                    disabled={busy || s.archived}
                  >
                    {busy ? 'Сохраняем…' : 'Сохранить карточку'}
                  </button>
                )}
              </form>
              {edited && (
                <>
                  <div className="editor-actions">
                    <button
                      className="text-button"
                      onClick={() =>
                        void act({
                          type: 'note.add',
                          kind: edited.kind,
                          text: edited.text,
                          zone: edited.zone,
                          color: edited.color,
                          url: edited.url,
                          x: edited.x + 30,
                          y: edited.y + 30,
                        }).then((r) => r && flash('Копия добавлена'))
                      }
                    >
                      <Copy size={15} />
                      Копировать
                    </button>
                    {canEdit && (
                      <button
                        className="text-button danger"
                        onClick={() => setDeleteConfirm(true)}
                      >
                        <Trash2 size={15} />
                        Удалить
                      </button>
                    )}
                    {deleteConfirm && (
                      <button
                        className="danger-button"
                        onClick={() =>
                          void act({ type: 'note.delete', id: edited.id }).then(
                            (r) => {
                              if (r) {
                                setDraft(null);
                                setDeleteConfirm(false);
                              }
                            },
                          )
                        }
                      >
                        Подтвердить удаление
                      </button>
                    )}
                  </div>
                  <div className="reaction-picker">
                    {['👍', '❤️', '🎉', '💡', '👀', '🔥', '🇰🇿', '🌱'].map(
                      (emoji) => (
                        <button
                          key={emoji}
                          onClick={() =>
                            void act({
                              type: 'note.react',
                              id: edited.id,
                              emoji,
                            })
                          }
                          aria-label={'Реакция ' + emoji}
                        >
                          {emoji}
                          <small>{edited.reactions[emoji]?.length || ''}</small>
                        </button>
                      ),
                    )}
                  </div>
                  <div className="comments">
                    <h3>
                      Обсуждение <span>{edited.comments.length}</span>
                    </h3>
                    {edited.comments.map((c) => (
                      <div className="comment" key={c.id}>
                        <strong>
                          {room.members.find((m) => m.id === c.author)?.name ||
                            'Участник'}
                        </strong>
                        <p>{c.text}</p>
                      </div>
                    ))}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act({
                          type: 'note.comment',
                          id: edited.id,
                          text: comment,
                        }).then((r) => r && setComment(''));
                      }}
                    >
                      <input
                        className="text-input"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Комментарий · @имя"
                        maxLength={2000}
                        required
                      />
                      <button
                        className="primary"
                        aria-label="Отправить комментарий"
                      >
                        <Send size={16} />
                      </button>
                    </form>
                  </div>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!panel} onOpenChange={(v) => !v && setPanel('')}>
        <DialogContent
          className={
            'app-dialog ' + (panel === 'settings' ? 'settings-dialog' : '')
          }
        >
          <DialogTitle>
            {(
              {
                history: 'История изменений',
                settings: 'Настройки встречи',
                world: 'Настройки мира',
                fps: 'Графика и FPS',
                share: 'Пригласить команду',
                join_requests: 'Запросы на вход',
                timer: 'Время для главного',
                vote: 'Голосование',
                group: 'Объединить идеи в тему',
                widgets: 'Для живой встречи',
                tools: 'Инвентарь и инструменты',
                actions: 'План действий',
                export: 'Забрать результаты с собой',
                help: 'Управление и инструменты',
              } as Record<string, string>
            )[panel] || 'Меню'}
          </DialogTitle>
          <DialogDescription>
            {panel === 'share'
              ? 'Участники войдут по ссылке. Новая комната имеет отдельный адрес.'
              : panel === 'join_requests'
                ? 'Управление пользователями, ожидающими входа в комнату'
                : panel === 'settings'
                  ? 'Приватность и правила совместной работы'
                  : panel === 'world'
                    ? 'Общий облик мира и правила возрождения'
                    : panel === 'fps'
                      ? 'Эти настройки действуют только на вашем устройстве'
                      : 'Инструменты вашей ретроспективы'}
          </DialogDescription>
          {panel === 'tools' && (
            <>
              <div className="tool-library">
                {activeTools.map((t, i) => {
                  const Icon = activeIcons[i] || MousePointer2;
                  return (
                    <button
                      key={t.id}
                      className={tool === i ? 'selected' : ''}
                      onClick={() => {
                        setTool(i);
                        setPanel('');
                      }}
                    >
                      <Icon size={22} />
                      <div>
                        <strong>{t.label}</strong>
                        <small>{TOOL_HINTS[t.id]}</small>
                      </div>
                      <kbd>{t.key}</kbd>
                    </button>
                  );
                })}
              </div>
              <div className="tool-library-footer">
                <button
                  className="secondary"
                  onClick={() => setPanel('widgets')}
                >
                  Игры для команды
                </button>
                <button className="secondary" onClick={() => setPanel('help')}>
                  Управление
                </button>
              </div>
            </>
          )}
          {panel === 'history' && (
            <>
              <p className="muted">
                Последние 40 изменений. Отмена доступна только для вашего
                последнего действия, пока другие участники не внесли изменения.
              </p>
              <button
                className="secondary"
                onClick={() =>
                  void act({ type: 'undo' }).then((r) => {
                    if (r) {
                      flash('Последнее действие отменено');
                      setPanel('');
                    }
                  })
                }
              >
                <RotateCcw size={16} />
                Отменить последнее действие
              </button>
              <div className="history-list">
                {history.map((h) => (
                  <div key={h.version}>
                    <strong>{h.name || 'Участник'}</strong>
                    <span>
                      {(
                        {
                          'note.add': 'Добавлена карточка',
                          'note.edit': 'Изменена карточка',
                          'note.delete': 'Удалена карточка',
                          'note.comment': 'Комментарий',
                          'note.react': 'Реакция',
                          'room.settings': 'Настройки комнаты',
                          'vote.start': 'Начат раунд',
                          'vote.end': 'Завершён раунд',
                          vote: 'Голос',
                          phase: 'Этап встречи',
                          timer: 'Таймер',
                          reveal: 'Раскрыты заметки',
                          'group.add': 'Добавлена тема',
                          undo: 'Отмена действия',
                          archive: 'Завершение встречи',
                        } as Record<string, string>
                      )[h.action] || 'Действие в комнате'}
                    </span>
                    <small>{new Date(h.at).toLocaleTimeString('ru-RU')}</small>
                  </div>
                ))}
              </div>
            </>
          )}
          {panel === 'join_requests' && (
            <div className="join-requests-panel">
              <div className="join-requests-header">
                <p className="muted">
                  Пользователи, ожидающие одобрения для входа в приватную комнату.
                </p>
              </div>
              {joinRequests.length === 0 ? (
                <p className="empty-requests">Ожидающих запросов нет</p>
              ) : (
                <div className="join-requests-list">
                  {joinRequests.map((req) => (
                    <div key={req.id} className="join-request-card">
                      <div className="join-request-user">
                        <span className="join-avatar">
                          {req.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="join-user-details">
                          <strong>{req.name}</strong>
                          <small>
                            {new Date(req.created).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </small>
                        </div>
                      </div>
                      <div className="join-request-actions">
                        <button
                          type="button"
                          className="btn-accept"
                          onClick={async () => {
                            try {
                              await act({
                                type: 'join_request.accept',
                                id: req.id,
                              });
                              setJoinRequests((prev) =>
                                prev.filter((r) => r.id !== req.id),
                              );
                              flash(`Вход для ${req.name} разрешён`);
                              await refresh();
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          <Check size={16} /> Принять
                        </button>
                        <button
                          type="button"
                          className="btn-reject"
                          onClick={async () => {
                            try {
                              await act({
                                type: 'join_request.reject',
                                id: req.id,
                              });
                              setJoinRequests((prev) =>
                                prev.filter((r) => r.id !== req.id),
                              );
                              flash(`Запрос ${req.name} отклонён`);
                              await refresh();
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          <X size={16} /> Отклонить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {panel === 'share' && (
            <>
              <label className="field">
                Ссылка на комнату
                <input
                  readOnly
                  value={
                    typeof location !== 'undefined'
                      ? location.origin +
                        '/room/' +
                        id +
                        (s.access?.type === 'private' && s.access.inviteToken
                          ? '?invite=' + s.access.inviteToken
                          : '')
                      : ''
                  }
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <div className="share-buttons">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void copyLink()}
                >
                  <Copy size={16} />
                  Скопировать ссылку
                </button>
                {host && s.access?.type === 'private' && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      if (
                        confirm(
                          'Создать новую ссылку-приглашение? Старая ссылка перестанет действовать.',
                        )
                      ) {
                        await act({ type: 'access.regenerate_invite' });
                        flash('Ссылка-приглашение обновлена');
                      }
                    }}
                  >
                    <RotateCcw size={16} />
                    Обновить ссылку
                  </button>
                )}
              </div>
              <div className="share-access-info">
                <span className={`access-badge ${s.access?.type || 'public'}`}>
                  {s.access?.type === 'private'
                    ? '🔒 Приватная комната'
                    : '🌐 Публичная комната'}
                </span>
                <p className="muted">
                  {s.access?.type === 'private'
                    ? 'Вход только по ссылке-приглашению с подтверждением ведущего. Комната скрыта из общего списка комнат.'
                    : 'Комната отображается в общем списке комнат. Любой пользователь может присоединиться свободно.'}
                </p>
              </div>
            </>
          )}
          {panel === 'world' && (
            <>
              <StylePicker
                value={s.visualStyle || 'classic'}
                disabled={!host}
                onChange={(visualStyle) =>
                  void act({ type: 'room.settings', patch: { visualStyle } })
                }
              />
              <div className="theme-grid">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    disabled={!host}
                    className={`theme-card ${s.theme === t.id ? 'selected' : ''}`}
                    onClick={() =>
                      void act({
                        type: 'room.settings',
                        patch: { theme: t.id, season: t.season },
                      })
                    }
                  >
                    <span>{t.icon}</span>
                    <strong>{t.name}</strong>
                    <small>{t.subtitle}</small>
                  </button>
                ))}
              </div>
              <div className="two-fields">
                <Choice
                  label="Время суток"
                  value={s.time}
                  disabled={!host}
                  onChange={(time) =>
                    void act({ type: 'room.settings', patch: { time } })
                  }
                  options={[
                    ['dawn', 'Рассвет'],
                    ['day', 'День'],
                    ['sunset', 'Закат'],
                    ['night', 'Ночь'],
                  ].map(([value, label]) => ({ value, label }))}
                />
                <Choice
                  label="Время года"
                  value={s.season}
                  disabled={!host}
                  onChange={(season) =>
                    void act({ type: 'room.settings', patch: { season } })
                  }
                  options={[
                    ['spring', 'Весна'],
                    ['summer', 'Лето'],
                    ['autumn', 'Осень'],
                    ['winter', 'Зима'],
                  ].map(([value, label]) => ({ value, label }))}
                />
              </div>
              <Toggle
                label="Встретиться в интерьере"
                description="Уютная мастерская с деревянными балками"
                value={s.interior}
                disabled={!host}
                onChange={(interior) =>
                  void act({ type: 'room.settings', patch: { interior } })
                }
              />
              <label className="field">
                Возрождение, секунд
                <input
                  type="number"
                  aria-label="Интервал возрождения"
                  key={s.respawnSeconds ?? 5}
                  defaultValue={s.respawnSeconds ?? 5}
                  min="1"
                  max="30"
                  step="1"
                  disabled={!host}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isInteger(value) && value >= 1 && value <= 30)
                      void act({
                        type: 'room.settings',
                        patch: { respawnSeconds: value },
                      });
                    else e.target.value = String(s.respawnSeconds ?? 5);
                  }}
                />
              </label>
            </>
          )}
          {panel === 'fps' && (
            <>
              <ResourcePackPicker />
              <p className="performance-summary">
                {fps} FPS · {me?.ping || 0} мс
              </p>
              <Choice
                label="Лимит FPS"
                value={String(fpsLimit)}
                onChange={(v) => {
                  setFpsLimit(Number(v));
                  localStorage.setItem('jinaly-fps-limit', v);
                }}
                options={[20, 30, 60].map((v) => ({
                  value: String(v),
                  label: `${v} FPS`,
                }))}
              />
              <Choice
                label="Качество шейдеров и графики"
                value={quality === 'high' ? 'cinematic' : quality}
                onChange={(q) => {
                  setQuality(q);
                  localStorage.setItem('jinaly-quality', q);
                }}
                options={[
                  {
                    value: 'low',
                    label: 'Быстрое · базовые шейдеры, макс. FPS',
                  },
                  {
                    value: 'balanced',
                    label: 'Сбалансированное · мягкие тени и свечение',
                  },
                  {
                    value: 'cinematic',
                    label: 'Кинематографичное · HDR Bloom, 2K тени, максимум деталей',
                  },
                ]}
              />
              <label className="field">
                Чувствительность камеры: {sensitivity.toFixed(1)}×
                <input
                  aria-label="Чувствительность камеры"
                  type="range"
                  min="0.4"
                  max="2"
                  step="0.1"
                  value={sensitivity}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setSensitivity(v);
                    localStorage.setItem('jinaly-sensitivity', String(v));
                  }}
                />
              </label>
              <Toggle
                label="Инвертировать вертикальную камеру"
                value={invertCamera}
                onChange={(v) => {
                  setInvertCamera(v);
                  localStorage.setItem('jinaly-invert-camera', String(v));
                }}
              />
            </>
          )}
          {panel === 'settings' && (
            <>
              <Toggle
                label="Анонимные участники"
                description="Пакеты со смайликом вместо лиц. Никнеймы скрыты."
                value={!!s.anonymousPlayers}
                disabled={!host}
                onChange={(anonymousPlayers) =>
                  void act({
                    type: 'room.settings',
                    patch: { anonymousPlayers },
                  })
                }
              />
              <Toggle
                label="Приватное написание"
                description="Каждый сам раскрывает свои новые заметки"
                value={s.privateWriting}
                disabled={!host}
                onChange={(privateWriting) =>
                  void act({ type: 'room.settings', patch: { privateWriting } })
                }
              />
              <Toggle
                label="Анонимные новые заметки"
                value={s.anonymous}
                disabled={!host}
                onChange={(anonymous) =>
                  void act({ type: 'room.settings', patch: { anonymous } })
                }
              />
              <Toggle
                label="Заблокировать макет"
                value={s.layoutLocked}
                disabled={!host}
                onChange={(layoutLocked) =>
                  void act({ type: 'room.settings', patch: { layoutLocked } })
                }
              />
              <Toggle label="Звуки встречи" value={sound} onChange={setSound} />
              {host && (
                <div className="settings-access-box">
                  <span className="settings-subheading">Доступ к комнате</span>
                  <div className="access-toggle-grid">
                    <button
                      type="button"
                      className={`access-toggle-card ${s.access?.type === 'public' ? 'active' : ''}`}
                      onClick={() =>
                        void act({
                          type: 'access.set',
                          accessType: 'public',
                        })
                      }
                    >
                      <div className="access-toggle-icon">🌐</div>
                      <div>
                        <strong>Публичная</strong>
                        <small>В общем списке комнат</small>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`access-toggle-card ${s.access?.type === 'private' ? 'active' : ''}`}
                      onClick={() =>
                        void act({
                          type: 'access.set',
                          accessType: 'private',
                        })
                      }
                    >
                      <div className="access-toggle-icon">🔒</div>
                      <div>
                        <strong>Приватная</strong>
                        <small>По ссылке с подтверждением</small>
                      </div>
                    </button>
                  </div>
                  <label className="field" style={{ marginTop: '0.75rem' }}>
                    Максимум участников: <b>{s.access?.maxPlayers || 8}</b>
                    <input
                      type="range"
                      min="2"
                      max="50"
                      value={s.access?.maxPlayers || 8}
                      onChange={(e) => {
                        const maxPlayers = Number(e.target.value);
                        void act({
                          type: 'access.max_players',
                          maxPlayers,
                        });
                      }}
                    />
                  </label>
                </div>
              )}
              <label className="field">
                Ваше имя
                <input
                  defaultValue={me?.name}
                  maxLength={40}
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== me?.name) {
                      void act({
                        type: 'profile',
                        name: e.target.value,
                        mood: me?.mood,
                        hat: me?.hat,
                      });
                      localStorage.setItem('jinaly-name', e.target.value);
                    }
                  }}
                />
              </label>
              {host && (
                <button
                  className="secondary"
                  onClick={() =>
                    void act({ type: 'archive', value: !s.archived }).then(
                      (r) => r && setPanel(''),
                    )
                  }
                >
                  <Check size={16} />
                  {s.archived ? 'Открыть встречу снова' : 'Завершить встречу'}
                </button>
              )}
            </>
          )}
          {panel === 'timer' && (
            <>
              <div className="large-timer">{timeText}</div>
              <Choice
                label="Продолжительность"
                value={seconds}
                onChange={setSeconds}
                options={[
                  { value: '60', label: '1 минута' },
                  { value: '180', label: '3 минуты' },
                  { value: '300', label: '5 минут' },
                  { value: '600', label: '10 минут' },
                  { value: '900', label: '15 минут' },
                ]}
              />
              <div className="button-row">
                <button
                  disabled={!host}
                  className="primary"
                  onClick={() =>
                    void act({
                      type: 'timer',
                      action: s.timer.running ? 'pause' : 'start',
                      seconds: s.timer.running ? undefined : Number(seconds),
                    })
                  }
                >
                  {s.timer.running ? <Pause size={17} /> : <Play size={17} />}{' '}
                  {s.timer.running ? 'Пауза' : 'Запустить'}
                </button>
                <button
                  disabled={!host}
                  className="secondary"
                  onClick={() =>
                    void act({
                      type: 'timer',
                      action: 'start',
                      seconds: s.timer.remaining,
                    })
                  }
                >
                  Продолжить
                </button>
                <button
                  disabled={!host}
                  className="secondary"
                  onClick={() =>
                    void act({
                      type: 'timer',
                      action: 'reset',
                      seconds: Number(seconds),
                    })
                  }
                >
                  <RotateCcw size={16} />
                  Сброс
                </button>
              </div>
              {!host && <p className="muted">Таймером управляет ведущий.</p>}
            </>
          )}
          {panel === 'vote' && (
            <>
              <p className="muted">
                {round?.active
                  ? `Осталось ${round.limit - used} из ${round.limit} голосов. Нажимайте 👍 на карточках. До завершения раунда вы видите только свои голоса.`
                  : 'Выберите важные темы для обсуждения. Результаты раскроются после завершения раунда.'}
              </p>
              {host && !round?.active && (
                <>
                  <label className="field">
                    Голосов на участника
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={voteLimit}
                      onChange={(e) => setVoteLimit(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    onClick={() =>
                      void act({ type: 'vote.start', limit: Number(voteLimit) })
                    }
                  >
                    <Vote size={17} />
                    Начать раунд
                  </button>
                </>
              )}
              {host && round?.active && (
                <button
                  className="primary"
                  onClick={() => void act({ type: 'vote.end' })}
                >
                  Завершить и показать результаты
                </button>
              )}
              <div className="vote-results">
                {[...s.notes]
                  .filter((n) => voteCount(s, n.id) > 0)
                  .sort((a, b) => voteCount(s, b.id) - voteCount(s, a.id))
                  .map((n, i) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setPanel('');
                        editNote(n);
                      }}
                    >
                      <span>{i + 1}</span>
                      <p>{n.text}</p>
                      <b>{voteCount(s, n.id)}</b>
                    </button>
                  ))}
              </div>
              {s.rounds.length > 0 && (
                <p className="muted">
                  Раунд {s.rounds.length} ·{' '}
                  {round?.active ? 'идёт голосование' : 'результаты открыты'}
                </p>
              )}
            </>
          )}
          {panel === 'group' && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act({ type: 'group.add', title: groupTitle }).then(
                    (r) => {
                      if (r) {
                        setGroupTitle('');
                        flash(
                          'Тема создана. Выберите её в настройках карточек.',
                        );
                      }
                    },
                  );
                }}
              >
                <label className="field">
                  Название темы
                  <input
                    required
                    maxLength={80}
                    value={groupTitle}
                    onChange={(e) => setGroupTitle(e.target.value)}
                    placeholder="Например, качество коммуникации"
                  />
                </label>
                <button className="primary">
                  <Folder size={16} />
                  Создать тему
                </button>
              </form>
              <div className="group-list">
                {s.groups.map((g) => (
                  <div key={g.id}>
                    <Folder size={17} />
                    <span>{g.title}</span>
                    <small>
                      {s.notes.filter((n) => n.group === g.id).length} идей
                    </small>
                    {host && (
                      <button
                        aria-label="Удалить тему"
                        onClick={() =>
                          void act({ type: 'group.delete', id: g.id })
                        }
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="muted">
                Откройте карточку и выберите «Общая тема», чтобы сгруппировать
                похожие идеи.
              </p>
            </>
          )}
          {panel === 'widgets' && (
            <>
              <p className="field">Как вы сегодня?</p>
              <div className="mood-picker">
                {['😊', '🤩', '😐', '😴', '😵‍💫'].map((mood) => (
                  <button
                    key={mood}
                    className={me?.mood === mood ? 'selected' : ''}
                    aria-label={'Настроение ' + mood}
                    onClick={() =>
                      void act({
                        type: 'profile',
                        name: me?.name || 'Участник',
                        mood,
                        hat: me?.hat,
                      })
                    }
                  >
                    {mood}
                  </button>
                ))}
              </div>
              <div className="widget-grid">
                <button
                  onClick={() =>
                    void act({ type: 'event', kind: 'confetti', value: '🎉' })
                  }
                >
                  <PartyPopper />
                  Конфетти
                </button>
                <button
                  onClick={() =>
                    void act({ type: 'event', kind: 'hat', value: '🎩' })
                  }
                >
                  <Smile />
                  Бросить шляпу
                </button>
                <button
                  onClick={() => {
                    setSound(true);
                    void act({ type: 'event', kind: 'buzzer' });
                  }}
                >
                  <Bell />
                  Звонок
                </button>
                <button
                  onClick={() => void act({ type: 'event', kind: 'ping' })}
                >
                  <Flag />
                  Внимание сюда
                </button>
              </div>
              <div className="counter-widget">
                <span>Счётчик</span>
                <button
                  onClick={() => void act({ type: 'counter', down: true })}
                >
                  −
                </button>
                <strong>{s.counter}</strong>
                <button onClick={() => void act({ type: 'counter' })}>+</button>
              </div>
              <label className="field">
                Случайный выбор · варианты через запятую
                <input
                  value={spinOptions}
                  onChange={(e) => setSpinOptions(e.target.value)}
                  placeholder={online.map((m) => m.name).join(', ')}
                />
              </label>
              <button
                className="secondary"
                onClick={() => {
                  const options = (
                    spinOptions || online.map((m) => m.name).join(',')
                  )
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean);
                  if (options.length) {
                    let randIndex = 0;
                    if (
                      typeof crypto !== 'undefined' &&
                      typeof crypto.getRandomValues === 'function'
                    ) {
                      const values = new Uint32Array(1);
                      crypto.getRandomValues(values);
                      randIndex = values[0] % options.length;
                    } else {
                      randIndex = Math.floor(Math.random() * options.length);
                    }
                    void act({
                      type: 'event',
                      kind: 'spin',
                      value: options[randIndex],
                    });
                  }
                }}
              >
                <Dices size={18} />
                Выбрать {spinner && '· ' + spinner}
              </button>
              <p className="muted">
                Музыка включается в Jinaly Radio в игровом окне. Плейлист и
                громкость индивидуальны для каждого участника.
              </p>
              <Toggle
                label="Звуки событий и реакций"
                value={sound}
                onChange={setSound}
              />
            </>
          )}
          {panel === 'actions' && (
            <>
              <button
                className="primary"
                onClick={() => {
                  setPanel('');
                  setDraft({
                    kind: 'action',
                    text: '',
                    zone: 'start',
                    color: '#b5d1c0',
                    url: '',
                    x: 25,
                    y: 60,
                    owner: '',
                    due: '',
                    group: '',
                    tags: '',
                    hidden: false,
                    locked: false,
                    done: false,
                    width: 220,
                    height: 180,
                    rotation: 0,
                  });
                }}
              >
                <Plus size={16} />
                Добавить действие
              </button>
              <div className="action-list">
                {s.notes
                  .filter((n) => ['action', 'task'].includes(n.kind))
                  .map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setPanel('');
                        editNote(n);
                      }}
                    >
                      <span
                        className={
                          n.done ? 'action-check done' : 'action-check'
                        }
                      >
                        {n.done && <Check size={15} />}
                      </span>
                      <div>
                        <strong>{n.text}</strong>
                        <small>
                          {n.owner || 'Ответственный не назначен'}{' '}
                          {n.due && '· ' + n.due}
                        </small>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                {!s.notes.some((n) => ['action', 'task'].includes(n.kind)) && (
                  <p className="muted">
                    Договоритесь о конкретном следующем шаге и назначьте
                    ответственного.
                  </p>
                )}
              </div>
            </>
          )}
          {panel === 'export' && (
            <>
              <div className="export-options">
                {[
                  ['json', 'JSON', 'Карточки, темы и раунды голосования'],
                  ['csv', 'CSV', 'Таблица для Excel и других приложений'],
                  ['md', 'Markdown', 'Итоги ретроспективы текстом'],
                ].map(([format, label, sub]) => (
                  <button key={format} onClick={() => exportRoom(format)}>
                    <Download size={20} />
                    <div>
                      <strong>{label}</strong>
                      <small>{sub}</small>
                    </div>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
              {host && (
                <label className="field">
                  Добавить карточки из JSON или CSV
                  <input
                    type="file"
                    accept=".json,.csv"
                    onChange={(e) => {
                      if (e.target.files?.[0])
                        void importFile(e.target.files[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
              <p className="muted">
                Экспорт содержит только доступные вам заметки. Импорт добавляет
                карточки к существующим, до 200 объектов за один раз.
              </p>
            </>
          )}
          {panel === 'help' && (
            <div className="help-copy">
              <p>
                <b>Камера:</b> кликните по миру и двигайте мышь — удерживать
                кнопки не нужно. Esc освобождает курсор для меню. Стрелки тоже
                вращают камеру. V переключает первое и третье лицо. F сбрасывает
                угол обзора. Alt + колесо меняет расстояние в третьем лице.
                Кнопка прицела включает необязательный захват мыши.
              </p>
              <p>
                <b>Краскомёт / конфетти:</b> слоты 1 и 2. ЛКМ стреляет туда,
                куда вы указываете. ПКМ — прицеливание, R — перезарядка. Краска
                исчезает через 12 секунд. Все игроки видят ваши залпы.
              </p>
              <p>
                Для игры с Ctrl + WASD включите <b>полный экран</b> кнопкой ⛶ в
                шапке: в поддерживаемом браузере игровой ввод перехватывает
                сочетания с W, A, S, D. Выход — Esc.
              </p>
              <p>
                <b>WASD</b> — движение. <b>Пробел</b> — прыжок. <b>C</b> — сесть
                / встать. <b>Дважды C</b> — лечь. <b>Ctrl</b> — присесть
                (удерживать). <b>Shift</b> — медленный шаг.
              </p>
              <p>
                <b>1–5</b> — краскомёт, дробовик, пиньято, снайперка и планшет.
                Колесо — переключение оружия, удержание колёсика — варианты снаряжения.
                <b>Q, I</b> — снаряжение. Инструменты ретро в этой панели
                сразу открывают обычную доску.
              </p>
              <p>
                <b>E</b> у доски — открыть её. <b>Ё</b> — участники и
                задержка. <b>Esc</b> — вернуть курсор.
              </p>
              <p>
                <b>На обычной доске:</b> двойной щелчок создаёт объект. Ручка в
                углу карточки позволяет перетаскивать её. Маркер рисует,
                инструмент «Связь» соединяет две выбранные карточки.
              </p>
              <p>
                В экономном режиме частота ограничена 30 FPS, со статическими
                тенями и без bloom. На устройстве без WebGL откроется обычная
                доска.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
function CompassPlaceholder() {
  return (
    <div className="loading-orbit">
      <Box size={36} />
    </div>
  );
}
