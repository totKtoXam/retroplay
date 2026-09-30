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
  SearchX,
  BookOpen,
  Settings2,
  Globe,
  Lock,
  Gamepad2,
  NotebookPen,
  Rocket,
  Swords,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { THEMES, type RoomAccessType } from '@/lib/model';
import { api, ready } from '@/lib/client';
import { plural } from '@/lib/plural';
import { defaultMapFor, mapsForMode, MODES, type GameMode } from '@/lib/maps/catalog';
import {
  filterRooms,
  mergeRooms,
  roomStatusLabel,
  type MyRoomSummary,
  type PublicRoomSummary,
  type RoomFilter,
} from '@/lib/lobby-rooms';
import { Choice } from './controls';
import { AccountButton, AuthDialog, type AuthMode } from './auth-panel';
import { KeysHelp } from './keys-help';
import { useAuth } from '../hooks/use-auth';
import { StylePicker } from './style-picker';
import { ResourcePackPicker } from './resource-pack-picker';
import { ThemeToggle } from './theme-toggle';
import { syncSettingsNow } from './settings-sync';
import { useResourcePack } from '../hooks/use-resource-pack';
/** Единственный фильтр списка: заменяет прежнюю пару «вкладка + фильтр». */
const FILTERS: { value: RoomFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'mine', label: 'Мои' },
  { value: 'active', label: 'Активные' },
  { value: 'archive', label: 'Завершённые' },
];
/**
 * Как режим выглядит в диалоге «Создать комнату». Режим без записи получает
 * нейтральные тексты из MODES и общую иконку — лобби не нужно учить каждый
 * новый режим отдельными условиями.
 */
const MODE_COPY: Partial<
  Record<GameMode, { icon: LucideIcon; title: string; hint: string; cta: string }>
> = {
  retro: {
    icon: NotebookPen,
    title: 'Соберёмся на ретро?',
    hint: 'Создайте отдельную комнату для этой встречи.',
    cta: 'Создать комнату',
  },
  battle: {
    icon: Swords,
    title: 'Готовы к бою?',
    hint: 'Выберите карту и позовите команду на матч.',
    cta: 'Начать бой',
  },
  impostor: {
    icon: Rocket,
    title: 'Кто из экипажа — предатель?',
    hint: 'Создайте комнату для партии: нужно от 4 до 15 игроков, боты тоже считаются.',
    cta: 'Создать партию',
  },
};
const modeCopy = (mode: GameMode) => {
  const info = MODES.find((m) => m.id === mode);
  return (
    MODE_COPY[mode] ?? {
      icon: Gamepad2,
      title: info ? `Новая комната: ${info.title}` : 'Новая комната',
      hint: info?.hint ?? 'Создайте комнату и позовите участников.',
      cta: 'Создать комнату',
    }
  );
};
function ModeIcon({ mode, size = 22 }: { mode: GameMode; size?: number }) {
  const Icon = modeCopy(mode).icon;
  return <Icon size={size} aria-hidden />;
}
/** Бейдж режима на карточке комнаты: иконка и название из MODES. */
function ModeBadge({ mode }: { mode: GameMode }) {
  const title = MODES.find((m) => m.id === mode)?.title ?? 'Игра';
  return (
    <span className={`room-mode-badge room-mode-${mode}`}>
      <ModeIcon mode={mode} size={13} />
      {title}
    </span>
  );
}
/**
 * Открыть диалог восстановления пароля можно ссылкой `/?forgot=1` — так ведёт
 * страница сброса, когда ссылка из письма устарела. Параметр сразу стирается.
 */
