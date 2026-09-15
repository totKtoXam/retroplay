/**
 * Голосовой чат комнаты: T — своей команде, Y — всем.
 *
 * Звук идёт напрямую между браузерами (WebRTC), мимо сервера. Комната сидит на
 * одном воркере Cloudflare, и гонять через него живой звук десятка человек —
 * это и трафик, и задержка на лишнем плече. Через сервер проходит только
 * служебное: договориться о соединении и отметка «я сейчас говорю».
 *
 * Сетка «каждый с каждым» выбрана осознанно. Для двенадцати человек это
 * одиннадцать исходящих дорожек на браузер — звук с этим справляется (видео бы
 * не справилось), а взамен не нужен медиасервер, которого в проекте нет и
 * который пришлось бы где-то держать.
 *
 * Кому уходит голос, решает отправитель, а не слушатель: на каждого
 * собеседника заводится своя копия микрофонной дорожки, и в командном канале
 * включаются только копии для своих. Если бы решал слушатель, звук всё равно
 * долетал бы до противника — и подправленный клиент слушал бы чужие
 * переговоры.
 *
 * Разговор включается удержанием, как рация: открытый микрофон в шутере — это
 * дыхание и щелчки мыши в ушах у всей команды.
 */

export type VoiceChannel = 'team' | 'all';

/** Состояние своего микрофона. Каждое значение — своя строка в HUD. */
export type VoiceMic =
  /** Микрофон ещё не спрашивали: до первого нажатия T или Y. */
  | 'idle'
  /** Браузер показывает запрос разрешения. */
  | 'asking'
  /** Микрофон работает. */
  | 'live'
  /** Игрок отказал в доступе (или отказал заранее, в настройках сайта). */
  | 'denied'
  /** Микрофона нет или браузер не умеет WebRTC. */
  | 'absent'
  /**
   * Страница открыта по http:// — браузер прячет микрофон целиком. Единственная
   * поломка, которую чинит не игрок и не код, а адрес сервера.
   */
  | 'insecure';

export type VoiceSpeaker = {
  id: string;
  channel: VoiceChannel;
  /** Слышно ли его на самом деле: заглушённого видно, но не слышно. */
  audible: boolean;
};

export type VoiceView = {
  mic: VoiceMic;
  /** В какой канал говорю прямо сейчас. */
  talking: VoiceChannel | null;
  /** Ведущий заглушил лично меня. */
  mutedByHost: boolean;
  /** Голосовой чат выключен в комнате целиком. */
  roomOff: boolean;
  /** Кто говорит сейчас — и мне, и рядом. */
  speakers: VoiceSpeaker[];
};

export type VoiceSignal = {
  kind: 'offer' | 'answer' | 'ice' | 'ready' | 'talk';
  from: string;
  to?: string;
  on?: boolean;
  channel?: VoiceChannel;
  silenced?: boolean;
  payload?: unknown;
};

export type VoicePeerInfo = { id: string; team: string };

export type VoiceRules = {
  /** Голос разрешён в комнате. */
  enabled: boolean;
  /** Кого заглушил ведущий. */
  muted: Set<string>;
  /** Есть ли в комнате команды (в ретро их нет, и «своим» значит «всем»). */
  teams: boolean;
  myTeam: string;
  /** Остальные участники комнаты — без себя. */
  peers: VoicePeerInfo[];
};

/** Отметка «говорит» без обновления живёт столько: страховка от потерянного «отпустил». */
const TALK_TTL_MS = 4000;

const emptyView: VoiceView = {
  mic: 'idle',
  talking: null,
  mutedByHost: false,
  roomOff: false,
  speakers: [],
};

type Peer = {
  id: string;
  pc: RTCPeerConnection;
  /** Вежливая сторона уступает при встречном предложении (perfect negotiation). */
  polite: boolean;
  makingOffer: boolean;
  audio: HTMLAudioElement;
  sender: RTCRtpSender | null;
  /** Своя копия микрофонной дорожки: включается отдельно для каждого собеседника. */
  track: MediaStreamTrack | null;
};

