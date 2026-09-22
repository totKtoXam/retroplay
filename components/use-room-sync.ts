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
import { uid, type Room, type RoomState, type Pose, type WorldEffect } from '@/lib/model';
import { api, ready } from '@/lib/client';
import type { WeaponCommand, WeaponReply } from '@/lib/weapon-protocol';
import type { VoiceSignal } from './voice-chat';
import type { ChatChannel, ChatMessage } from '@/lib/room-chat';

/** Ответ сервера на действие режима «Предатель». */
export type ImpostorReply = { ok: boolean; error?: string };

/** Чем комната кормит голосовой чат: сообщениями с сервера и фактом переподключения. */
export type VoiceSink = {
  signal: (msg: VoiceSignal) => void;
  reconnected: () => void;
};

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
      impostor?: Room['impostor'];
    }
  | { t: 'refresh' }
  | { t: 'impostor'; id: string; ok: boolean; error?: string }
  | { t: 'chat'; messages: ChatMessage[]; history?: boolean }
  | { t: 'chat.error'; error: string }
  | ({ t: 'voice' } & VoiceSignal)
  | { t: 'pong'; at: number }
  | ({ t: 'weapon' } & WeaponReply)
  | { t: 'error'; message: string };

/** Столько сообщений чата держим в памяти вкладки. */
const CHAT_KEEP = 100;

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
    light: !!p.light,
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
    [ping, setPing] = useState(0),
    [chat, setChat] = useState<ChatMessage[]>([]),
    [chatError, setChatError] = useState('');
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
  /**
   * Приёмник голосового чата. Регистрируется снаружи после создания чата: сам
   * чат отправляет сообщения через `sendVoice` этого же хука, поэтому связать
   * их на месте нельзя — получилось бы кольцо.
   */
  const voiceSink = useRef<VoiceSink | null>(null);
  const setVoiceSink = useCallback((sink: VoiceSink | null) => {
    voiceSink.current = sink;
  }, []);
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
            impostor: data.impostor,
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
  const weaponRequests = useRef(new Map<string, { resolve: (reply: WeaponReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const httpWeaponQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => () => {
    for (const pending of weaponRequests.current.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Подключение закрыто'));
    }
    weaponRequests.current.clear();
  }, [id]);
  const sendWeapon = useCallback((body: Record<string, unknown>): Promise<WeaponReply> => {
    const commandId = String(body.id);
    const life = roomRef.current?.members.find((m) => m.id === roomRef.current?.self)?.life ?? 0;
    const data = { ...body, life: body.life ?? life };
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        weaponRequests.current.delete(commandId);
        reject(new Error('Сервер не подтвердил действие. Переподключитесь к комнате.'));
      }, 5000);
      weaponRequests.current.set(commandId, { resolve, reject, timer });
      try { ws.send(JSON.stringify({ ...data, t: body.type === 'effect' ? 'effect' : 'weapon' })); }
      catch (error) { clearTimeout(timer); weaponRequests.current.delete(commandId); reject(error); }
    });
    // Preserve fire/reload/cancel order in the fallback, including after a failed request.
    const request = httpWeaponQueue.current.catch(() => {}).then(() => api<WeaponReply>('/api/rooms/' + id, data));
    httpWeaponQueue.current = request;
    return request;
  }, [id]);
  const weapon = useCallback((command: WeaponCommand) => sendWeapon({ ...command, type: 'weapon' }), [sendWeapon]);
  const impostorRequests = useRef(new Map<string, { resolve: (reply: ImpostorReply) => void; timer: ReturnType<typeof setTimeout> }>());
  /**
   * Действие режима «Предатель». Ответ сервера — принято или почему нет; само
   * изменение партии приходит следующим тиком. Без сокета — тем же HTTP, что и всё.
   */
  const impostor = useCallback(
    (action: Record<string, unknown>): Promise<ImpostorReply> => {
      const ws = socketRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        const requestId = uid();
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            impostorRequests.current.delete(requestId);
            resolve({ ok: false, error: 'Сервер не ответил' });
          }, 5000);
          impostorRequests.current.set(requestId, { resolve, timer });
          try {
            ws.send(JSON.stringify({ ...action, t: 'impostor', id: requestId }));
          } catch {
            clearTimeout(timer);
            impostorRequests.current.delete(requestId);
            resolve({ ok: false, error: 'Связь с сервером потеряна' });
          }
        });
      }
      return api<ImpostorReply>('/api/rooms/' + id, { ...action, type: 'impostor' }).catch((e: Error) => ({
        ok: false,
        error: e.message,
      }));
    },
    [id],
  );
  /**
   * Служебное сообщение голосового чата. Только через сокет: договориться о
   * соединении по HTTP-опросу нельзя — пока ответ дойдёт, предложение устареет.
   * `false` означает «сокет закрыт», и чат попробует объявиться снова.
   */
  const sendVoice = useCallback((msg: Record<string, unknown>) => {
    const ws = socketRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }, []);
  /**
   * Сообщение в текстовый чат. Только через сокет, как и голос: без него чат молчит,
   * и `false` говорит об этом окну ввода.
   */
  const sendChat = useCallback((channel: ChatChannel, text: string) => {
    const ws = socketRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify({ t: 'chat', channel, text }));
      setChatError('');
      return true;
    } catch {
      return false;
    }
  }, []);
  /**
   * Текущее время по серверным часам. Тик комнаты приносит `now` раз в 100 мс,
   * между тиками время идёт по `performance.now()` — монотонному счётчику,
   * который не дёргается от перевода системных часов. До первого тика остаётся
   * локальное время. Нужно всему, что обязано совпадать у всех участников:
   * внутриигровым суткам (lib/day-cycle.ts) и часам матча.
   */
  const serverNow = useCallback(() => {
    const clock = clockRef.current;
    return clock ? clock.server + performance.now() - clock.local : Date.now();
  }, []);
  /** A shot returns an authoritative acknowledgement, including rejected shots. */
  const fire = useCallback(
    (effect: object) => {
      // Server time of the world the player was looking at: the server checks the hit
      // against victims' poses from that moment (lag compensation, capped at 250 ms).
      const clock = clockRef.current;
      const seenAt = clock
        ? Math.round(clock.server + performance.now() - clock.local - RENDER_DELAY_MS)
        : undefined;
      return sendWeapon({ type: 'effect', ...effect, seenAt });
    },
    [sendWeapon],
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
        // Собеседники за время обрыва забыли о нас, а мы — о них: объявляемся
        // заново, иначе голос молчал бы до чьего-нибудь перезахода.
        voiceSink.current?.reconnected();
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
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'weapon') {
          const pending = weaponRequests.current.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            weaponRequests.current.delete(msg.id);
            pending.resolve(msg);
          }
        } else if (msg.t === 'tick') {
          clockRef.current = { server: msg.now, local: performance.now() };
          noteEffects(msg.effects);
          setRoom((old) =>
            old
              ? ({
                  ...old,
                  members: msg.members,
                  serverNow: msg.now,
                  match: msg.match ?? old.match,
                  impostor: msg.impostor,
                  effects: mergeEffects(old.effects, msg.effects),
                } as Room)
              : old,
          );
        } else if (msg.t === 'impostor') {
          const pending = impostorRequests.current.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            impostorRequests.current.delete(msg.id);
            pending.resolve({ ok: msg.ok, error: msg.error });
          }
        } else if (msg.t === 'chat') {
          if (!Array.isArray(msg.messages)) return;
          setChat((old) => {
            // История после переподключения повторяет уже известное: склеиваем по id.
            const known = new Set(old.map((c) => c.id));
            const fresh = msg.messages.filter((c) => c && typeof c.text === 'string' && !known.has(c.id));
            return fresh.length ? [...old, ...fresh].sort((a, b) => a.at - b.at).slice(-CHAT_KEEP) : old;
          });
        } else if (msg.t === 'chat.error') {
          setChatError(msg.error);
        } else if (msg.t === 'voice') {
          voiceSink.current?.signal(msg);
        } else if (msg.t === 'refresh') {
          refresh().catch((e) => setError((e as Error).message));
        } else if (msg.t === 'pong') {
          notePing(Math.round(performance.now() - msg.at));
        } else if (msg.t === 'error') {
          setError(msg.message);
        }
      };
      ws.onclose = () => {
        for (const pending of weaponRequests.current.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Связь с сервером потеряна'));
        }
        weaponRequests.current.clear();
        for (const pending of impostorRequests.current.values()) {
          clearTimeout(pending.timer);
          pending.resolve({ ok: false, error: 'Связь с сервером потеряна' });
        }
        impostorRequests.current.clear();
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
        /*
         * Первая загрузка комнаты не зависит от видимости вкладки. Presence в
         * фоне мы намеренно не шлём — незачем сообщать позицию игрока, который
         * не смотрит на экран. Но раньше под этой же проверкой стоял и первый
         * refresh, а обработчик тиков ничего не делает, пока комната не
         * загружена: открытая в фоновой вкладке комната навсегда зависала на
         * «Готовим место для встречи…» и оживала только от переключения на неё.
         */
        if (!roomRef.current) {
          await refresh();
        } else if (!document.hidden) {
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
        idleTime > 2000
          ? viaSocket
            ? 250
            : 300
          : viaSocket
            ? 50
            : 120;
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
    weapon,
    impostor,
    sendVoice,
    setVoiceSink,
    serverNow,
    chat,
    chatError,
    setChatError,
    sendChat,
  };
}
