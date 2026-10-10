'use client';
/* oxlint-disable next/no-html-link-for-pages -- Полная навигация обходит ошибку RSC prefetch в production-сборке vinext. */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
  useSyncExternalStore,
} from 'react';
import {
  Plus,
  Check,
  StickyNote,
  Flag,
  Eye,
  X,
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
  isActionKind,
  isOnline,
  isPresent,
  templateZones,
  zoneShort,
  zoneTitle,
  type Note,
  type Pose,
} from '@/lib/model';
import { relockWorld } from '@/lib/pointer-lock';
import { api, download, parseCSV } from '@/lib/client';
import {
  exportCsvRows,
  exportMarkdown,
  fromCsvCell,
  toCsv,
  zoneFromLabel,
} from '@/lib/room-export';
import { phaseGuide, type PhaseAction } from '@/lib/room-phase';
import { setMusicVoiceActive } from '@/lib/soundtrack';
import { Card } from './board';
import { useResourcePack } from '../hooks/use-resource-pack';
import { SETTINGS_APPLIED_EVENT } from '@/lib/settings-sync';
import {
  GroupPanel,
  JoinRequestsPanel,
  SharePanel,
  TimerPanel,
  ToolsPanel,
  VotePanel,
  type HistoryEntry,
} from './room-panels';
import { useConfirm } from './room-confirm';
import { UndoToast } from './room-toast';
import { ResultsPanel } from './room-results';
import { SidePicker } from './side-picker';
import { PhaseBar } from './phase-bar';
import RoomBoardFallback from './room-board-fallback';
import { useRoomSync } from './use-room-sync';
import GameChat from './game-chat';
import { useVoiceChat } from './use-voice-chat';
import { isFreeForAll, MAP_CATALOG, modeChoice, modeChoiceOf, modeOf } from '@/lib/maps/catalog';
import { defaultSlot, hasSlot, slotsFor } from '@/lib/loadout';
import { useLocalPrefs } from './use-local-prefs';
import { RoomJoinScreen, RoomLoadingScreen } from './room-join-screen';
import { RoomHeader } from './room-header';
import { RoomMonitor } from './room-monitor';
import { RoomNoteEditor, type Draft } from './room-note-editor';
import { RoomSettings } from './room-settings';

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
/** Адрес страницы внутри комнаты не меняется — подписываться не на что. */
const noSubscribe = () => () => {};

