// Подсказка и главная кнопка этапа встречи (components/phase-bar.tsx).
// Чистая функция: какую кнопку показать, решает она, а что кнопка делает —
// components/room-app.tsx по `action.id`.
import { PHASES } from './model.ts';

export type PhaseActionId =
  | 'phase'
  | 'vote.start'
  | 'vote.end'
  | 'open.vote'
  | 'open.group'
  | 'open.results';

export type PhaseAction = {
  id: PhaseActionId;
  label: string;
  /** Для id 'phase' — на какой этап перейти. */
  phase?: number;
};

export type PhaseGuide = {
  hint: string;
  action?: PhaseAction;
  /** Второстепенная ссылка рядом с главной кнопкой. */
  secondary?: PhaseAction;
};

export type PhaseFacts = {
  phase: number;
  host: boolean;
  archived: boolean;
  /** Людей в сети и всего в комнате (боты не считаются). */
  online: number;
  total: number;
  privateWriting: boolean;
  /** Идёт раунд голосования. */
  voting: boolean;
  /** Голосов у смотрящего осталось и всего в раунде. */
  votesLeft: number;
  voteLimit: number;
  /** Голосов на участника для нового раунда (поле в панели голосования). */
  nextVoteLimit: number;
  groups: number;
  actions: number;
};

const next = (phase: number, label: string): PhaseAction => ({
  id: 'phase',
  phase,
  label,
});

export function phaseGuide(f: PhaseFacts): PhaseGuide {
  const phase = Math.max(0, Math.min(PHASES.length - 1, f.phase));
  if (f.archived)
    return {
      hint: 'Встреча завершена. Итоги и экспорт остаются доступны',
      action: { id: 'open.results', label: 'Открыть итоги' },
    };
  if (!f.host) {
    switch (phase) {
      case 0:
        return { hint: 'Знакомимся. Ведущий скоро начнёт сбор идей' };
      case 1:
        return {
          hint: f.privateWriting
            ? 'Пишите идеи в зоны справа. Заметки видите только вы, пока не раскроете'
            : 'Пишите идеи в зоны справа',
        };
      case 2:
        return { hint: 'Ведущий объединяет похожие идеи в темы' };
      case 3:
        return f.voting
          ? {
              hint: `Голосуйте 👍 на карточках · осталось ${f.votesLeft} из ${f.voteLimit}`,
              action: { id: 'open.vote', label: 'Открыть голосование' },
            }
          : { hint: 'Ждём, когда ведущий начнёт раунд голосования' };
      case 4:
        return {
          hint: 'Обсуждаем идеи, набравшие больше голосов',
          secondary: { id: 'open.vote', label: 'Результаты голосования' },
        };
      default:
        return {
          hint: 'Итоги встречи: план действий и экспорт',
          action: { id: 'open.results', label: 'Открыть итоги' },
        };
    }
  }
  switch (phase) {
    case 0:
      return {
        hint: `Все на месте? ${f.online} из ${f.total} в сети`,
        action: next(1, 'Начать сбор идей'),
      };
    case 1:
      return {
        hint: f.privateWriting
          ? 'Идеи скрыты: каждый раскрывает свои заметки сам'
          : 'Идеи видны всем сразу',
        action: next(2, 'Перейти к группировке'),
      };
    case 2:
      return {
        hint: f.groups
          ? `Тем: ${f.groups}. Объедините похожие идеи`
          : 'Объедините похожие идеи в темы',
        action: next(3, 'Перейти к голосованию'),
        secondary: { id: 'open.group', label: 'Создать тему' },
      };
    case 3:
      return f.voting
        ? {
            hint: `Идёт раунд · у вас осталось ${f.votesLeft} из ${f.voteLimit}`,
            action: { id: 'vote.end', label: 'Завершить голосование' },
            secondary: { id: 'open.vote', label: 'Голосование' },
          }
        : {
            hint: `Голосов на участника: ${f.nextVoteLimit}`,
            action: { id: 'vote.start', label: 'Начать голосование' },
            secondary: { id: 'open.vote', label: 'Настроить' },
          };
    case 4:
      return {
        hint: 'Начните с идей, набравших больше голосов',
        action: next(5, 'Перейти к итогам'),
        secondary: { id: 'open.vote', label: 'Результаты голосования' },
      };
    default:
      return {
        hint: f.actions
          ? `В плане действий: ${f.actions}`
          : 'Запишите договорённости и ответственных',
        action: { id: 'open.results', label: 'Открыть итоги' },
      };
  }
}
