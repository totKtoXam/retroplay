'use client';
/* oxlint-disable next/no-html-link-for-pages -- Полная навигация обходит ошибку RSC prefetch в production-сборке vinext. */

import { ArrowLeft, Bell, Link2, ListChecks, Timer, Vote } from 'lucide-react';
import type { Person, Room, RoomState, Round } from '@/lib/model';
import type { GameMode } from '@/lib/maps/catalog';
import type { ConnectionStatus } from '@/lib/room-connection';
import { MatchBar } from './room-panels';
import { ConnectionIndicator } from './room-status';
import { RoomMenu } from './room-menu';
import { WorldQuickChip } from './world-quick-chip';
import { MusicPlayer } from './music-player';
import { GameClock } from './game-clock';
import type { JoinRequest, useRoomSync } from './use-room-sync';

type Act = ReturnType<typeof useRoomSync>['act'];

/** Шапка комнаты: название, таймер и голоса (или счёт боя), участники, приглашение и меню «⋯». */
export function RoomHeader({
  room,
  s,
  host,
  gameMode,
  mapTitle,
  now,
  timeText,
  round,
  used,
  votesLabel,
  online,
  joinRequests,
  connection,
  editingTitle,
  setEditingTitle,
  menuOpen,
  setMenuOpen,
  voiceActive,
  fullscreen,
  enterFullscreen,
  setPanel,
  setMonitor,
  setPrivateWriting,
  act,
  flash,
}: {
  room: Room;
  s: RoomState;
  host: boolean;
  gameMode: GameMode;
  mapTitle: string;
  now: number;
  timeText: string;
  round: Round | undefined;
  used: number;
  votesLabel: string;
  online: Person[];
  joinRequests: JoinRequest[];
  connection: ConnectionStatus;
  editingTitle: boolean;
  setEditingTitle: (value: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  voiceActive: boolean;
  fullscreen: boolean;
  enterFullscreen: () => Promise<void>;
  setPanel: (panel: string) => void;
  setMonitor: (open: boolean) => void;
  setPrivateWriting: (next: boolean) => Promise<void>;
  act: Act;
  flash: (text: string) => void;
}) {
  return (
    <header
      className={`game-bar${gameMode === 'battle' ? ' is-battle' : ''}`}
    >
      <a
        href="/"
        className="game-bar-back"
        aria-label="К комнатам"
        title="К комнатам"
      >
        <ArrowLeft size={17} />
      </a>
      {editingTitle ? (
        <input
          className="inline-room-title"
          aria-label="Название встречи"
          ref={(node) => node?.focus()}
          defaultValue={s.title}
          maxLength={100}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.currentTarget.value = s.title;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            setEditingTitle(false);
            if (e.target.value.trim() && e.target.value !== s.title)
              void act({
                type: 'room.settings',
                patch: { title: e.target.value },
              });
          }}
        />
      ) : (
        <h1>
          <button
            className="editable-room-title"
            disabled={!host}
            title={host ? 'Нажмите, чтобы изменить название' : undefined}
            onClick={() => setEditingTitle(true)}
          >
            {s.title}
          </button>
        </h1>
      )}
      {/* В ретро карта всегда одна — хаб, её имя в шапке ничего не говорит. */}
      {gameMode !== 'retro' && (
        <span className="game-tag map-tag">{mapTitle}</span>
      )}
      <div
        className={`game-bar-center${gameMode === 'battle' ? ' with-match' : ''}`}
      >
        {gameMode === 'battle' ? (
          // Часы — ярлык, выезжающий из-под счёта (app/game-clock.css): время
          // суток это фон боя, а не его счёт, и ни строки в шапке, ни высоты
          // сцены занимать не должно.
          <div className="match-stack">
            <MatchBar match={room.match} rounds={s.roundWins ?? 5} now={now} />
            <GameClock state={s} now={now} />
          </div>
        ) : (
          <>
            {/* Этапы уехали из шапки в PhaseBar над сценой, приватное
                написание, музыка, погода и полный экран — в меню «⋯». Здесь
                остаётся то, на что смотрят всю встречу: время и голоса. */}
            <button
              type="button"
              className={`game-tag clock ${s.timer.running ? 'running' : ''}`}
              onClick={() => setPanel('timer')}
              aria-label={`Таймер: ${timeText}${s.timer.running ? ', идёт' : ''}`}
              title="Таймер встречи"
            >
              <Timer size={14} aria-hidden="true" />
              {timeText}
            </button>
            <button
              type="button"
              className={`game-tag votes-tag ${round?.active ? 'on' : ''}`}
              onClick={() => setPanel('vote')}
              aria-label={votesLabel}
              title={votesLabel}
            >
              <Vote size={14} aria-hidden="true" />
              <span className="room-bar-label">Голоса</span>
              {round?.active && (
                <b>
                  {Math.max(0, round.limit - used)}/{round.limit}
                </b>
              )}
            </button>
            {/* В ретро MatchBar не рендерится, поэтому часы встают в тот же
                ряд — сразу за таймером встречи, чтобы «сколько осталось» в
                реальном и в игровом времени читалось рядом. На корабле
                «Предателя» суток нет — ни солнца, ни заката. */}
            {gameMode !== 'impostor' && <GameClock state={s} now={now} />}
          </>
        )}
      </div>
      {/* Участники и заявки на вход — одна группа: бейдж заявок прилеплен
          к кнопке участников и виден даже на телефоне. */}
      <div className="people-group">
        <button
          type="button"
          className="game-tag people"
          onClick={() => setMonitor(true)}
          aria-label={`Участники: ${online.length} в сети`}
          title="Участники · клавиша Ё"
        >
          {online.slice(0, 3).map((m) => (
            <span
              key={m.id}
              className="avatar"
              style={{ background: m.color, color: '#fff' }}
              title={m.name}
            >
              {Array.from(m.name)[0]}
            </span>
          ))}
          <b>{online.length}</b>
        </button>
        {host && joinRequests.length > 0 && (
          <button
            type="button"
            className="game-tag alert join-badge"
            onClick={() => setPanel('join_requests')}
            aria-label={`Заявки на вход: ${joinRequests.length}`}
            title="Заявки на вход"
          >
            <Bell size={13} className="bell-pulse" aria-hidden="true" />
            {joinRequests.length}
          </button>
        )}
      </div>
      {gameMode === 'retro' && (
        <button
          type="button"
          className="game-tag room-bar-wide"
          onClick={() => setPanel('results')}
          aria-label="Итоги встречи"
          title="Итоги встречи: голоса, план действий, экспорт"
        >
          <ListChecks size={14} aria-hidden="true" />
          <span className="room-bar-label">Итоги</span>
        </button>
      )}
      <button
        type="button"
        className="game-tag room-bar-wide"
        onClick={() => setPanel('share')}
        aria-label="Пригласить участников"
        title="Пригласить: ссылка на комнату"
      >
        <Link2 size={14} aria-hidden="true" />
        <span className="room-bar-label">Пригласить</span>
      </button>
      <ConnectionIndicator status={connection} />
      <RoomMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        status={connection}
        compact={[
          ...(gameMode !== 'battle'
            ? [
                {
                  id: 'timer',
                  label: `Таймер · ${timeText}`,
                  hint: s.timer.running ? 'Идёт' : 'Остановлен',
                  icon: Timer,
                  onSelect: () => setPanel('timer'),
                },
                {
                  id: 'vote',
                  label: votesLabel,
                  icon: Vote,
                  onSelect: () => setPanel('vote'),
                },
              ]
            : []),
          ...(gameMode === 'retro'
            ? [
                {
                  id: 'results',
                  label: 'Итоги встречи',
                  hint: 'Голоса, план действий, экспорт',
                  icon: ListChecks,
                  onSelect: () => setPanel('results'),
                },
              ]
            : []),
          {
            id: 'share',
            label: 'Пригласить',
            hint: 'Ссылка на комнату',
            icon: Link2,
            onSelect: () => setPanel('share'),
          },
        ]}
        music={<MusicPlayer voiceActive={voiceActive} />}
        world={
          gameMode !== 'impostor' ? (
          <WorldQuickChip
            time={s.time}
            season={s.season}
            weather={s.weather}
            weatherTuning={s.weatherTuning}
            weatherPeriod={s.weatherPeriod}
            windEffects={s.windEffects}
            now={now}
            dayCycle={s.dayCycle}
            host={host}
            onDayCycleChange={(dayCycle) =>
              void act({ type: 'room.settings', patch: { dayCycle } })
            }
            onTimeChange={(time) =>
              void act({ type: 'room.settings', patch: { time } })
            }
            onSeasonChange={(season) =>
              void act({ type: 'room.settings', patch: { season } })
            }
            onWeatherChange={(weather) =>
              void act({ type: 'room.settings', patch: { weather } })
            }
            onWeatherPeriodChange={(weatherPeriod) =>
              void act({ type: 'room.settings', patch: { weatherPeriod } })
            }
            onWeatherTuningChange={(weatherTuning) =>
              void act({ type: 'room.settings', patch: { weatherTuning } })
            }
            onWindEffectsChange={(windEffects) =>
              void act({ type: 'room.settings', patch: { windEffects } })
            }
            onLocked={() => flash('Облик мира меняет ведущий встречи')}
          />
          ) : undefined
        }
        privacy={
          gameMode !== 'battle'
            ? {
                value: s.privateWriting,
                host,
                onToggle: () => void setPrivateWriting(!s.privateWriting),
              }
            : undefined
        }
        fullscreen={fullscreen}
        onToggleFullscreen={() => void enterFullscreen()}
        onSettings={() => setPanel('menu')}
      />
    </header>
  );
}
