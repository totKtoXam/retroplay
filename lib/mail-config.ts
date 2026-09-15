/**
 * Выбор способа отправки писем по переменным окружения.
 *
 * Вынесено отдельно от `db/auth-mail.ts`, потому что правило важное и неочевидное:
 * письма и вход через Google настраиваются независимо. Ящик-отправитель можно
 * подключить, не включая кнопку «Продолжить с Google» — это нужно там, где
 * Google-вход невозможен (например, LAN-сервер по http: Google не принимает
 * такой адрес возврата), а восстановление пароля по почте нужно.
 *
 * Поэтому у почты своя пара ключей `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`, и
 * только если её нет — берётся клиент входа `GOOGLE_*` (обычный случай, когда
 * OAuth-клиент один на всё).
 */

export type MailEnv = {
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_SENDER?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
};

export type MailMode = 'gmail' | 'resend' | 'dev';

const trimmed = (value: string | undefined) => (value || '').trim();

/** Клиент, которым Gmail API выдаёт токен отправки. */
export function mailClient(env: MailEnv) {
  return {
    id: trimmed(env.GMAIL_CLIENT_ID) || trimmed(env.GOOGLE_CLIENT_ID),
    secret: trimmed(env.GMAIL_CLIENT_SECRET) || trimmed(env.GOOGLE_CLIENT_SECRET),
  };
}

/** Чем отправлять письма. `dev` — ключей нет, письма не уходят. */
export function mailMode(env: MailEnv): MailMode {
  const client = mailClient(env);
  if (trimmed(env.GMAIL_REFRESH_TOKEN) && client.id && client.secret)
    return 'gmail';
  if (trimmed(env.RESEND_API_KEY)) return 'resend';
  return 'dev';
}

/**
 * Адрес в поле «От кого». У Gmail он обязан принадлежать ящику, которым выдан
 * refresh-токен: чужой адрес Gmail просто перепишет на свой.
 */
export function mailSender(env: MailEnv) {
  return (
    trimmed(env.MAIL_FROM) ||
    trimmed(env.GMAIL_SENDER) ||
    'Jinaly <no-reply@jinaly.local>'
  );
}

/**
 * Домены из RFC 2606/6761, зарезервированные под примеры и тесты: почты там не
 * существует в принципе. Письмо на такой адрес Gmail примет, но оно вернётся
 * отлётом в ящик отправителя — а после интеграционных тестов таких писем
 * набирается по десятку за прогон. Поэтому на них не отправляем вовсе.
 */
const RESERVED_DOMAINS = ['test', 'example', 'invalid', 'localhost'];
const RESERVED_HOSTS = ['example.com', 'example.net', 'example.org'];

export function isUndeliverable(email: unknown) {
  const domain = (typeof email === 'string' ? email : '')
    .trim()
    .toLowerCase()
    .split('@')[1];
  if (!domain) return true;
  // Поддомены example.* зарезервированы вместе с самой зоной.
  if (RESERVED_HOSTS.some((host) => domain === host || domain.endsWith('.' + host)))
    return true;
  const tld = domain.split('.').pop() || '';
  return RESERVED_DOMAINS.includes(tld);
}
