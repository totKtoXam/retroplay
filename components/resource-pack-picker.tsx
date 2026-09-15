'use client';
import { useEffect, useRef, useState } from 'react';
import { GRAPHICS_PRESETS, recommendation, type GraphicsCheck } from '../lib/graphics-settings';
import { useGraphicsSettings, setGraphicsSettings } from '../hooks/use-graphics-settings';
import { RESOURCE_PACKS } from '../lib/resource-packs';
import {
  useResourcePack,
  chooseResourcePack,
} from '../hooks/use-resource-pack';
export function ResourcePackPicker() {
  const selected = useResourcePack();
  const graphics = useGraphicsSettings();
  const [checking,setChecking] = useState(false);
  const [check,setCheck] = useState<GraphicsCheck|null>(null);
  const [error,setError] = useState('');
  const [pending,setPending] = useState(false);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function test() {
    controller.current?.abort(); const active=new AbortController(); controller.current=active;
    setChecking(true);setPending(true);setError('');setCheck(null);
    try { const {benchmarkUrban}=await import('./resource-packs/urban/benchmark');
      if(active.signal.aborted)return;
      const result=await benchmarkUrban(graphics??GRAPHICS_PRESETS.high,active.signal);
      if(!active.signal.aborted){setCheck(result);try{localStorage.setItem('jinaly-urban-check',JSON.stringify(result));}catch{/* Optional history. */}}
    } catch(e){if(!active.signal.aborted)setError((e as Error).message);}
    finally{if(!active.signal.aborted)setChecking(false);}
  }
  function select(id: typeof selected) {
    if(id==='urban-realism'){void test();return;}
    controller.current?.abort();setChecking(false);setPending(false);chooseResourcePack(id);
  }
  return (
    <fieldset className="resource-pack-picker">
      <legend>Визуальный пакет</legend>
      <div className="resource-pack-options">
        {RESOURCE_PACKS.map((pack) => (
          <button
            key={pack.id}
            type="button"
            aria-pressed={selected === pack.id}
            className={`resource-pack-card pack-card-${pack.ui}`}
            onClick={() => select(pack.id)}
          >
            <span className="pack-preview" aria-hidden="true">
              <i />
              <i />
              <i />
              <b>{pack.badge}</b>
            </span>
            <strong>{pack.name}</strong>
            <small>{pack.subtitle}</small>
            <span className="pack-selection">
              {selected === pack.id ? 'Выбран' : 'Выбрать'}
            </span>
          </button>
        ))}
      </div>
      {pending && <section className="graphics-check" aria-live="polite">
        <strong>{checking?'Проверяем Urban Realism…':check?'Проверка завершена':'Проверка недоступна'}</strong>
        {checking && <p>Тестовая 3D-сцена · около 5–10 секунд. Оставайтесь в этой вкладке.</p>}
        {error && <p>{error.replace('UNSUPPORTED: ','')}</p>}
        {check && <><p>{check.fps} FPS · сложные кадры: {check.p95} мс · {check.width} × {check.height}</p>
          <p>{recommendation(check)==='low'?'Возможны заметные просадки. Рекомендуем снизить качество.':recommendation(check)==='medium'?'Рекомендуем средние настройки для более стабильной игры.':'Тест прошёл успешно. Начните с высокого качества.'}</p>
          <small>Это оценка тестовой сцены. Игроки, эффекты, свечение и текущая нагрузка могут снизить FPS в матче.</small>
          <button type="button" onClick={()=>{setGraphicsSettings(GRAPHICS_PRESETS[recommendation(check)]);chooseResourcePack('urban-realism');setPending(false);}}>Включить рекомендуемый профиль</button>
          <button type="button" onClick={()=>{chooseResourcePack('urban-realism');setPending(false);}}>Включить с текущими настройками</button>
        </>}
        {error && !error.startsWith('UNSUPPORTED:') && <button type="button" onClick={()=>{chooseResourcePack('urban-realism');setPending(false);}}>Включить без оценки производительности</button>}
        {!checking && <button type="button" onClick={()=>void test()}>Повторить проверку</button>}
        <button type="button" onClick={()=>{controller.current?.abort();setChecking(false);setPending(false);}}>Остаться на текущем пакете</button>
      </section>}
      <p>Личный выбор · сохраняется на этом устройстве</p>
    </fieldset>
  );
}
