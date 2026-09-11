declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ROOM_HUB: DurableObjectNamespace<import('../worker/room-hub').RoomHub>;
  }
}
