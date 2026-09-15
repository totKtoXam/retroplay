/**
 * Получение refresh-токена Gmail для отправки писем (docs/auth-setup.md).
 *
 * Запускается один раз на своём компьютере: поднимает локальный сервер на
 * адресе возврата, ждёт согласия в браузере и обменивает код на токены. Ключи
 * наружу не уходят — запрос идёт только на oauth2.googleapis.com.
 *
 *   node scripts/gmail-refresh-token.mjs
 *   node scripts/gmail-refresh-token.mjs --client-file <скачанный.json> --write
 *
 * Флаги:
 *   --client-file <p>  JSON OAuth-клиента, скачанный из Google Cloud Console
 *   --port <n>         порт адреса возврата (по умолчанию 3000)
 *   --path <p>         путь адреса возврата (по умолчанию /api/auth/google/callback)
 *   --sender <a>       адрес отправителя; по умолчанию берётся из ответа Google
 *   --write            записать полученные GMAIL_* в .dev.vars
 *
 * Без `--client-file` ключи берутся из GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET
 * (или GOOGLE_*), а если их нет — спрашиваются в терминале.
 */
import http from 'node:http';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';

/** `openid email` нужен, чтобы узнать ящик, который выдал согласие. */
const SCOPE = 'openid email https://www.googleapis.com/auth/gmail.send';
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf('--' + name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const port = Number(flag('port', '3000'));
const path = flag('path', '/api/auth/google/callback');
const write = args.includes('--write');
const clientFile = flag('client-file', '');
const redirectUri = `http://localhost:${port}${path}`;

/** Ключи из JSON, скачанного в Console: там они лежат под `web` или `installed`. */
async function clientFromFile(file) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const node = data.web || data.installed || {};
  if (!node.client_id || !node.client_secret)
    throw Error(`В ${file} нет client_id/client_secret — это точно файл OAuth-клиента?`);
  if (!data.web)
    console.warn(
      'Внимание: клиент не типа «Web application». Для приложения нужен именно web.',
    );
  const uris = node.redirect_uris || [];
  if (uris.length && !uris.includes(redirectUri))
    console.warn(
      `Внимание: ${redirectUri} нет в списке Authorized redirect URIs клиента.\n` +
        `Там сейчас: ${uris.join(', ') || '(пусто)'}`,
    );
  return { id: node.client_id, secret: node.client_secret };
}

let rl;
const ask = async (question) => {
  rl ??= readline.createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(question)).trim();
  if (!answer) throw Error('Пустое значение, прервано.');
  return answer;
};

/** Разбор полезной части id_token: подпись не проверяется, токен только что от Google. */
function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(
      Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'),
    );
    return typeof payload.email === 'string' ? payload.email : '';
  } catch {
    return '';
  }
}

/** Ждёт возврата от Google на локальный адрес и отдаёт код авторизации. */
function waitForCode(consent) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, `http://localhost:${port}`);
      if (url.pathname !== path) {
        response.writeHead(404).end('not found');
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        `<meta charset="utf-8"><body style="font-family:system-ui;padding:40px">
         <h1>${code ? 'Готово' : 'Не получилось'}</h1>
         <p>${code ? 'Можно закрыть вкладку и вернуться в терминал.' : 'Ошибка: ' + error}</p>`,
      );
      server.close();
      if (code) resolve(code);
      else reject(Error('Google вернул ошибку: ' + error));
    });
    server.on('error', (error) =>
      reject(
        error.code === 'EADDRINUSE'
          ? Error(
              `Порт ${port} занят. Остановите dev-сервер или укажите другой порт флагом --port ` +
                '(и добавьте соответствующий адрес возврата в Google Cloud Console).',
            )
          : error,
      ),
    );
    server.listen(port, 'localhost', () =>
      console.log(`
Откройте в браузере и войдите тем ящиком, от имени которого пойдут письма:

${consent}

Жду возврата на ${redirectUri} …`),
    );
  });
}

/** Дописывает или заменяет строки в .dev.vars, не трогая остальные. */
async function upsertDevVars(values) {
  const existing = await readFile('.dev.vars', 'utf8').catch(() => '');
  const lines = existing ? existing.replace(/\r\n/g, '\n').split('\n') : [];
  for (const [key, value] of Object.entries(values)) {
    const at = lines.findIndex((line) => line.startsWith(key + '='));
    if (at >= 0) lines[at] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  await writeFile('.dev.vars', lines.filter((l, i, a) => l || i < a.length - 1).join('\n').trimEnd() + '\n');
}

try {
  console.log(`
Получение refresh-токена Gmail
------------------------------
Адрес возврата: ${redirectUri}
Он должен быть в списке Authorized redirect URIs вашего OAuth-клиента.
Этот адрес нужен только здесь и только сейчас — чтобы один раз принять
согласие; для самой отправки писем он уже не используется.
`);

  const client = clientFile
    ? await clientFromFile(clientFile)
    : {
        id:
          process.env.GMAIL_CLIENT_ID ||
          process.env.GOOGLE_CLIENT_ID ||
          (await ask('Client ID: ')),
        secret:
          process.env.GMAIL_CLIENT_SECRET ||
          process.env.GOOGLE_CLIENT_SECRET ||
          (await ask('Client secret: ')),
      };

  const consent =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: client.id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      // Без offline и consent Google не выдаёт refresh-токен повторно.
      access_type: 'offline',
      prompt: 'consent',
    });

  const code = await waitForCode(consent);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.id,
      client_secret: client.secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.refresh_token) {
    console.error(
      '\nGoogle не выдал refresh-токен:',
      data.error_description || data.error || response.status,
    );
    if (response.ok)
      console.error(
        'Так бывает, если согласие уже выдавалось раньше. Отзовите доступ на\n' +
          'https://myaccount.google.com/permissions и повторите.',
      );
    process.exit(1);
  }

  const detected = emailFromIdToken(data.id_token);
  const sender =
    flag('sender', '') ||
    detected ||
    (await ask('\nАдрес отправителя (тот же ящик), например you@gmail.com: '));
  if (detected && !flag('sender', ''))
    console.log(`\nЯщик-отправитель: ${sender}`);

  const values = {
    GMAIL_CLIENT_ID: client.id,
    GMAIL_CLIENT_SECRET: client.secret,
    GMAIL_REFRESH_TOKEN: data.refresh_token,
    GMAIL_SENDER: `Jinaly <${sender}>`,
  };

  if (write) {
    await upsertDevVars(values);
    console.log(`
Записано в .dev.vars (файл в Git не попадает): GMAIL_CLIENT_ID,
GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER.

Именно GMAIL_*, а не GOOGLE_*: так письма включаются, а кнопка входа через
Google остаётся скрытой.`);
  } else {
    console.log(`
Готово. Строки для .dev.vars (или запустите ещё раз с флагом --write):

${Object.entries(values)
  .map(([key, value]) => `${key}=${value}`)
  .join('\n')}
`);
  }
} catch (error) {
  console.error('\n' + error.message);
  process.exitCode = 1;
} finally {
  rl?.close();
}
