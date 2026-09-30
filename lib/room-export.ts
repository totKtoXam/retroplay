// Итоги встречи и их экспорт (панель «Итоги» в components/room-results.tsx).
// Чистые функции без DOM: их проверяет tests/room-ux.test.mjs.
import {
  isActionKind,
  noteKindLabel,
  templateZones,
  voteCount,
  ZONES,
  zoneTitle,
  type Note,
  type RoomState,
} from './model.ts';

/** Объекты доски, у которых нет текста для итогов: линии, рисунки и скрытые чужие заметки. */
const isContent = (n: Note) =>
  !n.redacted && n.kind !== 'draw' && n.kind !== 'connector';

/**
 * Голоса последнего раунда — те же, что показывает панель голосования. Пока
 * раунд идёт, сервер отдаёт каждому только его собственные голоса.
 */
export function topVoted(state: RoomState, limit = 10) {
  return state.notes
    .filter(isContent)
    .map((note) => ({ note, votes: voteCount(state, note.id) }))
    .filter((v) => v.votes > 0)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, limit);
}

/** Пункты плана действий: новый тип «Действие» и старые «Задача» и «План». */
export function actionItems(state: RoomState) {
  return state.notes.filter((n) => isContent(n) && isActionKind(n.kind));
}

/** Карточки с мыслью участника: не фигуры, рамки, эмодзи и не пункты плана. */
const IDEA_KINDS = new Set(['sticky', 'index', 'page', 'text']);

/**
 * Цифры встречи для шапки «Итогов»: идеи, голоса последнего раунда, действия и
 * участники. Участник — тот, кто написал карточку, комментарий или голосовал;
 * анонимные авторы не различимы и все вместе не считаются никем, поэтому число
 * — нижняя оценка. Пока раунд идёт, голоса — только свои (как в topVoted).
 */
export function meetingStats(state: RoomState) {
  const content = state.notes.filter(isContent);
  const people = new Set<string>();
  const add = (id: string | undefined) => {
    if (id && id !== 'anonymous') people.add(id);
  };
  for (const n of content) {
    add(n.author);
    n.comments?.forEach((c) => add(c.author));
  }
  for (const r of state.rounds) Object.keys(r.votes || {}).forEach(add);
  const last = state.rounds.at(-1)?.votes || {};
  const votes = Object.values(last).reduce(
    (sum, v) => sum + Object.values(v).reduce((a, b) => a + (b || 0), 0),
    0,
  );
  return {
    ideas: content.filter((n) => IDEA_KINDS.has(n.kind)).length,
    votes,
    actions: content.filter((n) => isActionKind(n.kind)).length,
    people: people.size,
  };
}

/** Зоны для экспорта: зоны формата доски и те, где карточки остались от другого формата. */
function exportZones(state: RoomState) {
  const shown = new Set(templateZones(state.template).map((z) => z.id));
  return ZONES.filter(
    (z) => shown.has(z.id) || state.notes.some((n) => n.zone === z.id && isContent(n)),
  );
}

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();

function actionLine(n: Note) {
  const parts = [`- [${n.done ? 'x' : ' '}] ${oneLine(n.text) || 'Без описания'}`];
  if (n.owner) parts.push(`— ответственный: ${n.owner}`);
  if (n.due) parts.push(`(срок ${n.due})`);
  return parts.join(' ');
}

/**
 * Markdown-итоги: зоны с голосами, темы, результаты голосования и план
 * действий с ответственными. Пустые разделы не выводятся.
 */
export function exportMarkdown(state: RoomState, date = new Date()) {
  const votes = (n: Note) => voteCount(state, n.id);
  const withVotes = (n: Note) => {
    const v = votes(n);
    return `- ${oneLine(n.text) || 'Без текста'}${v ? ` · голосов: ${v}` : ''}`;
  };
  const byVotes = (a: Note, b: Note) => votes(b) - votes(a);
  const lines: string[] = [
    `# ${state.title || 'Ретроспектива'}`,
    '',
    `Дата выгрузки: ${date.toLocaleDateString('ru-RU')}`,
  ];
  const top = topVoted(state);
  if (top.length) {
    lines.push('', '## Итоги голосования', '');
    top.forEach(({ note, votes: v }, i) =>
      lines.push(`${i + 1}. ${oneLine(note.text) || 'Без текста'} — голосов: ${v}`),
    );
  }
  for (const zone of exportZones(state)) {
    const notes = state.notes
      .filter((n) => n.zone === zone.id && isContent(n) && !isActionKind(n.kind))
      .sort(byVotes);
    lines.push('', `## ${zoneTitle(zone.id, state.template)}`, '');
    lines.push(notes.length ? notes.map(withVotes).join('\n') : '_Нет карточек_');
  }
  const groups = state.groups.filter((g) =>
    state.notes.some((n) => n.group === g.id && isContent(n)),
  );
  if (groups.length) {
    lines.push('', '## Темы');
    for (const g of groups) {
      lines.push('', `### ${g.title}`, '');
      lines.push(
        state.notes
          .filter((n) => n.group === g.id && isContent(n))
          .sort(byVotes)
          .map(withVotes)
          .join('\n'),
      );
    }
  }
  const actions = actionItems(state);
  if (actions.length) {
    lines.push('', '## План действий', '');
    lines.push(actions.map(actionLine).join('\n'));
  }
  return lines.join('\n') + '\n';
}

/** Строки CSV: заголовок и по строке на карточку. Тип — человеческим названием. */
export function exportCsvRows(state: RoomState): string[][] {
  const groupTitle = new Map(state.groups.map((g) => [g.id, g.title]));
  return [
    [
      'Текст',
      'Зона',
      'Тип',
      'Ответственный',
      'Срок',
      'Завершено',
      'Голоса',
      'Теги',
      'Тема',
    ],
    ...state.notes
      .filter(isContent)
      .map((n) => [
        n.text,
        zoneTitle(n.zone, state.template),
        noteKindLabel(n.kind),
        n.owner,
        n.due,
        n.done ? 'Да' : 'Нет',
        String(voteCount(state, n.id)),
        n.tags.join('; '),
        groupTitle.get(n.group) ?? '',
      ]),
  ];
}

export function toCsv(rows: string[][]) {
  return (
    '﻿' +
    rows
      .map((r) => r.map((c) => '"' + String(c).replaceAll('"', '""') + '"').join(','))
      .join('\r\n')
  );
}

/**
 * Зона по подписи из CSV при импорте: полное название (в том числе «Продолжать
 * делать» формата из трёх колонок), короткая подпись или id.
 */
export function zoneFromLabel(label: string | undefined, template?: string) {
  const value = (label ?? '').trim();
  return (
    ZONES.find(
      (z) =>
        z.id === value ||
        z.title === value ||
        zoneTitle(z.id, template) === value ||
        zoneTitle(z.id, 'three') === value,
    )?.id ?? 'good'
  );
}
