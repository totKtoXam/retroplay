'use client';
import { useSyncExternalStore } from 'react';
import { Music2, Play, Pause, Volume2, Headphones } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  TRACKS,
  getMusicState,
  subscribeMusic,
  playMusic,
  pauseMusic,
  setMusicVolume,
} from '@/lib/soundtrack';

export function MusicPlayer({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const { playing, track, volume, error } = useSyncExternalStore(
    subscribeMusic,
    getMusicState,
    getMusicState,
  );
  return (
    <div className={`music-dock ${playing ? 'is-playing' : ''}`}>
      <button
        className="music-play"
        onClick={() => (playing ? pauseMusic() : void playMusic())}
        aria-label={playing ? 'Приостановить музыку' : 'Включить музыку'}
        title={playing ? 'Приостановить музыку' : 'Включить музыку'}
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <Popover onOpenChange={onOpenChange}>
        <PopoverTrigger className="music-open" aria-label="Музыкальный плеер">
          <span className="music-bars">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            <small>JINALY RADIO</small>
            <strong>{TRACKS.find((t) => t.id === track)?.title}</strong>
          </span>
          <Headphones size={16} />
        </PopoverTrigger>
        <PopoverContent className="music-popover" side="top" align="end">
          <div className="music-heading">
            <Music2 size={22} />
            <div>
              <strong>Музыка для встречи</strong>
              <small>Слышите только вы · без рекламы</small>
            </div>
          </div>
          <div className="music-tracks">
            {TRACKS.map((t) => (
              <button
                key={t.id}
                className={track === t.id ? 'selected' : ''}
                aria-pressed={track === t.id}
                onClick={() => {
                  void playMusic(t.id);
                }}
              >
                <span>{track === t.id && playing ? '♫' : '▷'}</span>
                <div>
                  <strong>{t.title}</strong>
                  <small>{t.subtitle}</small>
                </div>
              </button>
            ))}
          </div>
          <label className="music-volume">
            <Volume2 size={17} />
            <span className="sr-only">Громкость музыки</span>
            <input
              aria-label="Громкость музыки"
              type="range"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={(e) => {
                setMusicVolume(Number(e.target.value) / 100);
              }}
            />
            <output>{Math.round(volume * 100)}%</output>
          </label>
          <button
            className="primary full-width"
            onClick={() => (playing ? pauseMusic() : void playMusic())}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}{' '}
            {playing ? 'Пауза' : 'Включить музыку'}
          </button>
          {error && <p role="alert">{error}</p>}
        </PopoverContent>
      </Popover>
    </div>
  );
}
