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
  Repeat,
  Settings2,
  Check,
  StickyNote,
  Maximize,
  Minimize,
  Timer,
  Vote,
  Flag,
  Box,
  ChevronRight,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  Bell,
  X,
  Wifi,
  Monitor,
  Send,
  Lock,
  Gauge,
  MousePointer2,
  Swords,
  Sun,
  ShieldCheck,
  UserRound,
  ListChecks,
  Dices,
  Download,
  RotateCcw,
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
import {
  ZONES,
  GAME_TOOLS,
  kdaRatio,
  voteCount,
  type Note,
  type Pose,
} from '@/lib/model';
import { api, download, parseCSV } from '@/lib/client';
import { Choice, Toggle } from './controls';
import { Card } from './board';
import { useResourcePack } from '../hooks/use-resource-pack';
import { readAimModes, type WeaponAimModes } from '@/lib/aim-settings';
import {
  ActionsPanel,
  AccessSection,
  ArchiveSection,
  ControlsSection,
  ExportPanel,
  GraphicsSection,
  GroupPanel,
  HistoryPanel,
  JoinRequestsPanel,
  ProfileSection,
  SharePanel,
  TimerPanel,
  ToolsPanel,
  VotePanel,
  MatchBar,
  ModePanel,
  WidgetsPanel,
  WorldPanel,
  FPS_LIMITS,
} from './room-panels';
import { SettingsShell, type SettingsGroup } from './settings-shell';
import { WorldQuickChip } from './world-quick-chip';
import { GameClock } from './game-clock';
import { SidePicker } from './side-picker';
import { PhaseBar } from './phase-bar';
import { useRoomSync } from './use-room-sync';
import { MAP_CATALOG, modeOf } from '@/lib/maps/catalog';
import { defaultSlot, hasSlot, slotsFor } from '@/lib/loadout';

