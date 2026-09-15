'use client';
import { useState } from 'react';
import {
  LogIn,
  LogOut,
  Mail,
  MailCheck,
  KeyRound,
  UserRound,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api } from '@/lib/client';
import { PasswordField } from './password-field';
import type { AuthUser } from '@/hooks/use-auth';

/** Фирменная буква Google для кнопки входа. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

type Mode = 'login' | 'register' | 'forgot';

/**
 * Вход, регистрация и профиль в одном диалоге. Аккаунт не обязателен: гость
 * играет и создаёт комнаты без него, а вход добавляет возврат к своим комнатам
 * с другого устройства и после очистки cookie.
 */
export function AuthDialog({
  open,
  onOpenChange,
  user,
  google,
  mail,
  defaultName,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  user: AuthUser | null;
  google: boolean;
  mail: boolean;
  /** Имя с этого устройства: подставляется в регистрацию, если аккаунта нет. */
  defaultName: string;
  onChanged: () => Promise<unknown>;
}) {
  // Форма живёт от открытия до открытия: лобби меняет `key`, поэтому при
  // каждом открытии состояние начинается заново и пароль не «залипает».
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(user?.name || defaultName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [devLink, setDevLink] = useState('');
  const [passwordForm, setPasswordForm] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    setDevLink('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const goGoogle = () => {
    const next = location.pathname + location.search;
    location.href = '/api/auth/google?next=' + encodeURIComponent(next);
  };

  const submit = () =>
    run(async () => {
      if (mode === 'forgot') {
        const r = await api<{ devLink?: string }>('/api/auth/forgot', { email });
        setNotice(
          'Если такой адрес зарегистрирован, письмо со ссылкой уже отправлено. Ссылка действует час.',
        );
        if (r.devLink) setDevLink(r.devLink);
        return;
      }
      if (mode === 'register') {
        const r = await api<{ mailSent: boolean; devLink?: string }>(
          '/api/auth/register',
          { email, password, name },
        );
        await onChanged();
        setPassword('');
        if (r.devLink) setDevLink(r.devLink);
        setNotice(
          r.mailSent
            ? 'Аккаунт создан. Письмо с подтверждением отправлено на вашу почту.'
            : r.devLink
              ? 'Аккаунт создан. Отправка писем не настроена — подтвердите почту по ссылке ниже.'
              : 'Аккаунт создан. Письмо с подтверждением отправить не удалось — попробуйте позже.',
        );
        return;
      }
      await api('/api/auth/login', { email, password });
      await onChanged();
      setPassword('');
      onOpenChange(false);
    });

  const logout = () =>
    run(async () => {
      await api('/api/auth/logout', {});
      await onChanged();
      onOpenChange(false);
    });

  const resendVerification = () =>
    run(async () => {
      const r = await api<{ mailSent: boolean; devLink?: string }>(
        '/api/auth/verify',
        {},
      );
      if (r.devLink) setDevLink(r.devLink);
      setNotice(
        r.mailSent
          ? 'Письмо отправлено ещё раз — проверьте почту.'
          : 'Отправка писем не настроена на этом сервере.',
      );
    });

  const saveName = () =>
    run(async () => {
      await api('/api/auth/me', { name });
      await onChanged();
      setNotice('Имя обновлено.');
    });

  const savePassword = () =>
    run(async () => {
      await api('/api/auth/password', {
        current: currentPassword,
        password,
      });
      await onChanged();
      setPassword('');
      setCurrentPassword('');
      setPasswordForm(false);
      setNotice('Пароль сохранён. На других устройствах нужно войти заново.');
    });

  // Профиль вошедшего: смена имени, пароль и выход.
  const account = user && (
    <>
      <DialogTitle>Аккаунт</DialogTitle>
      <DialogDescription>
        Комнаты и карточки привязаны к аккаунту — вход с другого устройства
        вернёт их.
      </DialogDescription>

      <div className="auth-identity">
        <span className="auth-avatar" aria-hidden="true">
          {(user.name || user.email).slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </div>
        {user.emailVerified ? (
          <span className="auth-badge auth-badge-ok" title="Почта подтверждена">
            <ShieldCheck size={14} /> подтверждена
          </span>
        ) : (
          <span className="auth-badge" title="Почта не подтверждена">
            <Mail size={14} /> не подтверждена
          </span>
        )}
      </div>

      {!user.emailVerified && (
        <p className="auth-hint">
          Пока почта не подтверждена, восстановить пароль по ней нельзя.{' '}
          <button type="button" className="text-button" onClick={resendVerification} disabled={busy}>
            Отправить письмо ещё раз
          </button>
        </p>
      )}

      <label className="field">
        Имя в комнатах
        <input
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Как вас зовут?"
        />
      </label>
      <button className="secondary auth-wide" type="button" onClick={saveName} disabled={busy}>
        <UserRound size={16} /> Сохранить имя
      </button>

      {passwordForm ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void savePassword();
          }}
        >
          {user.hasPassword && (
            <PasswordField
              label="Текущий пароль"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
            />
          )}
          <PasswordField
            label="Новый пароль"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={8}
          />
          <button className="primary auth-wide" type="submit" disabled={busy}>
            {busy ? <Loader2 size={16} className="auth-spin" /> : <KeyRound size={16} />}
            Сохранить пароль
          </button>
        </form>
      ) : (
        <button
          className="secondary auth-wide"
          type="button"
          onClick={() => setPasswordForm(true)}
        >
          <KeyRound size={16} />
          {user.hasPassword ? 'Сменить пароль' : 'Задать пароль для входа по почте'}
        </button>
      )}

      <button className="light-button auth-wide auth-logout" type="button" onClick={logout} disabled={busy}>
        <LogOut size={16} /> Выйти
      </button>
    </>
  );

  // Вход, регистрация и запрос сброса пароля.
  const form = (
    <>
      <DialogTitle>
        {mode === 'register'
          ? 'Регистрация'
          : mode === 'forgot'
            ? 'Восстановление пароля'
            : 'Вход'}
      </DialogTitle>
      <DialogDescription>
        {mode === 'forgot'
          ? 'Пришлём ссылку для нового пароля на указанную почту.'
          : 'Аккаунт не обязателен: играть и создавать комнаты можно и без него. Он нужен, чтобы вернуться к своим комнатам с другого устройства.'}
      </DialogDescription>

      {google && mode !== 'forgot' && (
        <>
          <button className="auth-google" type="button" onClick={goGoogle}>
            <GoogleMark />
            Продолжить с Google
          </button>
          <div className="auth-divider">
            <span>или по почте</span>
          </div>
        </>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          Почта
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        {mode === 'register' && (
          <label className="field">
            Имя в комнатах
            <input
              maxLength={40}
              placeholder="Как вас зовут?"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}

        {mode !== 'forgot' && (
          <PasswordField
            label="Пароль"
            value={password}
            onChange={setPassword}
            required
            minLength={mode === 'register' ? 8 : undefined}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            hint={mode === 'register' ? 'Не короче 8 символов.' : undefined}
          />
        )}

        <button className="primary auth-wide" type="submit" disabled={busy}>
          {busy ? <Loader2 size={16} className="auth-spin" /> : <LogIn size={16} />}
          {mode === 'register'
            ? 'Создать аккаунт'
            : mode === 'forgot'
              ? 'Прислать ссылку'
              : 'Войти'}
        </button>
      </form>

      <div className="auth-switch">
        {mode === 'login' && (
          <>
            <button type="button" className="text-button" onClick={() => setMode('register')}>
              Создать аккаунт
            </button>
            {mail && (
              <button type="button" className="text-button" onClick={() => setMode('forgot')}>
                Забыли пароль?
              </button>
            )}
          </>
        )}
        {mode !== 'login' && (
          <button type="button" className="text-button" onClick={() => setMode('login')}>
            Уже есть аккаунт — войти
          </button>
        )}
      </div>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-dialog auth-dialog">
        {user ? account : form}

        {error && (
          <p role="alert" className="error-banner auth-message">
            {error}
          </p>
        )}
        {notice && (
          <p className="auth-notice">
            <MailCheck size={15} /> {notice}
          </p>
        )}
        {devLink && (
          // Отправка писем не настроена, и запрос пришёл с локального адреса:
          // показываем ссылку разработчику вместо письма.
          <p className="auth-notice auth-dev-link">
            Письма не настроены. Ссылка для этого запроса:{' '}
            <a href={devLink}>{devLink}</a>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Кнопка в шапке: имя вошедшего или приглашение войти. */
export function AccountButton({
  user,
  loading,
  onClick,
}: {
  user: AuthUser | null;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="account-chip"
      onClick={onClick}
      title={user ? `Аккаунт ${user.email}` : 'Войти или создать аккаунт'}
    >
      {user ? (
        <>
          <span className="auth-avatar auth-avatar-sm" aria-hidden="true">
            {(user.name || user.email).slice(0, 1).toUpperCase()}
          </span>
          <span className="account-chip-name">{user.name || user.email}</span>
        </>
      ) : (
        <>
          <LogIn size={16} aria-hidden="true" />
          {loading ? 'Проверяем вход…' : 'Войти'}
        </>
      )}
    </button>
  );
}
