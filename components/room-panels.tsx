'use client';

import {
  ChevronRight,
  Copy,
  Download,
  Pause,
  Play,
  RotateCcw,
  Vote,
} from 'lucide-react';
import {
  voteCount,
  type Note,
  type RoomAccess,
  type RoomState,
  type Round,
} from '@/lib/model';
import { Choice } from './controls';

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
