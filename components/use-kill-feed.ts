import { useEffect, useRef, useState } from 'react';
import type { Room } from '@/lib/model';
import type { HitZone } from '@/lib/game-items';
import type { HudMarkZone } from './hud-feedback';
import type { DeathInfo } from './hud-states';

export type KillMessage = {
  id: string;
  killer: string;
  killerName: string;
  victim: string;
  victimName: string;
  assister?: string;
  assisterName?: string;
  color?: string;
  tool?: string;
  headshot?: boolean;
  scoped?: boolean;
  noScope?: boolean;
  pelletsHit?: number;
  teamkill?: boolean;
  at: number;
};
export type PersonalAlert = {
  text: string;
  sub?: string;
  type: 'kill' | 'assist' | 'death';
  key: string | number;
};

/**
 * Лента убийств и всё, что рождает эффект `kill` в комнате: строки ленты,
 * личные плашки («Вы устранили», «Помощь»), карточка своей смерти, объявление
 * для скринридера, отметка попадания у прицела и звук своего убийства.
 *
 * Вынесено из world.tsx дословно: те же состояния и эффекты в том же порядке.
 * Движку мира отсюда нужны `hitMarker` (отметка своего попадания) и
 * `killSoundRef`, который он заполняет: звук синтезирует world-weapon-sounds.ts.
 * `setPersonalAlert` — для плашки «+1 ГОЛОС», `setDeathInfo` — чтобы убрать
 * карточку смерти после возрождения.
 */
