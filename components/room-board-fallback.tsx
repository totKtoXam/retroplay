'use client';
// Комната без WebGL: вместо 3D-мира — та же доска, что в планшете, на весь экран.
// Карточки, голосование, темы, этапы и итоги с экспортом работают через те же
// колбэки room-app, что и в 3D; диалоги (карточка, голосование, темы, итоги)
// остаются в room-app и открываются отсюда.
import { useId, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  Layers,
  Link2,
  ListChecks,
  MonitorOff,
  MousePointer2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ThumbsUp,
  Vote,
} from 'lucide-react';
import Board, { type BoardSyncStatus } from './board';
import { ZONES, type Note, type Room } from '@/lib/model';

/** Диалоги room-app, которые открывает панель доски (значения `panel`). */
export type RoomBoardFallbackPanel = 'vote' | 'group' | 'results';

export type RoomBoardFallbackProps = {
  room: Room;
  /** Текущий игрок — ведущий встречи. */
  host: boolean;
  /** Режим комнаты (`modeOf(state)`): вне ретро честно говорим, что без 3D игры нет. */
  gameMode?: string;
  /** Операция над комнатой — `act` из useRoomSync. */
  onOp: (op: Record<string, unknown>) => Promise<unknown>;
  /** Открыть карточку в редакторе room-app. */
  onEditNote: (n: Note) => void;
  /** Новая карточка в зоне; x/y — место на холсте зоны, если его выбрали. */
  onAddNote: (zone: string, x?: number, y?: number) => void;
  /** Курсор на доске для других участников (координаты холста). */
  onCursor?: (x: number, y: number) => void;
  /**
   * Открыть диалог room-app: голосование, темы, итоги (план действий, экспорт,
   * завершение встречи). Не передан — кнопок встречи в панели нет.
   */
  onOpenPanel?: (panel: RoomBoardFallbackPanel) => void;
  /** Плашка этапов (`<PhaseBar>`) — встаёт в панель доски, а не поверх неё. */
  phaseBar?: ReactNode;
  /** Статус связи из шапки; не передан — доска о сохранении молчит. */
  syncStatus?: BoardSyncStatus;
  /** «Проверить снова» в подсказке. По умолчанию — перезагрузка страницы. */
  onRetry?: () => void;
};

const TOOLS = [
  { id: 'pointer', label: 'Выбор', hint: 'Выбор и перемещение', Icon: MousePointer2 },
  { id: 'draw', label: 'Маркер', hint: 'Маркер: зажмите и рисуйте на холсте', Icon: Pencil },
  { id: 'connector', label: 'Связь', hint: 'Связь: соединить две карточки стрелкой', Icon: Link2 },
  { id: 'reaction', label: 'Реакция', hint: 'Реакция: быстрый 👍 на карточку', Icon: ThumbsUp },
] as const;

