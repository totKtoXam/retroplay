'use client';
/* oxlint-disable next/no-html-link-for-pages -- Полная навигация обходит ошибку RSC prefetch в production-сборке vinext. */
import { useState, useEffect, useMemo } from 'react';

import {
  Plus,
  ArrowUpRight,
  LayoutGrid,
  Link2,
  Clock3,
  Search,
  BookOpen,
  Settings2,
  Globe,
  Lock,
  NotebookPen,
  Swords,
  Users,
  UserRound,
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
import { defaultMapFor, mapsForMode, MODES, type GameMode } from '@/lib/maps/catalog';
import { Choice } from './controls';
import { AccountButton, AuthDialog } from './auth-panel';
import { useAuth } from '../hooks/use-auth';
import { StylePicker } from './style-picker';
import { ResourcePackPicker } from './resource-pack-picker';
import { ThemeToggle } from './theme-toggle';
import { syncSettingsNow } from './settings-sync';
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
/** Комната в едином списке: свои и публичные слиты по id, `mine` помечает свои. */
type RoomItem = {
  id: string;
  title: string;
  theme: string;
  archived: boolean;
  phase: number;
  created: number;
  mine: boolean;
  notes: number | null;
  hostName: string | null;
  membersCount: number | null;
  maxPlayers: number | null;
  status: PublicSummary['status'] | null;
};
/** Единственный фильтр списка: заменяет прежнюю пару «вкладка + фильтр». */
type RoomFilter = 'all' | 'mine' | 'active' | 'archive';
const FILTERS: { value: RoomFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'mine', label: 'Мои' },
  { value: 'active', label: 'Активные' },
  { value: 'archive', label: 'Завершённые' },
];
const STATUS_LABELS: Record<PublicSummary['status'], string> = {
  available: 'Доступна',
  full: 'Заполнена',
  in_progress: 'Идёт ретро',
  closed: 'Закрыта',
};
/**
 * Читает и стирает из адреса сообщение о возврате: подтверждение почты
 * (`?verified=`) и ошибку входа через Google (`?auth=`).
 */
function takeAuthNotice() {
  const params = new URLSearchParams(location.search);
  const verified = params.get('verified');
  const message =
    params.get('auth') ||
    (verified === '1'
      ? 'Почта подтверждена — теперь пароль можно восстановить по ней.'
      : verified === 'expired'
        ? 'Ссылка подтверждения устарела. Запросите новое письмо в аккаунте.'
        : verified === 'error'
          ? 'Не удалось подтвердить почту. Попробуйте ещё раз.'
          : '');
  if (!message) return '';
  params.delete('verified');
  params.delete('auth');
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? '?' + query : ''));
  return message;
}

