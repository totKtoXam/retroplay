import { db } from './server';
import {
  calculatePelletsHit,
  effectDamage,
  inHitRange,
  isHeadshot,
} from '../lib/game-items';
import { uid, type Pose, type WorldEffect } from '../lib/model';

const spawn = JSON.stringify({
  x: 0,
  y: 0,
  z: 4,
  yaw: 0,
  stance: 'stand',
  moving: false,
});

let schemaUpgraded = false;
async function ensureCombatColumns() {
  if (schemaUpgraded) return;
  try {
    await db()
      .prepare('ALTER TABLE members ADD COLUMN kills INTEGER NOT NULL DEFAULT 0')
      .run();
  } catch {}
  try {
    await db()
      .prepare('ALTER TABLE members ADD COLUMN deaths INTEGER NOT NULL DEFAULT 0')
      .run();
  } catch {}
  try {
    await db()
      .prepare('ALTER TABLE members ADD COLUMN assists INTEGER NOT NULL DEFAULT 0')
      .run();
  } catch {}
  try {
    await db()
      .prepare("ALTER TABLE members ADD COLUMN recent_damage TEXT NOT NULL DEFAULT '{}'")
      .run();
  } catch {}
  try {
    await db()
      .prepare('ALTER TABLE members ADD COLUMN immune_until INTEGER NOT NULL DEFAULT 0')
      .run();
  } catch {}
  schemaUpgraded = true;
}

