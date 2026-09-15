declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ROOM_HUB: DurableObjectNamespace<import('../worker/room-hub').RoomHub>;
    /**
     * Вход через Google и отправка писем. Заданы не в каждом окружении: без них
     * работает гостевой вход и регистрация по почте, а ссылки подтверждения
     * пишутся в консоль воркера (db/auth-mail.ts). Локально — в `.dev.vars`,
     * на сервере — секретами wrangler.
     */
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    /** Нужен, если адрес возврата не совпадает с origin запроса. */
    GOOGLE_REDIRECT_URI?: string;
    /** Refresh-токен адреса, от имени которого Gmail API шлёт письма. */
    GMAIL_REFRESH_TOKEN?: string;
    GMAIL_SENDER?: string;
    /**
     * Отдельный OAuth-клиент для писем. Нужен, чтобы подключить отправку, не
     * включая кнопку входа через Google. Если не задан — берётся `GOOGLE_*`.
     */
    GMAIL_CLIENT_ID?: string;
    GMAIL_CLIENT_SECRET?: string;
    RESEND_API_KEY?: string;
    MAIL_FROM?: string;
    /** Базовый адрес приложения для ссылок в письмах. */
    APP_URL?: string;
  }
}
