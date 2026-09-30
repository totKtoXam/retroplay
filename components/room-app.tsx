'use client';
/* oxlint-disable next/no-html-link-for-pages -- Полная навигация обходит ошибку RSC prefetch в production-сборке vinext. */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
  Fragment,
  useSyncExternalStore,
} from 'react';
import {
  ArrowLeft,
  Plus,
  Users,
  Link2,
  Repeat,
  Mic,
  MicOff,
  Check,
  StickyNote,
  Timer,
  Vote,
  Flag,
  Box,
  ChevronRight,
  Copy,
  Trash2,
  Eye,
  Bell,
  X,
  Wifi,
  Monitor,
  Send,
  Lock,
  Gauge,
  MousePointer2,
  Swords,
  Bot,
  Sun,
  ShieldCheck,
  UserRound,
  ListChecks,
  Dices,
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
  FORM_NOTE_KINDS,
  isActionKind,
  isOnline,
  isPresent,
  kdaRatio,
  monitorGroups,
  noteKindLabel,
  templateZones,
  zoneShort,
  zoneTitle,
  type Note,
  type Pose,
} from '@/lib/model';
import { api, download, parseCSV } from '@/lib/client';
import {
  exportCsvRows,
  exportMarkdown,
  toCsv,
  zoneFromLabel,
} from '@/lib/room-export';
import { phaseGuide, type PhaseAction } from '@/lib/room-phase';
import { setMusicVoiceActive } from '@/lib/soundtrack';
import { Choice, Toggle } from './controls';
import { Card } from './board';
import { useResourcePack } from '../hooks/use-resource-pack';
import { readAimModes, type WeaponAimModes } from '@/lib/aim-settings';
import { PREF_KEYS, readChoice, readPref, writePref } from '@/lib/user-prefs';
import { SETTINGS_APPLIED_EVENT } from '@/lib/settings-sync';
import { PAINTS } from '@/lib/game-items';
import {
  AccessSection,
  ControlsSection,
  GraphicsSection,
  GroupPanel,
  JoinRequestsPanel,
  ProfileSection,
  SharePanel,
  TimerPanel,
  ToolsPanel,
  VotePanel,
  MatchBar,
  ModePanel,
  BotsPanel,
  WidgetsPanel,
  WorldPanel,
  FPS_LIMITS,
  type HistoryEntry,
} from './room-panels';
import { useConfirm } from './room-confirm';
import { ConnectionIndicator } from './room-status';
import { UndoToast } from './room-toast';
import { ResultsPanel } from './room-results';
import { RoomMenu } from './room-menu';
import { SettingsShell, type SettingsGroup } from './settings-shell';
import { WorldQuickChip } from './world-quick-chip';
import { MusicPlayer } from './music-player';
import { GameClock } from './game-clock';
import { SidePicker } from './side-picker';
import { PhaseBar } from './phase-bar';
import RoomBoardFallback from './room-board-fallback';
import { useRoomSync } from './use-room-sync';
import GameChat from './game-chat';
import { useVoiceChat } from './use-voice-chat';
import { MAP_CATALOG, MODES, modeOf } from '@/lib/maps/catalog';
import { defaultSlot, hasSlot, slotsFor } from '@/lib/loadout';
import { BOT_LEVELS } from '@/lib/bot-levels';

