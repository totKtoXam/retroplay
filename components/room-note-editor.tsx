'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Check, Copy, Send, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ZONES,
  FORM_NOTE_KINDS,
  isActionKind,
  noteKindLabel,
  templateZones,
  zoneTitle,
  type Note,
  type Room,
  type RoomState,
} from '@/lib/model';
import { relockWorld } from '@/lib/pointer-lock';
import { Choice, Toggle } from './controls';
import type { useRoomSync } from './use-room-sync';

type Act = ReturnType<typeof useRoomSync>['act'];

export type Draft = {
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

/** Редактор карточки: быстрый стикер по зоне и полный диалог с обсуждением. */
export function RoomNoteEditor({
  room,
  s,
  draft,
  setDraft,
  quickSticky,
  edited,
  canEdit,
  formZones,
  busy,
  webglFailed,
  comment,
  setComment,
  saveNote,
  deleteNote,
  act,
  flash,
}: {
  room: Room;
  s: RoomState;
  draft: Draft | null;
  setDraft: Dispatch<SetStateAction<Draft | null>>;
  quickSticky: boolean;
  edited: Note | undefined;
  canEdit: boolean;
  formZones: ReturnType<typeof templateZones>;
  busy: boolean;
  webglFailed: boolean;
  comment: string;
  setComment: (text: string) => void;
  saveNote: () => Promise<void>;
  deleteNote: (n: Note) => Promise<void>;
  act: Act;
  flash: (text: string) => void;
}) {
  return (
    <>
      <Dialog
        open={!!draft && quickSticky}
        onOpenChange={(v) => {
          if (!v) {
            setDraft(null);
            setTimeout(() => {
              if (!webglFailed) relockWorld();
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
              if (!webglFailed) relockWorld();
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
    </>
  );
}
