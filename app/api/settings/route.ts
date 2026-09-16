import { json, payload, discardBody } from '@/db/server';
import { currentUser, readUserSettings, writeUserSettings } from '@/db/auth';
import { cleanSettings } from '@/lib/settings-sync';

/**
 * Личные настройки аккаунта (lib/settings-sync.ts). Гостю отвечаем `user: null`
 * без ошибки: у него настройки просто остаются на устройстве.
 */
export async function GET(request: Request) {
  try {
    const found = await currentUser(request);
    if (!found) return json({ user: null, settings: {}, updated: 0 });
    const saved = await readUserSettings(found.user.id);
    return json({ user: found.user.id, ...saved });
  } catch (error) {
    console.error(error);
    return json({ error: 'Не удалось загрузить настройки' }, 503);
  }
}

/**
 * Сохранение поверх версии `base`. Если её уже сменило другое устройство —
 * 409 со свежими настройками: клиент сливает их со своими и повторяет запись.
 */
export async function POST(request: Request) {
  try {
    const body = await payload(request);
    const found = await currentUser(request);
    if (!found) return json({ error: 'Войдите в аккаунт' }, 401);
    const base = Number(body.base);
    if (!Number.isSafeInteger(base) || base < 0)
      return json({ error: 'Неверная версия настроек' }, 400);
    const settings = cleanSettings(body.settings);
    const updated = await writeUserSettings(found.user.id, settings, base);
    if (updated === null)
      return json(
        { user: found.user.id, ...(await readUserSettings(found.user.id)) },
        409,
      );
    return json({ user: found.user.id, settings, updated });
  } catch (error) {
    await discardBody(request);
    console.error(error);
    return json({ error: 'Не удалось сохранить настройки' }, 400);
  }
}