export function useKillFeed(
  effects: Room['effects'],
  selfId: string,
  /** Движок мира: своя позиция — для дистанции до убийцы на карточке смерти. */
  engine: { readonly current: { player: { pos: { x: number; y: number; z: number } } } | null },
  /** Последние пропсы мира: позы участников. */
  latest: { readonly current: { room: Room } },
) {
  const [killfeed, setKillfeed] = useState<KillMessage[]>([]);
  const [personalAlert, setPersonalAlert] = useState<PersonalAlert | null>(null);
  // Кто и чем убил: карточка смерти держит это до возрождения.
  const [deathInfo, setDeathInfo] = useState<DeathInfo | null>(null);
  // Единственное, что HUD объявляет скринридеру: своё убийство и своя смерть.
  const [announce, setAnnounce] = useState('');
  // Отметка своего попадания: голова, корпус, конечность — и убийство.
  const [hitMark, setHitMark] = useState<{ zone: HudMarkZone; key: number } | null>(null);
  const hitMarker = useRef((zone: HitZone) => {
    setHitMark({ zone, key: Date.now() });
  });
  useEffect(() => {
    if (!hitMark) return;
    const timer = setTimeout(() => setHitMark(null), hitMark.zone === 'kill' ? 1000 : 700);
    return () => clearTimeout(timer);
  }, [hitMark]);
  const seenKillsRef = useRef<Set<string>>(new Set());
  /** Звук своего убийства — его синтезирует движок (world-weapon-sounds), вызывает лента убийств. */
  const killSoundRef = useRef<(() => void) | null>(null);
  const initialKillsProcessed = useRef(false);

  useEffect(() => {
    if (!effects) return;
    const now = Date.now();
    if (!initialKillsProcessed.current) {
      initialKillsProcessed.current = true;
      for (const e of effects) {
        if (e.kind === 'kill') seenKillsRef.current.add(e.id);
      }
      return;
    }

    const newKills: KillMessage[] = [];
    for (const e of effects) {
      if (e.kind === 'kill' && !seenKillsRef.current.has(e.id)) {
        seenKillsRef.current.add(e.id);
        if (now - (e.at || now) < 8000) {
          const item: KillMessage = {
            id: e.id,
            killer: e.killer || e.author,
            killerName: e.killerName || 'Игрок',
            victim: e.victim || '',
            victimName: e.victimName || 'Игрок',
            assister: e.assister,
            assisterName: e.assisterName,
            color: e.color || '#ff647c',
            tool: e.tool || 'paint',
            headshot: e.headshot,
            scoped: e.scoped,
            noScope: e.noScope,
            pelletsHit: e.pelletsHit,
            teamkill: e.teamkill,
            at: e.at || now,
          };
          newKills.push(item);

          if (item.killer === selfId && item.victim !== selfId) {
            queueMicrotask(() => {
              let text = `ВЫ УСТРАНИЛИ: ${item.victimName}`;
              if (item.tool === 'sniper' && item.noScope) {
                text = item.headshot
                  ? `БЕЗ ПРИЦЕЛА И В ГОЛОВУ: ${item.victimName}`
                  : `УСТРАНЁН БЕЗ ПРИЦЕЛА: ${item.victimName}`;
              } else if (item.headshot) {
                text = `ВЫ УСТРАНИЛИ В ГОЛОВУ: ${item.victimName}`;
              } else if (item.tool === 'confetti' && (item.pelletsHit || 0) >= 7) {
                text = `ВЫ УСТРАНИЛИ В УПОР: ${item.victimName}`;
              }
              setPersonalAlert({
                type: 'kill',
                text,
                sub: item.assisterName ? `Помог: ${item.assisterName}` : undefined,
                key: `kill-${Date.now()}-${Math.random()}`,
              });
              // Верхняя ступень хитмаркера: убийство видно у прицела, не только в ленте.
              setHitMark({ zone: 'kill', key: Date.now() });
              killSoundRef.current?.();
              setAnnounce(`Вы устранили: ${item.victimName}`);
            });
          } else if (item.assister === selfId) {
            queueMicrotask(() => {
              setPersonalAlert({
                type: 'assist',
                text: `ПОМОЩЬ В УСТРАНЕНИИ: ${item.victimName}`,
                sub: `Устранил: ${item.killerName}`,
                key: `assist-${Date.now()}-${Math.random()}`,
              });
            });
          } else if (item.victim === selfId) {
            // Своя смерть — карточкой до конца отсчёта (HudDeathCard), а не
            // оповещением на 3,5 секунды. Дистанцию считаем сейчас: к моменту
            // возрождения убийца уйдёт.
            const me = engine.current?.player.pos;
            // Позы — из последнего снимка: эффект срабатывает на новые эффекты, а не на позы.
            const pose = latest.current.room.members.find((m) => m.id === item.killer)?.pose;
            const distance =
              me && pose && item.killer !== selfId
                ? Math.hypot(pose.x - me.x, pose.y - me.y, pose.z - me.z)
                : undefined;
            queueMicrotask(() => {
              setDeathInfo({
                killer: item.killer,
                killerName: item.killerName,
                tool: item.tool,
                headshot: item.headshot,
                noScope: item.tool === 'sniper' && item.noScope,
                teamkill: item.teamkill,
                distance,
              });
              setAnnounce(
                item.killer === selfId
                  ? 'Вы погибли'
                  : `Вас устранил: ${item.killerName}`,
              );
            });
          }
        }
      }
    }

    if (newKills.length > 0) {
      queueMicrotask(() => {
        setKillfeed((prev) => [...prev, ...newKills].slice(-5));
      });
    }
    // engine и latest — ref-объекты: их тождество не меняется, эффект по ним не перезапускается.
  }, [effects, selfId, engine, latest]);

  useEffect(() => {
    if (killfeed.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setKillfeed((prev) => prev.filter((k) => now - k.at < 5000));
    }, 400);
    return () => clearInterval(timer);
  }, [killfeed.length]);

  useEffect(() => {
    if (!personalAlert) return;
    const timer = setTimeout(() => {
      setPersonalAlert(null);
    }, 3500);
    return () => clearTimeout(timer);
  }, [personalAlert]);
  return {
    killfeed,
    personalAlert,
    setPersonalAlert,
    deathInfo,
    setDeathInfo,
    announce,
    hitMark,
    hitMarker,
    killSoundRef,
  };
}
