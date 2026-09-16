'use client';
import { GAME_TOOLS, type Room, type Person } from '@/lib/model';
import type { GameMode } from '@/lib/maps/catalog';
import type { Perspective } from '@/lib/game-camera';
import { Eye, User, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SNIPER_ZOOM_LEVELS, SNIPER_ZOOM_FOVS } from './world-constants';
import {
  AMMO_DISPLAY_EVENT,
  DEFAULT_AMMO_DISPLAY,
  readAmmoDisplay,
  type AmmoDisplay,
} from '@/lib/ammo-display';
import type { KillMessage, PersonalAlert, HitEffect } from './world';
import type { VoiceView } from './voice-chat';

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
  /** Голосовой чат: свой микрофон и кто говорит (components/voice-chat.ts). */
  voice?: VoiceView;
};

/** Почему микрофон молчит. Пустая строка — всё в порядке, показывать нечего. */
const MIC_TROUBLE: Record<string, string> = {
  denied: 'Микрофон запрещён в настройках браузера',
  absent: 'Микрофон не найден',
  insecure: 'Микрофон недоступен: откройте игру по https://',
};

/**
 * Голоса у правого края экрана.
 *
 * Правый край выбран не случайно: слева уже висят FPS и состав, в центре
 * прицел, снизу оружие, а лента убийств живёт справа сверху — голоса встают
 * под ней, в единственном спокойном месте, куда взгляд уходит между
 * перестрелками.
 *
 * Строка показывает не только того, кого слышно. Заглушённый ведущим и тот, с
 * кем ещё не собралось соединение, тоже попадают в список — перечёркнутым
 * микрофоном. Иначе человек, которому выключили звук, жал бы кнопку в пустоту,
 * а остальные не понимали бы, почему он молчит и машет руками.
 */
function VoicePanel({ voice, room }: { voice: VoiceView; room: Room }) {
  const trouble = MIC_TROUBLE[voice.mic] ?? '';
  const nameOf = (id: string) =>
    room.state.anonymousPlayers
      ? 'Участник'
      : room.members.find((m) => m.id === id)?.name || 'Участник';
  const teamOf = (id: string) => room.members.find((m) => m.id === id)?.team || '';
  const rows = voice.speakers;
  const mine = voice.talking;
  const blocked = voice.roomOff || voice.mutedByHost;
  if (!rows.length && !mine && !blocked && !trouble) return null;
  return (
    <div className="voice-panel" aria-live="polite">
      {rows.map((s) => (
        <div
          key={s.id}
          className={`voice-row team-${teamOf(s.id) || 'none'} ${s.audible ? 'heard' : 'silent'}`}
          title={
            s.audible
              ? `${nameOf(s.id)} говорит ${s.channel === 'team' ? 'своей команде' : 'всем'}`
              : `${nameOf(s.id)} пытается сказать, но его не слышно`
          }
        >
          <span className="voice-mark" aria-hidden="true">
            {s.audible ? '🎙' : '🔇'}
          </span>
          <span className="voice-name">{nameOf(s.id)}</span>
          <span className="voice-scope">{s.channel === 'team' ? 'своим' : 'всем'}</span>
        </div>
      ))}
      {mine && (
        <div className={`voice-row is-me ${voice.mic === 'live' ? 'heard' : 'silent'}`}>
          <span className="voice-mark" aria-hidden="true">
            {voice.mic === 'live' ? '🎙' : voice.mic === 'asking' ? '⏳' : '🔇'}
          </span>
          <span className="voice-name">Вы</span>
          <span className="voice-scope">{mine === 'team' ? 'своим' : 'всем'}</span>
        </div>
      )}
      {(blocked || trouble) && (
        <div className="voice-note">
          {voice.roomOff
            ? 'Ведущий выключил голосовой чат'
            : voice.mutedByHost
              ? 'Ведущий вас заглушил'
              : trouble}
        </div>
      )}
    </div>
  );
}

/**
 * Разброс краскомёта в режиме ПКМ: четыре лепестка, которые расходятся от
 * движения и от непрерывной стрельбы. Точку попадания рисовать здесь больше не
 * нужно — при прицеливании её показывает светящаяся точка коллиматора на самой
 * модели. Данные о движении и отдаче берутся из тех же событий ввода, что и у
 * движка (WASD/стрелки + ЛКМ), поэтому дополнительные пропсы `WorldHud` не нужны.
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
      <i className="paint-aim-petal paint-aim-up" />
      <i className="paint-aim-petal paint-aim-down" />
      <i className="paint-aim-petal paint-aim-left" />
      <i className="paint-aim-petal paint-aim-right" />
    </div>
  );
}

/**
 * Ширина панели предметов и её верхняя кромка — панель рендерит `world.tsx`,
 * а полоска HP и остаток магазина живут здесь, поэтому размеры снимаем
 * измерением: набор слотов зависит от режима, а размер кнопок — от ширины
 * экрана, и никакая константа не удержала бы их ровно по краям панели.
 *
 * Замер не идёт через состояние React, а пишется переменными CSS прямо на
 * контейнер: HUD перерисовывается поверх каждого кадра сцены, и лишний
 * ре-рендер здесь стоит дороже, чем запись трёх свойств.
 */
