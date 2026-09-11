import vinext from 'vinext/server/fetch-handler';
import { session } from '@/db/server';

export { RoomHub } from './room-hub';

const SOCKET_PATH = /^\/api\/rooms\/([A-Za-z0-9_-]{1,64})\/socket$/;

/**
 * Worker entry: WebSocket upgrades for a room go straight to that room's Durable Object
 * (route handlers can't return a 101 through vinext); everything else is vinext.
 */
export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const match = SOCKET_PATH.exec(new URL(request.url).pathname);
    if (match && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      // The socket is authenticated by cookie, so a foreign page must not be able to open it.
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin)
        return new Response('Источник запроса не разрешён', { status: 403 });
      const self = await session(request);
      if (!self) return new Response('Откройте приложение заново', { status: 401 });
      const stub = env.ROOM_HUB.get(env.ROOM_HUB.idFromName(match[1]));
      const headers = new Headers(request.headers);
      headers.set('x-room', match[1]);
      headers.set('x-session', self);
      return stub.fetch(new Request(request, { headers }));
    }
    return vinext.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
