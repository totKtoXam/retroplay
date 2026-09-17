'use client';

import {
  WEATHER_PARAM_INFO,
  WEATHER_PARAMS,
  weatherLevels,
  type WeatherParam,
  type WeatherTuning,
} from '@/lib/weather';

/**
 * Тонкая настройка погоды: по строке на параметр (ветер, туман, дождь…).
 * «Авто» берёт уровень из выбранной погоды, остальные пункты — уровни шкалы
 * с расшифровкой (баллы Бофорта, видимость, мм/ч). Выпадающий список, а не
 * ряд кнопок: у параметра до шести вариантов с длинными именами, и кнопки не
 * помещались бы в узкий поповер.
 */
export function WeatherTuningPanel({
  weather,
  season,
  tuning,
  now,
  host,
  onChange,
  className = '',
}: {
  weather?: string;
  season: string;
  tuning?: WeatherTuning;
  /** Серверное время: по нему видно, какой уровень сейчас даёт «Авто». */
  now: number;
  host: boolean;
  /** Частичный патч: null у параметра — вернуть его к погоде, null целиком — сбросить всё. */
  onChange: (patch: Partial<Record<WeatherParam, number | null>> | null) => void;
  className?: string;
}) {
  // Что дала бы погода без ручных уровней — для подписи пункта «Авто».
  const auto = weatherLevels({ weather, season }, now);
  const tuned = WEATHER_PARAMS.filter((p) => tuning?.[p] !== undefined).length;
  return (
    <div className={`weather-tuning ${className}`}>
      {WEATHER_PARAMS.map((param) => {
        const info = WEATHER_PARAM_INFO[param];
        const value = tuning?.[param];
        const autoLevel = Math.max(info.min, Math.min(4, Math.round(auto[param])));
        return (
          <label key={param} className="weather-tuning-row" title={`Шкала: ${info.scale}`}>
            <span>{info.label}</span>
            <select
              value={value === undefined ? 'auto' : String(value)}
              disabled={!host}
              onChange={(e) =>
                onChange({ [param]: e.target.value === 'auto' ? null : Number(e.target.value) })
              }
            >
              <option value="auto">Авто · {info.levels[autoLevel][0].toLowerCase()}</option>
              {info.levels.map(([name, detail], level) =>
                level < info.min ? null : (
                  <option key={level} value={level}>
                    {name}
                    {detail ? ` — ${detail}` : ''}
                  </option>
                ),
              )}
            </select>
          </label>
        );
      })}
      {host && tuned > 0 && (
        <button type="button" className="weather-tuning-reset" onClick={() => onChange(null)}>
          Сбросить ручные уровни ({tuned})
        </button>
      )}
    </div>
  );
}
