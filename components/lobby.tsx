'use client';
/* oxlint-disable next/no-html-link-for-pages -- Полная навигация обходит ошибку RSC prefetch в production-сборке vinext. */
import { useState, useEffect } from 'react';

import {
  Plus,
  ArrowUpRight,
  Mountain,
  Compass,
  LayoutGrid,
  Link2,
  Clock3,
  ChevronRight,
  Search,
  Gamepad2,
  BookOpen,
  Settings2,
  Globe,
  Lock,
  Users,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { THEMES, PHASES, type RoomAccessType } from '@/lib/model';
import { api, ready } from '@/lib/client';
import { Choice } from './controls';
import { StylePicker } from './style-picker';
import { ResourcePackPicker } from './resource-pack-picker';
import { useResourcePack } from '../hooks/use-resource-pack';
type Summary = {
  id: string;
  title: string;
  theme: string;
  season: string;
  archived: boolean;
  phase: number;
  created: number;
  notes: number;
  host: string;
};
type PublicSummary = {
  id: string;
  title: string;
  theme: string;
  season: string;
  archived: boolean;
  phase: number;
  created: number;
  host: string;
  hostName: string;
  membersCount: number;
  maxPlayers: number;
  status: 'available' | 'full' | 'in_progress' | 'closed';
  accessType: 'public';
};
export default function Lobby() {
  const resourcePack = useResourcePack();
  const [packsOpen, setPacksOpen] = useState(false);
  const [create, setCreate] = useState(false),
    [name, setName] = useState(''),
    [title, setTitle] = useState(''),
    [theme, setTheme] = useState('nauryz'),
    [visualStyle, setVisualStyle] = useState('classic'),
    [template, setTemplate] = useState('four'),
    [accessType, setAccessType] = useState<RoomAccessType>('public'),
    [maxPlayers, setMaxPlayers] = useState(8),
    [view, setView] = useState<'browser' | 'my_rooms'>('browser'),
    [rooms, setRooms] = useState<Summary[]>([]),
    [publicRooms, setPublicRooms] = useState<PublicSummary[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('active'),
    [join, setJoin] = useState(false),
    [joinCode, setJoinCode] = useState(''),
    [help, setHelp] = useState(false);

  const loadRooms = async () => {
    try {
      const [myRes, pubRes] = await Promise.all([
        api<{ rooms: Summary[] }>('/api/rooms'),
        api<{ rooms: PublicSummary[] }>('/api/rooms?browse=public'),
      ]);
      setRooms(myRes.rooms || []);
      setPublicRooms(pubRes.rooms || []);
      setName(localStorage.getItem('jinaly-name') || '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void ready().then(loadRooms);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) {
        void api<{ rooms: PublicSummary[] }>('/api/rooms?browse=public')
          .then((r) => setPublicRooms(r.rooms || []))
          .catch(() => {});
        if (view === 'my_rooms') {
          void api<{ rooms: Summary[] }>('/api/rooms')
            .then((r) => setRooms(r.rooms || []))
            .catch(() => {});
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [view]);

  const createRoom = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ id: string; accessType?: string; inviteToken?: string }>(
        '/api/rooms',
        {
          title,
          name,
          theme,
          template,
          visualStyle,
          access: accessType,
          maxPlayers,
        },
      );
      localStorage.setItem('jinaly-name', name);
      const url =
        '/room/' +
        r.id +
        (r.accessType === 'private' && r.inviteToken ? '?invite=' + r.inviteToken : '');
      location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const joinRoom = () => {
    const trimmed = joinCode.trim();
    const match = trimmed.match(
      /(?:\/room\/)?([a-f0-9]{16})(?:\?invite=([a-f0-9-]+))?/i,
    );
    if (!match) {
      setError('Вставьте ссылку или 16-значный код комнаты');
      return;
    }
    const id = match[1];
    const invite = match[2];
    location.href = '/room/' + id + (invite ? '?invite=' + invite : '');
  };
  useEffect(() => {
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
    const register = (tool: unknown) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: abort.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: 'read_retro_rooms',
      description: 'List the rooms visible in this browser session.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => api('/api/rooms'),
    });
    register({
      name: 'create_retro_room',
      description: 'Create a new retrospective room and navigate into it.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 100 },
          name: { type: 'string', minLength: 1, maxLength: 40 },
          theme: { type: 'string', enum: THEMES.map((t) => t.id) },
        },
        required: ['title', 'name', 'theme'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: unknown) => {
        if (!input || typeof input !== 'object') throw Error('Invalid input');
        const p = input as { title: string; name: string; theme: string };
        if (
          typeof p.title !== 'string' ||
          !p.title.trim() ||
          typeof p.name !== 'string' ||
          !p.name.trim() ||
          !THEMES.some((t) => t.id === p.theme)
        )
          throw Error('Invalid room');
        const r = await api<{ id: string }>('/api/rooms', {
          ...p,
          template: 'four',
        });
        location.href = '/room/' + r.id;
        return { id: r.id, created: true };
      },
    });
    return () => abort.abort();
  }, []);
  const shown = rooms.filter(
    (r) =>
      r.title.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'all' || (filter === 'archive' ? r.archived : !r.archived)),
  );
  const shownPublic = publicRooms.filter((r) =>
    r.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <main className="lobby" data-resource-pack={resourcePack}>
      <Dialog open={packsOpen} onOpenChange={setPacksOpen}><DialogContent><DialogTitle>Визуальный пакет</DialogTitle><DialogDescription>Выберите оформление игры на этом устройстве.</DialogDescription><ResourcePackPicker /></DialogContent></Dialog>
      <header className="main-header">
        <a className="brand" href="/">
          <span className="brand-symbol">Ж</span>jinaly
          <span className="brand-suffix">RETRO WORLD</span>
        </a>
        <span className="header-caption">
          Место, где команда становится ближе
        </span>
        <button
          className="avatar"
          onClick={() => setCreate(true)}
          aria-label="Ваш профиль"
        >
          {name[0]?.toUpperCase() || 'Я'}
        </button>
      </header>
      <div className="lobby-body">
        <nav className="side-nav" aria-label="Главное меню">
          <p className="eyebrow">ПРОСТРАНСТВО КОМАНДЫ</p>
          <button
            className={view === 'browser' ? 'nav-active' : ''}
            onClick={() => setView('browser')}
          >
            <Globe size={18} /> Обзор комнат
          </button>
          <button
            className={view === 'my_rooms' ? 'nav-active' : ''}
            onClick={() => {
              setView('my_rooms');
              setFilter('active');
            }}
          >
            <LayoutGrid size={18} /> Мои комнаты
          </button>
          <button onClick={() => setCreate(true)}>
            <Plus size={18} /> Создать комнату
          </button>
          <button onClick={() => setJoin(true)}>
            <Link2 size={18} /> Войти по ссылке
          </button>
          <button onClick={() => setHelp(true)}>
            <BookOpen size={18} /> Как играть
          </button>
          <button onClick={() => setPacksOpen(true)}><Settings2 size={18} /> Визуальный пакет</button>
          <div className="nav-bottom">
            <Mountain size={23} />
            <p>
              Создано для встреч.
              <br />
              Вдохновлено Казахстаном.
            </p>
            <span className="version-tag">JINALY · EARLY ACCESS</span>
          </div>
        </nav>
        <section className="lobby-main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">СОБИРАЕМСЯ. ОБСУЖДАЕМ. РАСТЁМ.</p>
              <h1>
                Ваше место для ретро<span>.</span>
              </h1>
              <p className="muted">
                Одна команда. Общие идеи. Новый взгляд на каждый спринт.
              </p>
            </div>
            <button className="primary" onClick={() => setCreate(true)}>
              <Plus size={18} />
              Создать комнату
            </button>
          </div>
          <section className="welcome-panel">
            <div>
              <span className="pill">НОВЫЙ ФОРМАТ ВСТРЕЧ</span>
              <h2>
                Меньше формальностей.
                <br />
                Больше живого общения.
              </h2>
              <p>Встретьтесь в 3D-мире или соберите идеи на привычной доске.</p>
              <button className="light-button" onClick={() => setCreate(true)}>
                Собрать команду <ArrowUpRight size={18} />
              </button>
            </div>
            <div className="world-emblem">
              <Compass size={180} strokeWidth={0.7} />
              <span>43°14′ N · 76°53′ E</span>
            </div>
          </section>

          {view === 'browser' ? (
            <>
              <div className="section-heading">
                <h2>
                  Доступные комнаты <span className="count">{shownPublic.length}</span>
                </h2>
                <div className="search-box">
                  <Search size={16} />
                  <input
                    aria-label="Поиск комнат"
                    placeholder="Найти публичную комнату"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <p role="alert" className="error-banner">
                  {error}{' '}
                  <button onClick={() => location.reload()}>Повторить</button>
                </p>
              )}

              {loading ? (
                <div className="loading-state">Загружаем список комнат…</div>
              ) : shownPublic.length === 0 ? (
                <div className="empty-rooms-state">
                  <Globe size={48} className="empty-icon" />
                  <h3>Нет доступных публичных комнат</h3>
                  <p>
                    Создайте комнату или подключитесь к приватной по ссылке-приглашению.
                  </p>
                  <button className="primary" onClick={() => setCreate(true)}>
                    <Plus size={18} /> Создать комнату
                  </button>
                </div>
              ) : (
                <div className="room-grid">
                  {shownPublic.map((r) => {
                    const t = THEMES.find((th) => th.id === r.theme) || THEMES[0];
                    const isFull = r.status === 'full';
                    const isClosed = r.status === 'closed';
                    const statusLabel =
                      r.status === 'available'
                        ? 'Доступна'
                        : r.status === 'full'
                          ? 'Заполнена'
                          : r.status === 'in_progress'
                            ? 'Идёт ретро'
                            : 'Закрыта';
                    return (
                      <div key={r.id} className="room-card public-room-card">
                        <div
                          className="room-cover"
                          style={{ background: t.color + '55' }}
                        >
                          <span className="room-theme-emoji">{t.icon}</span>
                          <span className="room-format">
                            <Globe size={13} />
                            Публичная
                          </span>
                          <span className={`room-status status-${r.status}`}>
                            {statusLabel}
                          </span>
                        </div>
                        <div className="room-card-body">
                          <span className="eyebrow">
                            {t.name} · Ведущий: {r.hostName}
                          </span>
                          <h3>{r.title}</h3>
                          <div className="room-meta">
                            <span>
                              <Users size={13} />
                              {r.membersCount} / {r.maxPlayers}
                            </span>
                            <span>
                              <Clock3 size={13} />
                              {new Date(r.created).toLocaleDateString('ru-RU', {
                                day: 'numeric',
                                month: 'short',
                              })}
                            </span>
                          </div>
                          <button
                            className="primary full-width room-join-btn"
                            disabled={isFull || isClosed}
                            onClick={() => {
                              location.href = '/room/' + r.id;
                            }}
                          >
                            {isFull
                              ? 'Заполнена'
                              : isClosed
                                ? 'Закрыта'
                                : 'Присоединиться'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    className="new-room-card"
                    onClick={() => setCreate(true)}
                  >
                    <span className="create-circle">
                      <Plus />
                    </span>
                    <h3>Создать публичную комнату</h3>
                    <p>Соберите команду для ретроспективы</p>
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="section-heading">
                <h2>
                  Мои комнаты ретроспектив <span className="count">{rooms.length}</span>
                </h2>
                <div className="search-box">
                  <Search size={16} />
                  <input
                    aria-label="Поиск комнат"
                    placeholder="Найти комнату"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="lobby-filters">
                <Tabs value={filter} onValueChange={(v) => setFilter(String(v))}>
                  <TabsList>
                    <TabsTrigger value="active">Активные</TabsTrigger>
                    <TabsTrigger value="archive">Завершённые</TabsTrigger>
                    <TabsTrigger value="all">Все комнаты</TabsTrigger>
                  </TabsList>
                </Tabs>
                <button className="text-button" onClick={() => setJoin(true)}>
                  <Link2 size={15} /> Войти по ссылке
                </button>
              </div>
              {error && (
                <p role="alert" className="error-banner">
                  {error}{' '}
                  <button onClick={() => location.reload()}>Повторить</button>
                </p>
              )}
              {loading ? (
                <div className="loading-state">Подключаем ваши комнаты…</div>
              ) : (
                <div className="room-grid">
                  {shown.map((r) => {
                    const t = THEMES.find((th) => th.id === r.theme) || THEMES[0];
                    return (
                      <a
                        href={'/room/' + r.id}
                        key={r.id}
                        className="room-card"
                        aria-label={r.title}
                      >
                        <div
                          className="room-cover"
                          style={{ background: t.color + '55' }}
                        >
                          <span className="room-theme-emoji">{t.icon}</span>
                          <span className="room-format">
                            <Gamepad2 size={14} />
                            3D + Доска
                          </span>
                          <span className="room-status">
                            {r.archived ? 'Завершена' : PHASES[r.phase]}
                          </span>
                        </div>
                        <div className="room-card-body">
                          <span className="eyebrow">{t.name}</span>
                          <h3>{r.title}</h3>
                          <div className="room-meta">
                            <span>
                              <Clock3 size={13} />
                              {new Date(r.created).toLocaleDateString('ru-RU', {
                                day: 'numeric',
                                month: 'short',
                              })}
                            </span>
                            <span>{r.notes} идей</span>
                            <ChevronRight size={17} />
                          </div>
                        </div>
                      </a>
                    );
                  })}
                  <button
                    className="new-room-card"
                    onClick={() => setCreate(true)}
                  >
                    <span className="create-circle">
                      <Plus />
                    </span>
                    <h3>Новая история команды</h3>
                    <p>Создайте комнату и пригласите коллег</p>
                  </button>
                </div>
              )}
            </>
          )}

          <div className="lobby-foot">
            <span>
              <Link2 size={16} /> По ссылке — вместе, из любой точки
            </span>
            <span>
              <Settings2 size={16} /> Лёгкий 3D-мир и общая доска
            </span>
          </div>
        </section>
      </div>
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent className="app-dialog">
          <DialogTitle>Соберёмся на ретро?</DialogTitle>
          <DialogDescription>
            Создайте отдельную комнату для этой встречи.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createRoom();
            }}
          >
            <label className="field">
              Название комнаты
              <input
                required
                maxLength={100}
                placeholder="Команда продукта · Спринт 24"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              Ваше имя
              <input
                required
                maxLength={40}
                placeholder="Как вас зовут?"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <div className="field">
              <span className="field-label">Доступ к комнате</span>
              <div className="access-choice-cards">
                <button
                  type="button"
                  className={`access-choice-card ${accessType === 'public' ? 'selected' : ''}`}
                  onClick={() => setAccessType('public')}
                >
                  <div className="access-choice-head">
                    <Globe size={18} />
                    <strong>Публичная</strong>
                  </div>
                  <small>Отображается в общем списке. Любой может присоединиться.</small>
                </button>
                <button
                  type="button"
                  className={`access-choice-card ${accessType === 'private' ? 'selected' : ''}`}
                  onClick={() => setAccessType('private')}
                >
                  <div className="access-choice-head">
                    <Lock size={18} />
                    <strong>Приватная</strong>
                  </div>
                  <small>Скрыта из общего списка. Вход только по ссылке с подтверждением ведущего.</small>
                </button>
              </div>
            </div>

            <Choice
              label="Вместимость комнаты"
              value={String(maxPlayers)}
              onChange={(v) => setMaxPlayers(Number(v))}
              options={[
                { value: '4', label: '4 игрока' },
                { value: '8', label: '8 игроков (стандарт)' },
                { value: '12', label: '12 игроков' },
                { value: '16', label: '16 игроков' },
                { value: '24', label: '24 игрока' },
              ]}
            />

            <Choice
              label="Формат ретроспективы"
              value={template}
              onChange={setTemplate}
              options={[
                { value: 'four', label: 'Good / Bad / Start / Stop' },
                { value: 'three', label: 'Start / Stop / Continue' },
              ]}
            />
            <StylePicker value={visualStyle} onChange={setVisualStyle} />
            <span className="field">Выберите мир</span>
            <div className="theme-grid">
              {THEMES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={`theme-card ${theme === t.id ? 'selected' : ''}`}
                  onClick={() => setTheme(t.id)}
                >
                  <span>{t.icon}</span>
                  <strong>{t.name}</strong>
                  <small>{t.subtitle}</small>
                </button>
              ))}
            </div>
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary full-width"
              type="submit"
              disabled={busy}
            >
              {busy ? 'Создаём пространство…' : 'Создать комнату'}{' '}
              <ArrowUpRight size={17} />
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={join} onOpenChange={setJoin}>
        <DialogContent className="app-dialog">
          <DialogTitle>Присоединиться к встрече</DialogTitle>
          <DialogDescription>
            Попросите ведущего поделиться ссылкой на комнату.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              joinRoom();
            }}
          >
            <label className="field">
              Ссылка или код комнаты
              <input
                required
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Ссылка на комнату"
              />
            </label>
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <button className="primary full-width">Войти в комнату</button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="app-dialog">
          <DialogTitle>Ретро, в котором хочется участвовать</DialogTitle>
          <DialogDescription>
            Создайте комнату, поделитесь ссылкой и выберите удобный режим.
          </DialogDescription>
          <div className="help-copy">
            <p>
              <b>В 3D:</b> нажмите «Играть». WASD — движение, пробел — прыжок, C
              — сесть, дважды C — лечь. Ctrl — присесть, Shift — медленный шаг.
              Мышь вращает камеру.
            </p>
            <p>
              <b>Инструменты:</b> 1–3 и колесо меняют предмет в руках. Q, I или
              средняя кнопка открывают снаряжение. Выбор — кликом. Подойдите к
              доске и нажмите E.
            </p>
            <p>
              <b>Встреча:</b> ведущий переключает этапы, запускает таймер и
              голосования. Каждый участник раскрывает свои приватные заметки
              самостоятельно.
            </p>
            <p>
              <b>Tab:</b> участники, задержка, FPS. Esc возвращает курсор.
              Обычная доска доступна даже без WebGL.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
