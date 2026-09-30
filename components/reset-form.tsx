'use client';
/* oxlint-disable next/no-html-link-for-pages -- Полная навигация обходит ошибку RSC prefetch в production-сборке vinext. */
import { useState } from 'react';
import { KeyRound, Loader2, MailPlus } from 'lucide-react';
import { api } from '@/lib/client';
import { MIN_PASSWORD_LENGTH, passwordProblem } from '@/lib/auth';
import { PasswordField } from './password-field';
import { ThemeToggle } from './theme-toggle';

/** Лобби по этому адресу сразу открывает диалог восстановления пароля. */
const FORGOT_URL = '/?forgot=1';

/** Ссылка устарела или не подошла: сразу предлагаем запросить новую. */
function RequestNewLink() {
  return (
    <a className="primary auth-wide" href={FORGOT_URL}>
      <MailPlus size={16} aria-hidden="true" />
      Запросить новую ссылку
    </a>
  );
}

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
  // Сервер отклонил запрос уже после проверки пароля — значит, дело в ссылке.
  const [linkFailed, setLinkFailed] = useState(false);

  const submit = async () => {
    // Пароль проверяется здесь теми же правилами, что и на сервере: так ответ
    // сервера с ошибкой относится к ссылке, а не к паролю.
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== repeat) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    setError('');
    setLinkFailed(false);
    try {
      await api('/api/auth/reset', { token, password });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
      setLinkFailed(true);
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
            <RequestNewLink />
            <a className="text-button auth-wide" href="/">
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
              minLength={MIN_PASSWORD_LENGTH}
              hint={`Не короче ${MIN_PASSWORD_LENGTH} символов.`}
            />
            <PasswordField
              label="Повторите пароль"
              value={repeat}
              onChange={setRepeat}
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
            />
            {error && (
              <p role="alert" className="error-banner auth-message">
                {error}
              </p>
            )}
            {linkFailed && <RequestNewLink />}
            <button
              className={`${linkFailed ? 'secondary' : 'primary'} auth-wide`}
              type="submit"
              disabled={busy}
            >
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
