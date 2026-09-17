'use client';

import { CloudSun, Lock, Pause, Play, Wind } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { dayMoment, type DayCycle } from '@/lib/day-cycle';
import {
  currentWeather,
  WEATHER_LABELS,
  WEATHER_SETTINGS,
  weatherMix,
  weatherSetting,
  type WeatherParam,
  type WeatherTuning,
} from '@/lib/weather';
import { WeatherPeriodSelect, WeatherTuningPanel } from './weather-tuning';

/**
 * Время суток, время года и погода прямо в шапке комнаты.
 *
 * Раньше они лежали в «Облике мира» — третьим экраном в глубине меню, — хотя
 * их крутят посреди встречи чаще всего остального. Один чип показывает, что
 * сейчас стоит, и открывает обе шкалы; отдельного чипа на каждую не делаем,
 * чтобы не отбирать место у фаз и таймера.
 */

const TIMES = [
  { id: 'dawn', label: 'Рассвет', icon: '🌅' },
  { id: 'day', label: 'День', icon: '☀️' },
  { id: 'sunset', label: 'Закат', icon: '🌇' },
  { id: 'night', label: 'Ночь', icon: '🌙' },
] as const;

const SEASONS = [
  { id: 'spring', label: 'Весна', icon: '🌱' },
  { id: 'summer', label: 'Лето', icon: '🌻' },
  { id: 'autumn', label: 'Осень', icon: '🍂' },
  { id: 'winter', label: 'Зима', icon: '❄️' },
] as const;

export function WorldQuickChip({
  time,
  season,
  weather,
  weatherTuning,
  weatherPeriod,
  windEffects,
  now,
  dayCycle,
  host,
  onTimeChange,
  onSeasonChange,
  onWeatherChange,
  onWeatherTuningChange,
  onWeatherPeriodChange,
  onWindEffectsChange,
  onDayCycleChange,
  onLocked,
}: {
  time: string;
  season: string;
  weather?: string;
  weatherTuning?: WeatherTuning;
  weatherPeriod?: number;
  windEffects?: boolean;
  /** Серверное время: по нему считается фаза идущих суток. */
  now: number;
  dayCycle?: DayCycle;
  host: boolean;
  onTimeChange: (time: string) => void;
  onSeasonChange: (season: string) => void;
  onWeatherChange: (weather: string) => void;
  onWeatherPeriodChange: (minutes: number) => void;
  onWeatherTuningChange: (patch: Partial<Record<WeatherParam, number | null>> | null) => void;
  onWindEffectsChange: (on: boolean) => void;
  onDayCycleChange: (running: boolean) => void;
  /** Не ведущий тоже открывает чип, но вместо молчания получает объяснение. */
  onLocked: () => void;
}) {
  // Пока сутки идут, чип показывает не сохранённое `time`, а ту фазу, которая
  // сейчас на небе: иначе значок расходился бы с картинкой.
  const moment = dayMoment({ time, dayCycle }, now);
  const nowTime = TIMES.find((t) => t.id === moment.time) || TIMES[1];
  const nowSeason = SEASONS.find((s) => s.id === season) || SEASONS[1];
  const running = moment.running;
  const setting = weatherSetting(weather);
  // В режиме «авто» значок показывает ту погоду, что сейчас идёт.
  const nowWeather = WEATHER_LABELS[currentWeather(weatherMix({ weather, season, weatherPeriod }, now))];
  const windOn = windEffects !== false;
  return (
    <Popover>
      <PopoverTrigger
        className="game-tag world-chip"
        title="Время суток, время года и погода"
        aria-label={`Мир: ${nowTime.label}, ${nowSeason.label}, ${nowWeather.label}`}
      >
        <CloudSun size={14} />
        <span className="world-chip-now">
          {nowTime.icon}
          {nowSeason.icon}
          {nowWeather.icon}
        </span>
      </PopoverTrigger>
      <PopoverContent className="world-chip-pop" align="end">
        {!host && (
          <p className="world-chip-locked">
            <Lock size={13} /> Облик мира меняет ведущий встречи
          </p>
        )}
        <span className="world-chip-title">Время суток</span>
        {/* Сутки идут сами; любой ручной выбор ниже их останавливает и
            фиксирует время — про это здесь и написано, чтобы ведущий не решил,
            что выбор «не сработал». Вернуть ход суток можно этой же кнопкой. */}
        <button
          type="button"
          className={`world-chip-cycle ${running ? 'active' : ''}`}
          onClick={() => (host ? onDayCycleChange(!running) : onLocked())}
        >
          {running ? <Pause size={13} /> : <Play size={13} />}
          {running ? 'Сутки идут · 12 минут' : 'Время суток зафиксировано'}
        </button>
        <div className="world-chip-grid">
          {TIMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`world-chip-option ${!running && t.id === nowTime.id ? 'active' : ''}`}
              onClick={() => (host ? onTimeChange(t.id) : onLocked())}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        <span className="world-chip-title">Время года</span>
        <div className="world-chip-grid">
          {SEASONS.map((sn) => (
            <button
              key={sn.id}
              type="button"
              className={`world-chip-option ${sn.id === nowSeason.id ? 'active' : ''}`}
              onClick={() => (host ? onSeasonChange(sn.id) : onLocked())}
            >
              <span>{sn.icon}</span>
              {sn.label}
            </button>
          ))}
        </div>
        <span className="world-chip-title">
          Погода{setting === 'auto' ? ` · сейчас ${nowWeather.label.toLowerCase()}` : ''}
        </span>
        <div className="world-chip-grid">
          {WEATHER_SETTINGS.map((w) => (
            <button
              key={w}
              type="button"
              className={`world-chip-option ${w === setting ? 'active' : ''}`}
              onClick={() => (host ? onWeatherChange(w) : onLocked())}
              title={w === 'auto' ? 'Погода меняется сама, по времени года' : undefined}
            >
              <span>{WEATHER_LABELS[w].icon}</span>
              {WEATHER_LABELS[w].label}
            </button>
          ))}
        </div>
        <WeatherPeriodSelect
          weather={weather}
          season={season}
          period={weatherPeriod}
          now={now}
          host={host}
          onChange={onWeatherPeriodChange}
        />
        {/* Ветер зависит от погоды и сносит игроков и пули. Это правило боя для
            всех, поэтому выключает его ведущий, как и остальной облик мира. */}
        <button
          type="button"
          className={`world-chip-cycle ${windOn ? 'active' : ''}`}
          onClick={() => (host ? onWindEffectsChange(!windOn) : onLocked())}
        >
          <Wind size={13} />
          {windOn ? 'Ветер сносит игроков и пули' : 'Ветер не влияет на бой'}
        </button>
        <details className="world-chip-tuning">
          <summary>Тонкая настройка погоды</summary>
          <WeatherTuningPanel
            weather={weather}
            season={season}
            period={weatherPeriod}
            tuning={weatherTuning}
            now={now}
            host={host}
            onChange={onWeatherTuningChange}
          />
        </details>
      </PopoverContent>
    </Popover>
  );
}
