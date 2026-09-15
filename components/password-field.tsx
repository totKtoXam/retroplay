'use client';
import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Поле пароля с кнопкой «показать». Общее для входа, регистрации, смены пароля
 * и страницы сброса, чтобы поведение и разметка не разъезжались.
 *
 * Показ пароля — осознанное действие: по умолчанию поле закрыто, состояние не
 * запоминается между открытиями формы. Менеджеры паролей опираются на
 * `autoComplete`, поэтому он остаётся обязательным параметром.
 */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  required = false,
  minLength,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  required?: boolean;
  minLength?: number;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          // Пока пароль показан, это обычное текстовое поле.
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          // Свои подсказки браузера поверх открытого пароля ни к чему.
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="password-eye"
          onClick={() => setShown((was) => !was)}
          // Кнопка внутри формы не должна перехватывать Tab на пути к «Войти».
          tabIndex={-1}
          aria-controls={id}
          aria-pressed={shown}
          aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}
          title={shown ? 'Скрыть пароль' : 'Показать пароль'}
        >
          {shown ? (
            <EyeOff size={17} aria-hidden="true" />
          ) : (
            <Eye size={17} aria-hidden="true" />
          )}
        </button>
      </div>
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
}