export default function Lobby() {
  const resourcePack = useResourcePack();
  const auth = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  // Ключ меняется при каждом открытии: диалог пересоздаётся с чистой формой,
  // но при закрытии остаётся смонтированным и успевает доиграть анимацию.
  const [authKey, setAuthKey] = useState(0);
  const [authNotice, setAuthNotice] = useState('');
  const [packsOpen, setPacksOpen] = useState(false);
  const [create, setCreate] = useState(false),
    [name, setName] = useState(''),
    [title, setTitle] = useState(''),
    [theme, setTheme] = useState('nauryz'),
    [visualStyle, setVisualStyle] = useState('classic'),
    [template, setTemplate] = useState('four'),
    [gameMode, setGameMode] = useState<GameMode>('retro'),
    [map, setMap] = useState('hub'),
    [accessType, setAccessType] = useState<RoomAccessType>('public'),
    [maxPlayers, setMaxPlayers] = useState(8),
    [rooms, setRooms] = useState<Summary[]>([]),
    [publicRooms, setPublicRooms] = useState<PublicSummary[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState<RoomFilter>('all'),
    [join, setJoin] = useState(false),
    [joinCode, setJoinCode] = useState(''),
    [help, setHelp] = useState(false);

  const openAuth = () => {
    setAuthKey((key) => key + 1);
    setAuthOpen(true);
  };

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

  /**
   * Сообщения возвратов: подтверждение почты и ошибки входа через Google
   * приходят параметром адреса. Параметр сразу убирается, чтобы перезагрузка
   * страницы не показывала то же сообщение снова.
   */
  useEffect(() => {
    void Promise.resolve().then(() => setAuthNotice(takeAuthNotice()));
  }, []);

  useEffect(() => {
    void ready()
      .then(loadRooms)
      .catch((e) => {
        setError((e as Error).message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) {
        void api<{ rooms: PublicSummary[] }>('/api/rooms?browse=public')
          .then((r) => setPublicRooms(r.rooms || []))
          .catch(() => {});
        void api<{ rooms: Summary[] }>('/api/rooms')
          .then((r) => setRooms(r.rooms || []))
          .catch(() => {});
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

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
          mode: gameMode,
          map,
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
  // Один список: публичные и свои комнаты сливаются по id, свои получают флаг mine.
  const allRooms = useMemo<RoomItem[]>(() => {
    const byId = new Map<string, RoomItem>();
    for (const r of publicRooms)
      byId.set(r.id, {
        id: r.id,
        title: r.title,
        theme: r.theme,
        archived: r.archived,
        phase: r.phase,
        created: r.created,
        mine: false,
        notes: null,
        hostName: r.hostName,
        membersCount: r.membersCount,
        maxPlayers: r.maxPlayers,
        status: r.status,
      });
    for (const r of rooms) {
      const prev = byId.get(r.id);
      byId.set(r.id, {
        id: r.id,
        title: r.title,
        theme: r.theme,
        archived: r.archived,
        phase: r.phase,
        created: r.created,
        mine: true,
        notes: r.notes,
        hostName: prev?.hostName ?? null,
        membersCount: prev?.membersCount ?? null,
        maxPlayers: prev?.maxPlayers ?? null,
        status: prev?.status ?? null,
      });
    }
    return [...byId.values()].sort((a, b) => b.created - a.created);
  }, [rooms, publicRooms]);
  const shown = allRooms.filter(
    (r) =>
      r.title.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'all'
        ? true
        : filter === 'mine'
          ? r.mine
          : filter === 'archive'
            ? r.archived
            : !r.archived),
  );
  return (
    <main className="lobby" data-resource-pack={resourcePack}>
      <AuthDialog
        key={authKey}
        open={authOpen}
        onOpenChange={setAuthOpen}
        defaultName={name}
        user={auth.user}
        google={auth.google}
        mail={auth.mail}
        onChanged={async () => {
          await auth.refresh();
          // Вошли или вышли: подтянуть настройки аккаунта на это устройство.
          void syncSettingsNow();
          await loadRooms();
        }}
      />
      <Dialog open={packsOpen} onOpenChange={setPacksOpen}><DialogContent><DialogTitle>Визуальный пакет</DialogTitle><DialogDescription>Выберите оформление игры на этом устройстве.</DialogDescription><ResourcePackPicker /></DialogContent></Dialog>
      <header className="main-header">
        <a className="brand" href="/">
          <span className="brand-symbol">Ж</span>jinaly
          <span className="brand-suffix">RETRO WORLD</span>
        </a>
        <div className="header-actions">
          {!auth.user && name && (
            <span className="header-player" title="Ваше имя">
              {name}
            </span>
          )}
          <AccountButton
            user={auth.user}
            loading={auth.loading}
            onClick={openAuth}
          />
          <ThemeToggle />
        </div>
      </header>
      <div className="lobby-body">
        <nav className="side-nav" aria-label="Главное меню">
          <button className="nav-active" type="button" aria-current="page">
            <LayoutGrid size={18} /> Комнаты
          </button>
          <button type="button" onClick={() => setJoin(true)}>
            <Link2 size={18} /> Войти по ссылке
          </button>
          <button type="button" onClick={() => setHelp(true)}>
            <BookOpen size={18} /> Как играть
          </button>
          <button type="button" onClick={() => setPacksOpen(true)}>
            <Settings2 size={18} /> Визуальный пакет
          </button>
          <button type="button" onClick={openAuth}>
            <UserRound size={18} /> {auth.user ? 'Аккаунт' : 'Вход и регистрация'}
          </button>
          <div className="nav-bottom">
            <span className="version-tag">JINALY · EARLY ACCESS</span>
          </div>
        </nav>
        <section className="lobby-main">
          <div className="page-heading">
            <div>
              <h1>Комнаты</h1>
              <p className="muted">
                Зайдите в открытую комнату или создайте свою.
              </p>
            </div>
            <button className="primary" onClick={() => setCreate(true)}>
              <Plus size={18} />
              Создать комнату
            </button>
          </div>

          <div className="section-heading">
            <h2>
              Список комнат <span className="count">{shown.length}</span>
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
            <Tabs
              value={filter}
              onValueChange={(v) => setFilter(String(v) as RoomFilter)}
            >
              <TabsList aria-label="Фильтр комнат">
                {FILTERS.map((f) => (
                  <TabsTrigger key={f.value} value={f.value}>
                    {f.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <button className="text-button" onClick={() => setJoin(true)}>
              <Link2 size={15} /> Войти по ссылке
            </button>
          </div>

          {authNotice && (
            <p className="auth-notice lobby-auth-notice">
              {authNotice}{' '}
              <button className="text-button" onClick={() => setAuthNotice('')}>
                Скрыть
              </button>
            </p>
          )}

          {error && (
            <p role="alert" className="error-banner">
              {error} <button onClick={() => location.reload()}>Повторить</button>
            </p>
          )}

          {loading ? (
            <div className="loading-state">Загружаем список комнат…</div>
          ) : shown.length === 0 ? (
            <div className="empty-rooms-state">
              <Globe size={48} className="empty-icon" />
              <h3>Комнат пока нет</h3>
              <p>
                Создайте комнату или подключитесь к приватной по
                ссылке-приглашению.
              </p>
              <button className="primary" onClick={() => setCreate(true)}>
                <Plus size={18} /> Создать комнату
              </button>
            </div>
          ) : (
            <div className="room-grid">
              {shown.map((r) => {
                const t = THEMES.find((th) => th.id === r.theme) || THEMES[0];
                const isPublic = r.status !== null;
                const blocked =
                  !r.mine && (r.status === 'full' || r.status === 'closed');
                const statusLabel = r.mine
                  ? r.archived
                    ? 'Завершена'
                    : PHASES[r.phase]
                  : STATUS_LABELS[r.status ?? 'available'];
                return (
                  <article key={r.id} className="room-card">
                    <div
                      className="room-cover"
                      style={{ background: t.color + '55' }}
                    >
                      <span className="room-theme-emoji">{t.icon}</span>
                      <span className="room-format">
                        {isPublic ? <Globe size={13} /> : <Lock size={13} />}
                        {isPublic ? 'Публичная' : 'Приватная'}
                      </span>
                      <span
                        className={
                          r.status ? `room-status status-${r.status}` : 'room-status'
                        }
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <div className="room-card-body">
                      <span className="eyebrow">
                        {t.name}
                        {r.hostName ? ` · Ведущий: ${r.hostName}` : ''}
                      </span>
                      <h3>{r.title}</h3>
                      {r.mine && (
                        <span className="room-card-badge">Вы участник</span>
                      )}
                      <div className="room-meta">
                        {r.membersCount !== null && r.maxPlayers !== null && (
                          <span>
                            <Users size={13} />
                            {r.membersCount} / {r.maxPlayers}
                          </span>
                        )}
                        {r.mine && r.notes !== null && (
                          <span>
                            <NotebookPen size={13} />
                            {r.notes} идей
                          </span>
                        )}
                        <span>
                          <Clock3 size={13} />
                          {new Date(r.created).toLocaleDateString('ru-RU', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                      </div>
                      {r.mine ? (
                        <a
                          className="primary full-width room-join-btn"
                          href={'/room/' + r.id}
                          aria-label={'Войти в комнату ' + r.title}
                        >
                          Войти в комнату
                        </a>
                      ) : (
                        <button
                          className="primary full-width room-join-btn"
                          disabled={blocked}
                          aria-label={'Присоединиться к комнате ' + r.title}
                          onClick={() => {
                            location.href = '/room/' + r.id;
                          }}
                        >
                          {r.status === 'full'
                            ? 'Заполнена'
                            : r.status === 'closed'
                              ? 'Закрыта'
                              : 'Присоединиться'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent className="app-dialog">
          <DialogTitle>
            {gameMode === 'battle' ? 'Готовы к бою?' : 'Соберёмся на ретро?'}
          </DialogTitle>
          <DialogDescription>
            {gameMode === 'battle'
              ? 'Выберите карту и позовите команду на матч.'
              : 'Создайте отдельную комнату для этой встречи.'}
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createRoom();
            }}
          >
            <div className="field">
              <span className="field-label">Режим игры</span>
              <div className="access-choice-cards access-choice-cards-lg">
                {MODES.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    className={`access-choice-card ${gameMode === m.id ? 'selected' : ''}`}
                    aria-pressed={gameMode === m.id}
                    onClick={() => {
                      setGameMode(m.id);
                      setMap(defaultMapFor(m.id));
                    }}
                  >
                    <div className="access-choice-head">
                      {m.id === 'battle' ? <Swords size={22} /> : <NotebookPen size={22} />}
                      <strong>{m.title}</strong>
                    </div>
                    <small>{m.hint}</small>
                  </button>
                ))}
              </div>
            </div>

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

            {mapsForMode(gameMode).length > 1 && (
              <Choice
                label="Карта"
                value={map}
                onChange={setMap}
                options={mapsForMode(gameMode).map((m) => ({
                  value: m.id,
                  label: m.title,
                }))}
              />
            )}

            <details className="access-choice-advanced">
              <summary>Дополнительно</summary>

              <div className="field">
                <span className="field-label">Доступ к комнате</span>
                <div className="access-choice-cards">
                  <button
                    type="button"
                    className={`access-choice-card ${accessType === 'public' ? 'selected' : ''}`}
                    aria-pressed={accessType === 'public'}
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
                    aria-pressed={accessType === 'private'}
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

              {gameMode === 'retro' && (
                <Choice
                  label="Формат ретроспективы"
                  value={template}
                  onChange={setTemplate}
                  options={[
                    { value: 'four', label: 'Good / Bad / Start / Stop' },
                    { value: 'three', label: 'Start / Stop / Continue' },
                  ]}
                />
              )}
              <StylePicker value={visualStyle} onChange={setVisualStyle} />
              <span className="field">Выберите мир</span>
              <div className="theme-grid">
                {THEMES.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className={`theme-card ${theme === t.id ? 'selected' : ''}`}
                    aria-pressed={theme === t.id}
                    onClick={() => setTheme(t.id)}
                  >
                    <span>{t.icon}</span>
                    <strong>{t.name}</strong>
                    <small>{t.subtitle}</small>
                  </button>
                ))}
              </div>
            </details>

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
              {busy
                ? 'Создаём пространство…'
                : gameMode === 'battle'
                  ? 'Начать бой'
                  : 'Собрать команду'}{' '}
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