export default function RoomBoardFallback({
  room,
  host,
  gameMode = 'retro',
  onOp,
  onEditNote,
  onAddNote,
  onCursor,
  onOpenPanel,
  phaseBar,
  syncStatus,
  onRetry,
}: RoomBoardFallbackProps) {
  const [tool, setTool] = useState<string>('pointer');
  const [search, setSearch] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const s = room.state;
  const round = s.rounds.at(-1);
  const used = round?.active
    ? Object.values(round.votes[room.self] || {}).reduce((a, b) => a + b, 0)
    : 0;
  const voteText = round?.active
    ? `Осталось голосов: ${Math.max(0, round.limit - used)} из ${round.limit}`
    : s.rounds.length
      ? 'Голосование завершено'
      : 'Голосование не идёт';
  const firstZone =
    (s.template === 'three' ? ZONES.filter((z) => z.id !== 'bad') : ZONES)[0]
      ?.id || 'good';
  const readOnly = !!s.archived;

  return (
    <section className="room-board-fallback" aria-label="Доска встречи">
      <div className="rbf-banner">
        <MonitorOff size={18} aria-hidden="true" />
        <p>
          <strong>3D недоступно в этом браузере</strong> — работаем на обычной
          доске.
          {gameMode !== 'retro' && ' Бой, «Предатель» и «Выживание» без 3D не запустятся.'}
        </p>
        <button
          type="button"
          className="rbf-link"
          aria-expanded={helpOpen}
          aria-controls={helpId}
          onClick={() => setHelpOpen((v) => !v)}
        >
          Как включить 3D
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      {helpOpen && (
        <div className="rbf-help" id={helpId}>
          <p>
            3D-миру нужен WebGL. Обычно он выключен вместе с аппаратным
            ускорением:
          </p>
          <ol>
            <li>
              <b>Chrome, Edge, Яндекс Браузер:</b> Настройки → Система →
              включите «Использовать графическое ускорение» и перезапустите
              браузер.
            </li>
            <li>
              <b>Firefox:</b> Настройки → Основные → Производительность —
              снимите «Использовать рекомендуемые настройки» и включите
              «По возможности использовать аппаратное ускорение».
            </li>
            <li>
              <b>Safari:</b> обновите macOS или iOS — WebGL там включён
              по умолчанию.
            </li>
            <li>
              Не помогло — обновите драйвер видеокарты или откройте комнату в
              другом браузере.
            </li>
          </ol>
          <button
            type="button"
            className="rbf-button"
            onClick={() => (onRetry ? onRetry() : location.reload())}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Проверить снова
          </button>
        </div>
      )}

      <div className="rbf-toolbar">
        {phaseBar && <div className="rbf-phase">{phaseBar}</div>}
        <div className="rbf-group">
          {TOOLS.map(({ id, label, hint, Icon }) => (
            <button
              key={id}
              type="button"
              className="rbf-tool"
              aria-pressed={tool === id}
              aria-label={hint}
              title={hint}
              onClick={() => setTool(id)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="rbf-button rbf-primary"
          disabled={readOnly}
          aria-label="Новая карточка"
          title={readOnly ? 'Встреча завершена' : 'Новая карточка'}
          onClick={() => onAddNote(firstZone)}
        >
          <Plus size={16} aria-hidden="true" />
          <span>Карточка</span>
        </button>
        <label className="rbf-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            placeholder="Найти карточку…"
            aria-label="Поиск по доске"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="rbf-group rbf-meeting">
          {onOpenPanel && (
            <button
              type="button"
              className={`rbf-button${round?.active ? ' is-live' : ''}`}
              title={host ? 'Голосование: запуск и итоги' : 'Голосование'}
              onClick={() => onOpenPanel('vote')}
            >
              <Vote size={16} aria-hidden="true" />
              <span aria-hidden="true">
                {round?.active
                  ? `${Math.max(0, round.limit - used)} из ${round.limit}`
                  : 'Голоса'}
              </span>
              <span className="sr-only">{voteText}</span>
            </button>
          )}
          {onOpenPanel && (
            <button
              type="button"
              className="rbf-button"
              title="Темы: группы карточек"
              aria-label="Темы"
              onClick={() => onOpenPanel('group')}
            >
              <Layers size={16} aria-hidden="true" />
              <span>Темы</span>
            </button>
          )}
          {onOpenPanel && (
            <button
              type="button"
              className="rbf-button"
              title="Итоги: план действий, экспорт, завершение встречи"
              aria-label="Итоги встречи"
              onClick={() => onOpenPanel('results')}
            >
              <ListChecks size={16} aria-hidden="true" />
              <span>Итоги</span>
            </button>
          )}
        </div>
      </div>

      <div className="rbf-board">
        <Board
          room={room}
          tool={tool}
          onEdit={onEditNote}
          onAdd={onAddNote}
          onOp={onOp}
          search={search}
          onCursor={onCursor}
          syncStatus={syncStatus}
        />
      </div>
    </section>
  );
}
