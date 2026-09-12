'use client';

import {
  Bell,
  Check,
  ChevronRight,
  Copy,
  Dices,
  Download,
  Flag,
  Folder,
  MousePointer2,
  PartyPopper,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Smile,
  Vote,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  THEMES,
  TOOL_HINTS,
  voteCount,
  type Note,
  type Person,
  type RoomAccess,
  type RoomAccessType,
  type RoomState,
  type Round,
} from '@/lib/model';
import { Choice, Toggle } from './controls';
import { StylePicker } from './style-picker';
import { ResourcePackPicker } from './resource-pack-picker';
import { type WeaponAimModes } from './world';
import { AVATAR_SKINS, PRESET_BANDANA_COLORS } from './world-skins';

export function HelpPanel() {
  return (
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
  );
}

export function ExportPanel({
  host,
  onExport,
  onImport,
}: {
  host: boolean;
  onExport: (format: string) => void;
  onImport: (file: File) => void;
}) {
  return (
    <>
      <div className="export-options">
        {[
          ['json', 'JSON', 'Карточки, темы и раунды голосования'],
          ['csv', 'CSV', 'Таблица для Excel и других приложений'],
          ['md', 'Markdown', 'Итоги ретроспективы текстом'],
        ].map(([format, label, sub]) => (
          <button key={format} onClick={() => onExport(format)}>
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
                onImport(e.target.files[0]);
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
  );
}

export function SharePanel({
  roomId,
  access,
  host,
  onCopyLink,
  onRegenerateInvite,
}: {
  roomId: string;
  access: RoomAccess | undefined;
  host: boolean;
  onCopyLink: () => void;
  onRegenerateInvite: () => Promise<void>;
}) {
  return (
    <>
      <label className="field">
        Ссылка на комнату
        <input
          readOnly
          value={
            typeof location !== 'undefined'
              ? location.origin +
                '/room/' +
                roomId +
                (access?.type === 'private' && access.inviteToken
                  ? '?invite=' + access.inviteToken
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
          onClick={() => onCopyLink()}
        >
          <Copy size={16} />
          Скопировать ссылку
        </button>
        {host && access?.type === 'private' && (
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              if (
                confirm(
                  'Создать новую ссылку-приглашение? Старая ссылка перестанет действовать.',
                )
              ) {
                await onRegenerateInvite();
              }
            }}
          >
            <RotateCcw size={16} />
            Обновить ссылку
          </button>
        )}
      </div>
      <div className="share-access-info">
        <span className={`access-badge ${access?.type || 'public'}`}>
          {access?.type === 'private'
            ? '🔒 Приватная комната'
            : '🌐 Публичная комната'}
        </span>
        <p className="muted">
          {access?.type === 'private'
            ? 'Вход только по ссылке-приглашению с подтверждением ведущего. Комната скрыта из общего списка комнат.'
            : 'Комната отображается в общем списке комнат. Любой пользователь может присоединиться свободно.'}
        </p>
      </div>
    </>
  );
}

export function HistoryPanel({
  history,
  onUndo,
}: {
  history: { version: number; action: string; name: string; at: number }[];
  onUndo: () => void;
}) {
  return (
    <>
      <p className="muted">
        Последние 40 изменений. Отмена доступна только для вашего
        последнего действия, пока другие участники не внесли изменения.
      </p>
      <button
        className="secondary"
        onClick={() => onUndo()}
      >
        <RotateCcw size={16} />
        Отменить последнее действие
      </button>
      <div className="history-list">
        {history.map((h, idx) => (
          <div key={`${h.version}-${idx}`}>
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
  );
}

export function TimerPanel({
  timeText,
  seconds,
  onSecondsChange,
  host,
  timer,
  onTimer,
}: {
  timeText: string;
  seconds: string;
  onSecondsChange: (value: string) => void;
  host: boolean;
  timer: { running: boolean; remaining: number };
  onTimer: (action: 'start' | 'pause' | 'reset', seconds?: number) => void;
}) {
  return (
    <>
      <div className="large-timer">{timeText}</div>
      <Choice
        label="Продолжительность"
        value={seconds}
        onChange={onSecondsChange}
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
            onTimer(
              timer.running ? 'pause' : 'start',
              timer.running ? undefined : Number(seconds),
            )
          }
        >
          {timer.running ? <Pause size={17} /> : <Play size={17} />}{' '}
          {timer.running ? 'Пауза' : 'Запустить'}
        </button>
        <button
          disabled={!host}
          className="secondary"
          onClick={() => onTimer('start', timer.remaining)}
        >
          Продолжить
        </button>
        <button
          disabled={!host}
          className="secondary"
          onClick={() => onTimer('reset', Number(seconds))}
        >
          <RotateCcw size={16} />
          Сброс
        </button>
      </div>
      {!host && <p className="muted">Таймером управляет ведущий.</p>}
    </>
  );
}

export function VotePanel({
  round,
  used,
  host,
  voteLimit,
  onVoteLimitChange,
  onStartVote,
  onEndVote,
  s,
  onOpenNote,
}: {
  round: Round | undefined;
  used: number;
  host: boolean;
  voteLimit: string;
  onVoteLimitChange: (value: string) => void;
  onStartVote: () => void;
  onEndVote: () => void;
  s: RoomState;
  onOpenNote: (note: Note) => void;
}) {
  return (
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
              onChange={(e) => onVoteLimitChange(e.target.value)}
            />
          </label>
          <button
            className="primary"
            onClick={() => onStartVote()}
          >
            <Vote size={17} />
            Начать раунд
          </button>
        </>
      )}
      {host && round?.active && (
        <button
          className="primary"
          onClick={() => onEndVote()}
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
              onClick={() => onOpenNote(n)}
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
  );
}

export function ToolsPanel({
  activeTools,
  activeIcons,
  tool,
  onSelectTool,
  onOpenWidgets,
  onOpenHelp,
}: {
  activeTools: { id: string; label: string; key: string }[];
  activeIcons: LucideIcon[];
  tool: number;
  onSelectTool: (index: number) => void;
  onOpenWidgets: () => void;
  onOpenHelp: () => void;
}) {
  return (
    <>
      <div className="tool-library">
        {activeTools.map((t, i) => {
          const Icon = activeIcons[i] || MousePointer2;
          return (
            <button
              key={t.id}
              className={tool === i ? 'selected' : ''}
              onClick={() => onSelectTool(i)}
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
          onClick={() => onOpenWidgets()}
        >
          Игры для команды
        </button>
        <button className="secondary" onClick={() => onOpenHelp()}>
          Управление
        </button>
      </div>
    </>
  );
}

export function JoinRequestsPanel({
  joinRequests,
  onAccept,
  onReject,
}: {
  joinRequests: {
    id: string;
    name: string;
    created: number;
  }[];
  onAccept: (req: { id: string; name: string }) => Promise<void>;
  onReject: (req: { id: string; name: string }) => Promise<void>;
}) {
  return (
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
                    await onAccept(req);
                  }}
                >
                  <Check size={16} /> Принять
                </button>
                <button
                  type="button"
                  className="btn-reject"
                  onClick={async () => {
                    await onReject(req);
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
  );
}

export function GroupPanel({
  groupTitle,
  onGroupTitleChange,
  onAddGroup,
  s,
  host,
  onDeleteGroup,
}: {
  groupTitle: string;
  onGroupTitleChange: (value: string) => void;
  onAddGroup: () => void;
  s: RoomState;
  host: boolean;
  onDeleteGroup: (id: string) => void;
}) {
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAddGroup();
        }}
      >
        <label className="field">
          Название темы
          <input
            required
            maxLength={80}
            value={groupTitle}
            onChange={(e) => onGroupTitleChange(e.target.value)}
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
                onClick={() => onDeleteGroup(g.id)}
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
  );
}

export function ActionsPanel({
  s,
  onAddAction,
  onOpenNote,
}: {
  s: RoomState;
  onAddAction: () => void;
  onOpenNote: (note: Note) => void;
}) {
  return (
    <>
      <button
        className="primary"
        onClick={() => onAddAction()}
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
              onClick={() => onOpenNote(n)}
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
  );
}

export function WorldPanel({
  s,
  host,
  onStyleChange,
  onThemeChange,
  onTimeChange,
  onSeasonChange,
  onInteriorChange,
  onRespawnSecondsChange,
  maps,
  onMapChange,
}: {
  s: RoomState;
  host: boolean;
  maps: { id: string; title: string }[];
  onMapChange: (map: string) => void;
  onStyleChange: (visualStyle: string) => void;
  onThemeChange: (theme: string, season: string) => void;
  onTimeChange: (time: string) => void;
  onSeasonChange: (season: string) => void;
  onInteriorChange: (interior: boolean) => void;
  onRespawnSecondsChange: (respawnSeconds: number) => void;
}) {
  return (
    <>
      <Choice
        label="Карта"
        value={s.map ?? 'hub'}
        disabled={!host}
        onChange={onMapChange}
        options={maps.map((m) => ({ value: m.id, label: m.title }))}
      />
      <StylePicker
        value={s.visualStyle || 'classic'}
        disabled={!host}
        onChange={onStyleChange}
      />
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            disabled={!host}
            className={`theme-card ${s.theme === t.id ? 'selected' : ''}`}
            onClick={() => onThemeChange(t.id, t.season)}
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
          onChange={onTimeChange}
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
          onChange={onSeasonChange}
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
        onChange={onInteriorChange}
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
              onRespawnSecondsChange(value);
            else e.target.value = String(s.respawnSeconds ?? 5);
          }}
        />
      </label>
    </>
  );
}

export function FpsPanel({
  fps,
  me,
  fpsLimit,
  onFpsLimitChange,
  quality,
  onQualityChange,
  sensitivity,
  onSensitivityChange,
  invertCamera,
  onInvertCameraChange,
  aimModes,
  onAimModesChange,
}: {
  fps: number;
  me: Person | undefined;
  fpsLimit: number;
  onFpsLimitChange: (value: string) => void;
  quality: string;
  onQualityChange: (quality: string) => void;
  sensitivity: number;
  onSensitivityChange: (sensitivity: number) => void;
  invertCamera: boolean;
  onInvertCameraChange: (invertCamera: boolean) => void;
  aimModes: WeaponAimModes;
  onAimModesChange: (modes: WeaponAimModes) => void;
}) {
  return (
    <>
      <ResourcePackPicker />
      <p className="performance-summary">
        {fps} FPS · {me?.ping || 0} мс
      </p>
      <Choice
        label="Лимит FPS"
        value={String(fpsLimit)}
        onChange={onFpsLimitChange}
        options={[20, 30, 60].map((v) => ({
          value: String(v),
          label: `${v} FPS`,
        }))}
      />
      <Choice
        label="Качество шейдеров и графики"
        value={quality === 'high' ? 'cinematic' : quality}
        onChange={onQualityChange}
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
            onSensitivityChange(v);
          }}
        />
      </label>
      <Toggle
        label="Инвертировать вертикальную камеру"
        value={invertCamera}
        onChange={onInvertCameraChange}
      />
      <div className="aim-settings-section">
        <span className="field-label">Прицеливание (ПКМ)</span>
        <div className="aim-settings-list">
          {[
            { id: 'paint', name: '🎨 Краскострел' },
            { id: 'confetti', name: '💥 Дробовик' },
            { id: 'sniper', name: '🎯 Снайперка' },
          ].map((w) => (
            <div key={w.id} className="aim-setting-row">
              <span className="aim-weapon-name">{w.name}</span>
              <div className="aim-mode-pills">
                <button
                  type="button"
                  className={`aim-pill ${aimModes[w.id as keyof WeaponAimModes] === 'hold' ? 'active' : ''}`}
                  onClick={() => {
                    const next = { ...aimModes, [w.id]: 'hold' as const };
                    onAimModesChange(next);
                  }}
                >
                  Зажать
                </button>
                <button
                  type="button"
                  className={`aim-pill ${aimModes[w.id as keyof WeaponAimModes] === 'toggle' ? 'active' : ''}`}
                  onClick={() => {
                    const next = { ...aimModes, [w.id]: 'toggle' as const };
                    onAimModesChange(next);
                  }}
                >
                  Переключение
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function SettingsPanel({
  s,
  host,
  sound,
  onSoundChange,
  me,
  onAnonymousPlayersChange,
  onHidePlayerStatusChange,
  onPrivateWritingChange,
  onAnonymousChange,
  onLayoutLockedChange,
  onAccessTypeChange,
  onMaxPlayersChange,
  onUpdateName,
  onToggleArchive,
}: {
  s: RoomState;
  host: boolean;
  sound: boolean;
  onSoundChange: (sound: boolean) => void;
  me: Person | undefined;
  onAnonymousPlayersChange: (anonymousPlayers: boolean) => void;
  onHidePlayerStatusChange: (hidePlayerStatus: boolean) => void;
  onPrivateWritingChange: (privateWriting: boolean) => void;
  onAnonymousChange: (anonymous: boolean) => void;
  onLayoutLockedChange: (layoutLocked: boolean) => void;
  onAccessTypeChange: (accessType: RoomAccessType) => void;
  onMaxPlayersChange: (maxPlayers: number) => void;
  onUpdateName: (name: string) => void;
  onToggleArchive: () => void;
}) {
  return (
    <>
      <Toggle
        label="Анонимные участники"
        description="Пакеты со смайликом вместо лиц. Никнеймы скрыты."
        value={!!s.anonymousPlayers}
        disabled={!host}
        onChange={onAnonymousPlayersChange}
      />
      <Toggle
        label="Скрыть статус-бар игроков"
        description="Имя и HP над персонажем не отображаются — нельзя видеть через стены"
        value={!!s.hidePlayerStatus}
        disabled={!host}
        onChange={onHidePlayerStatusChange}
      />
      <Toggle
        label="Приватное написание"
        description="Каждый сам раскрывает свои новые заметки"
        value={s.privateWriting}
        disabled={!host}
        onChange={onPrivateWritingChange}
      />
      <Toggle
        label="Анонимные новые заметки"
        value={s.anonymous}
        disabled={!host}
        onChange={onAnonymousChange}
      />
      <Toggle
        label="Заблокировать макет"
        value={s.layoutLocked}
        disabled={!host}
        onChange={onLayoutLockedChange}
      />
      <Toggle label="Звуки встречи" value={sound} onChange={onSoundChange} />
      {host && (
        <div className="settings-access-box">
          <span className="settings-subheading">Доступ к комнате</span>
          <div className="access-toggle-grid">
            <button
              type="button"
              className={`access-toggle-card ${s.access?.type === 'public' ? 'active' : ''}`}
              onClick={() => onAccessTypeChange('public')}
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
              onClick={() => onAccessTypeChange('private')}
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
              onChange={(e) => onMaxPlayersChange(Number(e.target.value))}
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
              onUpdateName(e.target.value);
            }
          }}
        />
      </label>
      {host && (
        <button
          className="secondary"
          onClick={() => onToggleArchive()}
        >
          <Check size={16} />
          {s.archived ? 'Открыть встречу снова' : 'Завершить встречу'}
        </button>
      )}
    </>
  );
}

export function WidgetsPanel({
  me,
  onMoodChange,
  selectedSkin,
  onSelectSkin,
  selectedBandanaColor,
  onBandanaColorChange,
  onConfetti,
  onHat,
  onBuzzer,
  onPing,
  s,
  onDecrementCounter,
  onIncrementCounter,
  spinOptions,
  onSpinOptionsChange,
  online,
  onSpin,
  spinner,
  sound,
  onSoundChange,
}: {
  me: Person | undefined;
  onMoodChange: (mood: string) => void;
  selectedSkin: string;
  onSelectSkin: (skinId: string) => void;
  selectedBandanaColor: string;
  onBandanaColorChange: (color: string) => void;
  onConfetti: () => void;
  onHat: () => void;
  onBuzzer: () => void;
  onPing: () => void;
  s: RoomState;
  onDecrementCounter: () => void;
  onIncrementCounter: () => void;
  spinOptions: string;
  onSpinOptionsChange: (value: string) => void;
  online: Person[];
  onSpin: (value: string) => void;
  spinner: string;
  sound: boolean;
  onSoundChange: (sound: boolean) => void;
}) {
  return (
    <>
      <p className="field">Как вы сегодня?</p>
      <div className="mood-picker">
        {['😊', '🤩', '😐', '😴', '😵‍💫'].map((mood) => (
          <button
            key={mood}
            className={me?.mood === mood ? 'selected' : ''}
            aria-label={'Настроение ' + mood}
            onClick={() => onMoodChange(mood)}
          >
            {mood}
          </button>
        ))}
      </div>
      {/* ====== Skin picker ====== */}
      <p className="field" style={{ marginTop: 18 }}>
        Выбор скина
      </p>
      <div className="skin-picker-grid">
        {AVATAR_SKINS.map((sk) => (
          <button
            key={sk.id}
            className={`skin-card ${selectedSkin === sk.id ? 'selected' : ''}`}
            title={sk.description}
            onClick={() => onSelectSkin(sk.id)}
          >
            <span className="skin-icon">{sk.icon}</span>
            <span className="skin-name">{sk.name}</span>
          </button>
        ))}
      </div>
      {/* ====== Bandana / accent color picker ====== */}
      <p className="field" style={{ marginTop: 14 }}>
        Цвет банданы / акцента
      </p>
      <div className="bandana-color-swatches">
        {PRESET_BANDANA_COLORS.map((c) => (
          <button
            key={c}
            className={`bandana-swatch ${selectedBandanaColor === c ? 'selected' : ''}`}
            style={{ background: c }}
            title={c}
            aria-label={'Цвет банданы ' + c}
            aria-pressed={selectedBandanaColor === c}
            onClick={() => onBandanaColorChange(c)}
          />
        ))}
        <input
          type="color"
          className="bandana-color-input"
          value={selectedBandanaColor}
          onChange={(e) => onBandanaColorChange(e.target.value)}
          title="Свой цвет"
        />
      </div>
      <div className="widget-grid">
        <button onClick={() => onConfetti()}>
          <PartyPopper />
          Конфетти
        </button>
        <button onClick={() => onHat()}>
          <Smile />
          Бросить шляпу
        </button>
        <button onClick={() => onBuzzer()}>
          <Bell />
          Звонок
        </button>
        <button onClick={() => onPing()}>
          <Flag />
          Внимание сюда
        </button>
      </div>
      <div className="counter-widget">
        <span>Счётчик</span>
        <button onClick={() => onDecrementCounter()}>−</button>
        <strong>{s.counter}</strong>
        <button onClick={() => onIncrementCounter()}>+</button>
      </div>
      <label className="field">
        Случайный выбор · варианты через запятую
        <input
          value={spinOptions}
          onChange={(e) => onSpinOptionsChange(e.target.value)}
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
            onSpin(options[randIndex]);
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
        onChange={onSoundChange}
      />
    </>
  );
}