/** Each effect is resolved once inside a D1 transaction, including concurrent polls. */
export async function resolveCombat(room: string, respawnSeconds = 5) {
  await ensureCombatColumns();
  const now = Date.now();

  // Revive dead members whose respawn time reached; grant 5 seconds spawn protection
  await db()
    .prepare(
      'UPDATE members SET hp=100,respawn_at=0,life=life+1,immune_until=?,recent_damage="{}",pose=? WHERE room=? AND hp=0 AND respawn_at>0 AND respawn_at<=?',
    )
    .bind(now + 5000, spawn, room, now)
    .run();

  const pending = await db()
    .prepare(
      'SELECT id,payload,author FROM effects WHERE room=? AND applied=0 AND resolve_at>0 AND resolve_at<=? AND at>? ORDER BY at LIMIT 80',
    )
    .bind(room, now, now - 15000)
    .all<{ id: string; payload: string; author: string }>();

  for (const row of pending.results) {
    const e = JSON.parse(String(row.payload)) as WorldEffect;
    const people = await db()
      .prepare(
        'SELECT session,name,color,pose,hp,immune_until,recent_damage FROM members WHERE room=? AND hp>0 AND seen>?',
      )
      .bind(room, now - 15000)
      .all<{
        session: string;
        name: string;
        color: string;
        pose: string;
        hp: number;
        immune_until?: number;
        recent_damage?: string;
      }>();

    const hits = people.results.filter(
      (p) =>
        p.session !== row.author &&
        (e.kind === 'confetti'
          ? calculatePelletsHit(
              e.origin || [0, 0, 0],
              e.target || [0, 0, 0],
              JSON.parse(String(p.pose)) as Pose,
            ).pelletsHit > 0
          : inHitRange(
              e.kind,
              e.origin || [0, 0, 0],
              e.target || [0, 0, 0],
              JSON.parse(String(p.pose)) as Pose,
            )),
    );

    if (hits.length === 0) {
      await db()
        .prepare('UPDATE effects SET applied=1 WHERE id=? AND applied=0')
        .bind(row.id)
        .run();
      continue;
    }

    // Get author / killer info
    let authorName = 'Игрок';
    let authorColor = '#ff647c';
    let authorImmune = false;
    const authorMember =
      people.results.find((m) => m.session === row.author) ||
      (await db()
        .prepare('SELECT name,color,immune_until FROM members WHERE room=? AND session=?')
        .bind(room, row.author)
        .first<{ name: string; color: string; immune_until?: number }>());
    if (authorMember) {
      authorName = authorMember.name || 'Игрок';
      authorColor = authorMember.color || '#ff647c';
      authorImmune = (authorMember.immune_until || 0) > now;
    }

    // Prepare batch statements
    const statements: Parameters<ReturnType<typeof db>['batch']>[0] = [];

    for (const p of hits) {
      const victimImmune = (p.immune_until || 0) > now;
      const pose = JSON.parse(String(p.pose)) as Pose;
      const isHead = isHeadshot(
        e.kind,
        e.origin || [0, 0, 0],
        e.target || [0, 0, 0],
        pose,
      );

      // Immunity check: after respawn cannot die (take damage) and cannot kill (deal damage)
      if (authorImmune || victimImmune) {
        continue;
      }

      let damage: number;
      let pelletsHit: number | undefined;
      if (e.kind === 'confetti') {
        const pelletResult = calculatePelletsHit(
          e.origin || [0, 0, 0],
          e.target || [0, 0, 0],
          pose,
        );
        pelletsHit = pelletResult.pelletsHit;
        if (pelletResult.pelletsHit <= 0) continue;
        damage = isHead ? 100 : pelletResult.damage;
      } else {
        const shotDist = Math.hypot(
          (e.target?.[0] ?? 0) - (e.origin?.[0] ?? 0),
          (e.target?.[1] ?? 0) - (e.origin?.[1] ?? 0),
          (e.target?.[2] ?? 0) - (e.origin?.[2] ?? 0),
        );
        // Headshot deals 100 damage (instant kill)
        damage = isHead ? 100 : effectDamage(e.kind, shotDist);
      }

      let recent: Record<string, number> = {};
      try {
        recent = JSON.parse(p.recent_damage || '{}');
      } catch {}

      if (p.hp <= damage) {
        // Lethal hit
        let assisterSession: string | undefined;
        let assisterName: string | undefined;
        let latestAssistTime = 0;

        for (const [att, time] of Object.entries(recent)) {
          if (att !== row.author && typeof time === 'number' && now - time <= 15000) {
            if (time > latestAssistTime) {
              latestAssistTime = time;
              assisterSession = att;
            }
          }
        }

        if (assisterSession) {
          const assisterMember =
            people.results.find((m) => m.session === assisterSession) ||
            (await db()
              .prepare('SELECT name FROM members WHERE room=? AND session=?')
              .bind(room, assisterSession)
              .first<{ name: string }>());
          assisterName = assisterMember?.name;
        }

        // 1. Victim dies: deaths + 1, hp = 0, respawn_at, recent_damage reset
        statements.push(
          db()
            .prepare(
              'UPDATE members SET respawn_at=?,hp=0,deaths=deaths+1,recent_damage="{}" WHERE room=? AND session=? AND hp>0 AND EXISTS(SELECT 1 FROM effects WHERE id=? AND applied=0)',
            )
            .bind(now + respawnSeconds * 1000, room, p.session, row.id),
        );

        // 2. Killer gets kill + 1
        statements.push(
          db()
            .prepare(
              'UPDATE members SET kills=kills+1 WHERE room=? AND session=? AND EXISTS(SELECT 1 FROM effects WHERE id=? AND applied=0)',
            )
            .bind(room, row.author, row.id),
        );

        // 3. Assister gets assist + 1 if any
        if (assisterSession) {
          statements.push(
            db()
              .prepare(
                'UPDATE members SET assists=assists+1 WHERE room=? AND session=? AND EXISTS(SELECT 1 FROM effects WHERE id=? AND applied=0)',
              )
              .bind(room, assisterSession, row.id),
          );
        }

        // 4. Record kill effect for killfeed notifications
        const isNoScope = e.kind === 'sniper' && (e.noScope ?? !e.scoped);
        const killPayload = JSON.stringify({
          kind: 'kill',
          killer: row.author,
          killerName: authorName,
          victim: p.session,
          victimName: p.name || 'Игрок',
          assister: assisterSession,
          assisterName,
          color: authorColor,
          tool: e.kind,
          headshot: isHead,
          scoped: e.scoped,
          noScope: isNoScope,
          pelletsHit,
        });

        statements.push(
          db()
            .prepare(
              'INSERT INTO effects (id, room, author, applied, resolve_at, payload, at) SELECT ?, ?, ?, 1, 0, ?, ? WHERE EXISTS(SELECT 1 FROM effects WHERE id=? AND applied=0)',
            )
            .bind(uid(), room, row.author, killPayload, now, row.id),
        );
      } else {
        // Non-lethal hit: damage dealt, record recent damage for potential future assist
        recent[row.author] = now;
        statements.push(
          db()
            .prepare(
              'UPDATE members SET hp=MAX(0,hp-?),recent_damage=? WHERE room=? AND session=? AND hp>0 AND EXISTS(SELECT 1 FROM effects WHERE id=? AND applied=0)',
            )
            .bind(damage, JSON.stringify(recent), room, p.session, row.id),
        );
      }
    }

    statements.push(
      db()
        .prepare('UPDATE effects SET applied=1 WHERE id=? AND applied=0')
        .bind(row.id),
    );

    await db().batch(statements);
  }

  // Revive dead members whose respawn time reached; grant 5 seconds spawn protection
  await db()
    .prepare(
      'UPDATE members SET hp=100,respawn_at=0,life=life+1,immune_until=?,recent_damage="{}",pose=? WHERE room=? AND hp=0 AND respawn_at>0 AND respawn_at<=?',
    )
    .bind(now + 5000, spawn, room, now)
    .run();
}
