'use client';

// Сцена смерти: предатель в своём цвете бросается с ножом, вспышка удара, персонаж игрока
// падает, остаётся кость — и надпись «Вас убили». Короткая (около трёх секунд) и закрывается
// кликом. Цвет убийцы приходит только самой жертве (`killedBy` в снимке партии): она уже
// призрак и говорит лишь с призраками, так что тайна для живых не страдает.
import { useEffect } from 'react';
import { Crewmate } from './impostor-rules';

/** Удар ножом: свист рассечённого воздуха и глухой удар. Без файлов — Web Audio. */
function playStab() {
  if (typeof AudioContext === 'undefined') return;
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime + 0.05;
    const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.25), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const swoosh = ctx.createBufferSource();
    swoosh.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(2400, t);
    band.frequency.exponentialRampToValueAtTime(700, t + 0.22);
    const swooshGain = ctx.createGain();
    swooshGain.gain.setValueAtTime(0.35, t);
    swooshGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    swoosh.connect(band).connect(swooshGain).connect(ctx.destination);
    swoosh.start(t);
    const hit = ctx.createOscillator();
    const hitGain = ctx.createGain();
    hit.type = 'triangle';
    hit.frequency.setValueAtTime(140, t + 0.18);
    hit.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    hitGain.gain.setValueAtTime(0.0001, t);
    hitGain.gain.setValueAtTime(0.6, t + 0.18);
    hitGain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    hit.connect(hitGain).connect(ctx.destination);
    hit.start(t);
    hit.stop(t + 0.6);
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    // Звук — украшение: без него сцена всё равно показывается.
  }
}

export default function ImpostorDeath({
  myColor,
  killerColor,
  onDone,
}: {
  myColor: string;
  killerColor: string;
  onDone: () => void;
}) {
  useEffect(() => {
    playStab();
    const timer = setTimeout(onDone, 3400);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <button className="impostor-death" onClick={onDone} aria-label="Вас убили — закрыть">
      <div className="impostor-death-stage" aria-hidden="true">
        <div className="impostor-death-killer">
          <Crewmate color={killerColor} knife size={120} />
        </div>
        <div className="impostor-death-slash" />
        <div className="impostor-death-victim">
          <Crewmate color={myColor} size={120} />
        </div>
        <svg className="impostor-death-bone" viewBox="0 0 60 24" width="60" height="24">
          <path d="M10 12 H50" stroke="#f4efe6" strokeWidth="7" strokeLinecap="round" />
          <circle cx="8" cy="7" r="5" fill="#f4efe6" />
          <circle cx="8" cy="17" r="5" fill="#f4efe6" />
          <circle cx="52" cy="7" r="5" fill="#f4efe6" />
          <circle cx="52" cy="17" r="5" fill="#f4efe6" />
        </svg>
      </div>
      <div className="impostor-death-text">
        <strong>Вас убили</strong>
        <span>Теперь вы призрак: проходите сквозь стены и доделайте задания — экипаж ещё может победить</span>
      </div>
    </button>
  );
}
