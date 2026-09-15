'use client';

import type { LucideIcon } from 'lucide-react';

/** Один раздел настроек: пункт слева и его содержимое справа. */
export type SettingsSection = {
  id: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  /** Правит только ведущий: показываем замок, чтобы это было видно снаружи. */
  hostOnly?: boolean;
};

export type SettingsGroup = {
  id: string;
  title: string;
  sections: SettingsSection[];
};

/**
 * Двухколоночное меню настроек: слева список разделов, справа содержимое.
 *
 * Кнопки «назад» здесь нет намеренно. Раньше меню было деревом (список →
 * раздел), и выход из раздела закрывал диалог целиком, потому что возврата к
 * списку не существовало как состояния. Когда все разделы видны всегда,
 * уходить некуда: переход между ними — один клик, а Esc закрывает настройки.
 *
 * На узком экране колонки схлопываются: список превращается в ленту вкладок
 * над содержимым, поэтому разделы остаются на виду и там.
 */
export function SettingsShell({
  groups,
  section,
  onSection,
  host,
  children,
}: {
  groups: SettingsGroup[];
  section: string;
  onSection: (id: string) => void;
  /** Ведущий ли смотрящий: от этого зависит замок у разделов комнаты. */
  host: boolean;
  children: React.ReactNode;
}) {
  const active =
    groups.flatMap((g) => g.sections).find((s) => s.id === section) ||
    groups[0]?.sections[0];
  return (
    <div className="settings-shell">
      <nav className="settings-nav" aria-label="Разделы настроек">
        {groups.map((group) => (
          <div key={group.id} className="settings-nav-group">
            <span className="settings-nav-title">{group.title}</span>
            {group.sections.map((s) => {
              const locked = !!s.hostOnly && !host;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`settings-nav-item ${s.id === section ? 'active' : ''} ${locked ? 'locked' : ''}`}
                  aria-current={s.id === section ? 'page' : undefined}
                  aria-label={s.title}
                  onClick={() => onSection(s.id)}
                >
                  <s.icon size={17} />
                  <span>
                    <strong>{s.title}</strong>
                    <small>{locked ? 'Меняет ведущий' : s.hint}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="settings-body">
        {active && (
          <header className="settings-body-head">
            <h3>{active.title}</h3>
            <p>
              {active.hostOnly && !host
                ? 'Эти настройки меняет ведущий встречи — вам они видны, но заблокированы.'
                : active.hint}
            </p>
          </header>
        )}
        <div className="settings-body-scroll">{children}</div>
      </div>
    </div>
  );
}
