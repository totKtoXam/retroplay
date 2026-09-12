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
/** Pushed by the room's Durable Object (worker/room-hub.ts). */
type SocketMessage =
  | {
      t: 'tick';
      now: number;
      members: Room['members'];
      effects: WorldEffect[];
      match?: Room['match'];
    }
  | { t: 'refresh' }
  | { t: 'pong'; at: number }
  | { t: 'error'; message: string };

/** While the socket is down the board still refetches at least this often. */
const SOCKET_REFRESH_MS = 15_000;
/** Remote avatars trail their latest pose by about this much (smoothing in world-remote-players.ts). */
const RENDER_DELAY_MS = 70;

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

/** Keeps effects from the last 15 s and appends the ones not seen yet (by id). */
function mergeEffects(old: WorldEffect[] | undefined, incoming: WorldEffect[] | undefined) {
  const cutoff = Date.now() - 15000;
  const merged = (old || []).filter((e) => (e.at || 0) > cutoff);
  const seenIds = new Set(merged.map((e) => e.id));
  for (const e of incoming || []) {
    if (!seenIds.has(e.id)) {
      seenIds.add(e.id);
      merged.push(e);
    }
  }
  return merged;
}

/**
 * Room synchronisation. Live data (poses, HP, shots) comes over a WebSocket from the room's
 * Durable Object; board changes arrive as `refresh` pushes and are fetched over HTTP. If the
 * socket is down, the old presence poll (120–1400 ms by mode and idle time) takes over.
 * Also: ping and packet-loss stats and the `op`/`act`/`fire` write helpers.
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
  const lastRefreshRef = useRef(0);
  /** Latest server clock reading and when it arrived, to date what the player sees. */
  const clockRef = useRef<{ server: number; local: number } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  const notePing = useCallback((ms: number) => {
    const smoothed =
      pingRef.current === 0 ? ms : Math.round(0.7 * pingRef.current + 0.3 * ms);
    setPing(smoothed);
    pingRef.current = smoothed;
  }, []);

  const noteEffects = useCallback((effects: WorldEffect[] | undefined) => {
    if (!Array.isArray(effects)) return;
    for (const e of effects) {
      if (e.at && e.at > lastEffectAtRef.current) lastEffectAtRef.current = e.at;
    }
  }, []);

  const handleRoomData = useCallback(
    (data: RoomPayload, responseTimeMs?: number) => {
      if (responseTimeMs !== undefined) notePing(responseTimeMs);
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
      const serverNow = (data as { serverNow?: number }).serverNow;
      if (typeof serverNow === 'number')
        clockRef.current = { server: serverNow, local: performance.now() };
      if (data.joinRequests) {
        setJoinRequests(data.joinRequests);
      }
      noteEffects(data.effects);
      setRoom((old) => {
        if (!old) return data;
        const effects = mergeEffects(old.effects, data.effects);
        if (data.version >= old.version) {
          return {
            ...data,
            state: data.state || old.state,
            effects,
          };
        } else {
          return {
            ...old,
            members: data.members,
            match: data.match ?? old.match,
            effects,
          };
        }
      });
      setError('');
    },
    [nameRef, busyRef, enterRef, setError, notePing, noteEffects],
  );

  const refresh = useCallback(async () => {
    const start = performance.now();
    lastRefreshRef.current = Date.now();
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
  /** A shot or other world effect: over the socket when it is up, otherwise over HTTP. */
  const fire = useCallback(
    (effect: object) => {
      // Server time of the world the player was looking at: the server checks the hit
      // against victims' poses from that moment (lag compensation, capped at 250 ms).
      const clock = clockRef.current;
      const seenAt = clock
        ? Math.round(clock.server + performance.now() - clock.local - RENDER_DELAY_MS)
        : undefined;
      const ws = socketRef.current;
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ ...effect, seenAt, t: 'effect' }));
      else void act({ type: 'effect', ...effect, seenAt });
    },
    [act],
  );

  // The socket needs a membership, so it opens once the room snapshot has arrived.
  const joined = room !== null;
  useEffect(() => {
    if (!joined) return;
    let stop = false,
      current: WebSocket | null = null,
      retry: ReturnType<typeof setTimeout> | undefined,
      pinger: ReturnType<typeof setInterval> | undefined,
      delay = 1000;
    const connect = () => {
      if (stop) return;
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}/api/rooms/${id}/socket`);
      current = ws;
      ws.onopen = () => {
        socketRef.current = ws;
        delay = 1000;
        lossHistory.current = [];
        setPacketLoss(0);
        pinger = setInterval(
          () => ws.send(JSON.stringify({ t: 'ping', at: performance.now() })),
          2000,
        );
      };
      ws.onmessage = (event) => {
        let msg: SocketMessage;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg.t === 'tick') {
          clockRef.current = { server: msg.now, local: performance.now() };
          noteEffects(msg.effects);
          setRoom((old) =>
            old
              ? ({
                  ...old,
                  members: msg.members,
                  serverNow: msg.now,
                  match: msg.match ?? old.match,
                  effects: mergeEffects(old.effects, msg.effects),
                } as Room)
              : old,
          );
        } else if (msg.t === 'refresh') {
          refresh().catch((e) => setError((e as Error).message));
        } else if (msg.t === 'pong') {
          notePing(Math.round(performance.now() - msg.at));
        } else if (msg.t === 'error') {
          setError(msg.message);
        }
      };
      ws.onclose = () => {
        clearInterval(pinger);
        if (socketRef.current === ws) socketRef.current = null;
        if (stop) return;
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15000);
      };
    };
    connect();
    return () => {
      stop = true;
      clearTimeout(retry);
      clearInterval(pinger);
      current?.close();
      socketRef.current = null;
    };
  }, [id, joined, refresh, setError, notePing, noteEffects]);

  useEffect(() => {
    let stop = false,
      handle: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let ok = true;
      const ws = socketRef.current;
      const viaSocket = ws?.readyState === WebSocket.OPEN && !!roomRef.current;
      try {
        if (!document.hidden) {
          if (viaSocket && roomRef.current) {
            ws.send(
              JSON.stringify({
                t: 'presence',
                life:
                  pose.current.life ??
                  (roomRef.current.members.find(
                    (m) => m.id === roomRef.current?.self,
                  )?.life || 0),
                pose: compressPose(pose.current),
                ping: pingRef.current,
                cursor: cursor.current,
              }),
            );
            // Safety net for a missed `refresh` push.
            if (Date.now() - lastRefreshRef.current > SOCKET_REFRESH_MS)
              await refresh();
          } else if (roomRef.current) {
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
                pose.current.life ??
                (roomRef.current.members.find(
                  (m) => m.id === roomRef.current?.self,
                )?.life || 0),
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
      if (!document.hidden && !viaSocket) {
        lossHistory.current.push(ok);
        if (lossHistory.current.length > 40) lossHistory.current.shift();
        const lost = lossHistory.current.filter((v) => !v).length;
        setPacketLoss(Math.round((lost / lossHistory.current.length) * 100));
      }
      const idleTime = lastActivityRef.current
        ? Date.now() - lastActivityRef.current
        : 0;
      // A socket packet costs no request, so presence goes out more often over it.
      const interval =
        modeRef.current === '3d'
          ? idleTime > 2000
            ? viaSocket
              ? 250
              : 300
            : viaSocket
              ? 50
              : 120
          : idleTime > 3000
            ? viaSocket
              ? 1000
              : 1400
            : viaSocket
              ? 150
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
    fire,
  };
}
