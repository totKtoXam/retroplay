'use client';
/**
 * Настройки игрока из плана UX/UI (этап 3.4): поле зрения, громкость эффектов,
 * прицел, масштаб интерфейса и режим для дальтоников.
 *
 * Значения живут на устройстве (lib/user-prefs). Состояния React здесь нет:
 * контрол читает хранилище и пишет в него через `writePrefNotify`, а та шлёт
 * событие, по которому мир и HUD применяют настройку сразу, — и этот же
 * компонент перерисовывается по тому же событию. Источник правды один.
 */
import { useCallback, useId, useSyncExternalStore } from 'react';
import {
  PREF_CHANGED_EVENT,
  PREF_KEYS,
  readChoice,
  readNumberPref,
  readPref,
  writePrefNotify,
} from '@/lib/user-prefs';
import { plural } from '@/lib/plural';
// Один список видов прицела на меню и HUD.
import { CROSSHAIR_STYLES, type CrosshairStyle } from '@/lib/hud-prefs';
import { Toggle } from './controls';

/**
 * Сырое значение настройки, которое обновляется при каждой записи: и из этой
 * вкладки (`writePrefNotify`), и из соседней (событие `storage`). На сервере и
 * при гидрации — null: настройка устройства видна только в браузере.
 */
export function usePrefValue(key: string): string | null {
  const subscribe = useCallback(
    (notify: () => void) => {
      const onPref = (e: Event) => {
        if ((e as CustomEvent<string>).detail === key) notify();
      };
      const onStorage = (e: StorageEvent) => {
        if (e.key === key || e.key === null) notify();
      };
      window.addEventListener(PREF_CHANGED_EVENT, onPref);
      window.addEventListener('storage', onStorage);
      return () => {
        window.removeEventListener(PREF_CHANGED_EVENT, onPref);
        window.removeEventListener('storage', onStorage);
      };
    },
    [key],
  );
  return useSyncExternalStore(
    subscribe,
    () => readPref(key),
    () => null,
  );
}

/** Пределы и значения по умолчанию — те же, что описаны у ключей в lib/user-prefs. */
const FOV = { min: 70, max: 100, fallback: 80 };
const HUD_SCALE = { min: 0.9, max: 1.25, fallback: 1 };

const CROSSHAIR_LABELS: Record<CrosshairStyle, string> = {
  cross: 'Крест',
  dot: 'Точка',
  'cross-dot': 'Крест с точкой',
};

/**
 * Цвета прицела. Оранжевого и синего нет намеренно — это цвета команд, красного
 * — это цвет урона: прицел не должен путаться ни с тем, ни с другим. Чёрный —
 * для снега и яркого неба.
 */
export const CROSSHAIR_COLORS = [
  { value: '#f4f7ff', name: 'Белый' },
  { value: '#ffe066', name: 'Жёлтый' },
  { value: '#4ade80', name: 'Зелёный' },
  { value: '#7ee0ff', name: 'Голубой' },
  { value: '#ff66d9', name: 'Розовый' },
  { value: '#10131a', name: 'Чёрный' },
] as const;
const CROSSHAIR_DEFAULT_COLOR = '#f4f7ff';

function readCrosshairColor(raw: string | null) {
  return raw && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : CROSSHAIR_DEFAULT_COLOR;
}

/** Ползунок с подписью, текущим значением и подсказкой. */
function PrefRange({
  label,
  hint,
  value,
  min,
  max,
  step,
  shown,
  spoken,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Значение рядом с подписью: «80°», «75 %». */
  shown: string;
  /** Значение для скринридера: «80 градусов». */
  spoken: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="field player-range">
      <label htmlFor={id} className="player-range-head">
        <span>{label}</span>
        <output htmlFor={id} aria-hidden="true">
          {shown}
        </output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={spoken}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && (
        <small id={`${id}-hint`} className="field-hint">
          {hint}
        </small>
      )}
    </div>
  );
}

/** Поле зрения камеры, 70–100°. */
export function FovSetting() {
  usePrefValue(PREF_KEYS.fov);
  const fov = Math.round(readNumberPref(PREF_KEYS.fov, FOV.min, FOV.max, FOV.fallback));
  return (
    <PrefRange
      label="Поле зрения"
      hint="Шире — больше видно по краям, но цели мельче."
      value={fov}
      min={FOV.min}
      max={FOV.max}
      step={1}
      shown={`${fov}°`}
      spoken={plural(fov, ['градус', 'градуса', 'градусов'])}
      onChange={(v) => writePrefNotify(PREF_KEYS.fov, String(v))}
    />
  );
}

/** Громкость игровых эффектов отдельно от музыки, 0–100 %. */
export function SfxVolumeSetting() {
  usePrefValue(PREF_KEYS.sfxVolume);
  const pct = Math.round(readNumberPref(PREF_KEYS.sfxVolume, 0, 1, 1) * 100);
  return (
    <PrefRange
      label="Громкость эффектов"
      hint="Выстрелы, шаги, попадания и взрывы. Громкость музыки — в плеере комнаты."
      value={pct}
      min={0}
      max={100}
      step={5}
      shown={pct === 0 ? 'выкл.' : `${pct} %`}
      spoken={pct === 0 ? 'выключено' : plural(pct, ['процент', 'процента', 'процентов'])}
      onChange={(v) => writePrefNotify(PREF_KEYS.sfxVolume, String(v / 100))}
    />
  );
}

