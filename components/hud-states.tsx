'use client';
/* oxlint-disable next/no-html-link-for-pages -- Полная навигация обходит ошибку RSC prefetch в production-сборке vinext. */
import { useEffect, useRef, useState } from 'react';
import { LogOut, MousePointer2, Play, Keyboard, Skull, TriangleAlert, Smartphone } from 'lucide-react';
import type { GameMode } from '@/lib/maps/catalog';
import type { Match } from '@/lib/model';
import { keyLabel } from '@/lib/keymap';
import { teamCss } from '@/lib/team-colors';
import { matchOutcome, respawnCaption, roundCountdown } from '@/lib/hud-feedback';
import { KeysHelp } from './keys-help';
import { WeaponIcon, weaponName } from './hud-icons';

/*
 * Состояния игры поверх мира (план UX/UI, этап 3.3): первый вход, пауза, смерть,
 * итог раунда и потеря графики. Стили — app/hud.css.
 */

/** Подсказка на карточке входа: в каждом режиме ЛКМ делает своё. */
const START_HINTS: Partial<Record<GameMode, string>> = {
  retro: 'Esc — свободный курсор · ЛКМ — предмет в руках · E у доски — открыть',
  battle: 'Esc — пауза · ЛКМ — стрелять · R — перезарядка',
  impostor: 'Esc — пауза · E — использовать · F — фонарик',
  survival: 'Esc — пауза · ЛКМ — стрелять · N — навыки',
};

/**
 * Карточка первого входа. На устройстве без мыши подсказки про мышь и кнопка
 * «Играть» ничего не дадут: захвата указателя на телефоне нет, а бой без
 * клавиатуры не управляется. Там карточка честно говорит, что работает с телефона.
 */
export function HudStartCard(props: {
  mode: GameMode;
  touchOnly: boolean;
  waiting: boolean;
  error: string;
  onPlay: () => void;
}) {
  if (props.touchOnly)
    return (
      <div className="camera-onboarding hud-start is-touch">
        <Smartphone size={24} aria-hidden="true" />
        <div>
          <strong>Бой — с компьютера</strong>
          <span>Нужны клавиатура и мышь. Доска и чат работают с телефона.</span>
        </div>
      </div>
    );
  return (
    <div className="camera-onboarding hud-start">
      <MousePointer2 size={24} aria-hidden="true" />
      <div>
        <strong>Кликните, чтобы играть</strong>
        <span>Двигайте мышь — камера следует за вами.</span>
        <small>{START_HINTS[props.mode] ?? 'Esc — свободный курсор · ЛКМ — действие'}</small>
        {props.waiting ? (
          <output>Секунду…</output>
        ) : (
          props.error && <small role="alert">{props.error}</small>
        )}
      </div>
      <button className="play-capture" onClick={props.onPlay} disabled={props.waiting}>
        {props.waiting ? 'Секунду…' : 'Играть'}
      </button>
    </div>
  );
}

/**
 * Пауза по Esc. Раньше Esc возвращал карточку первого входа, и было непонятно,
 * идёт ли матч. Клик мимо карточки тоже продолжает игру — фон кликов не ловит.
 */
export function HudPause(props: {
  mode: GameMode;
  /** Матч идёт: в паузе по игроку продолжают стрелять. */
  vulnerable: boolean;
  waiting: boolean;
  error: string;
  onResume: () => void;
}) {
  const [keys, setKeys] = useState(false);
  const resume = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Фокус на главное действие: Enter или пробел сразу возвращают в игру.
    resume.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="hud-pause">
      <section className="hud-pause-card" aria-labelledby="hud-pause-title">
        <h2 id="hud-pause-title">Пауза</h2>
        {props.vulnerable && (
          <p className="hud-pause-warning">
            <TriangleAlert size={16} aria-hidden="true" />
            Матч идёт — вы уязвимы
          </p>
        )}
        <div className="hud-pause-actions">
          <button
            ref={resume}
            type="button"
            className="hud-btn hud-btn-primary"
            onClick={props.onResume}
            disabled={props.waiting}
          >
            <Play size={16} aria-hidden="true" />
            {props.waiting ? 'Секунду…' : 'Продолжить'}
          </button>
          <button
            type="button"
            className="hud-btn"
            aria-expanded={keys}
            aria-controls="hud-pause-keys"
            onClick={() => setKeys((v) => !v)}
          >
            <Keyboard size={16} aria-hidden="true" />
            Управление
          </button>
          <a className="hud-btn" href="/">
            <LogOut size={16} aria-hidden="true" />
            Выйти в лобби
          </a>
        </div>
        {props.waiting ? (
          <output className="hud-pause-note">
            Браузер ещё не отдал мышь — повторяем попытку.
          </output>
        ) : (
          props.error && (
            <p className="hud-pause-note" role="alert">
              {props.error}
            </p>
          )
        )}
        {keys && (
          <div id="hud-pause-keys" className="hud-pause-keys">
            <KeysHelp mode={props.mode} compact headingLevel={3} />
          </div>
        )}
      </section>
    </div>
  );
}

export type DeathInfo = {
  killer: string;
  killerName: string;
  tool?: string;
  headshot?: boolean;
  noScope?: boolean;
  teamkill?: boolean;
  /** Сколько метров было до убийцы в момент смерти. */
  distance?: number;
};

