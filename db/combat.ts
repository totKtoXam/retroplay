import { db } from './server';
import { effectDamage, inHitRange } from '../lib/game-items';
import type { Pose, WorldEffect } from '../lib/model';
const spawn = JSON.stringify({
  x: 0,
  y: 0,
  z: 4,
  yaw: 0,
  stance: 'stand',
  moving: false,
});
/** Each effect is resolved once inside a D1 transaction, including concurrent polls. */
export async function resolveCombat(room: string, respawnSeconds = 5) {
  const now = Date.now();
  const pending = await db()
    .prepare(
      'SELECT id,payload,author FROM effects WHERE room=? AND applied=0 AND resolve_at>0 AND resolve_at<=? AND at>? ORDER BY at LIMIT 80',
    )
    .bind(room, now, now - 15000)
    .all();
  for (const row of pending.results) {
    const e = JSON.parse(String(row.payload)) as WorldEffect;
    const people = await db()
      .prepare(
        'SELECT session,pose FROM members WHERE room=? AND hp>0 AND seen>?',
      )
      .bind(room, now - 15000)
      .all();
    const damage = effectDamage(e.kind);
    const hits = people.results.filter(
      (p) =>
        p.session !== row.author &&
        inHitRange(
          e.kind,
          e.origin,
          e.target,
          JSON.parse(String(p.pose)) as Pose,
        ),
    );
    await db().batch([
      ...hits.map((p) =>
        db()
          .prepare(
            'UPDATE members SET respawn_at=CASE WHEN hp<=? THEN ? ELSE respawn_at END,hp=MAX(0,hp-?) WHERE room=? AND session=? AND hp>0 AND EXISTS(SELECT 1 FROM effects WHERE id=? AND applied=0)',
          )
          .bind(
            damage,
            now + respawnSeconds * 1000,
            damage,
            room,
            p.session,
            row.id,
          ),
      ),
      db()
        .prepare('UPDATE effects SET applied=1 WHERE id=? AND applied=0')
        .bind(row.id),
    ]);
  }
  await db()
    .prepare(
      'UPDATE members SET hp=100,respawn_at=0,life=life+1,pose=? WHERE room=? AND hp=0 AND respawn_at>0 AND respawn_at<=?',
    )
    .bind(spawn, room, now)
    .run();
}
