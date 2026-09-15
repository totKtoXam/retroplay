'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';

export type AuthUser = {
  /** Публичная личность участника: та же строка, что у `members.session`. */
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  hasPassword: boolean;
  google: boolean;
  avatar: string;
};

export type AuthState = {
  loading: boolean;
  user: AuthUser | null;
  /** Настроен ли вход через Google и отправка писем на этом сервере. */
  google: boolean;
  mail: boolean;
};

/**
 * Состояние входа для лобби и страницы сброса пароля. Аккаунт не обязателен:
 * без него приложение работает по гостевой cookie, поэтому `user === null` —
 * нормальное состояние, а не ошибка.
 */
export function useAuth() {
  const [state, setState] = useState<AuthState>({
    loading: true,
    user: null,
    google: false,
    mail: false,
  });

  const refresh = useCallback(async () => {
    try {
      const data = await api<{
        user: AuthUser | null;
        google: boolean;
        mail: boolean;
      }>('/api/auth/me');
      setState({
        loading: false,
        user: data.user,
        google: !!data.google,
        mail: !!data.mail,
      });
      // Имя из аккаунта подставляется в форму входа в комнату, но не затирает
      // имя, которое человек уже выбрал на этом устройстве.
      if (data.user?.name && !localStorage.getItem('jinaly-name'))
        localStorage.setItem('jinaly-name', data.user.name);
      return data.user;
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
      return null;
    }
  }, []);

  useEffect(() => {
    // Запрос уходит микрозадачей: состояние меняется уже после эффекта.
    void Promise.resolve().then(refresh);
  }, [refresh]);

  return { ...state, refresh };
}
