import { ToolMagazine, type Blaster } from './tool-magazine.ts';
import type { WeaponReply } from './weapon-protocol.ts';
type Pending = { action: 'fire' | 'reload' | 'cancel' | 'sync'; tool?: Blaster; at: number };
/** Rebase unacknowledged input over the server magazine, never refund an unrelated later shot. */
export class WeaponPrediction {
  readonly magazine = new ToolMagazine();
  private pending = new Map<string, Pending>();
  private revision = -1;
  private life = -1;
  reset(life: number) {
    this.life = life;
    this.revision = -1;
    this.pending.clear();
    this.magazine.restore(new ToolMagazine().snapshot());
  }
  remember(id: string, action: Pending['action'], tool: Blaster | undefined, at: number) {
    this.pending.set(id, { action, tool, at });
  }
  forget(id: string) { this.pending.delete(id); }
  acknowledge(reply: WeaponReply, receivedAt: number) {
    const input = this.pending.get(reply.id);
    // Both transports preserve command order. A later ack includes all earlier inputs.
    if (input) for (const id of this.pending.keys()) {
      this.pending.delete(id);
      if (id === reply.id) break;
    }
    if (reply.life !== this.life || reply.revision <= this.revision) return;
    this.revision = reply.revision;
    // Command processing is anchored to its local prediction. A sync uses the midpoint of its RTT.
    const localNow = input ? input.action === 'sync' ? (input.at + receivedAt) / 2 : input.at : receivedAt;
    this.magazine.restore(reply.magazine, localNow - reply.now);
    for (const p of this.pending.values()) {
      if (p.action === 'cancel') this.magazine.cancel();
      else if (p.action === 'reload' && p.tool) this.magazine.reload(p.tool, p.at);
      else if (p.action === 'fire' && p.tool) this.magazine.fire(p.tool, p.at);
    }
    this.magazine.tick(receivedAt);
  }
}
