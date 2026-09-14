'use client';
import { GAME_TOOLS, type Room, type Person } from '@/lib/model';
import type { GameMode } from '@/lib/maps/catalog';
import type { Perspective } from '@/lib/game-camera';
import { Eye, User, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { SNIPER_ZOOM_LEVELS, SNIPER_ZOOM_FOVS } from './world-constants';
import type { KillMessage, PersonalAlert, HitEffect } from './world';

type GameTool = (typeof GAME_TOOLS)[number];

type WorldHudProps = {
  /** Бой показывает здоровье, счёт и ленту попаданий; ретро — только спокойные элементы. */
  mode: GameMode;
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
  /** Куда попал сам игрок последним выстрелом. */
  hitMark: { zone: 'head' | 'torso' | 'limb'; key: number } | null;
  shieldSeconds: number;
  killfeed: KillMessage[];
  personalAlert: PersonalAlert | null;
  respawnSeconds: number;
  /** Сколько секунд осталось до конца подготовки раунда. */
  freezeSeconds: number;
};

/**
 * Прицел краскомёта в режиме ПКМ: точка попадания в центре и четыре лепестка,
 * которые расходятся от движения и от непрерывной стрельбы. Данные о движении и
 * отдаче берутся из тех же событий ввода, что и у движка (WASD/стрелки + ЛКМ),
 * поэтому дополнительные пропсы `WorldHud` не нужны.
 */
function PaintAimReticle() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const moveKeys = new Set([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ]);
    const pressed = new Set<string>();
    let firing = false;
    let heat = 0;
    let moveBlend = 0;
    let last = performance.now();
    let raf = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      if (moveKeys.has(e.code)) pressed.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressed.delete(e.code);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) firing = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) firing = false;
    };
    const onBlur = () => {
      pressed.clear();
      firing = false;
    };
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      // Краскомёт стреляет очередью, пока зажата ЛКМ: отдача копится и спадает.
      heat = Math.min(1, Math.max(0, heat + (firing ? dt * 3.4 : -dt * 2.4)));
      const moving = pressed.size > 0 ? 1 : 0;
      moveBlend += (moving - moveBlend) * Math.min(1, dt * 11);
      const spread = 6 + moveBlend * 8 + heat * 13;
      const el = ref.current;
      if (el) {
        el.style.setProperty('--paint-spread', `${spread.toFixed(2)}px`);
        el.style.setProperty('--paint-heat', heat.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onBlur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return (
    <div ref={ref} className="paint-aim-reticle" aria-hidden="true">
      <span className="paint-aim-dot" />
      <i className="paint-aim-petal paint-aim-up" />
      <i className="paint-aim-petal paint-aim-down" />
      <i className="paint-aim-petal paint-aim-left" />
      <i className="paint-aim-petal paint-aim-right" />
    </div>
  );
}

export function WorldHud(props: WorldHudProps) {
  const paintAiming =
    props.current?.id === 'paint' &&
    props.aiming &&
    props.perspective === 'first' &&
    !props.dead;
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
        className={`crosshair modern-crosshair ${props.current?.id === 'sniper' || paintAiming ? 'is-hidden' : ''
          }`}
      >
        <i />
        <i />
      </div>
      {paintAiming && <PaintAimReticle />}
      {props.mode === 'battle' && props.hitMark && (
        <div
          key={props.hitMark.key}
          className={`hit-mark hit-mark-${props.hitMark.zone}`}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
          <i />
          {props.hitMark.zone !== 'torso' && (
            <b>{props.hitMark.zone === 'head' ? 'В ГОЛОВУ' : 'ПО КОНЕЧНОСТИ'}</b>
          )}
        </div>
      )}
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
      {props.mode === 'retro' && (
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
      )}
      {props.mode === 'retro' && props.room.state.readyCheck?.active && (
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
      {props.mode === 'battle' && props.shieldSeconds > 0 && !props.dead && (
        <div
          className="spawn-immunity-hud"
          title="Бессмертие после возрождения (5 секунд)"
        >
          <span className="immunity-icon">🛡️</span>
          <span>ЩИТ ВОЗРОЖДЕНИЯ</span>
          <strong>{props.shieldSeconds}с</strong>
        </div>
      )}
      {props.mode === 'battle' && (
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
      )}
      {props.mode === 'battle' && (
      <div className="killfeed-container" aria-live="polite">
        {props.killfeed.map((msg, idx) => {
          // Имена в ленте окрашены по сторонам: сразу видно, чей это размен.
          const teamColor = (id?: string) => {
            const team = props.room.members.find((m) => m.id === id)?.team;
            return team === 'red' ? '#ff8f8a' : team === 'blue' ? '#8fbcff' : '#d7dee9';
          };
          return (
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
                '--killer-color': teamColor(msg.killer),
                '--victim-color': teamColor(msg.victim),
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
          );
        })}
      </div>
      )}
      {props.mode === 'battle' &&
        props.room.match &&
        props.room.match.phase !== 'live' && (
          <output className="match-banner">
            <b
              style={{
                color:
                  props.room.match.phase === 'freeze'
                    ? '#e7eeff'
                    : props.room.match.winner === 'red'
                      ? '#ff5d52'
                      : props.room.match.winner === 'blue'
                        ? '#5aa9ff'
                        : '#e7eeff',
              }}
            >
              {props.room.match.phase === 'freeze'
                ? 'ПРИГОТОВЬТЕСЬ'
                : props.room.match.phase === 'ended'
                ? props.room.match.winner === 'draw'
                  ? 'НИЧЬЯ'
                  : props.room.match.winner === 'red'
                    ? 'ПОБЕДА КРАСНЫХ'
                    : 'ПОБЕДА СИНИХ'
                : props.room.match.winner === 'red'
                  ? 'РАУНД ЗА КРАСНЫМИ'
                  : props.room.match.winner === 'blue'
                    ? 'РАУНД ЗА СИНИМИ'
                    : 'РАУНД ОКОНЧЕН'}
            </b>
            <small>
              {props.room.match.phase === 'freeze'
                ? `Раунд ${props.room.match.round} начнётся через ${props.freezeSeconds} с`
                : `${props.room.match.score.red} : ${props.room.match.score.blue}`}
              {props.room.match.phase === 'intermission' &&
                ' · следующий раунд вот-вот начнётся'}
            </small>
          </output>
        )}
      {props.personalAlert && (
        <div
          key={props.personalAlert.key}
          className={`combat-personal-alert alert-${props.personalAlert.type}`}
        >
          <strong>{props.personalAlert.text}</strong>
          {props.personalAlert.sub && <small>{props.personalAlert.sub}</small>}
        </div>
      )}
      {/* Здоровье есть и на ретроспективе: там тоже можно словить залп конфетти. */}
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
