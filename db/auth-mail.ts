/**
 * Отправка писем аккаунтов: подтверждение почты и сброс пароля.
 *
 * В Cloudflare Workers нет SMTP, поэтому письма уходят по HTTPS:
 *  - `gmail` — Gmail API по `GMAIL_REFRESH_TOKEN`, который владелец ящика
 *    выдаёт один раз. Клиент берётся из `GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`,
 *    а если их нет — из клиента входа `GOOGLE_*` (lib/mail-config.ts). Своя
 *    пара нужна, чтобы включить письма, не включая кнопку входа через Google;
 *  - `resend` — если задан `RESEND_API_KEY`;
 *  - `dev` — ключей нет: ссылка пишется в консоль воркера и возвращается
 *    клиенту, но только когда запрос пришёл с локального адреса.
 */
import { authEnv } from './auth';
import {
  mailClient,
  isUndeliverable,
  mailMode as chooseMailMode,
  mailSender,
  type MailMode,
} from '@/lib/mail-config';

export type { MailMode };

export type Letter = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** Какой способ отправки настроен в этом окружении. */
export const mailMode = (): MailMode => chooseMailMode(authEnv());

export const mailConfigured = () => mailMode() !== 'dev';

/** Адрес отправителя: у Gmail это обязан быть адрес выданного refresh-токена. */
const sender = () => mailSender(authEnv());

const utf8 = new TextEncoder();

function base64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const base64Utf8 = (value: string) => base64(utf8.encode(value));

const base64Url = (value: string) =>
  base64Utf8(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** RFC 2047: кириллическая тема письма иначе приедет вопросительными знаками. */
const encodeSubject = (subject: string) => `=?UTF-8?B?${base64Utf8(subject)}?=`;

let gmailToken = { value: '', until: 0 };

/** Access-токен Gmail живёт час; на изолят он берётся один раз. */
async function gmailAccessToken() {
  const env = authEnv();
  const client = mailClient(env);
  if (gmailToken.value && gmailToken.until > Date.now()) return gmailToken.value;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.id,
      client_secret: client.secret,
      refresh_token: (env.GMAIL_REFRESH_TOKEN || '').trim(),
      grant_type: 'refresh_token',
    }),
  });
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!response.ok || !data.access_token)
    throw Error(
      'Gmail не выдал токен отправки: ' +
        (data.error_description || data.error || response.status),
    );
  gmailToken = {
    value: data.access_token,
    until: Date.now() + Math.max(0, (data.expires_in || 3600) - 60) * 1000,
  };
  return gmailToken.value;
}

/** Письмо в виде RFC 2822: текстовая и HTML-версии одним multipart/alternative. */
function rawMessage(letter: Letter) {
  const boundary = `jinaly-${crypto.randomUUID()}`;
  return [
    `From: ${sender()}`,
    `To: ${letter.to}`,
    `Subject: ${encodeSubject(letter.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Utf8(letter.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Utf8(letter.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function sendViaGmail(letter: Letter) {
  const token = await gmailAccessToken();
  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: base64Url(rawMessage(letter)) }),
    },
  );
  if (!response.ok) {
    // Токен мог быть отозван — следующая попытка не должна брать его из кеша.
    gmailToken = { value: '', until: 0 };
    throw Error('Gmail отклонил письмо: ' + (await response.text()).slice(0, 300));
  }
}

async function sendViaResend(letter: Letter) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authEnv().RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sender(),
      to: [letter.to],
      subject: letter.subject,
      text: letter.text,
      html: letter.html,
    }),
  });
  if (!response.ok)
    throw Error('Resend отклонил письмо: ' + (await response.text()).slice(0, 300));
}

/** Локальная разработка: ссылку показываем открыто только на своём же компьютере. */
export function isLocalRequest(request: Request) {
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * Шлёт письмо. Возвращает ссылку, если отправлять нечем и запрос локальный —
 * тогда форма покажет её разработчику вместо письма.
 */
export async function sendLetter(
  request: Request,
  letter: Letter,
  link: string,
): Promise<{ delivered: boolean; link?: string }> {
  const mode = mailMode();
  // Зарезервированные тестовые домены письма принять не могут — только отлёт.
  if (mode !== 'dev' && isUndeliverable(letter.to)) {
    console.log(`[auth] письмо для ${letter.to} не отправлено: домен зарезервирован под тесты`);
    return isLocalRequest(request) ? { delivered: false, link } : { delivered: false };
  }
  if (mode === 'dev') {
    console.log(`[auth] письмо для ${letter.to} не отправлено (почта не настроена): ${link}`);
    return isLocalRequest(request) ? { delivered: false, link } : { delivered: false };
  }
  if (mode === 'gmail') await sendViaGmail(letter);
  else await sendViaResend(letter);
  return { delivered: true };
}

const shell = (title: string, body: string, action: string, link: string) => `
<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#161616">
  <p style="font-size:20px;font-weight:700;margin:0 0 16px">Jinaly · Retro 3D</p>
  <h1 style="font-size:19px;margin:0 0 12px">${title}</h1>
  <p style="line-height:1.55;margin:0 0 20px">${body}</p>
  <p style="margin:0 0 20px">
    <a href="${link}" style="display:inline-block;background:#f25c2a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${action}</a>
  </p>
  <p style="color:#6b6b6b;font-size:13px;line-height:1.5;margin:0">
    Если кнопка не работает, откройте ссылку: <br /><a href="${link}" style="color:#f25c2a">${link}</a>
  </p>
</div>`;

export const verifyLetter = (to: string, link: string): Letter => ({
  to,
  subject: 'Подтвердите почту в Jinaly',
  text: `Подтвердите адрес почты для входа в Jinaly: ${link}\n\nСсылка действует сутки. Если вы не регистрировались, письмо можно не читать.`,
  html: shell(
    'Подтвердите почту',
    'Осталось подтвердить адрес — тогда вы сможете восстановить пароль и входить с любого устройства. Ссылка действует сутки.',
    'Подтвердить почту',
    link,
  ),
});

export const resetLetter = (to: string, link: string): Letter => ({
  to,
  subject: 'Сброс пароля в Jinaly',
  text: `Чтобы задать новый пароль в Jinaly, откройте ссылку: ${link}\n\nСсылка действует час. Если вы не просили сброс, ничего делать не нужно — пароль не изменится.`,
  html: shell(
    'Новый пароль',
    'Вы попросили сбросить пароль. Ссылка действует час. Если это были не вы, ничего делать не нужно — пароль останется прежним.',
    'Задать новый пароль',
    link,
  ),
});