function takeForgotRequest() {
  const params = new URLSearchParams(location.search);
  if (!params.has('forgot')) return false;
  params.delete('forgot');
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? '?' + query : ''));
  return true;
}
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
  const [authMode, setAuthMode] = useState<AuthMode>('login');
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
    // Приватная по умолчанию: командное ретро не должно само попадать в общий список.
    [accessType, setAccessType] = useState<RoomAccessType>('private'),
    [maxPlayers, setMaxPlayers] = useState(8),
    [rooms, setRooms] = useState<MyRoomSummary[]>([]),
    [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    // У каждой области своя ошибка: ошибка входа по ссылке не всплывает в
    // диалоге создания, а ошибка создания — над списком комнат.
    [listError, setListError] = useState(''),
    [createError, setCreateError] = useState(''),
    [joinError, setJoinError] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState<RoomFilter>('all'),
    [join, setJoin] = useState(false),
    [joinCode, setJoinCode] = useState(''),
    [help, setHelp] = useState(false),
    [helpMode, setHelpMode] = useState<GameMode>('retro');

  const openAuth = (mode: AuthMode = 'login') => {
    setAuthMode(mode);
    setAuthKey((key) => key + 1);
    setAuthOpen(true);
  };

  const openCreate = () => {
    // Имя из аккаунта — если на этом устройстве имя ещё не задано.
    if (!name.trim() && auth.user?.name) setName(auth.user.name);
    setCreateError('');
    setCreate(true);
  };
  const setCreateOpen = (open: boolean) => {
    setCreate(open);
    if (!open) setCreateError('');
  };
  const setJoinOpen = (open: boolean) => {
    setJoin(open);
    if (!open) setJoinError('');
  };

  const loadRooms = async () => {
    try {
      const [myRes, pubRes] = await Promise.all([
        api<{ rooms: MyRoomSummary[] }>('/api/rooms'),
        api<{ rooms: PublicRoomSummary[] }>('/api/rooms?browse=public'),
      ]);
      setRooms(myRes.rooms || []);
      setPublicRooms(pubRes.rooms || []);
      setListError('');
      const stored = localStorage.getItem('jinaly-name');
      if (stored) setName((prev) => prev || stored);
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  /** Первая загрузка и «Повторить»: сначала сессия, затем список. */
  const startRooms = () =>
    ready()
      .then(loadRooms)
      .catch((e) => {
        setListError((e as Error).message);
        setLoading(false);
      });

  const retryRooms = () => {
    setListError('');
    setLoading(true);
    void startRooms();
  };

  /**
   * Сообщения возвратов: подтверждение почты и ошибки входа через Google
   * приходят параметром адреса. Параметр сразу убирается, чтобы перезагрузка
   * страницы не показывала то же сообщение снова.
   */
  useEffect(() => {
    void Promise.resolve().then(() => {
      setAuthNotice(takeAuthNotice());
      if (takeForgotRequest()) openAuth('forgot');
    });
  }, []);

  useEffect(() => {
    void startRooms();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) {
        void api<{ rooms: PublicRoomSummary[] }>('/api/rooms?browse=public')
          .then((r) => setPublicRooms(r.rooms || []))
          .catch(() => {});
        void api<{ rooms: MyRoomSummary[] }>('/api/rooms')
          .then((r) => setRooms(r.rooms || []))
          .catch(() => {});
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const createRoom = async () => {
    setBusy(true);
    setCreateError('');
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
      setCreateError((e as Error).message);
      setBusy(false);
    }
  };
  const joinRoom = () => {
    const trimmed = joinCode.trim();
    const match = trimmed.match(
      /(?:\/room\/)?([a-f0-9]{16})(?:\?invite=([a-f0-9-]+))?/i,
    );
    if (!match) {
      setJoinError('Вставьте ссылку или 16-значный код комнаты');
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
          // Как и в диалоге: новая комната по умолчанию не попадает в общий список.
          access: 'private',
        });
        location.href = '/room/' + r.id;
        return { id: r.id, created: true };
      },
    });
    return () => abort.abort();
  }, []);
  // Один список: публичные и свои комнаты сливаются по id, свои получают флаг mine.
  const allRooms = useMemo(() => mergeRooms(rooms, publicRooms), [rooms, publicRooms]);
  const shown = filterRooms(allRooms, query, filter);
  const filtered = query.trim() !== '' || filter !== 'all';
  const resetFilter = () => {
    setQuery('');
    setFilter('all');
  };
  // Ссылки второго ряда: на широком экране — в сайдбаре, на узком — полосой под шапкой.
  const secondaryNav = (
    <>
      <button type="button" onClick={() => setHelp(true)}>
        <BookOpen size={18} aria-hidden /> Как играть
      </button>
      <button type="button" onClick={() => setPacksOpen(true)}>
        <Settings2 size={18} aria-hidden /> Визуальный пакет
      </button>
    </>
  );
  return (
    <main className="lobby" data-resource-pack={resourcePack}>
      <AuthDialog
        key={authKey}
        open={authOpen}
        onOpenChange={setAuthOpen}
        initialMode={authMode}
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
            onClick={() => openAuth()}
          />
          <ThemeToggle />
        </div>
      </header>
      {/* На узком экране сайдбара нет: его пункты — полосой под шапкой. */}
      <nav className="lobby-mobile-nav" aria-label="Дополнительное меню">
        {secondaryNav}
      </nav>
      <div className="lobby-body">
        <nav className="side-nav" aria-label="Главное меню">
          <button className="nav-active" type="button" aria-current="page">
            <LayoutGrid size={18} aria-hidden /> Комнаты
          </button>
          {secondaryNav}
          <div className="nav-bottom">
            <span className="version-tag">JINALY · РАННИЙ ДОСТУП</span>
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
            <div className="lobby-heading-actions">
              <button className="primary" type="button" onClick={openCreate}>
                <Plus size={18} aria-hidden />
                Создать комнату
              </button>
              <button className="secondary" type="button" onClick={() => setJoin(true)}>
                <Link2 size={17} aria-hidden /> Войти по ссылке
              </button>
            </div>
          </div>

          <div className="section-heading">
            <h2>
              Список комнат <span className="count">{shown.length}</span>
            </h2>
            <div className="search-box">
              <Search size={16} aria-hidden />
              <input
                type="search"
                aria-label="Поиск комнат по названию"
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
          </div>

          {authNotice && (
            <p className="auth-notice lobby-auth-notice">
              {authNotice}{' '}
              <button className="text-button" onClick={() => setAuthNotice('')}>
                Скрыть
              </button>
            </p>
          )}

          {listError && !loading && (
            <p role="alert" className="error-banner">
              {listError}{' '}
              <button type="button" onClick={retryRooms}>
                Повторить
              </button>
            </p>
          )}

          {loading ? (
            <div className="loading-state">Загружаем список комнат…</div>
          ) : listError && allRooms.length === 0 ? null : shown.length === 0 &&
            filtered &&
            allRooms.length > 0 ? (
            <div className="empty-rooms-state">
              <SearchX size={48} className="empty-icon" aria-hidden />
              <h3>Ничего не найдено</h3>
              <p>
                {query.trim()
                  ? `Нет комнат с «${query.trim()}» в названии.`
                  : 'В этом разделе комнат нет.'}{' '}
                Попробуйте другой запрос или покажите все комнаты.
              </p>
              <button className="secondary" type="button" onClick={resetFilter}>
                Сбросить фильтр
              </button>
            </div>
          ) : shown.length === 0 ? (
            <div className="empty-rooms-state">
              <Globe size={48} className="empty-icon" aria-hidden />
              <h3>Комнат пока нет</h3>
              <p>
                Создайте комнату или подключитесь к приватной по
                ссылке-приглашению.
              </p>
              <button className="primary" type="button" onClick={openCreate}>
                <Plus size={18} aria-hidden /> Создать комнату
              </button>
            </div>
          ) : (
            <div className="room-grid">
              {shown.map((r) => {
                const t = THEMES.find((th) => th.id === r.theme) || THEMES[0];
                const isPublic = r.status !== null;
                const blocked =
                  !r.mine && (r.status === 'full' || r.status === 'closed');
                const statusLabel = roomStatusLabel(r);
                return (
                  <article key={r.id} className="room-card">
                    <div
                      className="room-cover"
                      style={{ background: t.color + '55' }}
                    >
                      <span className="room-theme-emoji">{t.icon}</span>
                      <span className="room-format">
                        {isPublic ? (
                          <Globe size={13} aria-hidden />
                        ) : (
                          <Lock size={13} aria-hidden />
                        )}
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
                      {(r.mode || r.mine) && (
                        <div className="room-card-tags">
                          {r.mode && <ModeBadge mode={r.mode} />}
                          {r.mine && (
                            <span className="room-card-badge">Вы участник</span>
                          )}
                        </div>
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
                            {plural(r.notes, ['идея', 'идеи', 'идей'])}
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
      <Dialog open={create} onOpenChange={setCreateOpen}>
        <DialogContent className="app-dialog">
          <DialogTitle>{modeCopy(gameMode).title}</DialogTitle>
          <DialogDescription>{modeCopy(gameMode).hint}</DialogDescription>
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
                      <ModeIcon mode={m.id} />
                      <strong>{m.title}</strong>
                    </div>
                    <small>{m.hint}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="field lobby-access-field">
              <span className="field-label">Кто может войти</span>
              <div className="access-choice-cards">
                <button
                  type="button"
                  className={`access-choice-card ${accessType === 'private' ? 'selected' : ''}`}
                  aria-pressed={accessType === 'private'}
                  onClick={() => setAccessType('private')}
                >
                  <div className="access-choice-head">
                    <Lock size={18} aria-hidden />
                    <strong>Приватная</strong>
                  </div>
                  <small>Только по ссылке-приглашению, вход подтверждает ведущий.</small>
                </button>
                <button
                  type="button"
                  className={`access-choice-card ${accessType === 'public' ? 'selected' : ''}`}
                  aria-pressed={accessType === 'public'}
                  onClick={() => setAccessType('public')}
                >
                  <div className="access-choice-head">
                    <Globe size={18} aria-hidden />
                    <strong>Публичная</strong>
                  </div>
                  <small>Видна в общем списке, войти может любой.</small>
                </button>
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

            {createError && (
              <p className="error-banner" role="alert">
                {createError}
              </p>
            )}
            <button
              className="primary full-width"
              type="submit"
              disabled={busy}
            >
              {busy ? 'Создаём комнату…' : modeCopy(gameMode).cta}{' '}
              <ArrowUpRight size={17} aria-hidden />
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={join} onOpenChange={setJoinOpen}>
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
                onChange={(e) => {
                  setJoinCode(e.target.value);
                  setJoinError('');
                }}
                placeholder="Ссылка на комнату"
              />
            </label>
            {joinError && (
              <p className="error-banner" role="alert">
                {joinError}
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
              <b>Встреча:</b> ведущий переключает этапы, запускает таймер и
              голосования. Каждый участник раскрывает свои приватные заметки
              самостоятельно. В 3D нажмите «Играть»; если браузер не умеет 3D,
              комната откроется обычной доской.
            </p>
          </div>
          <fieldset className="keys-help-modes">
            <legend className="sr-only">Клавиши для режима</legend>
            {MODES.map((m) => (
              <button
                type="button"
                key={m.id}
                aria-pressed={helpMode === m.id}
                onClick={() => setHelpMode(m.id)}
              >
                {m.title}
              </button>
            ))}
          </fieldset>
          <KeysHelp mode={helpMode} />
        </DialogContent>
      </Dialog>
    </main>
  );
}
