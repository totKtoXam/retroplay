'use client';
import { GAME_TOOLS, type Room, type Person } from '@/lib/model';
import type { GameMode } from '@/lib/maps/catalog';
import type { Perspective } from '@/lib/game-camera';
import { Bell, Check, Crosshair, Eye, Hourglass, Mic, MicOff, Shield, Skull, User, X, Zap } from 'lucide-react';
import { teamLook } from '@/lib/team-colors';
import { useEffect, useRef, useState } from 'react';
import { SNIPER_ZOOM_LEVELS, SNIPER_ZOOM_FOVS } from './world-constants';
import {
  AMMO_DISPLAY_EVENT,
  DEFAULT_AMMO_DISPLAY,
  readAmmoDisplay,
  type AmmoDisplay,
} from '@/lib/ammo-display';
import type { KillMessage, PersonalAlert } from './world';
import type { VoiceView } from './voice-chat';
import type { HudPrefs } from '@/lib/hud-prefs';
import { lowHealth } from '@/lib/hud-feedback';
import { keyLabel } from '@/lib/keymap';
import { HeadshotIcon, NoScopeIcon, WeaponIcon, weaponName } from './hud-icons';
import {
  HudCrosshair,
  HudDamage,
  HudHitMark,
  HudLowHealth,
  type DamageHit,
  type HudMarkZone,
} from './hud-feedback';
import { HudDeathCard, HudMatchBanner, type DeathInfo } from './hud-states';

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
  /** Свежие попадания по игроку: дуги урона по краю экрана. */
  damageHits: DamageHit[];
  /** Где игрок и куда смотрит — для дуг урона, читается каждый кадр. */
  damageView: () => { x: number; z: number; yaw: number } | null;
  /** Куда попал сам игрок последним выстрелом; `kill` — выстрел убил. */
  hitMark: { zone: HudMarkZone; key: number } | null;
  shieldSeconds: number;
  killfeed: KillMessage[];
  personalAlert: PersonalAlert | null;
  respawnSeconds: number;
  /** Полное время возрождения в комнате, с: для кольца отсчёта. */
  respawnTotal: number;
  /** Погибшие ждут следующего раунда (режим раундов): числа отсчёта у них нет. */
  waitsForRound: boolean;
  /** Кто и чем убил игрока; `null` — данных нет. */
  deathInfo: DeathInfo | null;
  /** Настройки игрока: прицел, масштаб HUD, режим для дальтоников. */
  prefs: HudPrefs;
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
    // Без aria-live: кто сейчас говорит, меняется каждую секунду, и скринридер
    // зачитывал бы это поверх боя. Объявляются только своё убийство и смерть.
    <div className="voice-panel">
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
            {s.audible ? <Mic size={13} /> : <MicOff size={13} />}
          </span>
          <span className="voice-name">{nameOf(s.id)}</span>
          <span className="voice-scope">{s.channel === 'team' ? 'своим' : 'всем'}</span>
        </div>
      ))}
      {mine && (
        <div className={`voice-row is-me ${voice.mic === 'live' ? 'heard' : 'silent'}`}>
          <span className="voice-mark" aria-hidden="true">
            {voice.mic === 'live' ? (
              <Mic size={13} />
            ) : voice.mic === 'asking' ? (
              <Hourglass size={13} />
            ) : (
              <MicOff size={13} />
            )}
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
 * Патроны в правом нижнем углу: в магазине — сколько осталось, в запасе — «∞»:
 * магазинов, как и гранат «в рюкзаке», бесконечно, кончается только то, что в
 * руках. Без плашки и без подсказок: клавиши игрок выучивает за первый бой, а
 * название оружия и так видно по слоту в панели предметов и по модели в руках.
 */
export function AmmoIndicator(props: {
  rounds: number;
  capacity: number;
  reloading: boolean;
  /** Доля перезарядки 0…1: шкала наполняется, пока магазин (или граната) готовится. */
  progress?: number;
  /**
   * Доля перезарядки магазина, читается каждый кадр: кольцо у патронов
   * наполняется без ре-рендера всего мира.
   */
  readProgress?: () => number;
  label?: string;
}) {
  const display = useAmmoDisplay();
  const ring = useRef<HTMLSpanElement>(null);
  const readProgress = props.readProgress;
  useEffect(() => {
    if (!props.reloading || !readProgress) return;
    let raf = 0;
    const tick = () => {
      ring.current?.style.setProperty('--ammo-progress', readProgress().toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [props.reloading, readProgress]);
  const capacity = Math.max(1, props.capacity);
  const left = Math.min(capacity, Math.max(0, props.rounds));
  // У гранаты «в руках» всегда одна: краснеть ей незачем.
  const low = !props.reloading && capacity > 1 && left <= Math.ceil(capacity * AMMO_LOW_SHARE);
  const fill = props.reloading && props.progress !== undefined ? props.progress : left / capacity;
  return (
    // Не живая область: остаток меняется с каждым выстрелом, и `output`
    // заставлял скринридер зачитывать его посреди боя. Подпись — скрытым
    // текстом: её прочтут, если дойти до индикатора.
    <div
      className={`hud-ammo ${display === 'graphic' ? 'is-graphic' : 'is-numbers'} ${props.reloading ? 'is-reloading' : ''} ${low ? 'is-low' : ''}`}
      style={{ '--ammo-fill': `${fill * 100}%` } as React.CSSProperties}
    >
      <span className="sr-only">
        {props.label ?? (props.reloading ? 'Перезарядка' : `Патроны: ${left} из ${capacity}, запас бесконечен`)}
      </span>
      {props.reloading && readProgress && (
        <span ref={ring} className="hud-ammo-ring" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle className="hud-ammo-ring-track" cx="12" cy="12" r="9.5" />
            <circle className="hud-ammo-ring-fill" cx="12" cy="12" r="9.5" pathLength={100} />
          </svg>
        </span>
      )}
      {/* Мало патронов — подсказка, какой клавишей перезарядиться. */}
      {low && (
        <kbd className="hud-ammo-reload-key" aria-hidden="true">
          {keyLabel('reload') || 'R'}
        </kbd>
      )}
      {display === 'graphic' ? (
        capacity > AMMO_SEGMENT_LIMIT || props.progress !== undefined ? (
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
          <strong aria-hidden="true">{left}</strong>
          <small aria-hidden="true">/∞</small>
        </>
      )}
    </div>
  );
}

/**
 * Граната — как магазин на один заряд: в руке одна, в «рюкзаке» бесконечно.
 * После броска следующую достают 10 секунд — это её перезарядка: в руке 0,
 * индикатор мигает, как у оружия, и шкала наполняется.
 */
export function GrenadeRecharge(props: { readyAt: number; cooldown: number }) {
  const [now, setNow] = useState(() => performance.now());
  const waiting = props.readyAt > now;
  useEffect(() => {
    const tick = () => setNow(performance.now());
    // Новый бросок сдвинул readyAt: обновляем сразу, не ждём такта таймера.
    const first = requestAnimationFrame(tick);
    const timer = setInterval(tick, 100);
    const stop = setTimeout(() => clearInterval(timer), Math.max(0, props.readyAt - performance.now()) + 150);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [props.readyAt]);
  const left = Math.max(0, props.readyAt - now);
  return (
    <AmmoIndicator
      rounds={waiting ? 0 : 1}
      capacity={1}
      reloading={waiting}
      progress={waiting ? 1 - left / props.cooldown : undefined}
      label={waiting ? `Граната через ${Math.ceil(left / 1000)} с` : 'Граната в руке, запас бесконечен'}
    />
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
  const low = props.mode === 'battle' && lowHealth(hp, props.dead);
  // Имена в ленте окрашены по сторонам: сразу видно, чей это размен. Светлый
  // оттенок цвета команды — имя читается на тёмной подложке.
  const teamColor = (id?: string) =>
    teamLook(props.room.members.find((m) => m.id === id)?.team).text;
  const colorblind = props.prefs.colorblind;
  const killer = props.deathInfo
    ? props.room.members.find((m) => m.id === props.deathInfo?.killer)
    : undefined;
  // Подсказка «G — сменить сторону» — только между схватками: посреди боя
  // смена стороны всё равно не нужна, а строка отнимала место у состава.
  const sideHint = props.room.match ? props.room.match.phase !== 'live' : false;
  return (
    <>
      {props.mode === 'battle' && <HudDamage hits={props.damageHits} view={props.damageView} />}
      {low && <HudLowHealth />}
      <HudCrosshair
        style={props.prefs.crosshairStyle}
        color={props.prefs.crosshairColor}
        hidden={props.current?.id === 'sniper' || throughSights}
      />
      {paintAiming && <PaintAimReticle />}
      {props.mode === 'battle' && props.hitMark && (
        <HudHitMark key={props.hitMark.key} zone={props.hitMark.zone} />
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
              <span>КРАТНОСТЬ: {SNIPER_ZOOM_LEVELS[props.sniperZoomIndex]}×</span>
              <span>ОБЗОР: {SNIPER_ZOOM_FOVS[props.sniperZoomIndex]}°</span>
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
              <span>ФЕЙЕРВЕРК</span>
              <span>КАЛИБР 75 мм</span>
              <small className="scope-zoom-hint">Колесо: зум</small>
            </div>
          </div>
        </div>
      )}
      <div className="world-hud-top-left">
        {props.prefs.showStats && (
          <button
            className="world-location world-performance"
            onClick={props.onGraphics}
            aria-label="Настройки графики: частота кадров и сеть"
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
                {props.fps} кадр/с <span> / {props.fpsLimit}</span>
              </strong>
              <span>
                {props.self?.ping || 0} мс · {props.packetLoss ?? 0}% потерь · Графика ↗
              </span>
            </div>
          </button>
        )}
        <fieldset className="view-switch" aria-label="Режим обзора">
          <button
            type="button"
            aria-pressed={props.perspective === 'first'}
            onClick={() => props.choosePerspective('first')}
            title="Вид от 1-го лица [V]"
            aria-label="Вид от 1-го лица"
          >
            <Eye size={15} />
          </button>
          <button
            type="button"
            aria-pressed={props.perspective === 'third'}
            onClick={() => props.choosePerspective('third')}
            title="Вид от 3-го лица [V]"
            aria-label="Вид от 3-го лица"
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
            {sideHint && (
              <p className="hud-side-hint">
                <kbd>G</kbd> — сменить сторону
              </p>
            )}
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
          <span className="ready-bell-icon" aria-hidden="true">
            <Bell size={14} />
          </span>
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
                <span className="ready-icon" aria-hidden="true">
                  <Zap size={16} />
                </span>
                <strong>Готовы к ретроспективе?</strong>
              </div>
              <button
                className="ready-check-close"
                onClick={() => void props.onOp?.({ type: 'ready.dismiss' })}
                title="Закрыть проверку"
                aria-label="Закрыть проверку"
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
                      <span className="ready-status-badge" aria-label={isReady ? 'Готов' : 'Ждём'}>
                        {isReady ? <Check size={14} /> : <Hourglass size={14} />}
                      </span>
                      <span
                        className="ready-member-name"
                        style={{ color: isAnonymous ? '#94a3b8' : m.color }}
                      >
                        {displayName}
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
      {props.mode === 'battle' && props.shieldSeconds > 0 && !props.dead && (
        <div
          className="spawn-immunity-hud"
          title="Бессмертие после возрождения: длительность задаёт ведущий в настройках комнаты"
        >
          <span className="immunity-icon" aria-hidden="true">
            <Shield size={14} />
          </span>
          <span>ЩИТ ВОЗРОЖДЕНИЯ</span>
          <strong>{props.shieldSeconds} с</strong>
        </div>
      )}
      {props.voice && <VoicePanel voice={props.voice} room={props.room} />}
      {props.mode === 'battle' && (
      <div
        className="combat-stats-hud"
        title="Убийства / Смерти / Помощь / отношение убийств к смертям"
      >
        <div className="combat-stat-col stat-k">
          <small>УБ</small>
          <strong>{props.self?.kills ?? 0}</strong>
        </div>
        <div className="combat-stat-divider" />
        <div className="combat-stat-col stat-d">
          <small>СМ</small>
          <strong>{props.self?.deaths ?? 0}</strong>
        </div>
        <div className="combat-stat-divider" />
        <div className="combat-stat-col stat-a">
          <small>ПОМ</small>
          <strong>{props.self?.assists ?? 0}</strong>
        </div>
        <div className="combat-stat-divider" />
        <div className="combat-stat-col stat-kd">
          <small>УБ/СМ</small>
          <strong>{kdRatio}</strong>
        </div>
      </div>
      )}
      {props.mode === 'battle' && (
      // Без aria-live: чужие убийства скринридеру ни к чему, своё убийство и
      // своя смерть объявляются отдельно (world.tsx).
      <div className="killfeed-container">
        {props.killfeed.map((msg, idx) => {
          const mine = msg.killer === props.room.self;
          const myDeath = msg.victim === props.room.self;
          return (
          <div
            key={`${msg.id}-${idx}`}
            className={`killfeed-item ${mine
                ? 'is-my-kill'
                : myDeath
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
            {/* Своя смерть отмечена формой, а не только красной рамкой: цвет
                различают не все. В режиме для дальтоников знак есть и у
                своего убийства — «убил / погиб» различаются без цвета. */}
            {myDeath && (
              <span className="killfeed-mark is-death" aria-label="Ваша смерть">
                <Skull size={13} aria-hidden="true" />
              </span>
            )}
            {mine && colorblind && (
              <span className="killfeed-mark is-kill" aria-label="Ваше убийство">
                <Crosshair size={13} aria-hidden="true" />
              </span>
            )}
            <span className="killfeed-killer">{msg.killerName}</span>
            {msg.assisterName && (
              <span className="killfeed-assist">(+ {msg.assisterName})</span>
            )}
            <span
              className={`killfeed-weapon ${msg.noScope ? 'is-noscope' : ''}`}
              title={weaponName(msg.tool)}
            >
              <WeaponIcon tool={msg.tool} />
              {msg.headshot && (
                <span className="killfeed-badge is-headshot" title="В голову">
                  <HeadshotIcon />
                </span>
              )}
              {msg.tool === 'sniper' && msg.noScope && (
                <span className="killfeed-badge is-noscope">
                  <NoScopeIcon />
                  БЕЗ ПРИЦЕЛА
                </span>
              )}
            </span>
            <span className="killfeed-victim">{msg.victimName}</span>
          </div>
          );
        })}
      </div>
      )}
      {props.mode === 'battle' && props.room.match && (
        <HudMatchBanner
          match={props.room.match}
          myTeam={props.self?.team}
          selfId={props.self?.id}
          freezeSeconds={props.freezeSeconds}
          kills={kills}
          deaths={deaths}
          assists={props.self?.assists ?? 0}
        />
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
        className={`health-bar-hud ${props.dead ? 'is-depleted' : ''} ${low ? 'is-low' : ''}`}
        style={
          {
            '--hp-fill': `${hp}%`,
            '--hp-color': `hsl(${healthHue(hp)} 62% 42%)`,
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
        <HudDeathCard
          selfId={props.room.self}
          info={props.deathInfo}
          killerHp={killer?.hp}
          killerColor={props.deathInfo ? teamColor(props.deathInfo.killer) : undefined}
          seconds={props.respawnSeconds}
          total={props.respawnTotal}
          waitsForRound={props.waitsForRound}
        />
      )}
    </>
  );
}
