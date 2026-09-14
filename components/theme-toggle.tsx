'use client';
import { Sun, Moon, MonitorCog } from 'lucide-react';
import {
  chooseTheme,
  nextThemeChoice,
  useTheme,
  type ThemeChoice,
} from '../hooks/use-theme';

/** Название текущей темы для подсказки. */
const CURRENT: Record<ThemeChoice, string> = {
  system: 'Тема: как в системе',
  light: 'Тема: светлая',
  dark: 'Тема: тёмная',
};
/** Название следующей темы в винительном падеже. */
const UPCOMING: Record<ThemeChoice, string> = {
  system: 'системную',
  light: 'светлую',
  dark: 'тёмную',
};

/** Компактная кнопка-иконка: системная → светлая → тёмная → системная. */
export function ThemeToggle() {
  const { choice } = useTheme();
  const upcoming = nextThemeChoice(choice);
  const label = `${CURRENT[choice]}. Переключить на ${UPCOMING[upcoming]}.`;
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => chooseTheme(upcoming)}
      aria-label={label}
      title={label}
    >
      {choice === 'light' ? (
        <Sun size={18} aria-hidden="true" />
      ) : choice === 'dark' ? (
        <Moon size={18} aria-hidden="true" />
      ) : (
        <MonitorCog size={18} aria-hidden="true" />
      )}
    </button>
  );
}
