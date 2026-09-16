'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ListMusic,
  Pause,
  Play,
  SkipForward,
  Trash2,
  Upload,
  Volume1,
  Volume2,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  addMusicFiles,
  getMusicState,
  nextMusic,
  pauseMusic,
  playMusic,
  removeMusicTrack,
  setMusicBackground,
  setMusicVoiceActive,
  setMusicVolume,
  subscribeMusic,
} from '@/lib/soundtrack';

/**
 * Музыка прямо в шапке комнаты.
 *
 * Раньше плеер жил вкладкой планшета, и чтобы сменить трек или сделать тише,
 * приходилось бросать игру. В шапке он виден всегда: кнопка воспроизведения и
 * название, рядом — плейлист, режим «на фоне» и загрузка своих файлов.
 *
 * `voiceActive` — говорит ли кто-то в голосовой чат прямо сейчас: в фоновом
 * режиме музыка на это время приглушается (lib/music-mix.ts).
 */
export function MusicPlayer({ voiceActive }: { voiceActive: boolean }) {
  const music = useSyncExternalStore(
    subscribeMusic,
    getMusicState,
    getMusicState,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setMusicVoiceActive(voiceActive);
  }, [voiceActive]);

  const current =
    music.playlist.find((t) => t.id === music.track) ?? music.playlist[0];
  // Ошибку видно только в плейлисте, поэтому при сбое он раскрывается сам.
  const reveal = () => {
    if (getMusicState().error) setOpen(true);
  };
  const toggle = () =>
    music.playing ? pauseMusic() : void playMusic().then(reveal);
  const upload = () => fileInput.current?.click();

  return (
    <div className={`music-chip${music.playing ? ' is-playing' : ''}`}>
      <button
        type="button"
        className="music-chip-btn music-chip-play"
        onClick={toggle}
        aria-label={music.playing ? 'Приостановить музыку' : 'Включить музыку'}
        title={music.playing ? 'Пауза' : 'Включить музыку'}
      >
        {music.playing ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <span className="music-chip-now" title={current.title}>
        <span className="music-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="music-chip-title">{current.title}</span>
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="music-chip-btn"
          aria-label="Открыть плейлист"
          title="Плейлист"
        >
          <ListMusic size={14} />
        </PopoverTrigger>
        <PopoverContent className="music-pop" align="end">
          <div className="music-pop-head">
            <strong>Плейлист</strong>
            <small>Слышите только вы</small>
          </div>
          <ul className="music-pop-list">
            {music.playlist.map((t) => {
              const active = t.id === music.track;
              return (
                <li key={t.id} className={active ? 'active' : ''}>
                  <button
                    type="button"
                    className="music-pop-track"
                    aria-pressed={active}
                    onClick={() =>
                      active && music.playing
                        ? pauseMusic()
                        : void playMusic(t.id)
                    }
                  >
                    <span className="music-pop-icon" aria-hidden="true">
                      {active && music.playing ? '♫' : '▷'}
                    </span>
                    <span className="music-pop-text">
                      <strong>{t.title}</strong>
                      <small>{t.subtitle}</small>
                    </span>
                  </button>
                  {t.custom && (
                    <button
                      type="button"
                      className="music-pop-remove"
                      aria-label={`Убрать «${t.title}» из плейлиста`}
                      title="Убрать из плейлиста"
                      onClick={() => void removeMusicTrack(t.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="music-pop-row">
            <button
              type="button"
              className="music-pop-action"
              onClick={() => void nextMusic()}
            >
              <SkipForward size={13} /> Следующий
            </button>
            <button
              type="button"
              className="music-pop-action"
              onClick={upload}
            >
              <Upload size={13} /> Добавить свою музыку
            </button>
          </div>
          <label className="music-pop-volume">
            <Volume2 size={14} aria-hidden="true" />
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(music.volume * 100)}
              aria-label="Громкость музыки"
              onChange={(e) => setMusicVolume(Number(e.target.value) / 100)}
            />
            <output>{Math.round(music.volume * 100)}%</output>
          </label>
          {music.error && (
            <p className="music-pop-error" role="alert">
              {music.error}
            </p>
          )}
        </PopoverContent>
      </Popover>
      <button
        type="button"
        className={`music-chip-btn music-chip-mode${music.background ? ' on' : ''}`}
        aria-pressed={music.background}
        aria-label="Музыка на фоне"
        title={
          music.background
            ? 'На фоне: музыка тише и уступает голосам. Нажмите — в полную громкость'
            : 'В полную громкость. Нажмите — на фон, чтобы не перебивать голоса'
        }
        onClick={() => setMusicBackground(!music.background)}
      >
        {music.background ? <Volume1 size={14} /> : <Volume2 size={14} />}
        <span>{music.background ? 'Фон' : 'Громко'}</span>
      </button>
      <button
        type="button"
        className="music-chip-btn"
        aria-label="Загрузить свою музыку"
        title="Загрузить свою музыку"
        onClick={upload}
      >
        <Upload size={14} />
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void addMusicFiles(files).then(reveal);
        }}
      />
    </div>
  );
}
