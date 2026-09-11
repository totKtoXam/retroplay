'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { Room, RoomState, Pose, WorldEffect } from '@/lib/model';
import { api, ready } from '@/lib/client';

export type JoinRequest = {
  id: string;
  session: string;
  name: string;
  status: string;
  created: number;
};
export type JoinInfo = {
  title: string;
  isPrivate?: boolean;
  requestStatus?: 'none' | 'pending' | 'accepted' | 'rejected';
  requestId?: string;
  hostName?: string;
  membersCount?: number;
  maxPlayers?: number;
};
type RoomPayload = Room & {
  join?: boolean;
  title?: string;
  isPrivate?: boolean;
  requestStatus?: 'none' | 'pending' | 'accepted' | 'rejected';
  requestId?: string;
  hostName?: string;
  membersCount?: number;
  maxPlayers?: number;
  joinRequests?: JoinRequest[];
  effects?: WorldEffect[];
};

function compressPose(p: Pose): Pose {
  return {
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
    z: Math.round(p.z * 100) / 100,
    yaw: Math.round(p.yaw * 1000) / 1000,
    stance: p.stance,
    moving: !!p.moving,
    speed: p.speed != null ? Math.round(p.speed * 100) / 100 : undefined,
    strafe: p.strafe != null ? Math.round(p.strafe * 100) / 100 : undefined,
    forward: p.forward != null ? Math.round(p.forward * 100) / 100 : undefined,
    pitch: p.pitch != null ? Math.round(p.pitch * 1000) / 1000 : undefined,
    tool: p.tool,
    variant: p.variant,
    working: !!p.working,
    crouching: !!p.crouching,
    aiming: !!p.aiming,
    reload: p.reload != null ? Math.round(p.reload * 100) / 100 : undefined,
  };
}

/**
 * Room synchronisation: room/join state, the presence poll loop (120–1400 ms depending on
 * mode and idle time), ping and packet-loss stats, and the `op`/`act` write helpers.
 * `onReady` runs once the session is ready, right before the first poll.
 */
