'use client';

import { Fragment } from 'react';
import { Mic, MicOff, Monitor, Repeat, Users, Wifi, X } from 'lucide-react';
import {
  isOnline,
  isPresent,
  kdaRatio,
  monitorGroups,
  type Person,
  type Room,
} from '@/lib/model';
import type { GameMode } from '@/lib/maps/catalog';
import { BOT_LEVELS } from '@/lib/bot-levels';
import { teamName } from '@/lib/team-colors';
import type { useRoomSync } from './use-room-sync';

type Act = ReturnType<typeof useRoomSync>['act'];

/** Табло «Комната в реальном времени» (клавиша Ё): участники, статусы, пинг, K/D/A в бою. */
export function RoomMonitor({
  room,
  host,
  gameMode,
  now,
  online,
  ping,
  fps,
  voiceMuted,
  setMonitor,
  setPanel,
  act,
}: {
  room: Room;
  host: boolean;
  gameMode: GameMode;
  now: number;
  online: Person[];
  ping: number;
  fps: number;
  voiceMuted: Set<string>;
  setMonitor: (open: boolean) => void;
  setPanel: (panel: string) => void;
  act: Act;
}) {
  return (
    <section
      className="monitor-hud-overlay"
      aria-live="polite"
      aria-label="Комната в реальном времени"
    >
      <div className="monitor-card">
        <div className="monitor-header">
          <div className="monitor-title-wrap">
            <h3>Комната в реальном времени</h3>
            <span>
              {online.length} в сети · {room.members.length} участников
            </span>
          </div>
          <button
            type="button"
            className="monitor-close"
            onClick={() => setMonitor(false)}
            aria-label="Закрыть"
            title="Закрыть (Esc)"
          >
            <X size={14} />
          </button>
        </div>
        <div className="monitor-metrics-bar">
          <div className="metric-pill">
            <Wifi size={12} />
            <strong>{ping}</strong>
            <small>мс</small>
          </div>
          <div className="metric-pill">
            <Monitor size={12} />
            <strong>{fps}</strong>
            <small>FPS</small>
          </div>
          <div className="metric-pill">
            <Users size={12} />
            <strong>{online.length}</strong>
            <small>в сети</small>
          </div>
        </div>
        <div
          className={`monitor-table-wrap ${gameMode === 'battle' ? 'is-battle' : ''}`}
        >
          <div className="monitor-table-header">
            <span className="col-user">УЧАСТНИК</span>
            <span className="col-status">СТАТУС</span>
            {gameMode === 'battle' && (
              <>
                <span className="col-num col-k">K</span>
                <span className="col-num col-d">D</span>
                <span className="col-num col-a">A</span>
                <span className="col-num col-kda">KDA</span>
              </>
            )}
            <span className="col-num col-ping">ПИНГ</span>
          </div>
          <div className="monitor-table-body">
            {/* Покинувших игру в таблице нет: раньше показывались все, кто
                когда-либо заходил, и список копил ушедших. Себя оставляем
                всегда — из скрытой вкладки пакеты не уходят, и смотрящий
                вычеркнул бы сам себя. */}
            {monitorGroups(
              room.members
                .filter((m) => m.id === room.self || isPresent(m.lastSeen, now))
                .sort((a, b) => kdaRatio(b) - kdaRatio(a)),
              gameMode === 'battle',
            ).map((group) => (
              <Fragment key={group.team ?? 'all'}>
              {group.team && (
                <div
                  className={`monitor-team-header team-${group.team}`}
                  aria-label={`${group.label}: ${group.members.length} игроков`}
                >
                  <span className="col-user">
                    <strong>{group.label}</strong>
                    {(group.team === 'red' || group.team === 'blue') &&
                      room.match && (
                        <b className="monitor-team-score">
                          {room.match.score[group.team]}
                        </b>
                      )}
                    <small>{group.members.length}</small>
                  </span>
                  <span className="col-status" />
                  <span className="col-num col-k">{group.kills}</span>
                  <span className="col-num col-d">{group.deaths}</span>
                  <span className="col-num col-a">{group.assists}</span>
                  <span className="col-num col-kda" />
                  <span className="col-num col-ping" />
                </div>
              )}
              {group.members.map((m) => (
              <div key={m.id} className="monitor-table-row">
                <div className="col-user">
                  <span
                    className="avatar mini-avatar"
                    style={{ background: m.color, color: 'white' }}
                  >
                    {Array.from(m.name)[0]}
                  </span>
                  <span className="user-name-box">
                    <strong className="name-text">
                      {m.name}
                      {m.id === room.self ? ' (вы)' : ''}
                    </strong>
                    <small className="role-text">
                      {m.bot
                        ? `Бот · ${BOT_LEVELS[m.bot]?.label ?? ''}`
                        : m.id === room.host
                          ? 'Ведущий'
                          : 'Участник'}
                      {gameMode === 'battle' &&
                        ` · ${teamName(m.team).toLowerCase()}`}
                    </small>
                  </span>
                  {gameMode === 'battle' && (host || m.id === room.self) && (
                    <button
                      type="button"
                      className={`side-swap ${m.team || 'none'}`}
                      title={
                        m.id === room.self
                          ? 'Выбор стороны и скина · клавиша G'
                          : 'Перевести в другую команду'
                      }
                      aria-label={
                        m.id === room.self
                          ? 'Выбрать сторону и скин, клавиша G'
                          : `Перевести игрока ${m.name} в другую команду`
                      }
                      onClick={() => {
                        if (m.id === room.self) {
                          setMonitor(false);
                          setPanel('team');
                        } else
                          void act({
                            type: 'team.set',
                            session: m.id,
                            team: m.team === 'red' ? 'blue' : 'red',
                          });
                      }}
                    >
                      <Repeat size={13} />
                    </button>
                  )}
                  {/* Микрофон рядом с именем, а не в отдельном разделе
                      настроек: заглушают конкретного человека и обычно
                      прямо сейчас, глядя на список говорящих. */}
                  {host && m.id !== room.host && !m.bot && (
                    <button
                      type="button"
                      className={`voice-mute ${voiceMuted.has(m.id) ? 'is-muted' : ''}`}
                      title={
                        voiceMuted.has(m.id)
                          ? 'Вернуть голос'
                          : 'Заглушить: его перестанут слышать все'
                      }
                      aria-label={
                        voiceMuted.has(m.id)
                          ? `Вернуть голос игроку ${m.name}`
                          : `Заглушить игрока ${m.name}`
                      }
                      onClick={() =>
                        void act({
                          type: 'voice.mute',
                          session: m.id,
                          muted: !voiceMuted.has(m.id),
                        })
                      }
                    >
                      {voiceMuted.has(m.id) ? <MicOff size={13} /> : <Mic size={13} />}
                    </button>
                  )}
                </div>
                {/* Состояний два вместо прежнего «в сети / не в сети»:
                    ушедшие до таблицы просто не доходят, а всё, что между, —
                    это «отошёл», то есть свернул вкладку или
                    переподключается. */}
                <span
                  className={`col-status ${
                    isOnline(m.lastSeen, now) ? 'is-online' : 'is-away'
                  }`}
                >
                  {isOnline(m.lastSeen, now) ? 'в сети' : 'отошёл'}
                </span>
                {gameMode === 'battle' && (
                  <>
                    <span className="col-num col-k">{m.kills ?? 0}</span>
                    <span className="col-num col-d">{m.deaths ?? 0}</span>
                    <span className="col-num col-a">{m.assists ?? 0}</span>
                    <span className="col-num col-kda">
                      {kdaRatio(m).toFixed(2)}
                    </span>
                  </>
                )}
                <span className="col-num col-ping">
                  {isOnline(m.lastSeen, now) ? `${m.ping} мс` : '—'}
                </span>
              </div>
              ))}
              </Fragment>
            ))}
          </div>
        </div>
        <p className="monitor-footer-note">
          {gameMode === 'battle'
            ? 'Отсортировано по KDA · (убийства + помощь) / смерти'
            : 'Участники встречи · держите «ё», ЛКМ закрепляет табло'}
        </p>
      </div>
    </section>
  );
}
