'use client';
/* oxlint-disable next/no-html-link-for-pages -- Полная навигация обходит ошибку RSC prefetch в production-сборке vinext. */
import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { api } from '@/lib/client';
import { PasswordField } from './password-field';
import { ThemeToggle } from './theme-toggle';

/**
 * Новый пароль по ссылке из письма. Токен одноразовый: после успеха браузер
 * сразу оказывается внутри аккаунта, остальные устройства разлогинены.
 */
export default function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (password !== repeat) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/reset', { token, password });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="join-screen">
      <div className="auth-reset-top">
        <ThemeToggle />
      </div>
      <div className="join-card">
        <p className="join-emoji" aria-hidden="true">
          🔑
        </p>
        <h1>Новый пароль</h1>
        {!token ? (
          <>
            <p className="muted">
              В ссылке нет кода подтверждения. Откройте письмо ещё раз или
              запросите новое.
            </p>
            <a className="primary auth-wide" href="/">
              На главную
            </a>
          </>
        ) : done ? (
          <>
            <p className="muted">
              Пароль сохранён, вы вошли в аккаунт. На других устройствах нужно
              войти заново.
            </p>
            <a className="primary auth-wide" href="/">
              К комнатам
            </a>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="muted">Ссылка действует час и срабатывает один раз.</p>
            <PasswordField
              label="Новый пароль"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              required
              minLength={8}
            />
            <PasswordField
              label="Повторите пароль"
              value={repeat}
              onChange={setRepeat}
              autoComplete="new-password"
              required
              minLength={8}
            />
            {error && (
              <p role="alert" className="error-banner auth-message">
                {error}
              </p>
            )}
            <button className="primary auth-wide" type="submit" disabled={busy}>
              {busy ? (
                <Loader2 size={16} className="auth-spin" />
              ) : (
                <KeyRound size={16} />
              )}
              Сохранить пароль
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