export default function RoomApp({ id }: { id: string }) {
  const resourcePack = useResourcePack();
  const {
    fpsLimit,
    setFpsLimit,
    sensitivity,
    setSensitivity,
    invertCamera,
    setInvertCamera,
    aimModes,
    setAimModes,
    paintColor,
    quality,
    setQuality,
    sound,
    selectedSkin,
    setSelectedSkin,
    selectedBandanaColor,
    setSelectedBandanaColor,
    loadDeviceSettings,
    changeSound,
    changePaintColor,
  } = useLocalPrefs();
  const [editingTitle, setEditingTitle] = useState(false);
  const [quickSticky, setQuickSticky] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
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
    [guideBusy, setGuideBusy] = useState(false);
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
  }, [act, loadDeviceSettings, setSelectedSkin, setSelectedBandanaColor]);
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
        if (!webglFailed) relockWorld();
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
          text: fromCsvCell(r[0]),
          zone: zoneFromLabel(fromCsvCell(r[1]), s?.template),
          owner: fromCsvCell(r[3]),
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
  if (join)
    return (
      <RoomJoinScreen
        join={join}
        joinRequestSent={joinRequestSent}
        retryAfterReject={retryAfterReject}
        setJoinRequestSent={setJoinRequestSent}
        setRetryAfterReject={setRetryAfterReject}
        name={name}
        setName={setName}
        busy={busy}
        error={error}
        setError={setError}
        sendJoinRequest={sendJoinRequest}
        enter={enter}
      />
    );
  if (!room || !s)
    return (
      <RoomLoadingScreen error={error} setError={setError} refresh={refresh} />
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
    // Командный бой и «Каждый за себя» — один режим с флагом команд, но переход между
    // ними тоже начинает игру заново, поэтому спрашиваем и о нём.
    const target = modeChoiceOf({
      mode: 'mode' in patch ? String(patch.mode) : gameMode,
      map: s.map,
      freeForAll: 'freeForAll' in patch ? !!patch.freeForAll : s.freeForAll,
    });
    if (target !== modeChoiceOf(s)) {
      const sameMode = modeChoice(target).mode === gameMode;
      const ok = await confirm({
        title: `Переключить комнату в режим «${modeChoice(target).title}»?`,
        description: sameMode
          ? 'Матч начнётся заново у всех участников: стороны раздадутся или снимутся, счёт и убийства обнулятся.'
          : 'Режим и карта сменятся сразу у всех участников. Карточки, голоса и план действий сохранятся — к ним можно вернуться, переключив режим обратно.',
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
      <RoomHeader
        room={room}
        s={s}
        host={host}
        gameMode={gameMode}
        mapTitle={mapTitle}
        now={now}
        timeText={timeText}
        round={round}
        used={used}
        votesLabel={votesLabel}
        online={online}
        joinRequests={joinRequests}
        connection={connection}
        editingTitle={editingTitle}
        setEditingTitle={setEditingTitle}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        voiceActive={voiceActive}
        fullscreen={fullscreen}
        enterFullscreen={enterFullscreen}
        setPanel={setPanel}
        setMonitor={setMonitor}
        setPrivateWriting={setPrivateWriting}
        act={act}
        flash={flash}
      />
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
        <RoomMonitor
          room={room}
          host={host}
          gameMode={gameMode}
          now={now}
          online={online}
          ping={ping}
          fps={fps}
          voiceMuted={voiceMuted}
          setMonitor={setMonitor}
          setPanel={setPanel}
          act={act}
        />
      )}
      <RoomNoteEditor
        room={room}
        s={s}
        draft={draft}
        setDraft={setDraft}
        quickSticky={quickSticky}
        edited={edited}
        canEdit={canEdit}
        formZones={formZones}
        busy={busy}
        webglFailed={webglFailed}
        comment={comment}
        setComment={setComment}
        saveNote={saveNote}
        deleteNote={deleteNote}
        act={act}
        flash={flash}
      />
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
                team: isFreeForAll(s) ? 'Облик бойца' : 'Выбор стороны',
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
            <RoomSettings
              room={room}
              s={s}
              me={me}
              host={host}
              gameMode={gameMode}
              online={online}
              settingsSection={settingsSection}
              setSettingsSection={setSettingsSection}
              fps={fps}
              fpsLimit={fpsLimit}
              setFpsLimit={setFpsLimit}
              quality={quality}
              setQuality={setQuality}
              sensitivity={sensitivity}
              setSensitivity={setSensitivity}
              invertCamera={invertCamera}
              setInvertCamera={setInvertCamera}
              aimModes={aimModes}
              setAimModes={setAimModes}
              sound={sound}
              changeSound={changeSound}
              selectedSkin={selectedSkin}
              setSelectedSkin={setSelectedSkin}
              selectedBandanaColor={selectedBandanaColor}
              setSelectedBandanaColor={setSelectedBandanaColor}
              spinOptions={spinOptions}
              setSpinOptions={setSpinOptions}
              spinner={spinner}
              setPanel={setPanel}
              changeRoomSettings={changeRoomSettings}
              setPrivateWriting={setPrivateWriting}
              changeAccessType={changeAccessType}
              act={act}
            />
          )}
          {panel === 'team' && (
            <SidePicker
              self={me}
              members={room.members}
              anime={s.visualStyle === 'anime'}
              anonymous={!!s.anonymousPlayers}
              teams={!isFreeForAll(s)}
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