export function useRoomSync({
  id,
  pose,
  cursor,
  modeRef,
  lastActivityRef,
  nameRef,
  busyRef,
  enterRef,
  setError,
  onReady,
}: {
  id: string;
  pose: RefObject<Pose>;
  cursor: RefObject<{ x: number; y: number; mode: string }>;
  modeRef: RefObject<string>;
  lastActivityRef: RefObject<number>;
  nameRef: RefObject<string>;
  busyRef: RefObject<boolean>;
  enterRef: RefObject<((name?: string) => Promise<void>) | null>;
  setError: Dispatch<SetStateAction<string>>;
  onReady: () => void;
}) {
  const [room, setRoom] = useState<Room | null>(null),
    [join, setJoin] = useState<JoinInfo | null>(null),
    [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]),
    [packetLoss, setPacketLoss] = useState(0),
    [ping, setPing] = useState(0);
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  const pingRef = useRef(0);
  const lossHistory = useRef<boolean[]>([]);
  const lastEffectAtRef = useRef(0);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  const handleRoomData = useCallback(
    (data: RoomPayload, responseTimeMs?: number) => {
      if (responseTimeMs !== undefined) {
        const smoothed =
          pingRef.current === 0
            ? responseTimeMs
            : Math.round(0.7 * pingRef.current + 0.3 * responseTimeMs);
        setPing(smoothed);
        pingRef.current = smoothed;
      }
      if (data.join) {
        setJoin(data as Room & { title: string });
        if (data.requestStatus === 'accepted') {
          const savedName =
            localStorage.getItem('jinaly-name') || nameRef.current;
          if (savedName && !busyRef.current) {
            void enterRef.current?.(savedName);
          }
        }
        return;
      }
      setJoin(null);
      if (data.joinRequests) {
        setJoinRequests(data.joinRequests);
      }
      if (Array.isArray(data.effects) && data.effects.length > 0) {
        let maxAt = lastEffectAtRef.current;
        for (const e of data.effects) {
          if (e.at && e.at > maxAt) maxAt = e.at;
        }
        lastEffectAtRef.current = maxAt;
      }
      setRoom((old) => {
        if (!old) return data;
        const cutoff = Date.now() - 15000;
        const oldEffects = (old.effects || []).filter(
          (e) => (e.at || 0) > cutoff,
        );
        const newEffects = data.effects || [];
        const seenIds = new Set(oldEffects.map((e) => e.id));
        const mergedEffects = [...oldEffects];
        for (const e of newEffects) {
          if (!seenIds.has(e.id)) {
            seenIds.add(e.id);
            mergedEffects.push(e);
          }
        }
        if (data.version >= old.version) {
          return {
            ...data,
            state: data.state || old.state,
            effects: mergedEffects,
          };
        } else {
          return {
            ...old,
            members: data.members,
            effects: mergedEffects,
          };
        }
      });
      setError('');
    },
    [nameRef, busyRef, enterRef, setError],
  );

  const refresh = useCallback(async () => {
    const start = performance.now();
    const inviteParam =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('invite')
        : null;
    const query = new URLSearchParams();
    if (roomRef.current) query.set('version', String(roomRef.current.version));
    if (inviteParam) query.set('invite', inviteParam);
    if (lastEffectAtRef.current > 0) {
      query.set(
        'sinceEffect',
        String(Math.max(0, lastEffectAtRef.current - 100)),
      );
    }
    const qs = query.toString() ? '?' + query.toString() : '';

    const data = await api<RoomPayload>('/api/rooms/' + id + qs);

    const ms = Math.round(performance.now() - start);
    handleRoomData(data, ms);
  }, [id, handleRoomData]);
  const op = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const data = await api<{
          state?: RoomState;
          version: number;
          ok?: boolean;
        }>('/api/rooms/' + id, body);
        if (data.state)
          setRoom((old) =>
            old && data.version >= old.version
              ? { ...old, state: data.state!, version: data.version }
              : old,
          );
        return data;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      }
    },
    [id, setError],
  );
  // События UI обрабатывают ошибку в общем баннере, не оставляя unhandled rejection.
  const act = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        return await op(body);
      } catch {
        return null;
      }
    },
    [op],
  );
  useEffect(() => {
    let stop = false,
      handle: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let ok = true;
      try {
        if (!document.hidden) {
          if (roomRef.current) {
            const start = performance.now();
            const sinceEffectTime =
              lastEffectAtRef.current > 0
                ? Math.max(0, lastEffectAtRef.current - 100)
                : undefined;
            const res = await api<
              Room & {
                ok?: boolean;
                members?: Room['members'];
                joinRequests?: JoinRequest[];
                effects?: WorldEffect[];
              }
            >('/api/rooms/' + id, {
              type: 'presence',
              life:
                roomRef.current.members.find(
                  (m) => m.id === roomRef.current?.self,
                )?.life || 0,
              pose: compressPose(pose.current),
              ping: pingRef.current,
              cursor: cursor.current,
              version: roomRef.current.version,
              sinceEffect: sinceEffectTime,
            });
            const ms = Math.round(performance.now() - start);
            if (res && res.members) {
              handleRoomData(res, ms);
            } else {
              await refresh();
            }
          } else {
            await refresh();
          }
        }
      } catch (e) {
        ok = false;
        if (!stop) setError((e as Error).message);
      }
      if (!document.hidden) {
        lossHistory.current.push(ok);
        if (lossHistory.current.length > 40) lossHistory.current.shift();
        const lost = lossHistory.current.filter((v) => !v).length;
        setPacketLoss(Math.round((lost / lossHistory.current.length) * 100));
      }
      const idleTime = lastActivityRef.current
        ? Date.now() - lastActivityRef.current
        : 0;
      const interval =
        modeRef.current === '3d'
          ? idleTime > 2000
            ? 300
            : 120
          : idleTime > 3000
            ? 1400
            : 800;
      if (!stop) handle = setTimeout(tick, interval);
    };
    void ready()
      .then(() => {
        if (!stop) {
          onReadyRef.current();
          void tick();
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      stop = true;
      clearTimeout(handle);
    };
  }, [
    id,
    refresh,
    handleRoomData,
    pose,
    cursor,
    lastActivityRef,
    modeRef,
    setError,
  ]);

  return {
    room,
    setRoom,
    join,
    joinRequests,
    setJoinRequests,
    packetLoss,
    ping,
    refresh,
    op,
    act,
  };
}