/** Масштаб HUD, 90–125 %: зависит от экрана, поэтому живёт в «Графике». */
export function HudScaleSetting() {
  usePrefValue(PREF_KEYS.hudScale);
  const pct = Math.round(
    readNumberPref(PREF_KEYS.hudScale, HUD_SCALE.min, HUD_SCALE.max, HUD_SCALE.fallback) * 100,
  );
  return (
    <PrefRange
      label="Масштаб интерфейса"
      hint="Размер надписей и индикаторов боя. На большом экране — крупнее, на маленьком — мельче, чтобы не закрывать обзор."
      value={pct}
      min={HUD_SCALE.min * 100}
      max={HUD_SCALE.max * 100}
      step={5}
      shown={`${pct} %`}
      spoken={plural(pct, ['процент', 'процента', 'процентов'])}
      onChange={(v) => writePrefNotify(PREF_KEYS.hudScale, String(v / 100))}
    />
  );
}

/** Превью прицела на «небе и земле»: видно, как цвет читается на светлом и тёмном. */
function CrosshairPreview({ style, color }: { style: CrosshairStyle; color: string }) {
  const lines = style !== 'dot';
  const dot = style !== 'cross';
  // Контур контрастный цвету: светлому прицелу — тёмный, чёрному — светлый.
  const dark = color.toLowerCase() === '#10131a';
  const edge = dark ? 'rgb(244 247 255 / 0.85)' : 'rgb(8 13 25 / 0.8)';
  const arms = 'M20 7v8M20 25v8M7 20h8M25 20h8';
  return (
    <svg className="crosshair-preview" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      {lines && (
        <>
          <path d={arms} stroke={edge} strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d={arms} stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
        </>
      )}
      {dot && <circle cx="20" cy="20" r="2.4" fill={color} stroke={edge} strokeWidth="1.2" />}
    </svg>
  );
}

/** Прицел: вид (сегмент из трёх с превью) и цвет (кружки с названиями). */
export function CrosshairSetting() {
  usePrefValue(PREF_KEYS.crosshairStyle);
  const rawColor = usePrefValue(PREF_KEYS.crosshairColor);
  const style = readChoice<CrosshairStyle>(PREF_KEYS.crosshairStyle, CROSSHAIR_STYLES, 'cross');
  const color = readCrosshairColor(rawColor);
  const name = useId();
  const colorName = CROSSHAIR_COLORS.find((c) => c.value === color)?.name ?? 'свой';
  return (
    <div className="player-crosshair">
      <fieldset className="player-fieldset">
        <legend className="field-label">Прицел</legend>
        <div className="player-seg">
          {CROSSHAIR_STYLES.map((s) => (
            <label key={s} className={`player-seg-item ${style === s ? 'is-on' : ''}`}>
              <input
                type="radio"
                name={`${name}-style`}
                value={s}
                checked={style === s}
                onChange={() => writePrefNotify(PREF_KEYS.crosshairStyle, s)}
              />
              <CrosshairPreview style={s} color={color} />
              <span>{CROSSHAIR_LABELS[s]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="player-fieldset">
        <legend className="field-label">
          Цвет прицела: <span className="player-value">{colorName.toLowerCase()}</span>
        </legend>
        <div className="player-swatches">
          {CROSSHAIR_COLORS.map((c) => (
            <label key={c.value} className="player-swatch" title={c.name}>
              <input
                type="radio"
                name={`${name}-color`}
                value={c.value}
                checked={color === c.value}
                onChange={() => writePrefNotify(PREF_KEYS.crosshairColor, c.value)}
              />
              <span className="player-swatch-dot" style={{ background: c.value }} aria-hidden="true" />
              <span className="sr-only">{c.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/**
 * Режим для дальтоников. Команды оранжевые и синие у всех и без него; режим
 * добавляет формы: на миникарте союзник — ромб, враг — треугольник. Тот же ключ
 * читает HUD для значков в ленте убийств.
 */
/** Блок частоты кадров и пинга в углу HUD — для тех, кому он мешает. */
export function StatsSetting() {
  const on = usePrefValue(PREF_KEYS.showStats) !== '0';
  return (
    <Toggle
      label="Показывать частоту кадров и пинг"
      description="Блок в левом верхнем углу игры. Настройки графики остаются в меню."
      value={on}
      onChange={(v) => writePrefNotify(PREF_KEYS.showStats, v ? '1' : '0')}
    />
  );
}

/** Кровь и тела на мрачных картах. Приложение — и для рабочих встреч: кому не нужно, выключит. */
export function GoreSetting() {
  const on = usePrefValue(PREF_KEYS.gore) !== '0';
  return (
    <Toggle
      label="Кровь и жестокость"
      description="Лужи крови и тела погибших на мрачных картах («Зона заражения»). Выключите — останутся только разруха и брошенные вещи; на игру это не влияет."
      value={on}
      onChange={(v) => writePrefNotify(PREF_KEYS.gore, v ? '1' : '0')}
    />
  );
}

export function ColorblindSetting() {
  const on = usePrefValue(PREF_KEYS.colorblind) === '1';
  return (
    <Toggle
      label="Режим для дальтоников"
      description="Свой и чужой различаются формой, а не только цветом: на миникарте союзник — ромб, враг — треугольник. Команды оранжевые и синие и без этого режима."
      value={on}
      onChange={(v) => writePrefNotify(PREF_KEYS.colorblind, v ? '1' : '0')}
    />
  );
}