export function createVoiceChat({
  selfId,
  send,
  onView,
}: {
  selfId: string;
  /** Отправка служебного сообщения через сокет комнаты; false — сокет закрыт. */
  send: (msg: Record<string, unknown>) => boolean;
  onView: (view: VoiceView) => void;
}) {
  const peers = new Map<string, Peer>();
  /** Кто откликнулся «я на связи»: соединяемся только с теми, у кого голос жив. */
  const ready = new Set<string>();
  const talking = new Map<string, { channel: VoiceChannel; silenced: boolean; at: number }>();
  let rules: VoiceRules = { enabled: true, muted: new Set(), teams: false, myTeam: '', peers: [] };
  let mic: VoiceMic = 'idle';
  let micStream: MediaStream | null = null;
  let micTrack: MediaStreamTrack | null = null;
  let channel: VoiceChannel | null = null;
  let announced = false;
  let disposed = false;
  let view = emptyView;

  const teamOf = (id: string) => rules.peers.find((p) => p.id === id)?.team ?? '';
  /** Слышит ли этот собеседник мой канал: в свободной игре «свои» — это все. */
  const inChannel = (id: string, want: VoiceChannel) =>
    want === 'all' || !rules.teams || !rules.myTeam || teamOf(id) === rules.myTeam;
  const silenced = (id: string) => !rules.enabled || rules.muted.has(id);

  function publish() {
    if (disposed) return;
    const now = Date.now();
    const speakers: VoiceSpeaker[] = [];
    for (const [id, state] of talking) {
      if (state.at < now - TALK_TTL_MS) {
        talking.delete(id);
        continue;
      }
      speakers.push({
        id,
        channel: state.channel,
        // Слышно, только если его не заглушили и соединение действительно живо:
        // «говорит, но не слышно» — это тоже ответ, и он должен быть виден.
        audible: !state.silenced && !silenced(id) && peers.get(id)?.pc.connectionState === 'connected',
      });
    }
    const next: VoiceView = {
      mic,
      talking: channel,
      mutedByHost: rules.muted.has(selfId),
      roomOff: !rules.enabled,
      speakers,
    };
    if (
      next.mic === view.mic &&
      next.talking === view.talking &&
      next.mutedByHost === view.mutedByHost &&
      next.roomOff === view.roomOff &&
      next.speakers.length === view.speakers.length &&
      next.speakers.every(
        (s, i) =>
          s.id === view.speakers[i].id &&
          s.channel === view.speakers[i].channel &&
          s.audible === view.speakers[i].audible,
      )
    )
      return;
    view = next;
    onView(next);
  }

  // ------------------------------------------------------------- соединения

  function peerFor(id: string): Peer | null {
    const existing = peers.get(id);
    if (existing) return existing;
    if (disposed || !rules.enabled || silenced(id) || silenced(selfId)) return null;
    if (typeof RTCPeerConnection === 'undefined') return null;
    // Игра живёт в локальной сети, где браузеры видят друг друга напрямую.
    // Публичный STUN оставлен на случай, когда игроки в разных сетях: без него
    // соединение там не соберётся вовсе, а на LAN он просто не понадобится.
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    // Свой голос в наушники не возвращаем, чужой — играем всегда, если не заглушён.
    audio.muted = silenced(id);
    const peer: Peer = { id, pc, polite: selfId < id, makingOffer: false, audio, sender: null, track: null };
    peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) send({ t: 'voice', kind: 'ice', to: id, payload: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void audio.play().catch(() => {
        // Браузер может запретить автозапуск до первого клика по странице.
        // Игрок к этому моменту уже кликал по миру, а если нет — заиграет со
        // следующей попытки: специально ничего не показываем.
      });
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        send({ t: 'voice', kind: 'offer', to: id, payload: pc.localDescription });
      } catch {
        // Соединение закрылось на полпути — его пересоберёт следующий `ready`.
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') dropPeer(id);
      publish();
    };
    // Слушать хотят все, даже те, кто не говорит: дорожка на приём заводится
    // сразу, а своя появится, когда игрок первый раз нажмёт T или Y.
    if (micTrack) attachMic(peer);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    return peer;
  }

  function attachMic(peer: Peer) {
    if (!micTrack || peer.track) return;
    const clone = micTrack.clone();
    clone.enabled = !!channel && inChannel(peer.id, channel);
    peer.track = clone;
    peer.sender = peer.pc.addTrack(clone, new MediaStream([clone]));
  }

  function dropPeer(id: string) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    peer.track?.stop();
    peer.audio.srcObject = null;
    peer.audio.remove();
    try {
      peer.pc.close();
    } catch {
      // Уже закрыто — ничего страшного.
    }
  }

  async function onSignal(msg: VoiceSignal) {
    if (disposed) return;
    const from = msg.from;
    if (!from || from === selfId) return;
    if (msg.kind === 'talk') {
      if (msg.on) talking.set(from, { channel: msg.channel === 'team' ? 'team' : 'all', silenced: !!msg.silenced, at: Date.now() });
      else talking.delete(from);
      publish();
      return;
    }
    if (msg.kind === 'ready') {
      if (!msg.on) {
        ready.delete(from);
        dropPeer(from);
        publish();
        return;
      }
      const known = ready.has(from);
      ready.add(from);
      // Новичок узнал о нас из общей рассылки — отвечаем ему лично, иначе он
      // будет ждать следующей, а её может не быть.
      if (!known && announced) send({ t: 'voice', kind: 'ready', to: from, on: true });
      peerFor(from);
      return;
    }
    const peer = peerFor(from);
    if (!peer) return;
    try {
      if (msg.kind === 'ice') {
        await peer.pc.addIceCandidate(msg.payload as RTCIceCandidateInit);
        return;
      }
      const description = msg.payload as RTCSessionDescriptionInit;
      if (!description) return;
      // Perfect negotiation: столкнувшись предложениями, уступает вежливая
      // сторона. Кто вежлив, решает сравнение идентификаторов — одинаково у
      // обоих, поэтому договариваться об этом отдельно не нужно.
      const collision =
        description.type === 'offer' && (peer.makingOffer || peer.pc.signalingState !== 'stable');
      if (collision && !peer.polite) return;
      await peer.pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await peer.pc.setLocalDescription();
        send({ t: 'voice', kind: 'answer', to: from, payload: peer.pc.localDescription });
      }
    } catch {
      // Рассогласование состояний лечится пересозданием соединения.
      dropPeer(from);
    }
  }

  // ----------------------------------------------------------------- микрофон

  async function ensureMic(): Promise<boolean> {
    if (micTrack) return true;
    if (mic === 'asking') return false;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      // Главная причина — страница по http://: в незащищённом источнике
      // браузер не отдаёт микрофон вовсе и даже не спрашивает.
      mic = typeof window !== 'undefined' && !window.isSecureContext ? 'insecure' : 'absent';
      publish();
      return false;
    }
    mic = 'asking';
    publish();
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micTrack = micStream.getAudioTracks()[0] ?? null;
      if (!micTrack) {
        mic = 'absent';
        publish();
        return false;
      }
      // Исходная дорожка всегда включена: рацию открывают и закрывают копии,
      // по одной на собеседника, и у каждой копии свой выключатель.
      micTrack.enabled = true;
      mic = 'live';
      for (const peer of peers.values()) attachMic(peer);
      publish();
      return true;
    } catch (e) {
      mic = (e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'absent';
      publish();
      return false;
    }
  }

  function routeMic() {
    for (const peer of peers.values()) {
      if (peer.track) peer.track.enabled = !!channel && inChannel(peer.id, channel);
    }
  }

  /** Нажали или отпустили T (`team`) или Y (`all`). */
  function setTalk(want: VoiceChannel, on: boolean) {
    if (on) {
      if (channel === want) return;
      channel = want;
      publish();
      // Отметку шлём сразу, не дожидаясь микрофона: собеседники увидят, что к
      // ним обращаются, даже если разрешение ещё висит на экране.
      send({ t: 'voice', kind: 'talk', channel: want, on: true });
      routeMic();
      void ensureMic().then((ok) => {
        if (ok && channel === want) routeMic();
      });
      return;
    }
    if (channel !== want) return;
    channel = null;
    routeMic();
    send({ t: 'voice', kind: 'talk', channel: want, on: false });
    publish();
  }

  return {
    /** Сообщение голосового чата с сервера. */
    signal(msg: VoiceSignal) {
      void onSignal(msg);
    },

    /** Правила комнаты и состав участников из очередного тика. */
    update(next: VoiceRules) {
      const wasEnabled = rules.enabled;
      rules = next;
      const mutedMe = rules.muted.has(selfId);
      if (!rules.enabled || mutedMe) {
        // Выключили голос или заглушили лично меня — рация замолкает сразу,
        // не дожидаясь, пока игрок отпустит клавишу.
        if (channel) setTalk(channel, false);
      }
      for (const peer of peers.values()) peer.audio.muted = silenced(peer.id);
      const present = new Set(rules.peers.map((p) => p.id));
      // Копия ключей, потому что dropPeer удаляет из той же карты.
      for (const id of Array.from(peers.keys()))
        if (!present.has(id) || !rules.enabled || silenced(id)) dropPeer(id);
      for (const id of Array.from(ready)) if (!present.has(id)) ready.delete(id);
      if (rules.enabled && !silenced(selfId)) {
        for (const id of ready) if (present.has(id)) peerFor(id);
      }
      // Снова включили голос — заново объявляемся: собеседники успели забыть.
      if (!wasEnabled && rules.enabled) announced = false;
      if (!announced && rules.enabled && !silenced(selfId) && rules.peers.length) {
        announced = send({ t: 'voice', kind: 'ready', on: true });
      }
      routeMic();
      publish();
    },

    talk: setTalk,

    /** Сокет переподключился: объявиться заново. */
    reconnected() {
      announced = false;
      ready.clear();
      for (const id of Array.from(peers.keys())) dropPeer(id);
      publish();
    },

    dispose() {
      disposed = true;
      if (announced) send({ t: 'voice', kind: 'ready', on: false });
      for (const id of Array.from(peers.keys())) dropPeer(id);
      micTrack?.stop();
      micStream?.getTracks().forEach((t) => t.stop());
      micTrack = null;
      micStream = null;
    },
  };
}

export type VoiceChat = ReturnType<typeof createVoiceChat>;
export const EMPTY_VOICE_VIEW = emptyView;
