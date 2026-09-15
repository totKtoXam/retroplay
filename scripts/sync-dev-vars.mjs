/**
 * Кладёт `.dev.vars` рядом с собранным конфигом воркера.
 *
 * Wrangler ищет `.dev.vars` в каталоге файла конфигурации, а не в рабочем
 * каталоге. Продакшен-запуск идёт с `--config dist/server/wrangler.json`,
 * поэтому секреты из корня проекта туда надо принести — иначе воркер стартует
 * вообще без переменных, и отправка писем молча уходит в режим заглушки
 * (проверено на LAN-сервере: в списке привязок были только ROOM_HUB и DB).
 *
 * Запускается перед `wrangler dev` из `npm start` и из `start-lan.sh`. Каталог
 * `dist/` в Git не попадает, так что копия секретов никуда не уезжает.
 */
import { copyFileSync, existsSync, chmodSync } from 'node:fs';

const SOURCE = '.dev.vars';
const TARGET = 'dist/server/.dev.vars';

if (!existsSync(SOURCE)) {
  // Это нормальный режим: без секретов работают гостевой вход и регистрация.
  console.log('[dev-vars] .dev.vars нет — воркер стартует без переменных окружения');
} else if (!existsSync('dist/server')) {
  console.warn('[dev-vars] dist/server не собран — сначала `npm run build`');
} else {
  copyFileSync(SOURCE, TARGET);
  try {
    // Секреты не должны быть читаемы всем на общей машине.
    chmodSync(TARGET, 0o600);
  } catch {
    // На Windows прав POSIX нет — не повод падать.
  }
  console.log(`[dev-vars] секреты скопированы в ${TARGET}`);
}
