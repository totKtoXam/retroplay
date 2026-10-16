'use client';
/* oxlint-disable next/no-html-link-for-pages -- Полная навигация обходит ошибку RSC prefetch в production-сборке vinext. */

import { Box, ChevronRight, Lock } from 'lucide-react';
import type { JoinInfo } from './use-room-sync';

/** Экран входа по ссылке: имя для открытой комнаты или запрос ведущему для приватной. */
export function RoomJoinScreen({
  join,
  joinRequestSent,
  retryAfterReject,
  setJoinRequestSent,
  setRetryAfterReject,
  name,
  setName,
  busy,
  error,
  setError,
  sendJoinRequest,
  enter,
}: {
  join: JoinInfo;
  joinRequestSent: boolean;
  retryAfterReject: boolean;
  setJoinRequestSent: (value: boolean) => void;
  setRetryAfterReject: (value: boolean) => void;
  name: string;
  setName: (name: string) => void;
  busy: boolean;
  error: string;
  setError: (error: string) => void;
  sendJoinRequest: (overrideName?: string) => Promise<void>;
  enter: (overrideName?: string) => Promise<void>;
}) {
  const isPrivate = !!join.isPrivate;
  // The server keeps reporting the latest (rejected) request until a new one is sent.
  const isRejected = join.requestStatus === 'rejected' && !retryAfterReject;
  const isPending =
    join.requestStatus === 'pending' ||
    (joinRequestSent && join.requestStatus !== 'rejected');
  const isFull = (join.membersCount || 0) >= (join.maxPlayers || 8);

  return (
    <main className="join-screen">
      <a className="brand" href="/">
        <span className="brand-symbol">Ж</span>jinaly
      </a>
      <div className="join-card">
        {isPrivate && (
          <span className="private-room-badge">
            <Lock size={13} /> Приватная комната
          </span>
        )}
        <span className="join-emoji">{isPrivate ? '🔐' : '🤝'}</span>
        <h1>{join.title}</h1>
        <div className="join-room-meta-info">
          <span>
            Ведущий: <b>{join.hostName || 'Ведущий'}</b>
          </span>
          <span>
            Участники:{' '}
            <b>
              {join.membersCount || 0} / {join.maxPlayers || 8}
            </b>
          </span>
        </div>

        {isPrivate ? (
          isPending ? (
            <div className="join-waiting-box">
              <div className="waiting-spinner" />
              <span className="waiting-title">
                Ожидание одобрения ведущего…
              </span>
              <p className="waiting-text">
                Ведущий ({join.hostName || 'Ведущий'}) получил ваш запрос на
                вход. Комната откроется автоматически сразу после одобрения.
              </p>
              <a href="/" className="secondary">
                К списку комнат
              </a>
            </div>
          ) : isRejected ? (
            <div className="join-rejected-box">
              <span className="rejected-icon">🚫</span>
              <span className="rejected-title">Запрос отклонён</span>
              <p className="rejected-text">
                Ведущий отклонил ваш запрос на вход в эту комнату.
              </p>
              <button
                className="primary"
                onClick={() => {
                  setJoinRequestSent(false);
                  setRetryAfterReject(true);
                  setError('');
                }}
              >
                Попробовать снова
              </button>
              <a href="/" className="secondary">
                К списку комнат
              </a>
            </div>
          ) : (
            <>
              <p className="muted">
                Для входа в эту комнату требуется подтверждение ведущего.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendJoinRequest(name);
                }}
              >
                <label className="field">
                  Ваше имя
                  <input
                    required
                    maxLength={40}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Как вас зовут?"
                  />
                </label>
                <button
                  className="primary full-width"
                  disabled={busy || isFull}
                >
                  {busy
                    ? 'Отправка запроса…'
                    : isFull
                      ? 'Комната заполнена'
                      : 'Отправить запрос на вход'}{' '}
                  <ChevronRight size={17} />
                </button>
              </form>
            </>
          )
        ) : (
          <>
            <p className="muted">
              Команда ждёт вас. Представьтесь, чтобы присоединиться.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void enter();
              }}
            >
              <label className="field">
                Ваше имя
                <input
                  required
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Как вас зовут?"
                />
              </label>
              <button
                className="primary full-width"
                disabled={busy || isFull}
              >
                {busy
                  ? 'Подключаемся…'
                  : isFull
                    ? 'Комната заполнена'
                    : 'Войти в комнату'}{' '}
                <ChevronRight size={17} />
              </button>
            </form>
          </>
        )}

        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

/** Комната ещё грузится или открыть её не удалось. */
export function RoomLoadingScreen({
  error,
  setError,
  refresh,
}: {
  error: string;
  setError: (error: string) => void;
  refresh: () => Promise<void>;
}) {
  return (
    <main className="join-screen">
      <a href="/" className="brand">
        <span className="brand-symbol">Ж</span>jinaly
      </a>
      <div className="join-card">
        <CompassPlaceholder />
        <h2>
          {error
            ? 'Не удалось открыть комнату'
            : 'Готовим место для встречи…'}
        </h2>
        <p className="muted">
          {error || 'Подключаем общую доску и участников'}
        </p>
        {error && (
          <>
            <button
              className="primary"
              onClick={() => void refresh().catch((e) => setError(e.message))}
            >
              Повторить
            </button>
            <a href="/" className="secondary">
              К комнатам
            </a>
          </>
        )}
      </div>
    </main>
  );
}

function CompassPlaceholder() {
  return (
    <div className="loading-orbit">
      <Box size={36} />
    </div>
  );
}
