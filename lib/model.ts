export const ZONES = [
  {
    id: 'good',
    title: 'Что было хорошо',
    short: 'Good',
    color: '#8db9a1',
    emoji: '☀️',
    hint: 'Победы, благодарности и то, что хочется сохранить',
  },
  {
    id: 'bad',
    title: 'Что было сложно',
    short: 'Bad',
    color: '#d99887',
    emoji: '🌧️',
    hint: 'Препятствия, ошибки и моменты для улучшения',
  },
  {
    id: 'start',
    title: 'Начать делать',
    short: 'Start',
    color: '#e0c477',
    emoji: '🌱',
    hint: 'Новые идеи и эксперименты на следующий спринт',
  },
  {
    id: 'stop',
    title: 'Перестать делать',
    short: 'Stop',
    color: '#aaa1c8',
    emoji: '✋',
    hint: 'Что больше не помогает команде',
  },
];
export const THEMES = [
  {
    id: 'nauryz',
    name: 'Наурыз',
    subtitle: '21–23 марта · праздник обновления',
    color: '#9bb889',
    season: 'spring',
    icon: '🌷',
  },
  {
    id: 'steppe',
    name: 'Великая степь',
    subtitle: 'Простор, горы и спокойствие',
    color: '#c7b781',
    season: 'summer',
    icon: '🏔️',
  },
  {
    id: 'republic',
    name: 'День Республики',
    subtitle: '25 октября · золотая осень',
    color: '#c99b67',
    season: 'autumn',
    icon: '🇰🇿',
  },
  {
    id: 'independence',
    name: 'День Независимости',
    subtitle: '16 декабря · бирюза и золото',
    color: '#86b8be',
    season: 'winter',
    icon: '✨',
  },
  {
    id: 'newyear',
    name: 'Новый год',
    subtitle: '1–2 января · зимний уют',
    color: '#96b3b6',
    season: 'winter',
    icon: '🎄',
  },
  {
    id: 'unity',
    name: 'День единства',
    subtitle: '1 мая · встречаемся вместе',
    color: '#b4baa0',
    season: 'spring',
    icon: '🤝',
  },
];
export const PHASES = [
  'Знакомство',
  'Пишем идеи',
  'Группируем',
  'Голосуем',
  'Обсуждаем',
  'Итоги',
];
export const TOOLS = [
  { id: 'pointer', label: 'Выбор', key: '1' },
  { id: 'sticky', label: 'Стикер', key: '2' },
  { id: 'group', label: 'Тема', key: '3' },
  { id: 'draw', label: 'Маркер', key: '4' },
  { id: 'shape', label: 'Фигура', key: '5' },
  { id: 'text', label: 'Текст', key: '6' },
  { id: 'connector', label: 'Связь', key: '7' },
  { id: 'reaction', label: 'Реакция', key: '8' },
  { id: 'image', label: 'Медиа', key: '9' },
  { id: 'action', label: 'Задача', key: '0' },
];
export const GAME_TOOLS = [
  { id: 'paint', label: 'Краскомёт', key: '1' },
  { id: 'confetti', label: 'Дробовик конфетти', key: '2' },
  { id: 'sticky', label: 'Стикер', key: '5' },
  { id: 'group', label: 'Тема', key: '7' },
  { id: 'draw', label: 'Маркер', key: '8' },
  { id: 'shape', label: 'Фигура', key: '9' },
  { id: 'connector', label: 'Связь', key: '0' },
  { id: 'reaction', label: 'Реакция', key: '8' },
  { id: 'action', label: 'Задача', key: '9' },
  { id: 'pointer', label: 'Планшет', key: '6' },
  { id: 'grenade', label: 'Пиньято', key: '3' },
  { id: 'sniper', label: 'Снайперка', key: '4' },
  { id: 'like', label: 'Лайкомёт', key: '7' },
];
export const TOOL_HINTS: Record<string, string> = {
  paint: 'ЛКМ — выстрел краской · ПКМ — точный прицел',
  confetti: 'ЛКМ — залп дробовика конфетти',
  grenade: 'Зажмите ЛКМ — дуга броска · отпустите — бросить пиньято',
  sniper: 'ЛКМ — выстрел фейерверком · ПКМ — оптический зум',
  sticky: 'ЛКМ или E — написать стикер · Колесо/СКМ выбор зоны',
  group: 'ЛКМ по доске — объединить идеи',
  draw: 'ЛКМ по доске — рисовать маркером',
  shape: 'ЛКМ по доске — добавить фигуру',
  connector: 'ЛКМ по доске — связать карточки',
  reaction: 'ЛКМ — отправить реакцию',
  action: 'ЛКМ по доске — создать задачу',
  pointer: 'ЛКМ или E — заглянуть в планшет и открыть доску',
  like: 'ЛКМ — выстрел лайком · попадание в стикер на доске добавляет +1 голос',
  text: 'Текстовый блок на доске',
  image: 'Изображение или ссылка',
};
export type WorldEffect = {
  id: string;
  kind: 'paint' | 'confetti' | 'grenade' | 'sniper' | 'like' | 'kill';
  variant?: string;
  origin?: number[];
  target?: number[];
  normal?: number[];
  color?: string;
  at: number;
  author: string;
  killer?: string;
  killerName?: string;
  victim?: string;
  victimName?: string;
  assister?: string;
  assisterName?: string;
  tool?: string;
  headshot?: boolean;
};
export type Pose = {
  x: number;
  z: number;
  y: number;
  yaw: number;
  stance: 'stand' | 'sit' | 'lie';
  moving: boolean;
  speed?: number;
  strafe?: number;
  forward?: number;
  pitch?: number;
  tool?: string;
  variant?: string;
  working?: boolean;
  crouching?: boolean;
  aiming?: boolean;
  reload?: number;
};
export type Person = {
  id: string;
  name: string;
  color: string;
  lastSeen: number;
  hp?: number;
  respawnAt?: number;
  immuneUntil?: number;
  immuneRemaining?: number;
  respawnRemaining?: number;
  life?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  pose: Pose;
  ping: number;
  mood: string;
  hat: string;
  cursor?: { x?: number; y?: number; mode?: string };
};
export type Note = {
  redacted?: boolean;
  id: string;
  kind: string;
  text: string;
  zone: string;
  color: string;
  author: string;
  anonymous: boolean;
  hidden: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  group: string;
  tags: string[];
  locked: boolean;
  url: string;
  points: number[][];
  from: string;
  to: string;
  owner: string;
  due: string;
  done: boolean;
  comments: { id: string; author: string; text: string; at: number }[];
  reactions: Record<string, string[]>;
};
export type Round = {
  id: string;
  limit: number;
  active: boolean;
  votes: Record<string, Record<string, number>>;
};
export type RoomState = {
  anonymousPlayers?: boolean;
  respawnSeconds?: number;
  title: string;
  theme: string;
  visualStyle?: 'classic' | 'anime';
  season: string;
  time: string;
  interior: boolean;
  phase: number;
  privateWriting: boolean;
  anonymous: boolean;
  layoutLocked: boolean;
  notes: Note[];
  groups: { id: string; title: string; color: string }[];
  rounds: Round[];
  timer: { end: number; remaining: number; running: boolean };
  focus: { zone: string; at: number };
  events: {
    id: string;
    kind: string;
    value: string;
    at: number;
    author: string;
  }[];
  counter: number;
  music: string;
  archived: boolean;
  template: string;
  readyCheck?: {
    active: boolean;
    initiator: string;
    startedAt: number;
    readyUsers: string[];
  } | null;
};
export type Room = {
  id: string;
  host: string;
  version: number;
  state: RoomState;
  members: Person[];
  self: string;
  created: number;
  effects?: WorldEffect[];
};
export const uid = (): string => {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
export function filterNewEffects<T extends { id?: string; at?: number }>(
  effects: T[],
  seen: Map<string, number>,
  ttlMs = 15000,
): T[] {
  const fresh: T[] = [];
  const now = Date.now();
  for (const [key, when] of seen) {
    if (now - when > ttlMs) seen.delete(key);
  }
  for (const effect of effects) {
    if (!effect.id) {
      if (typeof effect.at === 'number' && now - effect.at > ttlMs) continue;
      fresh.push(effect);
      continue;
    }
    const lastSeen = seen.get(effect.id);
    if (lastSeen && now - lastSeen <= ttlMs) continue;
    seen.set(effect.id, now);
    fresh.push(effect);
  }
  return fresh;
}
export function initialState(
  title: string,
  theme = 'nauryz',
  template = 'four',
): RoomState {
  return {
    title,
    theme,
    visualStyle: 'classic',
    template,
    season: THEMES.find((t) => t.id === theme)?.season || 'spring',
    time: 'day',
    interior: false,
    phase: 0,
    privateWriting: false,
    anonymous: false,
    layoutLocked: false,
    notes: [],
    groups: [],
    rounds: [],
    timer: { end: 0, remaining: 300, running: false },
    focus: { zone: '', at: 0 },
    events: [],
    counter: 0,
    music: '',
    archived: false,
    readyCheck: null,
  };
}
export function cleanText(v: unknown, max = 4000) {
  if (typeof v !== 'string') throw Error('Ожидается текст');
  if (v.length > max) throw Error(`Не более ${max} символов`);
  return v.trim();
}
function finite(v: unknown, min = -10000, max = 10000) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw Error('Некорректное числовое значение');
  return v;
}
const oneOf = (v: unknown, values: string[]) => {
  if (typeof v !== 'string' || !values.includes(v))
    throw Error('Недопустимое значение');
  return v;
};
const safeUrl = (v: unknown) => {
  const s = cleanText(v, 2000);
  if (!s) return '';
  const u = new URL(s);
  if (u.protocol !== 'https:') throw Error('Используйте HTTPS-ссылку');
  return u.href;
};
export function applyOperation(
  original: RoomState,
  op: Record<string, unknown>,
  user: string,
  host: string,
): RoomState {
  const s = structuredClone(original),
    kind = String(op.type),
    isHost = user === host;
  const hostOnly = () => {
    if (!isHost) throw Error('Доступно только ведущему');
  };
  if (s.archived && kind !== 'archive')
    throw Error('Встреча завершена. Ведущий может открыть её снова.');
  const note = () => {
    const n = s.notes.find((n) => n.id === op.id);
    if (!n) throw Error('Карточка не найдена');
    if (n.hidden && n.author !== user) throw Error('Заметка пока приватная');
    return n;
  };
  const editable = (n: Note) => {
    if (n.locked || s.layoutLocked) {
      if (!isHost) throw Error('Редактирование заблокировано ведущим');
    }
    if (n.author !== user && !isHost)
      throw Error('Изменять карточку может автор или ведущий');
  };
  if (kind === 'note.add') {
    if (s.notes.length >= 600) throw Error('В комнате уже 600 объектов');
    const k = oneOf(op.kind || 'sticky', [
      'sticky',
      'index',
      'task',
      'roadmap',
      'page',
      'shape',
      'text',
      'image',
      'draw',
      'connector',
      'token',
      'frame',
      'action',
    ]);
    if (
      s.layoutLocked &&
      ['shape', 'text', 'image', 'draw', 'connector', 'frame'].includes(k) &&
      !isHost
    )
      throw Error('Макет доски заблокирован');
    const points = Array.isArray(op.points)
      ? op.points.slice(0, 400).map((p) => {
          if (!Array.isArray(p)) throw Error('Некорректный рисунок');
          return [finite(p[0]), finite(p[1])];
        })
      : [];
    s.notes.push({
      id: uid(),
      kind: k,
      text: cleanText(op.text || '', 8000),
      zone: oneOf(
        op.zone || 'good',
        ZONES.map((z) => z.id),
      ),
      color: /^#[0-9a-f]{6}$/i.test(String(op.color))
        ? String(op.color)
        : '#f5e6a9',
      author: user,
      anonymous: s.anonymous,
      hidden:
        ['sticky', 'index', 'page'].includes(k) &&
        (s.privateWriting || !!op.hidden),
      x: finite(op.x ?? 50),
      y: finite(op.y ?? 50),
      width: finite(op.width ?? 220, 40, 1800),
      height: finite(op.height ?? 165, 40, 1800),
      rotation: finite(op.rotation ?? 0, -180, 180),
      group: cleanText(op.group || '', 100),
      tags: Array.isArray(op.tags)
        ? op.tags.slice(0, 12).map((t) => cleanText(t, 40))
        : [],
      locked: !!op.locked,
      url: safeUrl(op.url || ''),
      points,
      from: cleanText(op.from || '', 100),
      to: cleanText(op.to || '', 100),
      owner: cleanText(op.owner || '', 80),
      due: cleanText(op.due || '', 20),
      done: !!op.done,
      comments: [],
      reactions: {},
    });
  } else if (kind === 'note.edit') {
    const n = note();
    editable(n);
    const p = op.patch as Record<string, unknown>;
    if (!p || typeof p !== 'object') throw Error('Нет изменений');
    for (const key of ['text', 'owner', 'due', 'group'] as const)
      if (key in p) n[key] = cleanText(p[key], key === 'text' ? 8000 : 100);
    if ('zone' in p)
      n.zone = oneOf(
        p.zone,
        ZONES.map((z) => z.id),
      );
    for (const key of ['x', 'y', 'rotation'] as const)
      if (key in p) n[key] = finite(p[key]);
    for (const key of ['width', 'height'] as const)
      if (key in p) n[key] = finite(p[key], 40, 1800);
    if ('color' in p) {
      if (!/^#[0-9a-f]{6}$/i.test(String(p.color)))
        throw Error('Некорректный цвет');
      n.color = String(p.color);
    }
    if ('tags' in p) {
      if (!Array.isArray(p.tags) || p.tags.length > 12)
        throw Error('Не более 12 тегов');
      n.tags = p.tags.map((t) => cleanText(t, 40));
    }
    if ('hidden' in p) {
      if (n.author !== user) throw Error('Раскрыть заметку может её автор');
      n.hidden = !!p.hidden;
    }
    if ('locked' in p) n.locked = !!p.locked;
    if ('done' in p) n.done = !!p.done;
    if ('url' in p) n.url = safeUrl(p.url);
  } else if (kind === 'note.delete') {
    const n = note();
    editable(n);
    s.notes = s.notes.filter(
      (x) => x.id !== n.id && x.from !== n.id && x.to !== n.id,
    );
  } else if (kind === 'note.comment') {
    const n = note();
    if (n.comments.length >= 100) throw Error('Достигнут лимит комментариев');
    const text = cleanText(op.text, 2000);
    if (!text) throw Error('Введите комментарий');
    n.comments.push({ id: uid(), text, author: user, at: Date.now() });
  } else if (kind === 'note.react') {
    const n = note(),
      emoji = oneOf(op.emoji, ['👍', '❤️', '🎉', '💡', '👀', '🔥', '🇰🇿', '🌱']);
    const list = n.reactions[emoji] || [];
    n.reactions[emoji] = list.includes(user)
      ? list.filter((x) => x !== user)
      : [...list, user];
  } else if (kind === 'group.add') {
    if (s.groups.length >= 40) throw Error('Достигнут лимит тем');
    s.groups.push({
      id: uid(),
      title: cleanText(op.title, 80) || 'Общая тема',
      color: '#a1baa8',
    });
  } else if (kind === 'group.delete') {
    hostOnly();
    s.groups = s.groups.filter((g) => g.id !== op.id);
    s.notes.forEach((n) => {
      if (n.group === op.id) n.group = '';
    });
  } else if (kind === 'reveal') {
    s.notes.forEach((n) => {
      if (n.author === user) n.hidden = false;
    });
  } else if (kind === 'room.settings') {
    hostOnly();
    const p = op.patch as Record<string, unknown>;
    if (!p || typeof p !== 'object') throw Error('Нет настроек');
    if ('title' in p) s.title = cleanText(p.title, 100) || 'Ретроспектива';
    if ('theme' in p)
      s.theme = oneOf(
        p.theme,
        THEMES.map((t) => t.id),
      );
    if ('visualStyle' in p)
      s.visualStyle = oneOf(p.visualStyle, ['classic', 'anime']) as
        | 'classic'
        | 'anime';
    if ('respawnSeconds' in p) {
      s.respawnSeconds = finite(p.respawnSeconds, 1, 30);
      if (!Number.isInteger(s.respawnSeconds))
        throw Error('Интервал должен быть целым числом');
    }
    if ('season' in p)
      s.season = oneOf(p.season, ['spring', 'summer', 'autumn', 'winter']);
    if ('time' in p) s.time = oneOf(p.time, ['dawn', 'day', 'sunset', 'night']);
    for (const key of [
      'interior',
      'privateWriting',
      'anonymous',
      'anonymousPlayers',
      'layoutLocked',
    ] as const)
      if (key in p) s[key] = !!p[key];
  } else if (kind === 'phase') {
    hostOnly();
    s.phase = finite(op.phase, 0, 5);
    if (!Number.isInteger(s.phase)) throw Error('Некорректный этап');
  } else if (kind === 'vote.start') {
    hostOnly();
    const limit = finite(op.limit, 1, 20);
    if (!Number.isInteger(limit))
      throw Error('Лимит голосов должен быть целым');
    s.rounds.forEach((r) => (r.active = false));
    if (s.rounds.length >= 30) throw Error('Не более 30 раундов');
    s.rounds.push({ id: uid(), limit, active: true, votes: {} });
    s.phase = 3;
  } else if (kind === 'vote.end') {
    hostOnly();
    s.rounds.forEach((r) => (r.active = false));
    s.phase = 4;
  } else if (kind === 'vote') {
    const n = note();
    let r = s.rounds.at(-1);
    if (!r?.active) {
      if (op.force || op.kind === 'blaster') {
        r = { id: uid(), limit: 10, active: true, votes: {} };
        s.rounds.push(r);
      } else {
        throw Error('Голосование не запущено');
      }
    }
    if (n.hidden) throw Error('Сначала раскройте заметку');
    const votes = r.votes[user] || {};
    const value = op.remove ? -1 : 1;
    if (
      value === 1 &&
      Object.values(votes).reduce((a, b) => a + b, 0) >= r.limit
    ) {
      if (op.force || op.kind === 'blaster') {
        r.limit += 5;
      } else {
        throw Error('Все голоса использованы');
      }
    }
    votes[n.id] = Math.max(0, (votes[n.id] || 0) + value);
    r.votes[user] = votes;
  } else if (kind === 'ready.start') {
    s.readyCheck = {
      active: true,
      initiator: user,
      startedAt: Date.now(),
      readyUsers: [user],
    };
  } else if (kind === 'ready.respond') {
    if (s.readyCheck?.active) {
      const ready = !!op.ready;
      const set = new Set(s.readyCheck.readyUsers);
      if (ready) {
        set.add(user);
      } else {
        set.delete(user);
      }
      s.readyCheck.readyUsers = Array.from(set);
    }
  } else if (kind === 'ready.dismiss') {
    if (s.readyCheck) {
      s.readyCheck.active = false;
    }
  } else if (kind === 'timer') {
    hostOnly();
    const action = oneOf(op.action, ['start', 'pause', 'reset']);
    if (action === 'start') {
      const seconds = finite(op.seconds ?? s.timer.remaining, 1, 7200);
      s.timer = {
        end: Date.now() + seconds * 1000,
        remaining: seconds,
        running: true,
      };
    } else if (action === 'pause') {
      s.timer.remaining = Math.max(
        0,
        Math.ceil((s.timer.end - Date.now()) / 1000),
      );
      s.timer.running = false;
    } else {
      s.timer = {
        end: 0,
        remaining: finite(op.seconds ?? 300, 1, 7200),
        running: false,
      };
    }
  } else if (kind === 'focus') {
    hostOnly();
    s.focus = {
      zone: oneOf(
        op.zone,
        ZONES.map((z) => z.id),
      ),
      at: Date.now(),
    };
  } else if (kind === 'event') {
    s.events.push({
      id: uid(),
      kind: oneOf(op.kind, [
        'confetti',
        'reaction',
        'buzzer',
        'ping',
        'hat',
        'spin',
      ]),
      value: cleanText(op.value || '', 200),
      author: user,
      at: Date.now(),
    });
    s.events = s.events.slice(-30);
  } else if (kind === 'counter') {
    s.counter += op.down ? -1 : 1;
  } else if (kind === 'music') {
    hostOnly();
    s.music = oneOf(op.track, ['', 'steppe', 'rain', 'evening']);
  } else if (kind === 'archive') {
    hostOnly();
    s.archived = !!op.value;
  } else if (kind === 'import') {
    hostOnly();
    if (!Array.isArray(op.notes) || op.notes.length > 200)
      throw Error('Импортируйте до 200 объектов за раз');
    let result = s;
    for (const raw of op.notes) {
      if (!raw || typeof raw !== 'object') throw Error('Некорректная карточка');
      result = applyOperation(result, { ...raw, type: 'note.add' }, user, host);
    }
    return result;
  } else throw Error('Неизвестная команда');
  return s;
}
export function publicState(state: RoomState, self: string): RoomState {
  const s = structuredClone(state);
  s.notes = s.notes.map((n) =>
    n.hidden && n.author !== self
      ? {
          id: n.id,
          kind: 'sticky',
          text: '',
          zone: n.zone,
          color: n.color,
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          rotation: n.rotation,
          author: '',
          anonymous: true,
          hidden: true,
          redacted: true,
          locked: true,
          group: '',
          tags: [],
          url: '',
          points: [],
          from: '',
          to: '',
          owner: '',
          due: '',
          done: false,
          comments: [],
          reactions: {},
        }
      : {
          ...n,
          author:
            (n.anonymous || s.anonymousPlayers) && n.author !== self
              ? 'anonymous'
              : n.author,
        },
  );
  s.rounds = s.rounds.map((r) =>
    r.active ? { ...r, votes: { [self]: r.votes[self] || {} } } : r,
  );
  return s;
}
export function voteCount(s: RoomState, id: string) {
  return Object.values(s.rounds.at(-1)?.votes || {}).reduce(
    (sum, v) => sum + (v[id] || 0),
    0,
  );
}
