'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from '@/lib/model';
import { modeOf } from '@/lib/maps/catalog';
import {
  createVoiceChat,
  EMPTY_VOICE_VIEW,
  type VoiceChannel,
  type VoiceChat,
  type VoiceView,
} from './voice-chat';
import type { VoiceSink } from './use-room-sync';

/**
 * Голосовой чат в жизни комнаты: создать на входе, кормить составом и правилами
 * из каждого тика, погасить на выходе.
 *
 * Сам разговор живёт вне React (components/voice-chat.ts): соединения и
 * дорожки нельзя пересобирать на каждую перерисовку, а перерисовок в комнате
 * десятки в секунду. Наружу оттуда выходит только то, что рисует HUD.
 */
export function useVoiceChat({
  room,
  sendVoice,
  setVoiceSink,
}: {
  room: Room | null;
  sendVoice: (msg: Record<string, unknown>) => boolean;
  setVoiceSink: (sink: VoiceSink | null) => void;
}) {
  const [view, setView] = useState<VoiceView>(EMPTY_VOICE_VIEW);
  const chat = useRef<VoiceChat | null>(null);
  const self = room?.self ?? '';
  const sendRef = useRef(sendVoice);
  useEffect(() => {
    sendRef.current = sendVoice;
  }, [sendVoice]);

  useEffect(() => {
    if (!self) return;
    const voice = createVoiceChat({
      selfId: self,
      send: (msg) => sendRef.current(msg),
      onView: setView,
    });
    chat.current = voice;
    setVoiceSink({
      signal: (msg) => voice.signal(msg),
      reconnected: () => voice.reconnected(),
    });
    return () => {
      setVoiceSink(null);
      chat.current = null;
      voice.dispose();
      setView(EMPTY_VOICE_VIEW);
    };
  }, [self, setVoiceSink]);

  /**
   * Состав комнаты и правила приходят тиком по десять раз в секунду, а меняются
   * редко. Соединения от каждого тика не пересобрать, поэтому в зависимости
   * эффекта идёт слепок — строка из того, что для голоса действительно важно, —
   * а сама комната читается из ссылки.
   */
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  });
  const signature = room
    ? room.members
        .filter((m) => !m.bot)
        .map((m) => m.id + ':' + (m.team || ''))
        .join(',') +
      '|' +
      (room.state.voiceEnabled === false ? 'off' : 'on') +
      '|' +
      (room.state.voiceMuted ?? []).join(',')
    : '';
  useEffect(() => {
    const voice = chat.current;
    const current = roomRef.current;
    if (!voice || !current) return;
    const { members, state } = current;
    voice.update({
      enabled: state.voiceEnabled !== false,
      muted: new Set(state.voiceMuted ?? []),
      teams: modeOf(state) === 'battle',
      myTeam: members.find((m) => m.id === self)?.team || '',
      // Боты не говорят и не слушают: соединение с ними некому принять.
      peers: members
        .filter((m) => m.id !== self && !m.bot)
        .map((m) => ({ id: m.id, team: m.team || '' })),
    });
  }, [signature, self]);

  const talk = useCallback((channel: VoiceChannel, on: boolean) => {
    chat.current?.talk(channel, on);
  }, []);

  return { voice: view, talk };
}