/**
 * Карточка смерти — до самого возрождения, а не 3,5 секунды, как прежнее
 * оповещение: за время отсчёта игрок успевает понять, кто, чем и откуда.
 */
export function HudDeathCard(props: {
  selfId: string;
  info: DeathInfo | null;
  /** Здоровье убийцы сейчас, если он в комнате. */
  killerHp?: number;
  killerColor?: string;
  seconds: number;
  total: number;
  waitsForRound: boolean;
}) {
  const info = props.info;
  const self = info?.killer === props.selfId;
  const share = props.waitsForRound || props.total <= 0 ? 1 : Math.min(1, props.seconds / props.total);
  // Укус зомби — не предмет из GAME_TOOLS: подпись своя, иначе было бы «Оружие».
  const details = info
    ? [
        info.tool === 'bite' ? 'укус зомби' : weaponName(info.tool),
        info.headshot ? 'в голову' : '',
        info.noScope ? 'без прицела' : '',
        info.distance !== undefined && !self ? `${Math.round(info.distance)} м` : '',
      ].filter(Boolean)
    : [];
  return (
    <div className="hud-death">
      <div className="hud-death-card">
        <div className="hud-death-ring" aria-hidden="true">
          <svg viewBox="0 0 64 64">
            <circle className="hud-death-ring-track" cx="32" cy="32" r="28" />
            <circle
              className="hud-death-ring-fill"
              cx="32"
              cy="32"
              r="28"
              pathLength={100}
              style={{ strokeDashoffset: 100 - share * 100 }}
            />
          </svg>
          {props.seconds > 0 && !props.waitsForRound ? (
            <strong>{props.seconds}</strong>
          ) : (
            <Skull size={22} />
          )}
        </div>
        <div className="hud-death-info">
          <span className="hud-death-eyebrow">
            {!info
              ? 'Вы выбыли'
              : self
                ? 'Вы устранили себя'
                : info.teamkill
                  ? 'Вас устранил союзник'
                  : 'Вас устранил'}
          </span>
          {info && !self && (
            <strong className="hud-death-killer" style={{ color: props.killerColor }}>
              {info.killerName}
            </strong>
          )}
          {details.length > 0 && (
            <span className="hud-death-weapon">
              <WeaponIcon tool={info?.tool} size={14} />
              {details.join(' · ')}
            </span>
          )}
          {info && !self && props.killerHp !== undefined && props.killerHp > 0 && (
            <span className="hud-death-hp">
              У него осталось <b>{props.killerHp}</b> здоровья
            </span>
          )}
          <p className="hud-death-caption">{respawnCaption(props.seconds, props.waitsForRound)}</p>
        </div>
      </div>
      <p className="hud-death-tips">
        <kbd>{keyLabel('map') || 'M'}</kbd> — карта · <kbd>{keyLabel('scoreboard') || 'Ё'}</kbd> — табло
      </p>
    </div>
  );
}

/** Потеря WebGL-контекста: видеокарта сбросила графику (сон ноутбука, драйвер, нехватка памяти). */
export function HudGraphicsLost() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="hud-gl-lost" role="alert">
      <strong>Графика перезапускается…</strong>
      <span>Видеокарта сбросила изображение. Обычно оно возвращается само через пару секунд.</span>
      {slow && (
        <button type="button" className="hud-btn hud-btn-primary" onClick={() => location.reload()}>
          Перезагрузить страницу
        </button>
      )}
    </div>
  );
}

const TEAM_COLOR: Record<string, string> = {
  red: teamCss('red'),
  blue: teamCss('blue'),
};

/**
 * Баннер раунда: отсчёт 3-2-1 перед стартом, итог относительно своей команды и
 * личный счёт в конце матча.
 */
export function HudMatchBanner(props: {
  match: Match;
  myTeam?: string;
  freezeSeconds: number;
  kills: number;
  deaths: number;
  assists: number;
}) {
  const { match } = props;
  if (match.phase === 'live') return null;
  if (match.phase === 'freeze') {
    const count = roundCountdown(match.phase, props.freezeSeconds);
    return (
      <div className="match-banner hud-match is-freeze">
        {count ? (
          <b key={count} className="hud-match-count">
            {count}
          </b>
        ) : (
          <b>ПРИГОТОВЬТЕСЬ</b>
        )}
        <small>
          Раунд {match.round}
          {count ? ' — сейчас начнётся' : ` начнётся через ${props.freezeSeconds} с`}
        </small>
      </div>
    );
  }
  const outcome = matchOutcome(match, props.myTeam);
  const color =
    outcome?.tone === 'neutral' && match.winner && match.winner !== 'draw'
      ? TEAM_COLOR[match.winner]
      : undefined;
  return (
    <div className={`match-banner hud-match is-${outcome?.tone ?? 'neutral'}`}>
      <b style={color ? { color } : undefined}>{outcome?.title}</b>
      <small>
        <span className="hud-match-score">
          <span style={{ color: TEAM_COLOR.red }}>{match.score.red}</span>
          {' : '}
          <span style={{ color: TEAM_COLOR.blue }}>{match.score.blue}</span>
        </span>
        {match.phase === 'intermission' && ' · следующий раунд вот-вот начнётся'}
      </small>
      {match.phase === 'ended' && (
        <small className="hud-match-mine">
          Ваш счёт: убийства {props.kills} · смерти {props.deaths} · помощь {props.assists}
        </small>
      )}
    </div>
  );
}
