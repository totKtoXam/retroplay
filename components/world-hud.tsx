'use client';
import { GAME_TOOLS, type Room, type Person } from '@/lib/model';
import type { Perspective } from '@/lib/game-camera';
import { Eye, User, X } from 'lucide-react';
import { SNIPER_ZOOM_LEVELS, SNIPER_ZOOM_FOVS } from './world-constants';
import type { KillMessage, PersonalAlert, HitEffect } from './world';

type GameTool = (typeof GAME_TOOLS)[number];

type WorldHudProps = {
  room: Room;
  host?: boolean;
  onOp?: (op: Record<string, unknown>) => Promise<unknown>;
  onGraphics: () => void;
  packetLoss?: number;
  fps: number;
  fpsLimit: number;
  self?: Person;
  perspective: Perspective;
  choosePerspective: (value: Perspective) => void;
  current?: GameTool;
  aiming: boolean;
  dead: boolean;
  sniperZoomIndex: number;
  hitEffect: HitEffect | null;
  shieldSeconds: number;
  killfeed: KillMessage[];
  personalAlert: PersonalAlert | null;
  respawnSeconds: number;
};

export function WorldHud(props: WorldHudProps) {
  return (
    <>
      {props.hitEffect && (
        <div
          key={props.hitEffect.key}
          className="hit-glow-vignette"
          style={
            {
              '--hit-color': props.hitEffect.color,
            } as React.CSSProperties
          }
          aria-hidden="true"
        />
      )}
      <div
        className={`crosshair modern-crosshair ${props.current?.id === 'sniper' ? 'is-hidden' : ''
          }`}
      >
        <i />
        <i />
      </div>
      {props.current?.id === 'sniper' && props.aiming && props.perspective === 'first' && !props.dead && (
        <div className="sniper-scope-overlay" aria-hidden="true">
          <div className="scope-vignette" />
          <div className="scope-reticle">
            <div className="scope-line-h" />
            <div className="scope-line-v" />
            <div className="scope-mils-v">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="scope-mils-h">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="scope-center-point" />
            <div className="scope-circle" />
            <div className="scope-outer-ring" />
            <div className="scope-info-left">
              <span>ZOOM: {SNIPER_ZOOM_LEVELS[props.sniperZoomIndex]}×</span>
              <span>FOV: {SNIPER_ZOOM_FOVS[props.sniperZoomIndex]}°</span>
              <div className="scope-zoom-pips">
                {SNIPER_ZOOM_LEVELS.map((z, idx) => (
                  <span
                    key={z}
                    className={`scope-zoom-pip ${idx === props.sniperZoomIndex ? 'active' : ''
                      }`}
                  >
                    {z}×
                  </span>
                ))}
              </div>
            </div>
            <div className="scope-info-right">
              <span>FIREWORK</span>
              <span>CAL: 75mm</span>
              <small className="scope-zoom-hint">Колесо: зум</small>
            </div>
          </div>
        </div>
      )}
      <div className="world-hud-top-left">
        <button
          className="world-location world-performance"
          onClick={props.onGraphics}
          aria-label="Настройки FPS"
        >
          <span
            className={`live-dot ${(props.packetLoss ?? 0) > 5
                ? 'loss-bad'
                : (props.packetLoss ?? 0) > 0
                  ? 'loss-warn'
                  : ''
              }`}
          />
          <div>
            <strong>
              {props.fps} FPS <span> / {props.fpsLimit}</span>
            </strong>
            <span>
              {props.self?.ping || 0} мс · {props.packetLoss ?? 0}% потерь · Графика ↗
            </span>
          </div>
        </button>
        <fieldset className="view-switch" aria-label="Режим обзора">
          <button
            type="button"
            aria-pressed={props.perspective === 'first'}
            onClick={() => props.choosePerspective('first')}
            title="1-е лицо (FPP) [V]"
            aria-label="1-е лицо (FPP)"
          >
            <Eye size={15} />
          </button>
          <button
            type="button"
            aria-pressed={props.perspective === 'third'}
            onClick={() => props.choosePerspective('third')}
            title="3-е лицо (TPP) [V]"
            aria-label="3-е лицо (TPP)"
          >
            <User size={15} />
          </button>
          <kbd>V</kbd>
        </fieldset>
      </div>
      <div className="world-hud-top-center">
        <button
          className={`ready-check-trigger-btn ${props.room.state.readyCheck?.active ? 'is-active' : ''}`}
          onClick={() => {
            if (!props.room.state.readyCheck?.active) {
              void props.onOp?.({ type: 'ready.start' });
            }
          }}
          title="Проверить готовность всех игроков к ретроспективе"
        >
          <span className="ready-bell-icon">🔔</span>
          <span>
            {props.room.state.readyCheck?.active
              ? `Готовность: ${props.room.state.readyCheck.readyUsers.length}/${props.room.members.length}`
              : 'Готовы к ретро?'}
          </span>
        </button>
      </div>
      {props.room.state.readyCheck?.active && (
        <div className="ready-check-modal-overlay">
          <div className="ready-check-modal-card">
            <header className="ready-check-card-header">
              <div className="ready-check-title">
                <span className="ready-icon">⚡</span>
                <strong>Готовы к ретроспективе?</strong>
              </div>
              <button
                className="ready-check-close"
                onClick={() => void props.onOp?.({ type: 'ready.dismiss' })}
                title="Закрыть проверку"
              >
                <X size={15} />
              </button>
            </header>
            <div className="ready-check-card-body">
              <div className="ready-check-progress-bar">
                <div
                  className="ready-check-progress-fill"
                  style={{
                    width: `${Math.round(
                      (props.room.state.readyCheck.readyUsers.length /
                        Math.max(1, props.room.members.length)) *
                        100,
                    )}%`,
                  }}
                />
              </div>
              <div className="ready-check-members-grid">
                {props.room.members.map((m) => {
                  const isReady = props.room.state.readyCheck?.readyUsers.includes(m.id);
                  const isAnonymous =
                    props.room.state.anonymousPlayers ||
                    props.room.state.anonymous ||
                    m.hat === 'bag';
                  const displayName = isAnonymous ? 'Аноним' : m.name;
                  return (
                    <div
                      key={m.id}
                      className={`ready-member-item ${isReady ? 'is-ready' : 'is-pending'}`}
                    >
                      <span className="ready-status-badge">
                        {isReady ? '✅' : '⏳'}
                      </span>
                      <span
                        className="ready-member-name"
                        style={{ color: isAnonymous ? '#94a3b8' : m.color }}
                      >
                        {isAnonymous ? '🛍️ ' : ''}{displayName}
                        {m.id === props.room.self ? ' (Вы)' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <footer className="ready-check-card-footer">
              {(() => {
                const myReady = props.room.state.readyCheck.readyUsers.includes(props.room.self);
                return (
                  <button
                    className={`ready-toggle-btn ${myReady ? 'ready-confirmed' : 'ready-action'}`}
                    onClick={() =>
                      void props.onOp?.({
                        type: 'ready.respond',
                        ready: !myReady,
                      })
                    }
                  >
                    {myReady ? '✓ Я готов (отменить)' : '✓ Я готов к ретро!'}
                  </button>
                );
              })()}
              {props.host && (
                <button
                  className="ready-dismiss-btn"
                  onClick={() => void props.onOp?.({ type: 'ready.dismiss' })}
                >
                  Завершить опрос
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
      {/* Immunity glow vignette removed */}
      {props.shieldSeconds > 0 && !props.dead && (
        <div
          className="spawn-immunity-hud"
          title="Бессмертие после возрождения (5 секунд)"
        >
          <span className="immunity-icon">🛡️</span>
          <span>ЩИТ ВОЗРОЖДЕНИЯ</span>
          <strong>{props.shieldSeconds}с</strong>
        </div>
      )}
      <div
        className="combat-stats-hud"
        title="Убийства / Смерти / Помощи (K/D/A)"
      >
        <div className="combat-stat-col stat-k">
          <small>K</small>
          <strong>{props.self?.kills ?? 0}</strong>
        </div>
        <div className="combat-stat-divider" />
        <div className="combat-stat-col stat-d">
          <small>D</small>
          <strong>{props.self?.deaths ?? 0}</strong>
        </div>
        <div className="combat-stat-divider" />
        <div className="combat-stat-col stat-a">
          <small>A</small>
          <strong>{props.self?.assists ?? 0}</strong>
        </div>
      </div>
      <div className="killfeed-container" aria-live="polite">
        {props.killfeed.map((msg, idx) => (
          <div
            key={`${msg.id}-${idx}`}
            className={`killfeed-item ${msg.killer === props.room.self
                ? 'is-my-kill'
                : msg.victim === props.room.self
                  ? 'is-my-death'
                  : msg.assister === props.room.self
                    ? 'is-my-assist'
                    : ''
              } ${msg.headshot ? 'is-headshot' : ''} ${msg.noScope ? 'is-noscope' : ''}`}
            style={
              {
                '--killer-color': msg.color || '#ff647c',
              } as React.CSSProperties
            }
          >
            <span className="killfeed-killer">{msg.killerName}</span>
            {msg.assisterName && (
              <span className="killfeed-assist">(+ {msg.assisterName})</span>
            )}
            <span className={`killfeed-weapon ${msg.noScope ? 'is-noscope' : ''}`}>
              {msg.tool === 'sniper' && msg.noScope
                ? (msg.headshot ? '🎯🔥💀 NO-SCOPE' : '🎯🔥 NO-SCOPE')
                : msg.headshot
                  ? '🎯💀'
                  : msg.tool === 'grenade'
                    ? '💣'
                    : msg.tool === 'confetti'
                      ? '🎉'
                      : msg.tool === 'sniper'
                        ? '🎆'
                        : '🎯'}
            </span>
            <span className="killfeed-victim">{msg.victimName}</span>
          </div>
        ))}
      </div>
      {props.personalAlert && (
        <div
          key={props.personalAlert.key}
          className={`combat-personal-alert alert-${props.personalAlert.type}`}
        >
          <strong>{props.personalAlert.text}</strong>
          {props.personalAlert.sub && <small>{props.personalAlert.sub}</small>}
        </div>
      )}
      <div className={`health-hud ${props.dead ? 'depleted' : ''}`}>
        <strong>{props.self?.hp ?? 100}</strong>
        <span>HP</span>
        <meter
          min="0"
          max="100"
          value={props.self?.hp ?? 100}
          aria-label="Здоровье"
        />
      </div>
      {props.dead && (
        <div className="respawn-overlay">
          <span>ПЕРЕРЫВ НА КОНФЕТТИ</span>
          <strong>{props.respawnSeconds || 1}</strong>
          <p>Возрождение через несколько секунд</p>
        </div>
      )}
    </>
  );
}