const World = lazy(() => import('./world'));
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
  const [fpsLimit, setFpsLimit] = useState(60);
  const [editingTitle, setEditingTitle] = useState(false);
  const [quickSticky, setQuickSticky] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [sensitivity, setSensitivity] = useState(1),
    [invertCamera, setInvertCamera] = useState(false);
  const [aimModes, setAimModes] = useState<WeaponAimModes>(() => readAimModes());
  const [paintColor, setPaintColor] = useState('#bc91f5');
  const [joinRequestSent, setJoinRequestSent] = useState(false),
    [retryAfterReject, setRetryAfterReject] = useState(false),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [webglFailed, setWebglFailed] = useState(false),
    [heldTool, setTool] = useState(0),
    [panel, setPanel] = useState(''),
    // Какой раздел открыт в двухколоночных настройках. Отдельно от panel:
    // настройки — один экран, разделы внутри него переключаются без выхода.
    [settingsSection, setSettingsSection] = useState('graphics'),
    [selectedZone, setSelectedZone] = useState(''),
    [draft, setDraft] = useState<Draft | null>(null),
    [comment, setComment] = useState(''),
    [quality, setQuality] = useState('balanced'),
    [fps, setFps] = useState(0),
    [monitor, setMonitor] = useState(false),
    [now, setNow] = useState(() => Date.now()),
    [seconds, setSeconds] = useState('300'),
    [voteLimit, setVoteLimit] = useState('5'),
    [groupTitle, setGroupTitle] = useState(''),
    [sound, setSound] = useState(false),
    [spinner, setSpinner] = useState(''),
    [spinOptions, setSpinOptions] = useState(''),
    [deleteConfirm, setDeleteConfirm] = useState(false),
    [celebrate, setCelebrate] = useState(''),
    [selectedSkin, setSelectedSkin] = useState<string>(() =>
      typeof localStorage !== 'undefined' ? localStorage.getItem('jinaly-custom-skin') || 'agent' : 'agent',
    ),
    [selectedBandanaColor, setSelectedBandanaColor] = useState<string>(() =>
      typeof localStorage !== 'undefined' ? localStorage.getItem('jinaly-bandana-color') || '#3b82f6' : '#3b82f6',
    );
  const cursor = useRef({ x: 0, y: 0, mode: '3d' });
  const [history, setHistory] = useState<
    { version: number; action: string; name: string; at: number }[]
  >([]);
  // История не лежит в состоянии комнаты: её отдаёт отдельный запрос, и раздел
  // пуст, пока её не спросишь. Раньше запрос висел на пункте меню, но меню
  // больше нет, а заходов в раздел стало два — переключение слева и открытие
  // настроек сразу на нём. Эффект покрывает оба и заодно освежает список: за
  // время встречи он успевает устареть.
  useEffect(() => {
    if (panel !== 'menu' || settingsSection !== 'history') return;
    void api<{ history: typeof history }>('/api/rooms/' + id, {
      type: 'history',
    })
      .then((r) => setHistory(r.history))
      .catch((e: Error) => setError(e.message));
  }, [panel, settingsSection, id]);
  const pose = useRef<Pose>({
      x: 0,
      z: 14,
      y: 0,
      yaw: 0,
      stance: 'stand',
      moving: false,
    }),
    eventTime = useRef(0),
    lastFocus = useRef(0),
    audio = useRef<AudioContext | null>(null),
    soundRef = useRef(false);
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

  useEffect(() => {
    eventTime.current = Date.now();
  }, [id]);
  const {
    room,
    join,
    joinRequests,
    setJoinRequests,
    packetLoss,
    ping,
    refresh,
    op,
    act,
    fire,
    weapon,
    serverNow,
  } = useRoomSync({
    id,
    pose,
    cursor,
    lastActivityRef,
    nameRef,
    busyRef,
    enterRef,
    setError,
    onReady: () => {
      setName(localStorage.getItem('jinaly-name') || '');
      const savedSensitivity = Number(
        localStorage.getItem('jinaly-sensitivity') || 1,
      );
      setSensitivity(
        Number.isFinite(savedSensitivity)
          ? Math.min(2, Math.max(0.4, savedSensitivity))
          : 1,
      );
      setInvertCamera(localStorage.getItem('jinaly-invert-camera') === 'true');
      setAimModes(readAimModes());
      const savedQuality = localStorage.getItem('jinaly-quality');
      setQuality(
        savedQuality === 'high' ? 'cinematic' : savedQuality || 'balanced',
      );
      const savedFps = Number(localStorage.getItem('jinaly-fps-limit'));
      setFpsLimit(FPS_LIMITS.includes(savedFps) ? savedFps : 60);
    },
  });
  // Часы комнаты идут по серверному времени: и матч, и внутриигровые сутки
  // считаются от серверных отметок, а локальные часы у участников разные.
  useEffect(() => {
    const clock = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(clock);
  }, [serverNow]);
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
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
  // Карточка или лист зоны перехватывают ввод: клавиша стороны при них молчит.
  const editorOpenRef = useRef(false);
  useEffect(() => {
    editorOpenRef.current = !!draft || !!selectedZone;
  }, [draft, selectedZone]);
  // «G» открывает и закрывает выбор стороны прямо из игры, без табло счёта.
  // Смотрим на e.code, а не на e.key: в русской раскладке это «п».
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyG' || e.repeat || e.ctrlKey || e.metaKey || e.altKey)
        return;
      // Пока игрок печатает, клавиша остаётся обычной буквой.
      if (
        (e.target as HTMLElement | null)?.closest(
          'input,textarea,select,[contenteditable=true]',
        )
      )
        return;
      if (!roomRef.current || editorOpenRef.current) return;
      e.preventDefault();
      // Чужую открытую панель клавиша не подменяет: только своя открывается
      // и закрывается.
      setPanel((p) => (p === 'team' ? '' : p === '' ? 'team' : p));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const me = room?.members.find((m) => m.id === room.self),
    host = room?.host === room?.self,
    s = room?.state,
    online = room?.members.filter((m) => now - m.lastSeen < 15000) || [],
    gameMode = modeOf(s ?? {}),
    mapTitle =
      MAP_CATALOG.find((m) => m.id === (s?.map ?? 'hub'))?.title ?? 'Хаб',
    slots = slotsFor(gameMode),
    // Предмет другого режима в руках не остаётся: берём предмет по умолчанию.
    tool = hasSlot(gameMode, heldTool) ? heldTool : defaultSlot(gameMode);
  // Сколько пунктов плана ещё не сделано — подпись раздела «План действий»
  // отвечает на вопрос «надо ли туда заходить» до того, как его открыли.
  const actionsLeft =
    s?.notes.filter((n) => n.kind === 'action' && !n.done).length ?? 0;
  // Разделы настроек. Личное отделено от правил комнаты: раньше они лежали в
  // одном плоском списке, и было не видно, что можешь менять ты, а что ведущий.
  // Сюда же переехали разовые действия из бывшего меню комнаты: своих входов
  // (горячих клавиш, кнопок в шапке) у них нет, и без меню они стали бы
  // недостижимы. У инвентаря и выбора стороны такие входы есть — Q / I и G, —
  // поэтому их в настройках нет.
  const settingsGroups: SettingsGroup[] = [
    {
      id: 'mine',
      title: 'Моё',
      sections: [
        {
          id: 'graphics',
          title: 'Графика',
          hint: 'Качество картинки и лимит FPS на этом устройстве',
          icon: Gauge,
        },
        {
          id: 'controls',
          title: 'Управление',
          hint: 'Мышь, камера, прицеливание и список клавиш',
          icon: MousePointer2,
        },
        {
          id: 'profile',
          title: 'Профиль',
          hint: 'Имя в комнате и звуки встречи',
          icon: UserRound,
        },
      ],
    },
    {
      id: 'meeting',
      title: 'Встреча',
      sections: [
        {
          id: 'actions',
          title: 'План действий',
          hint: actionsLeft
            ? `${actionsLeft} не сделано`
            : 'Договорённости встречи и кто за них взялся',
          icon: ListChecks,
        },
        {
          id: 'widgets',
          title: 'Для живой встречи',
          hint: 'Таймер, спиннер, счётчик и реакции',
          icon: Dices,
        },
      ],
    },
    {
      id: 'room',
      title: 'Комната',
      sections: [
        {
          id: 'mode',
          title: 'Режим и карта',
          hint: 'Во что играем: режим, карта и правила матча',
          icon: Swords,
          hostOnly: true,
        },
        {
          id: 'world',
          title: 'Облик мира',
          hint: 'Стиль и тема оформления',
          icon: Sun,
          hostOnly: true,
        },
        {
          id: 'access',
          title: 'Доступ и приватность',
          hint: 'Кто входит и что видно участникам',
          icon: ShieldCheck,
          hostOnly: true,
        },
      ],
    },
    {
      id: 'results',
      title: 'Результаты',
      sections: [
        {
          id: 'export',
          title: 'Импорт / экспорт',
          hint: 'JSON, CSV, Markdown',
          icon: Download,
        },
        {
          id: 'history',
          title: 'История изменений',
          hint: 'Последние 40 действий',
          icon: RotateCcw,
        },
        // Завершение встречи — последним пунктом и отдельной группой, а не
        // строкой среди переключателей: оно необратимо для участников, и
        // соседство с «Именем в комнате» его уравнивало с обычной настройкой.
        // hostOnly — не только про замок: архивирует комнату только ведущий.
        {
          id: 'finish',
          title: 'Завершение встречи',
          hint: s?.archived
            ? 'Комната сейчас только для чтения'
            : 'Закрыть комнату для правок',
          icon: Flag,
          hostOnly: true,
        },
      ],
    },
  ];
  /** Открыть настройки сразу на нужном разделе — из HUD или из инвентаря. */
  const openSettings = (section: string) => {
    setSettingsSection(section);
    // Кнопка-шестерёнка в шапке шлёт 'menu': меню комнаты и есть настройки,
    // отдельного списка-прослойки между ними больше нет.
    setPanel('menu');
  };
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
      setRetryAfterReject(false);
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
    if (!stickyOnly && GAME_TOOLS[tool]?.id === 'group') {
      setPanel('group');
      return;
    }
    const count = s?.notes.filter((n) => n.zone === zone).length || 0;
    let kind = stickyOnly ? 'sticky' : kinds[GAME_TOOLS[tool]?.id] || 'sticky';
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
      const { hidden, ...rest } = draft;
      const data = {
        ...rest,
        // Only the author may change visibility; the host editing someone else's card must not send it.
        ...(!draft.id ||
        room?.state.notes.find((n) => n.id === draft.id)?.author === room?.self
          ? { hidden }
          : {}),
        tags: draft.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };
      if (draft.id) await op({ type: 'note.edit', id: draft.id, patch: data });
      else await op({ type: 'note.add', ...data });
      setDraft(null);
      setTimeout(() => {
        void document.querySelector('canvas')?.requestPointerLock();
      }, 50);
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
    // The server keeps reporting the latest (rejected) request until a new one is sent.
    const isRejected = join.requestStatus === 'rejected' && !retryAfterReject;
    const isPending =
      join.requestStatus === 'pending' ||
      (joinRequestSent && join.requestStatus !== 'rejected');
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
                    setRetryAfterReject(true);
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
        // mode-3d держит стили игрового HUD: комната теперь всегда 3D.
        'room-app mode-3d mode-' +
        gameMode +
        (s.visualStyle === 'anime' ? ' style-anime' : ' style-classic')
      }
    >
      <header className="game-bar">
        <a href="/" className="game-bar-back" aria-label="К комнатам">
          <ArrowLeft size={17} />
        </a>
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
        <span className="game-tag map-tag">{mapTitle}</span>
        <div className="game-bar-center">
          {gameMode === 'battle' ? (
            // Часы стоят под счётом матча: время суток — фон боя, а не его
            // счёт, и перебивать собой очки команд не должно.
            <div className="match-stack">
              <MatchBar match={room.match} rounds={s.roundWins ?? 5} now={now} />
              <GameClock state={s} now={now} />
            </div>
          ) : (
            <>
              {/* Этапы уехали из шапки в PhaseBar над сценой: шесть кнопок
                  занимали всю середину ради действия, которое делают пять раз
                  за встречу, и вытесняли таймер, голоса и приватность. */}
              <button
                className={`game-tag clock ${s.timer.running ? 'running' : ''}`}
                onClick={() => setPanel('timer')}
                title="Время для главного"
              >
                <Timer size={14} />
                {timeText}
              </button>
              <button
                className="game-tag"
                onClick={() => setPanel('vote')}
                title="Голосование"
              >
                <Vote size={14} />
                {round?.active ? `${round.limit - used}` : 'Голоса'}
              </button>
              <button
                className={`game-tag ${s.privateWriting ? 'on' : ''}`}
                title="Приватное написание"
                onClick={() =>
                  host
                    ? void act({
                        type: 'room.settings',
                        patch: { privateWriting: !s.privateWriting },
                      })
                    : flash('Режим приватного написания меняет ведущий')
                }
              >
                <EyeOff size={14} />
                {s.privateWriting ? 'Приватно' : 'Открыто'}
              </button>
              {/* В ретро MatchBar не рендерится, поэтому часы встают в тот же
                  ряд — сразу за таймером встречи, чтобы «сколько осталось» в
                  реальном и в игровом времени читалось рядом. */}
              <GameClock state={s} now={now} />
            </>
          )}
        </div>
        <button
          className="game-tag people"
          onClick={() => setMonitor(true)}
          aria-label="Участники комнаты"
        >
          {online.slice(0, 3).map((m) => (
            <span
              key={m.id}
              className="avatar"
              style={{ background: m.color, color: '#fff' }}
              title={m.name}
            >
              {m.name[0]}
            </span>
          ))}
          <b>{online.length}</b>
        </button>
        {host && joinRequests.length > 0 && (
          <button
            type="button"
            className="game-tag alert"
            onClick={() => setPanel('join_requests')}
            aria-label="Запросы на вход"
          >
            <Bell size={14} className="bell-pulse" />
            {joinRequests.length}
          </button>
        )}
        <WorldQuickChip
          time={s.time}
          season={s.season}
          now={now}
          dayCycle={s.dayCycle}
          host={host}
          onDayCycleChange={(dayCycle) =>
            void act({ type: 'room.settings', patch: { dayCycle } })
          }
          onTimeChange={(time) =>
            void act({ type: 'room.settings', patch: { time } })
          }
          onSeasonChange={(season) =>
            void act({ type: 'room.settings', patch: { season } })
          }
          onLocked={() => flash('Облик мира меняет ведущий встречи')}
        />
        <button className="game-tag" onClick={() => setPanel('share')}>
          <Link2 size={14} />
          Пригласить
        </button>
        <button
          className="game-tag"
          onClick={() => void enterFullscreen()}
          aria-label={
            fullscreen ? 'Выйти из полного экрана' : 'Полный экран для игры'
          }
          title="Полный экран · игровой ввод"
        >
          {fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>
        <button
          className="game-tag"
          onClick={() => setPanel('menu')}
          aria-label="Меню комнаты"
        >
          <Settings2 size={15} />
        </button>
      </header>
      <section className="main-surface" aria-label="Игровой мир">
          {/* Этапы есть только у ретро: в командном бою их роль играет MatchBar
              в шапке. Плашка лежит в левой колонке HUD под .camera-toolbar —
              свободное место, где она не спорит ни с зонами справа, ни с
              панелью предметов внизу (подробности — в app/phases.css). */}
          {gameMode === 'retro' && (
            <PhaseBar
              phase={s.phase}
              host={host}
              archived={s.archived}
              onPhase={(phase) => void act({ type: 'phase', phase })}
            />
          )}
          {webglFailed ? (
            <div className="world-failed" role="alert">
              <h2>Браузер не смог открыть 3D-мир</h2>
              <p>
                Нужен WebGL: включите аппаратное ускорение в настройках браузера
                или откройте комнату в другом браузере.
              </p>
              <a href="/" className="secondary">
                К комнатам
              </a>
            </div>
          ) : (
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
                onGraphics={() => openSettings('graphics')}
                onPaintColor={setPaintColor}
                tool={tool}
                onTool={setTool}
                pendingJoinRequestsCount={joinRequests.length}
                onOpenJoinRequests={() => setPanel('join_requests')}
                onBoardTool={() =>
                  flash('Доска открывается планшетом — предмет в инвентаре')
                }
                onZone={(zone) => newNote(zone, undefined, undefined, true)}
                sensitivity={sensitivity}
                invertCamera={invertCamera}
                aimModes={aimModes}
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
                monitor={monitor}
                onFps={setFps}
                onAction={() =>
                  void act({ type: 'event', kind: 'reaction', value: '👍' })
                }
                onFire={fire}
                onWeapon={weapon}
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
                onFailure={() => setWebglFailed(true)}
                blocked={
                  !!panel ||
                  !!draft ||
                  !!selectedZone
                }
              />
            </Suspense>
          )}
          {gameMode === 'retro' && (
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
                title="Закрыть (Esc)"
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
                <strong>{fps}</strong>
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
                {gameMode === 'battle' && (
                  <>
                    <span className="col-num col-k">K</span>
                    <span className="col-num col-d">D</span>
                    <span className="col-num col-a">A</span>
                    <span className="col-num col-kda">KDA</span>
                  </>
                )}
                <span className="col-num col-ping">ПИНГ</span>
              </div>
              <div className="monitor-table-body">
                {[...room.members]
                  .sort((a, b) => kdaRatio(b) - kdaRatio(a))
                  .map((m) => (
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
                          {gameMode === 'battle' &&
                            ` · ${m.team === 'red' ? 'красные' : m.team === 'blue' ? 'синие' : 'без команды'}`}
                        </small>
                      </span>
                      {gameMode === 'battle' && (host || m.id === room.self) && (
                        <button
                          type="button"
                          className={`side-swap ${m.team || 'none'}`}
                          title={
                            m.id === room.self
                              ? 'Выбор стороны и скина · клавиша G'
                              : 'Перевести в другую команду'
                          }
                          aria-label={
                            m.id === room.self
                              ? 'Выбрать сторону и скин, клавиша G'
                              : `Перевести игрока ${m.name} в другую команду`
                          }
                          onClick={() => {
                            if (m.id === room.self) {
                              setMonitor(false);
                              setPanel('team');
                            } else
                              void act({
                                type: 'team.set',
                                session: m.id,
                                team: m.team === 'red' ? 'blue' : 'red',
                              });
                          }}
                        >
                          <Repeat size={13} />
                        </button>
                      )}
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
                    {gameMode === 'battle' && (
                      <>
                        <span className="col-num col-k">{m.kills ?? 0}</span>
                        <span className="col-num col-d">{m.deaths ?? 0}</span>
                        <span className="col-num col-a">{m.assists ?? 0}</span>
                        <span className="col-num col-kda">
                          {kdaRatio(m).toFixed(2)}
                        </span>
                      </>
                    )}
                    <span className="col-num col-ping">
                      {now - m.lastSeen < 15000 ? `${m.ping} мс` : '—'}
                    </span>
                  </div>
                  ))}
              </div>
            </div>
            <p className="monitor-footer-note">
              {gameMode === 'battle'
                ? 'Отсортировано по KDA · (убийства + помощь) / смерти'
                : 'Участники встречи · держите «ё», ЛКМ закрепляет табло'}
            </p>
          </div>
        </section>
      )}
      <Dialog
        open={!!draft && quickSticky}
        onOpenChange={(v) => {
          if (!v) {
            setDraft(null);
            setTimeout(() => {
              void document.querySelector('canvas')?.requestPointerLock();
            }, 50);
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
            setTimeout(() => {
              void document.querySelector('canvas')?.requestPointerLock();
            }, 50);
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
            'app-dialog ' +
            (panel === 'menu'
              ? 'settings-dialog'
              : panel === 'team'
                ? 'side-picker-dialog'
                : '')
          }
        >
          <DialogTitle>
            {(
              {
                menu: 'Настройки',
                team: 'Выбор стороны',
                share: 'Пригласить команду',
                join_requests: 'Запросы на вход',
                timer: 'Время для главного',
                vote: 'Голосование',
                group: 'Объединить идеи в тему',
                tools: 'Инвентарь и инструменты',
              } as Record<string, string>
            )[panel] || 'Меню'}
          </DialogTitle>
          <DialogDescription>
            {panel === 'share'
              ? 'Участники войдут по ссылке. Новая комната имеет отдельный адрес.'
              : panel === 'join_requests'
                ? 'Управление пользователями, ожидающими входа в комнату'
                : panel === 'menu'
                  ? 'Личные настройки, встреча и правила комнаты. Esc закрывает.'
                  : panel === 'team'
                    ? 'Сторона, скин и цвет банданы вашего бойца'
                    : gameMode === 'battle'
                      ? 'Снаряжение бойца'
                      : 'Инструменты вашей ретроспективы'}
          </DialogDescription>
          {/* Инвентарь остался отдельным диалогом: у него своя клавиша Q / I,
              и в настройки он не переехал. Его ссылки ведут в разделы: виджеты
              стали разделом настроек, а панели 'help' не существовало вовсе —
              кнопка открывала пустой диалог, хотя список клавиш лежит в
              «Управлении». */}
          {panel === 'tools' && (
            <ToolsPanel
              slots={slots}
              tool={tool}
              onSelectTool={(i) => {
                setTool(i);
                setPanel('');
              }}
              onOpenWidgets={() => openSettings('widgets')}
              onOpenHelp={() => openSettings('controls')}
            />
          )}
          {panel === 'join_requests' && (
            <JoinRequestsPanel
              joinRequests={joinRequests}
              onAccept={async (req) => {
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
              onReject={async (req) => {
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
            />
          )}
          {panel === 'share' && (
            <SharePanel
              roomId={id}
              access={s.access}
              host={host}
              onCopyLink={() => void copyLink()}
              onRegenerateInvite={async () => {
                await act({ type: 'access.regenerate_invite' });
                flash('Ссылка-приглашение обновлена');
              }}
            />
          )}
          {panel === 'menu' && (
            <SettingsShell
              groups={settingsGroups}
              section={settingsSection}
              onSection={setSettingsSection}
              host={host}
            >
              {settingsSection === 'graphics' && (
                <GraphicsSection
                  fps={fps}
                  me={me}
                  fpsLimit={fpsLimit}
                  onFpsLimitChange={(v) => {
                    setFpsLimit(Number(v));
                    localStorage.setItem('jinaly-fps-limit', v);
                  }}
                  quality={quality}
                  onQualityChange={(q) => {
                    setQuality(q);
                    localStorage.setItem('jinaly-quality', q);
                  }}
                />
              )}
              {settingsSection === 'controls' && (
                <ControlsSection
                  sensitivity={sensitivity}
                  onSensitivityChange={(v) => {
                    setSensitivity(v);
                    localStorage.setItem('jinaly-sensitivity', String(v));
                  }}
                  invertCamera={invertCamera}
                  onInvertCameraChange={(v) => {
                    setInvertCamera(v);
                    localStorage.setItem('jinaly-invert-camera', String(v));
                  }}
                  aimModes={aimModes}
                  onAimModesChange={(next) => {
                    setAimModes(next);
                    localStorage.setItem(
                      'jinaly-aim-modes',
                      JSON.stringify(next),
                    );
                  }}
                />
              )}
              {settingsSection === 'profile' && (
                <ProfileSection
                  me={me}
                  sound={sound}
                  onSoundChange={setSound}
                  onUpdateName={(name) => {
                    void act({ type: 'profile', name });
                    localStorage.setItem('jinaly-name', name);
                  }}
                />
              )}
              {settingsSection === 'mode' && (
                <ModePanel
                  s={s}
                  host={host}
                  onSettings={(patch) =>
                    void act({ type: 'room.settings', patch })
                  }
                />
              )}
              {settingsSection === 'world' && (
                <WorldPanel
                  s={s}
                  host={host}
                  onStyleChange={(visualStyle) =>
                    void act({ type: 'room.settings', patch: { visualStyle } })
                  }
                  onThemeChange={(theme, season) =>
                    void act({
                      type: 'room.settings',
                      patch: { theme, season },
                    })
                  }
                  onInteriorChange={(interior) =>
                    void act({ type: 'room.settings', patch: { interior } })
                  }
                />
              )}
              {settingsSection === 'access' && (
                <AccessSection
                  s={s}
                  host={host}
                  onAnonymousPlayersChange={(anonymousPlayers) =>
                    void act({
                      type: 'room.settings',
                      patch: { anonymousPlayers },
                    })
                  }
                  onHidePlayerStatusChange={(hidePlayerStatus) =>
                    void act({
                      type: 'room.settings',
                      patch: { hidePlayerStatus },
                    })
                  }
                  onPrivateWritingChange={(privateWriting) =>
                    void act({
                      type: 'room.settings',
                      patch: { privateWriting },
                    })
                  }
                  onAnonymousChange={(anonymous) =>
                    void act({ type: 'room.settings', patch: { anonymous } })
                  }
                  onLayoutLockedChange={(layoutLocked) =>
                    void act({ type: 'room.settings', patch: { layoutLocked } })
                  }
                  onAccessTypeChange={(accessType) =>
                    void act({ type: 'access.set', accessType })
                  }
                  onMaxPlayersChange={(maxPlayers) => {
                    void act({ type: 'access.max_players', maxPlayers });
                  }}
                />
              )}
              {settingsSection === 'actions' && (
                <ActionsPanel
                  s={s}
                  onAddAction={() => {
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
                  onOpenNote={(n) => {
                    setPanel('');
                    editNote(n);
                  }}
                />
              )}
              {settingsSection === 'widgets' && (
                <WidgetsPanel
                  me={me}
                  onMoodChange={(mood) =>
                    void act({
                      type: 'profile',
                      mood,
                    })
                  }
                  selectedSkin={selectedSkin}
                  onSelectSkin={(skinId) => {
                    setSelectedSkin(skinId);
                    localStorage.setItem('jinaly-custom-skin', skinId);
                    void act({
                      type: 'profile',
                      hat: skinId,
                      color: selectedBandanaColor,
                    });
                  }}
                  selectedBandanaColor={selectedBandanaColor}
                  onBandanaColorChange={(color) => {
                    setSelectedBandanaColor(color);
                    localStorage.setItem('jinaly-bandana-color', color);
                    void act({
                      type: 'profile',
                      hat: selectedSkin,
                      color,
                    });
                  }}
                  onConfetti={() =>
                    void act({ type: 'event', kind: 'confetti', value: '🎉' })
                  }
                  onHat={() =>
                    void act({ type: 'event', kind: 'hat', value: '🎩' })
                  }
                  onBuzzer={() => {
                    setSound(true);
                    void act({ type: 'event', kind: 'buzzer' });
                  }}
                  onPing={() => void act({ type: 'event', kind: 'ping' })}
                  s={s}
                  onDecrementCounter={() =>
                    void act({ type: 'counter', down: true })
                  }
                  onIncrementCounter={() => void act({ type: 'counter' })}
                  spinOptions={spinOptions}
                  onSpinOptionsChange={setSpinOptions}
                  online={online}
                  onSpin={(value) =>
                    void act({
                      type: 'event',
                      kind: 'spin',
                      value,
                    })
                  }
                  spinner={spinner}
                  sound={sound}
                  onSoundChange={setSound}
                />
              )}
              {settingsSection === 'export' && (
                <ExportPanel
                  host={host}
                  onExport={exportRoom}
                  onImport={(file) => void importFile(file)}
                />
              )}
              {settingsSection === 'history' && (
                <HistoryPanel
                  history={history}
                  onUndo={() =>
                    void act({ type: 'undo' }).then((r) => {
                      if (r) {
                        flash('Последнее действие отменено');
                        setPanel('');
                      }
                    })
                  }
                />
              )}
              {settingsSection === 'finish' && (
                <ArchiveSection
                  archived={!!s.archived}
                  host={host}
                  onToggleArchive={() =>
                    void act({ type: 'archive', value: !s.archived }).then(
                      (r) => r && setPanel(''),
                    )
                  }
                />
              )}
            </SettingsShell>
          )}
          {panel === 'team' && (
            <SidePicker
              self={me}
              members={room.members}
              anime={s.visualStyle === 'anime'}
              anonymous={!!s.anonymousPlayers}
              onClose={() => setPanel('')}
              onTeam={(team) =>
                void act({ type: 'team.set', session: room.self, team })
              }
              selectedSkin={selectedSkin}
              onSelectSkin={(skinId) => {
                setSelectedSkin(skinId);
                localStorage.setItem('jinaly-custom-skin', skinId);
                void act({
                  type: 'profile',
                  hat: skinId,
                  color: selectedBandanaColor,
                });
              }}
              selectedBandanaColor={selectedBandanaColor}
              onBandanaColorChange={(color) => {
                setSelectedBandanaColor(color);
                localStorage.setItem('jinaly-bandana-color', color);
                void act({ type: 'profile', hat: selectedSkin, color });
              }}
            />
          )}
          {panel === 'timer' && (
            <TimerPanel
              timeText={timeText}
              seconds={seconds}
              onSecondsChange={setSeconds}
              host={host}
              timer={s.timer}
              onTimer={(action, timerSeconds) =>
                void act({
                  type: 'timer',
                  action,
                  seconds: timerSeconds,
                })
              }
            />
          )}
          {panel === 'vote' && (
            <VotePanel
              round={round}
              used={used}
              host={host}
              voteLimit={voteLimit}
              onVoteLimitChange={setVoteLimit}
              onStartVote={() =>
                void act({ type: 'vote.start', limit: Number(voteLimit) })
              }
              onEndVote={() => void act({ type: 'vote.end' })}
              s={s}
              onOpenNote={(n) => {
                setPanel('');
                editNote(n);
              }}
            />
          )}
          {panel === 'group' && (
            <GroupPanel
              groupTitle={groupTitle}
              onGroupTitleChange={setGroupTitle}
              onAddGroup={() =>
                void act({ type: 'group.add', title: groupTitle }).then(
                  (r) => {
                    if (r) {
                      setGroupTitle('');
                      flash(
                        'Тема создана. Выберите её в настройках карточек.',
                      );
                    }
                  },
                )
              }
              s={s}
              host={host}
              onDeleteGroup={(id) =>
                void act({ type: 'group.delete', id })
              }
            />
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