const World = lazy(() => import('./world'));
// Как и мир, интерфейс «Предателя» тянет геометрию карт — грузится отдельно и только в этом режиме.
const ImpostorOverlay = lazy(() => import('./impostor-overlay'));
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
/** Адрес страницы внутри комнаты не меняется — подписываться не на что. */
const noSubscribe = () => () => {};

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
    [webglBroken, setWebglFailed] = useState(false),
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
    // Экран режима «Предатель» (мини-игра, собрание) держит курсор — мир не слушает ввод.
    [impostorBlocked, setImpostorBlocked] = useState(false),
    [chatOpen, setChatOpen] = useState(false),
    // Растёт, когда чат закрыт клавишей: мир снова захватывает мышь.
    [resumeWorld, setResumeWorld] = useState(0),
    [now, setNow] = useState(() => Date.now()),
    [seconds, setSeconds] = useState('300'),
    [voteLimit, setVoteLimit] = useState('5'),
    [groupTitle, setGroupTitle] = useState(''),
    [sound, setSound] = useState(false),
    [spinner, setSpinner] = useState(''),
    [spinOptions, setSpinOptions] = useState(''),
    [celebrate, setCelebrate] = useState(''),
    // Меню «⋯» в шапке: пока оно открыто, мир не ловит ввод.
    [menuOpen, setMenuOpen] = useState(false),
    // Тост «Удалено · Отменить»: версия комнаты сразу после удаления — номер
    // записи истории, по которой `restore` вернёт удалённое.
    [undoToast, setUndoToast] = useState<{ text: string; version: number } | null>(null),
    [undoBusy, setUndoBusy] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    // Главная кнопка этапа ждёт ответа сервера.
    [guideBusy, setGuideBusy] = useState(false),
    [selectedSkin, setSelectedSkin] = useState<string>(() =>
      typeof localStorage !== 'undefined' ? localStorage.getItem('jinaly-custom-skin') || 'agent' : 'agent',
    ),
    [selectedBandanaColor, setSelectedBandanaColor] = useState<string>(() =>
      typeof localStorage !== 'undefined' ? localStorage.getItem('jinaly-bandana-color') || '#3b82f6' : '#3b82f6',
    );
  const cursor = useRef({ x: 0, y: 0, mode: '3d' });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyVersion, setHistoryVersion] = useState(-1);
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
  // ?no3d=1 открывает комнату сразу обычной доской: слабый ноутбук, проверка
  // 2D-режима без настоящего сбоя WebGL. На сервере адреса нет — там 3D.
  const no3d = useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).has('no3d'),
    () => false,
  );
  const webglFailed = webglBroken || no3d;
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
  /** Личные настройки с этого устройства: при входе в комнату и после синхронизации с аккаунтом. */
  const loadDeviceSettings = useCallback(() => {
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
    setSound(readPref(PREF_KEYS.sound) === 'true');
    setPaintColor(
      readChoice(
        PREF_KEYS.paintColor,
        PAINTS.map((p) => p.color),
        '#bc91f5',
      ),
    );
  }, []);
  const {
    connection,
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
    impostor,
    sendVoice,
    setVoiceSink,
    serverNow,
    chat,
    chatError,
    setChatError,
    sendChat,
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
      loadDeviceSettings();
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
  // История не лежит в состоянии комнаты: её отдаёт отдельный запрос. Она нужна
  // в «Итогах» — и списком, и чтобы понять, есть ли что отменять, — поэтому
  // освежается, пока панель открыта и комната меняется (с паузой, чтобы
  // голосование всей командой не превращалось в поток запросов).
  const roomVersion = room?.version ?? -1;
  useEffect(() => {
    if (panel !== 'results') return;
    const timer = setTimeout(
      () =>
        void api<{ history: HistoryEntry[] }>('/api/rooms/' + id, {
          type: 'history',
        })
          .then((r) => {
            setHistory(r.history);
            setHistoryVersion(roomRef.current?.version ?? -1);
          })
          .catch((e: Error) => setError(e.message)),
      historyVersion < 0 ? 0 : 800,
    );
    return () => clearTimeout(timer);
    // historyVersion только выбирает задержку первого запроса.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, roomVersion, id]);
  // Первый вход ведущего в только что созданную комнату: сразу открываем
  // «Пригласить». Один раз на комнату — отметка живёт в localStorage.
  const inviteShownKey = 'jinaly-invite-shown:' + id;
  const freshHostRoom =
    !!room && room.host === room.self && now - room.created < 15 * 60_000;
  useEffect(() => {
    if (!freshHostRoom) return;
    let shown = true;
    try {
      shown = localStorage.getItem(inviteShownKey) === '1';
      if (!shown) localStorage.setItem(inviteShownKey, '1');
    } catch {}
    // Открывается один раз по внешнему факту (новая комната), а не от ввода.
    // oxlint-disable-next-line react/react-compiler
    if (!shown) setPanel((p) => p || 'share');
  }, [freshHostRoom, inviteShownKey]);
  const skinRef = useRef({ skin: selectedSkin, color: selectedBandanaColor });
  useEffect(() => {
    skinRef.current = { skin: selectedSkin, color: selectedBandanaColor };
  }, [selectedSkin, selectedBandanaColor]);
  // Настройки с аккаунта могли прийти уже в комнате (lib/settings-sync.ts).
  useEffect(() => {
    const onApplied = () => {
      loadDeviceSettings();
      const skin = localStorage.getItem('jinaly-custom-skin') || 'agent';
      const color = localStorage.getItem('jinaly-bandana-color') || '#3b82f6';
      if (skin === skinRef.current.skin && color === skinRef.current.color)
        return;
      setSelectedSkin(skin);
      setSelectedBandanaColor(color);
      if (roomRef.current) void act({ type: 'profile', hat: skin, color });
    };
    window.addEventListener(SETTINGS_APPLIED_EVENT, onApplied);
    return () => window.removeEventListener(SETTINGS_APPLIED_EVENT, onApplied);
  }, [act, loadDeviceSettings]);
  const changeSound = useCallback((value: boolean) => {
    setSound(value);
    writePref(PREF_KEYS.sound, String(value));
  }, []);
  const changePaintColor = useCallback((color: string) => {
    setPaintColor(color);
    writePref(PREF_KEYS.paintColor, color);
  }, []);
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
  const { voice, talk } = useVoiceChat({ room, sendVoice, setVoiceSink });
  // Плеер переехал в меню «⋯» и живёт, только пока меню открыто, а приглушать
  // музыку под голоса рации нужно всегда.
  const voiceActive =
    !!voice.talking || voice.speakers.some((v) => v.audible);
  useEffect(() => {
    setMusicVoiceActive(voiceActive);
  }, [voiceActive]);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const openChat = useCallback((open: boolean, resume = false) => {
    setChatOpen(open);
    if (!open && resume) setResumeWorld((n) => n + 1);
  }, []);
  const clearChatError = useCallback(() => setChatError(''), [setChatError]);
  const voiceMuted = new Set(room?.state.voiceMuted ?? []);
  const me = room?.members.find((m) => m.id === room.self),
    host = room?.host === room?.self,
    s = room?.state,
    online = room?.members.filter((m) => isOnline(m.lastSeen, now)) || [],
    gameMode = modeOf(s ?? {}),
    mapTitle =
      MAP_CATALOG.find((m) => m.id === (s?.map ?? 'hub'))?.title ?? 'Хаб',
    slots = slotsFor(gameMode),
    // Предмет другого режима в руках не остаётся: берём предмет по умолчанию.
    tool = hasSlot(gameMode, heldTool) ? heldTool : defaultSlot(gameMode);
  // Каналы чата. В «Предателе» свой канал есть только у живых предателей, а живые пишут
  // всем лишь на собраниях (правила — lib/room-chat.ts, здесь только подсказка).
  const impostorView = gameMode === 'impostor' ? room?.impostor : undefined;
  const inParty = !!impostorView && ['intro', 'play', 'meeting', 'voting', 'eject'].includes(impostorView.phase);
  const partyGhost = inParty && !(impostorView?.role && impostorView.alive);
  const chatTeam = inParty
    ? !partyGhost && impostorView?.role === 'impostor'
      ? 'Предателям'
      : null
    : gameMode === 'battle' && me?.team
      ? 'Команде'
      : null;
  const chatAllBlocked =
    inParty && !partyGhost && !['meeting', 'voting', 'eject'].includes(impostorView?.phase ?? '')
      ? 'Живые говорят только на собраниях'
      : '';
  // Сколько пунктов плана ещё не сделано — подпись раздела «План действий»
  // отвечает на вопрос «надо ли туда заходить» до того, как его открыли.
  const actionsLeft =
    s?.notes.filter((n) => isActionKind(n.kind) && !n.done).length ?? 0;
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
          id: 'results',
          title: 'Итоги встречи',
          hint: actionsLeft
            ? `План действий: ${actionsLeft} не сделано`
            : 'План действий, экспорт, история и завершение',
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
          id: 'bots',
          title: 'Боты',
          hint:
            gameMode === 'impostor'
              ? s?.bots?.length
                ? `На корабле: ${s.bots.length}`
                : 'Экипаж и предатели четырёх уровней'
              : gameMode !== 'battle'
                ? 'Играют в бою и в «Предателе»'
                : s?.bots?.length
                  ? `В бою: ${s.bots.length}`
                  : 'Соперники и напарники четырёх уровней',
          icon: Bot,
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
    // План действий, экспорт, история с отменой и завершение встречи
    // переехали в отдельную панель «Итоги» (components/room-results.tsx): её
    // открывают из шапки и кнопкой этапа. В настройках от них осталась ссылка
    // «Итоги встречи» в группе «Встреча».
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
    // 2D-доска без WebGL: всегда полный редактор, где выбираются тип и зона.
    fullEditor = false,
  ) => {
    if (!stickyOnly && GAME_TOOLS[tool]?.id === 'group') {
      setPanel('group');
      return;
    }
    const count = s?.notes.filter((n) => n.zone === zone).length || 0;
    let kind = stickyOnly ? 'sticky' : kinds[GAME_TOOLS[tool]?.id] || 'sticky';
    if (['draw', 'connector'].includes(kind)) kind = 'sticky';
    setQuickSticky(!fullEditor && kind === 'sticky');
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
        if (!webglFailed) void document.querySelector('canvas')?.requestPointerLock();
      }, 50);
      flash('Карточка сохранена');
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const copyLink = async (): Promise<boolean> => {
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
      return true;
    } catch {
      // Браузер не дал доступ к буферу: в панели ссылка видна целиком и
      // выделяется по фокусу, её можно скопировать руками.
      setPanel('share');
      flash('Не удалось скопировать — выделите ссылку в поле и скопируйте');
      return false;
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
    // Таблица и текст итогов собираются в lib/room-export.ts: там же голоса,
    // темы и план действий с ответственными, а тип карточки — по-русски.
    if (format === 'csv')
      download(
        filename + '.csv',
        toCsv(exportCsvRows(room.state)),
        'text/csv;charset=utf-8',
      );
    if (format === 'md')
      download(filename + '.md', exportMarkdown(room.state), 'text/markdown');
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
          zone: zoneFromLabel(r[1], s?.template),
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
  // Люди в комнате без ботов: для подсказки этапа «N из M в сети».
  const people = room.members.filter(
    (m) => !m.bot && (m.id === room.self || isPresent(m.lastSeen, now)),
  );
  const guide =
    gameMode === 'retro'
      ? phaseGuide({
          phase: s.phase,
          host,
          archived: !!s.archived,
          online: people.filter(
            (m) => m.id === room.self || isOnline(m.lastSeen, now),
          ).length,
          total: people.length,
          privateWriting: s.privateWriting,
          voting: !!round?.active,
          votesLeft: round ? Math.max(0, round.limit - used) : 0,
          voteLimit: round?.limit ?? 0,
          nextVoteLimit: Number(voteLimit) || 5,
          groups: s.groups.length,
          actions: s.notes.filter((n) => isActionKind(n.kind)).length,
          sealed: s.notes.filter((n) => n.hidden && n.sealed).length,
        })
      : undefined;
  /** Главная кнопка этапа: те же операции, что и в панелях голосования и этапов. */
  const runGuide = async (action: PhaseAction) => {
    if (action.id === 'open.vote') return setPanel('vote');
    if (action.id === 'open.group') return setPanel('group');
    if (action.id === 'open.results') return setPanel('results');
    setGuideBusy(true);
    try {
      if (action.id === 'phase' && action.phase !== undefined)
        await act({ type: 'phase', phase: action.phase });
      // Тем же действием, что и кнопка «Начать голосование» в панели голосования.
      if (action.id === 'vote.start')
        await act({ type: 'vote.start', limit: Number(voteLimit) || 5 });
      if (action.id === 'vote.end') await act({ type: 'vote.end' });
      if (action.id === 'reveal.all') {
        const r = await act({ type: 'reveal', all: true });
        if (r) flash('Идеи открыты всем');
      }
    } finally {
      setGuideBusy(false);
    }
  };
  const votesLabel = round?.active
    ? `Голоса: осталось ${Math.max(0, round.limit - used)} из ${round.limit}`
    : 'Голосование';
  const setPrivateWriting = async (next: boolean) => {
    if (!host) {
      flash('Режим приватного написания меняет ведущий');
      return;
    }
    if (next === s.privateWriting) return;
    const ok = await confirm({
      title: next
        ? 'Включить приватное написание?'
        : 'Выключить приватное написание?',
      description: next
        ? 'Новые заметки увидит только автор, пока сам их не раскроет. Уже написанные останутся видны всем.'
        : 'Новые заметки сразу увидят все участники. Уже скрытые заметки авторы раскрывают сами.',
      confirmLabel: next ? 'Включить' : 'Выключить',
    });
    if (ok) void act({ type: 'room.settings', patch: { privateWriting: next } });
  };
  const changeAccessType = async (accessType: 'public' | 'private') => {
    if ((s.access?.type ?? 'public') === accessType) return;
    const ok = await confirm(
      accessType === 'private'
        ? {
            title: 'Сделать комнату приватной?',
            description:
              'Комната пропадёт из общего списка. Новые участники войдут только по ссылке-приглашению и после вашего подтверждения. Кто уже в комнате — останется.',
            confirmLabel: 'Сделать приватной',
          }
        : {
            title: 'Сделать комнату публичной?',
            description:
              'Комната появится в общем списке, и войти сможет любой — без приглашения и подтверждения.',
            confirmLabel: 'Сделать публичной',
          },
    );
    if (ok) void act({ type: 'access.set', accessType });
  };
  const changeRoomSettings = async (patch: Record<string, unknown>) => {
    if ('mode' in patch && patch.mode !== gameMode) {
      const title = MODES.find((m) => m.id === patch.mode)?.title ?? '';
      const ok = await confirm({
        title: `Переключить комнату в режим «${title}»?`,
        description:
          'Режим и карта сменятся сразу у всех участников. Карточки, голоса и план действий сохранятся — к ним можно вернуться, переключив режим обратно.',
        confirmLabel: 'Переключить режим',
      });
      if (!ok) return;
    }
    void act({ type: 'room.settings', patch });
  };
  const toggleArchive = async () => {
    if (!s.archived) {
      const ok = await confirm({
        title: 'Завершить встречу?',
        description:
          'Комната станет только для чтения у всех, включая вас: карточки, голоса и план действий сохранятся. Открыть встречу снова может только ведущий.',
        confirmLabel: 'Завершить встречу',
        danger: true,
      });
      if (!ok) return;
    }
    const r = await act({ type: 'archive', value: !s.archived });
    if (r) flash(s.archived ? 'Встреча снова открыта' : 'Встреча завершена');
  };
  const deleteNote = async (n: Note) => {
    const r = await act({ type: 'note.delete', id: n.id });
    if (!r) return;
    setDraft(null);
    setUndoToast({ text: 'Карточка удалена', version: r.version });
  };
  const deleteGroup = async (groupId: string) => {
    const r = await act({ type: 'group.delete', id: groupId });
    if (r) setUndoToast({ text: 'Тема удалена', version: r.version });
  };
  /** Вернуть удалённое по записи истории (`restore`, db/room-ops.ts): работает,
   *  даже если после удаления комнату успели изменить другие. */
  const undoDelete = async () => {
    if (!undoToast) return;
    setUndoBusy(true);
    const r = await act({ type: 'restore', version: undoToast.version });
    setUndoBusy(false);
    setUndoToast(null);
    if (r) flash('Удаление отменено');
  };
  const undoLast = async () => {
    setUndoBusy(true);
    const r = await act({ type: 'undo' });
    setUndoBusy(false);
    if (r) flash('Последнее действие отменено');
  };
  // «Отменить последнее действие» активна, только когда отменять есть что и
  // это действие ваше: сервер всё равно проверит, но кнопка не обещает лишнего.
  const lastChange = history[0];
  const undoInfo = !lastChange
    ? { enabled: false, reason: 'Отменять пока нечего' }
    : lastChange.version !== room.version
      ? { enabled: false, reason: 'Обновляем историю…' }
      : lastChange.author && lastChange.author !== room.self
        ? {
            enabled: false,
            reason:
              'Последнее изменение сделал другой участник. Отменить можно только своё последнее действие.',
          }
        : { enabled: true, reason: '' };
  const newAction = () => {
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
  };
  // Все зоны формата и зона самой карточки, если она из другого формата.
  const formZones = templateZones(s.template);
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
      <header
        className={`game-bar${gameMode === 'battle' ? ' is-battle' : ''}`}
      >
        <a
          href="/"
          className="game-bar-back"
          aria-label="К комнатам"
          title="К комнатам"
        >
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
        {/* В ретро карта всегда одна — хаб, её имя в шапке ничего не говорит. */}
        {gameMode !== 'retro' && (
          <span className="game-tag map-tag">{mapTitle}</span>
        )}
        <div
          className={`game-bar-center${gameMode === 'battle' ? ' with-match' : ''}`}
        >
          {gameMode === 'battle' ? (
            // Часы — ярлык, выезжающий из-под счёта (app/game-clock.css): время
            // суток это фон боя, а не его счёт, и ни строки в шапке, ни высоты
            // сцены занимать не должно.
            <div className="match-stack">
              <MatchBar match={room.match} rounds={s.roundWins ?? 5} now={now} />
              <GameClock state={s} now={now} />
            </div>
          ) : (
            <>
              {/* Этапы уехали из шапки в PhaseBar над сценой, приватное
                  написание, музыка, погода и полный экран — в меню «⋯». Здесь
                  остаётся то, на что смотрят всю встречу: время и голоса. */}
              <button
                type="button"
                className={`game-tag clock ${s.timer.running ? 'running' : ''}`}
                onClick={() => setPanel('timer')}
                aria-label={`Таймер: ${timeText}${s.timer.running ? ', идёт' : ''}`}
                title="Таймер встречи"
              >
                <Timer size={14} aria-hidden="true" />
                {timeText}
              </button>
              <button
                type="button"
                className={`game-tag votes-tag ${round?.active ? 'on' : ''}`}
                onClick={() => setPanel('vote')}
                aria-label={votesLabel}
                title={votesLabel}
              >
                <Vote size={14} aria-hidden="true" />
                <span className="room-bar-label">Голоса</span>
                {round?.active && (
                  <b>
                    {Math.max(0, round.limit - used)}/{round.limit}
                  </b>
                )}
              </button>
              {/* В ретро MatchBar не рендерится, поэтому часы встают в тот же
                  ряд — сразу за таймером встречи, чтобы «сколько осталось» в
                  реальном и в игровом времени читалось рядом. На корабле
                  «Предателя» суток нет — ни солнца, ни заката. */}
              {gameMode !== 'impostor' && <GameClock state={s} now={now} />}
            </>
          )}
        </div>
        {/* Участники и заявки на вход — одна группа: бейдж заявок прилеплен
            к кнопке участников и виден даже на телефоне. */}
        <div className="people-group">
          <button
            type="button"
            className="game-tag people"
            onClick={() => setMonitor(true)}
            aria-label={`Участники: ${online.length} в сети`}
            title="Участники · клавиша Ё"
          >
            {online.slice(0, 3).map((m) => (
              <span
                key={m.id}
                className="avatar"
                style={{ background: m.color, color: '#fff' }}
                title={m.name}
              >
                {Array.from(m.name)[0]}
              </span>
            ))}
            <b>{online.length}</b>
          </button>
          {host && joinRequests.length > 0 && (
            <button
              type="button"
              className="game-tag alert join-badge"
              onClick={() => setPanel('join_requests')}
              aria-label={`Заявки на вход: ${joinRequests.length}`}
              title="Заявки на вход"
            >
              <Bell size={13} className="bell-pulse" aria-hidden="true" />
              {joinRequests.length}
            </button>
          )}
        </div>
        {gameMode === 'retro' && (
          <button
            type="button"
            className="game-tag room-bar-wide"
            onClick={() => setPanel('results')}
            aria-label="Итоги встречи"
            title="Итоги встречи: голоса, план действий, экспорт"
          >
            <ListChecks size={14} aria-hidden="true" />
            <span className="room-bar-label">Итоги</span>
          </button>
        )}
        <button
          type="button"
          className="game-tag room-bar-wide"
          onClick={() => setPanel('share')}
          aria-label="Пригласить участников"
          title="Пригласить: ссылка на комнату"
        >
          <Link2 size={14} aria-hidden="true" />
          <span className="room-bar-label">Пригласить</span>
        </button>
        <ConnectionIndicator status={connection} />
        <RoomMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          status={connection}
          compact={[
            ...(gameMode !== 'battle'
              ? [
                  {
                    id: 'timer',
                    label: `Таймер · ${timeText}`,
                    hint: s.timer.running ? 'Идёт' : 'Остановлен',
                    icon: Timer,
                    onSelect: () => setPanel('timer'),
                  },
                  {
                    id: 'vote',
                    label: votesLabel,
                    icon: Vote,
                    onSelect: () => setPanel('vote'),
                  },
                ]
              : []),
            ...(gameMode === 'retro'
              ? [
                  {
                    id: 'results',
                    label: 'Итоги встречи',
                    hint: 'Голоса, план действий, экспорт',
                    icon: ListChecks,
                    onSelect: () => setPanel('results'),
                  },
                ]
              : []),
            {
              id: 'share',
              label: 'Пригласить',
              hint: 'Ссылка на комнату',
              icon: Link2,
              onSelect: () => setPanel('share'),
            },
          ]}
          music={<MusicPlayer voiceActive={voiceActive} />}
          world={
            gameMode !== 'impostor' ? (
            <WorldQuickChip
              time={s.time}
              season={s.season}
              weather={s.weather}
              weatherTuning={s.weatherTuning}
              weatherPeriod={s.weatherPeriod}
              windEffects={s.windEffects}
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
              onWeatherChange={(weather) =>
                void act({ type: 'room.settings', patch: { weather } })
              }
              onWeatherPeriodChange={(weatherPeriod) =>
                void act({ type: 'room.settings', patch: { weatherPeriod } })
              }
              onWeatherTuningChange={(weatherTuning) =>
                void act({ type: 'room.settings', patch: { weatherTuning } })
              }
              onWindEffectsChange={(windEffects) =>
                void act({ type: 'room.settings', patch: { windEffects } })
              }
              onLocked={() => flash('Облик мира меняет ведущий встречи')}
            />
            ) : undefined
          }
          privacy={
            gameMode !== 'battle'
              ? {
                  value: s.privateWriting,
                  host,
                  onToggle: () => void setPrivateWriting(!s.privateWriting),
                }
              : undefined
          }
          fullscreen={fullscreen}
          onToggleFullscreen={() => void enterFullscreen()}
          onSettings={() => setPanel('menu')}
        />
      </header>
      <section className="main-surface" aria-label="Игровой мир">
          {/* Этапы есть только у ретро: в командном бою их роль играет MatchBar
              в шапке. Плашка лежит в левой колонке HUD под .camera-toolbar —
              свободное место, где она не спорит ни с зонами справа, ни с
              панелью предметов внизу (подробности — в app/phases.css). */}
          {gameMode === 'retro' && !webglFailed && (
            <PhaseBar
              phase={s.phase}
              host={host}
              archived={s.archived}
              onPhase={(phase) => void act({ type: 'phase', phase })}
              guide={guide}
              guideBusy={guideBusy}
              onGuideAction={(action) => void runGuide(action)}
            />
          )}
          {webglFailed ? (
            // Без WebGL встреча идёт на обычной доске: карточки, голосование,
            // темы, этапы и итоги работают так же, как через планшет в 3D.
            <RoomBoardFallback
              room={room}
              host={host}
              gameMode={gameMode}
              onOp={act}
              onEditNote={editNote}
              onAddNote={(zone, x, y) => newNote(zone, x, y, true, true)}
              onCursor={(x, y) => {
                lastActivityRef.current = Date.now();
                cursor.current = { x, y, mode: 'board' };
              }}
              onOpenPanel={setPanel}
              phaseBar={
                gameMode === 'retro' ? (
                  <PhaseBar
                    phase={s.phase}
                    host={host}
                    archived={s.archived}
                    onPhase={(phase) => void act({ type: 'phase', phase })}
                    guide={guide}
                    guideBusy={guideBusy}
                    onGuideAction={(action) => void runGuide(action)}
                  />
                ) : undefined
              }
            />
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
                onPaintColor={changePaintColor}
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
                voice={voice}
                onTalk={talk}
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
                resume={resumeWorld}
                blocked={
                  !!panel ||
                  menuOpen ||
                  !!draft ||
                  !!selectedZone ||
                  impostorBlocked ||
                  chatOpen
                }
              />
            </Suspense>
          )}
          {gameMode === 'impostor' && !webglFailed && (
            <Suspense fallback={null}>
              <ImpostorOverlay
                room={room}
                host={host}
                serverNow={serverNow}
                pose={pose}
                send={impostor}
                onBlocked={setImpostorBlocked}
              />
            </Suspense>
          )}
          {(
            <GameChat
              hotkey={!webglFailed}
              messages={chat}
              self={room.self}
              open={chatOpen}
              onOpen={openChat}
              send={sendChat}
              error={chatError}
              clearError={clearChatError}
              teamLabel={chatTeam}
              allBlocked={chatAllBlocked}
              disabled={!!panel || !!draft || !!selectedZone}
            />
          )}
          {gameMode === 'retro' && !webglFailed && (
            <div className="game-zone-buttons">
              {formZones.map((z) => (
                <button
                  type="button"
                  title={zoneTitle(z.id, s.template)}
                  aria-label={zoneTitle(z.id, s.template)}
                  key={z.id}
                  onClick={() => setSelectedZone(z.id)}
                >
                  <span style={{ background: z.color }} />
                  {zoneShort(z.id, s.template)}
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
      {undoToast && (
        <UndoToast
          key={undoToast.version}
          text={undoToast.text}
          busy={undoBusy}
          onUndo={() => void undoDelete()}
          onClose={() => setUndoToast(null)}
        />
      )}
      {/* Подтверждение поверх открытой панели кладётся внутрь неё (ниже), иначе
          щелчок по нему закрывал бы панель как щелчок мимо. */}
      {!panel && confirmDialog}
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
          <SheetTitle>{zoneTitle(selectedZone, s.template)}</SheetTitle>
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
            <div
              className={`monitor-table-wrap ${gameMode === 'battle' ? 'is-battle' : ''}`}
            >
              <div className="monitor-table-header">
                <span className="col-user">УЧАСТНИК</span>
                <span className="col-status">СТАТУС</span>
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
                {/* Покинувших игру в таблице нет: раньше показывались все, кто
                    когда-либо заходил, и список копил ушедших. Себя оставляем
                    всегда — из скрытой вкладки пакеты не уходят, и смотрящий
                    вычеркнул бы сам себя. */}
                {monitorGroups(
                  room.members
                    .filter((m) => m.id === room.self || isPresent(m.lastSeen, now))
                    .sort((a, b) => kdaRatio(b) - kdaRatio(a)),
                  gameMode === 'battle',
                ).map((group) => (
                  <Fragment key={group.team ?? 'all'}>
                  {group.team && (
                    <div
                      className={`monitor-team-header team-${group.team}`}
                      aria-label={`${group.label}: ${group.members.length} игроков`}
                    >
                      <span className="col-user">
                        <strong>{group.label}</strong>
                        {(group.team === 'red' || group.team === 'blue') &&
                          room.match && (
                            <b className="monitor-team-score">
                              {room.match.score[group.team]}
                            </b>
                          )}
                        <small>{group.members.length}</small>
                      </span>
                      <span className="col-status" />
                      <span className="col-num col-k">{group.kills}</span>
                      <span className="col-num col-d">{group.deaths}</span>
                      <span className="col-num col-a">{group.assists}</span>
                      <span className="col-num col-kda" />
                      <span className="col-num col-ping" />
                    </div>
                  )}
                  {group.members.map((m) => (
                  <div key={m.id} className="monitor-table-row">
                    <div className="col-user">
                      <span
                        className="avatar mini-avatar"
                        style={{ background: m.color, color: 'white' }}
                      >
                        {Array.from(m.name)[0]}
                      </span>
                      <span className="user-name-box">
                        <strong className="name-text">
                          {m.name}
                          {m.id === room.self ? ' (вы)' : ''}
                        </strong>
                        <small className="role-text">
                          {m.bot
                            ? `Бот · ${BOT_LEVELS[m.bot]?.label ?? ''}`
                            : m.id === room.host
                              ? 'Ведущий'
                              : 'Участник'}
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
                      {/* Микрофон рядом с именем, а не в отдельном разделе
                          настроек: заглушают конкретного человека и обычно
                          прямо сейчас, глядя на список говорящих. */}
                      {host && m.id !== room.host && !m.bot && (
                        <button
                          type="button"
                          className={`voice-mute ${voiceMuted.has(m.id) ? 'is-muted' : ''}`}
                          title={
                            voiceMuted.has(m.id)
                              ? 'Вернуть голос'
                              : 'Заглушить: его перестанут слышать все'
                          }
                          aria-label={
                            voiceMuted.has(m.id)
                              ? `Вернуть голос игроку ${m.name}`
                              : `Заглушить игрока ${m.name}`
                          }
                          onClick={() =>
                            void act({
                              type: 'voice.mute',
                              session: m.id,
                              muted: !voiceMuted.has(m.id),
                            })
                          }
                        >
                          {voiceMuted.has(m.id) ? <MicOff size={13} /> : <Mic size={13} />}
                        </button>
                      )}
                    </div>
                    {/* Состояний два вместо прежнего «в сети / не в сети»:
                        ушедшие до таблицы просто не доходят, а всё, что между, —
                        это «отошёл», то есть свернул вкладку или
                        переподключается. */}
                    <span
                      className={`col-status ${
                        isOnline(m.lastSeen, now) ? 'is-online' : 'is-away'
                      }`}
                    >
                      {isOnline(m.lastSeen, now) ? 'в сети' : 'отошёл'}
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
                      {isOnline(m.lastSeen, now) ? `${m.ping} мс` : '—'}
                    </span>
                  </div>
                  ))}
                  </Fragment>
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
              if (!webglFailed) void document.querySelector('canvas')?.requestPointerLock();
            }, 50);
          }
        }}
      >
        <DialogContent
          className="quick-sticky-dialog"
          style={{ background: draft?.color }}
          aria-describedby={undefined}
        >
          <DialogTitle>{zoneTitle(draft?.zone ?? '', s.template)}</DialogTitle>
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
            setTimeout(() => {
              if (!webglFailed) void document.querySelector('canvas')?.requestPointerLock();
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
                    // В форме — только то, что формой и создаётся: рисунок и
                    // связь рисуют инструментами доски, а «Задача», «План» и
                    // «План действий» стали одним «Действием». Старая карточка
                    // со снятым типом показывает его название, данные не меняются.
                    options={[
                      ...FORM_NOTE_KINDS,
                      ...(FORM_NOTE_KINDS.includes(draft.kind)
                        ? []
                        : [draft.kind]),
                    ].map((value) => ({ value, label: noteKindLabel(value) }))}
                  />
                  <Choice
                    label="Зона"
                    disabled={!canEdit}
                    value={draft.zone}
                    onChange={(zone) => setDraft({ ...draft, zone })}
                    options={[
                      ...formZones,
                      ...ZONES.filter(
                        (z) =>
                          z.id === draft.zone && !formZones.includes(z),
                      ),
                    ].map((z) => ({
                      value: z.id,
                      label: zoneTitle(z.id, s.template),
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
                  {(
                    [
                      ['#f5e6a9', 'Жёлтый'],
                      ['#b5d1c0', 'Зелёный'],
                      ['#edc5b6', 'Персиковый'],
                      ['#cdc4e0', 'Лавандовый'],
                      ['#b7d2df', 'Голубой'],
                      ['#ffffff', 'Белый'],
                    ] as const
                  ).map(([c, colorName]) => (
                    <button
                      type="button"
                      key={c}
                      disabled={!canEdit}
                      aria-label={'Цвет: ' + colorName}
                      aria-pressed={draft.color === c}
                      title={colorName}
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
                {isActionKind(draft.kind) && (
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
                    {/* Удаление сразу, без «Вы уверены?»: вернуть карточку
                        можно тостом «Отменить» в течение 6 секунд. */}
                    {canEdit && (
                      <button
                        type="button"
                        className="text-button danger"
                        disabled={s.archived}
                        title={
                          s.archived
                            ? 'Встреча завершена — комната только для чтения'
                            : undefined
                        }
                        onClick={() => void deleteNote(edited)}
                      >
                        <Trash2 size={15} />
                        Удалить
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
                : panel === 'results'
                  ? 'results-dialog'
                  : '')
          }
        >
          {confirmDialog}
          <DialogTitle>
            {(
              {
                menu: 'Настройки',
                team: 'Выбор стороны',
                share: 'Пригласить команду',
                results: 'Итоги встречи',
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
              ? 'Отправьте ссылку команде — участники войдут по ней. У каждой комнаты свой адрес.'
              : panel === 'results'
                ? 'Главное по голосам, план действий и экспорт. Всё, что нужно после встречи.'
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
              onCopyLink={copyLink}
              onRegenerateInvite={async () => {
                await act({ type: 'access.regenerate_invite' });
                flash('Ссылка-приглашение обновлена');
              }}
            />
          )}
          {panel === 'results' && (
            <ResultsPanel
              s={s}
              host={host}
              history={history}
              historyOpen={historyOpen}
              onHistoryOpen={setHistoryOpen}
              undo={{ ...undoInfo, busy: undoBusy }}
              onUndo={() => void undoLast()}
              onExport={exportRoom}
              onImport={(file) => void importFile(file)}
              onAddAction={newAction}
              onOpenNote={(n) => {
                setPanel('');
                editNote(n);
              }}
              onOpenVote={() => setPanel('vote')}
              onToggleArchive={() => void toggleArchive()}
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
                  mode={gameMode}
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
                  onSoundChange={changeSound}
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
                  onSettings={(patch) => void changeRoomSettings(patch)}
                />
              )}
              {settingsSection === 'bots' && (
                <BotsPanel
                  s={s}
                  host={host}
                  members={room.members}
                  onAct={(op) => void act(op)}
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
                    void setPrivateWriting(privateWriting)
                  }
                  onAnonymousChange={(anonymous) =>
                    void act({ type: 'room.settings', patch: { anonymous } })
                  }
                  onLayoutLockedChange={(layoutLocked) =>
                    void act({ type: 'room.settings', patch: { layoutLocked } })
                  }
                  onAccessTypeChange={(accessType) =>
                    void changeAccessType(accessType)
                  }
                  onMaxPlayersChange={(maxPlayers) => {
                    void act({ type: 'access.max_players', maxPlayers });
                  }}
                />
              )}
              {settingsSection === 'results' && (
                <div className="settings-results-link">
                  <p>
                    План действий, экспорт, история изменений и завершение
                    встречи теперь на отдельном экране — он открывается и из
                    шапки, и кнопкой этапа «Итоги».
                  </p>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setPanel('results')}
                  >
                    <ListChecks size={16} aria-hidden="true" />
                    Итоги встречи → открыть
                  </button>
                </div>
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
                    changeSound(true);
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
                  onSoundChange={changeSound}
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
              selectedSkin={selectedSkin}
              selectedBandanaColor={selectedBandanaColor}
              /* Окно копит выбор у себя; сюда приходит только то, что реально
                 изменилось, — и уже отсюда уходит на сервер. */
              onApply={({ team, skin, bandanaColor }) => {
                if (skin !== undefined && bandanaColor !== undefined) {
                  setSelectedSkin(skin);
                  setSelectedBandanaColor(bandanaColor);
                  localStorage.setItem('jinaly-custom-skin', skin);
                  localStorage.setItem('jinaly-bandana-color', bandanaColor);
                  void act({ type: 'profile', hat: skin, color: bandanaColor });
                }
                // Смерть и штраф за переход считает сервер, клиент шлёт только сторону.
                if (team)
                  void act({ type: 'team.set', session: room.self, team });
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
              onDeleteGroup={(groupId) => void deleteGroup(groupId)}
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