function useLoadoutAnchor() {
  useEffect(() => {
    const dock = document.querySelector<HTMLElement>('.quick-loadout');
    const host = dock?.parentElement;
    if (!dock || !host) return;
    const measure = () => {
      const dockBox = dock.getBoundingClientRect();
      const hostBox = host.getBoundingClientRect();
      host.style.setProperty('--hud-dock-width', `${Math.round(dockBox.width)}px`);
      host.style.setProperty('--hud-dock-top', `${Math.round(hostBox.bottom - dockBox.top)}px`);
      host.style.setProperty('--hud-dock-base', `${Math.round(hostBox.bottom - dockBox.bottom)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    observer.observe(host);
    return () => {
      observer.disconnect();
      for (const name of ['--hud-dock-width', '--hud-dock-top', '--hud-dock-base'])
        host.style.removeProperty(name);
    };
  }, []);
}

/**
 * Цвет полоски здоровья: оттенок едет от зелёного (130°) к красному (0°)
 * пропорционально hp. Считаем формулой, а не тремя порогами, — иначе на
 * границах ступеней полоска дёргала цветом от каждого попадания.
 */
function healthHue(hp: number) {
  return Math.round((Math.min(100, Math.max(0, hp)) / 100) * 130);
}

/**
 * Настройка вида магазина. Меню настроек и бой живут в разных ветках дерева и
 * общего состояния не имеют, поэтому подписываемся на событие модуля, а не
 * тянем проп через `room-app`.
 */
function useAmmoDisplay(): AmmoDisplay {
  const [display, setDisplay] = useState<AmmoDisplay>(DEFAULT_AMMO_DISPLAY);
  useEffect(() => {
    // Читаем только после монтирования: на сервере localStorage нет, и разметка
    // первого кадра разошлась бы с гидрацией.
    const sync = () => setDisplay(readAmmoDisplay());
    sync();
    window.addEventListener(AMMO_DISPLAY_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(AMMO_DISPLAY_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return display;
}

/**
 * Посегментный магазин читается взглядом, пока сегменты можно охватить разом, —
 * это примерно два десятка. У краскомёта 24 патрона (`WEAPONS` в
 * lib/weapon-definition.ts), и на ширине индикатора его сегменты вырождаются в
 * рябь по 2–3 px: сосчитать нельзя, а «много/мало» хуже видно, чем на шкале.
 * Выше порога рисуем сплошную шкалу — она не зависит от размера магазина.
 */
const AMMO_SEGMENT_LIMIT = 20;
/** Доля магазина, ниже которой индикатор краснеет: пора перезаряжаться. */
const AMMO_LOW_SHARE = 0.25;

/**
 * Патроны в правом нижнем углу. Без плашки и без подсказок: клавиши игрок
 * выучивает за первый бой, а название оружия и так видно по слоту в панели
 * предметов и по модели в руках.
 */
export function AmmoIndicator(props: {
  rounds: number;
  capacity: number;
  reloading: boolean;
}) {
  const display = useAmmoDisplay();
  const capacity = Math.max(1, props.capacity);
  const left = Math.min(capacity, Math.max(0, props.rounds));
  const low = !props.reloading && left <= Math.ceil(capacity * AMMO_LOW_SHARE);
  return (
    // `output` вместо div: в графическом виде на экране нет ни одной буквы,
    // и без живой области с подписью скринридеру нечего сообщить.
    <output
      className={`hud-ammo ${display === 'graphic' ? 'is-graphic' : 'is-numbers'} ${props.reloading ? 'is-reloading' : ''} ${low ? 'is-low' : ''}`}
      style={
        { '--ammo-fill': `${(left / capacity) * 100}%` } as React.CSSProperties
      }
      aria-label={
        props.reloading ? 'Перезарядка' : `Патроны: ${left} из ${capacity}`
      }
    >
      {display === 'graphic' ? (
        capacity > AMMO_SEGMENT_LIMIT ? (
          <span className="hud-ammo-gauge" aria-hidden="true">
            <i />
          </span>
        ) : (
          <span className="hud-ammo-segments" aria-hidden="true">
            {Array.from({ length: capacity }, (_, index) => (
              <i key={index} className={index < left ? 'is-loaded' : ''} />
            ))}
          </span>
        )
      ) : (
        <>
          <strong>{left}</strong>
          <small>/{capacity}</small>
        </>
      )}
    </output>
  );
}

export function WorldHud(props: WorldHudProps) {
  useLoadoutAnchor();
  const hp = Math.min(100, Math.max(0, props.self?.hp ?? 100));
  const kills = props.self?.kills ?? 0;
  const deaths = props.self?.deaths ?? 0;
  // При нуле смертей отношение не определено, и «∞» в углу экрана в начале
  // каждого раунда только пугает. Берём принятое в шутерах соглашение: пока не
  // умирал, коэффициент равен числу убийств — 3 убийства без смертей дают 3.00,
  // и переход к первой смерти (3 / 1 = 3.00) выходит без скачка. Два знака:
  // 1.50 и 1.53 различимы, третий в бою уже не читается.
  const kdRatio = (deaths > 0 ? kills / deaths : kills).toFixed(2);
  // Стороны показываем только когда они реально розданы: в ретро и свободной
  // драке поле `team` пустое, и пустой блок только мешал бы смотреть на бой.
  const sides = (['red', 'blue'] as const).map((team) => ({
    team,
    members: props.room.members.filter((m) => m.team === team),
  }));
  const teamBattle =
    props.mode === 'battle' && sides.some((side) => side.members.length > 0);
  /*
   * Прицеливание сквозь оружие. У краскомёта, дробовика и лайкомёта появились
   * настоящие целик с мушкой, и рука при ПКМ выводит их на ось камеры — рисовать
   * поверх ещё и перекрестие значит спорить с прицелом, по которому целятся.
   * У снайперки перекрестие прячется всегда: без оптики она бьёт от бедра.
   */
  const throughSights =
    !!props.current &&
    ['paint', 'confetti', 'like'].includes(props.current.id) &&
    props.aiming &&
    props.perspective === 'first' &&
    !props.dead;
  const paintAiming = throughSights && props.current?.id === 'paint';
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
        className={`crosshair modern-crosshair ${props.current?.id === 'sniper' || throughSights ? 'is-hidden' : ''
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
        {teamBattle && (
          <div className="hud-sides" aria-label="Состав команд">
            {sides.map((side) => (
              <div
                key={side.team}
                className={`hud-side hud-side-${side.team} ${
                  props.self?.team === side.team ? 'is-mine' : ''
                }`}
              >
                <i aria-hidden="true" />
                <b>{side.members.length}</b>
                <span>
                  {side.members.map((m) => m.name).join(', ') || '—'}
                </span>
              </div>
            ))}
            <p className="hud-side-hint">
              <kbd>G</kbd> — сменить сторону
            </p>
          </div>
        )}
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
          title="Бессмертие после возрождения: длительность задаёт ведущий в настройках комнаты"
        >
          <span className="immunity-icon">🛡️</span>
          <span>ЩИТ ВОЗРОЖДЕНИЯ</span>
          <strong>{props.shieldSeconds}с</strong>
        </div>
      )}
      {props.voice && <VoicePanel voice={props.voice} room={props.room} />}
      {props.mode === 'battle' && (
      <div
        className="combat-stats-hud"
        title="Убийства / Смерти / Помощи / коэффициент K/D"
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
        <div className="combat-stat-divider" />
        <div className="combat-stat-col stat-kd">
          <small>K/D</small>
          <strong>{kdRatio}</strong>
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
      {/* Здоровье есть и на ретроспективе: там тоже можно словить залп конфетти.
          Полоска прижата к панели предметов: взгляд в бою и так держится на
          центре низа экрана, а угловой блок с цифрами заставлял его метаться. */}
      <div
        className={`health-bar-hud ${props.dead ? 'is-depleted' : ''}`}
        style={
          {
            '--hp-fill': `${hp}%`,
            // Насыщенность ниже прежних 72%: заливка во всю ширину панели
            // предметов тянула взгляд сильнее, чем сам бой.
            '--hp-color': `hsl(${healthHue(hp)} 62% 47%)`,
          } as React.CSSProperties
        }
        title="Здоровье"
      >
        <i className="health-bar-fill" aria-hidden="true" />
        {/* Только число: «HP» рядом с залитой полоской здоровья ничего не
            добавляет, а по ширине это ещё треть подписи. Значение по-прежнему
            остаётся обычным текстом, так что скринридер его читает. */}
        <span className="health-bar-value">{hp}</span>
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
