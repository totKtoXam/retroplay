'use client';
import { Vote } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Note, RoomState } from '@/lib/model';
import { festivePalette, festiveVars } from '@/lib/festive';
import { actionItems, topVoted } from '@/lib/room-export';
import { ResultsHero } from './results-hero';
import {
  ActionsPanel,
  ArchiveSection,
  ExportPanel,
  HistoryPanel,
  type HistoryEntry,
} from './room-panels';

/**
 * Итоги встречи одним экраном: главное по голосам, план действий, экспорт,
 * история с отменой и завершение. Раньше всё это лежало разделами в
 * «Настройках», и путь «от голосования к экспорту» шёл через меню, куда на
 * встрече никто не заглядывает. Открывается из шапки и кнопкой этапа «Итоги».
 *
 * Сверху — праздничная шапка мира (results-hero.tsx) с цифрами встречи; акцент
 * панели (полоски голосов, номер лидера) — цвет мира из lib/festive.ts.
 */
export function ResultsPanel({
  s,
  host,
  history,
  historyOpen,
  onHistoryOpen,
  undo,
  onUndo,
  onExport,
  onImport,
  onAddAction,
  onOpenNote,
  onOpenVote,
  onToggleArchive,
}: {
  s: RoomState;
  host: boolean;
  history: HistoryEntry[];
  historyOpen: boolean;
  onHistoryOpen: (open: boolean) => void;
  undo: { enabled: boolean; reason: string; busy: boolean };
  onUndo: () => void;
  onExport: (format: string) => void;
  onImport: (file: File) => void;
  onAddAction: () => void;
  onOpenNote: (note: Note) => void;
  onOpenVote: () => void;
  onToggleArchive: () => void;
}) {
  const top = topVoted(s, 5);
  const max = top[0]?.votes || 1;
  const round = s.rounds.at(-1);
  const actions = actionItems(s);
  const done = actions.filter((n) => n.done).length;
  return (
    <div
      className="results-panel"
      style={festiveVars(festivePalette(s.theme)) as CSSProperties}
    >
      <ResultsHero s={s} />
      <section className="results-section" aria-labelledby="results-top">
        <h3 id="results-top">Главное по голосам</h3>
        {round?.active ? (
          <p className="muted">
            Раунд ещё идёт: до его завершения вы видите только свои голоса.
          </p>
        ) : (
          s.rounds.length > 1 && (
            // Повторный раунд — это пересмотр решения, поэтому считается последний.
            <p className="muted">По последнему раунду из {s.rounds.length}.</p>
          )
        )}
        {top.length ? (
          <ol className="results-top">
            {top.map(({ note, votes }) => (
              <li key={note.id}>
                <button type="button" onClick={() => onOpenNote(note)}>
                  <span className="results-top-body">
                    <span className="results-top-text">
                      {note.text || 'Без текста'}
                    </span>
                    {/* Доля от лидера: длина полоски — подсказка, число справа. */}
                    <span className="results-bar" aria-hidden="true">
                      <span
                        style={{ '--share': votes / max } as CSSProperties}
                      />
                    </span>
                  </span>
                  <b aria-label={`голосов: ${votes}`}>{votes}</b>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">
            {s.rounds.length
              ? 'За карточки пока никто не проголосовал.'
              : 'Голосования ещё не было.'}
          </p>
        )}
        <button type="button" className="text-button" onClick={onOpenVote}>
          <Vote size={15} aria-hidden="true" />
          Все результаты голосования
        </button>
      </section>
      <section className="results-section" aria-labelledby="results-actions">
        <h3 id="results-actions">
          План действий
          {actions.length > 0 && (
            <span className="results-count">
              выполнено {done} из {actions.length}
            </span>
          )}
        </h3>
        <ActionsPanel
          s={s}
          onAddAction={onAddAction}
          onOpenNote={onOpenNote}
          disabled={!!s.archived}
        />
      </section>
      <section className="results-section" aria-labelledby="results-export">
        <h3 id="results-export">Экспорт</h3>
        <ExportPanel host={host} onExport={onExport} onImport={onImport} />
      </section>
      <details
        className="results-section results-history"
        open={historyOpen}
        onToggle={(e) => onHistoryOpen(e.currentTarget.open)}
      >
        <summary>История изменений и отмена</summary>
        <HistoryPanel
          history={history}
          onUndo={onUndo}
          undoEnabled={undo.enabled}
          undoReason={undo.reason}
          undoBusy={undo.busy}
        />
      </details>
      {host && (
        <section className="results-section" aria-labelledby="results-finish">
          <h3 id="results-finish">Завершение встречи</h3>
          <ArchiveSection
            archived={!!s.archived}
            host={host}
            onToggleArchive={onToggleArchive}
          />
        </section>
      )}
    </div>
  );
}
