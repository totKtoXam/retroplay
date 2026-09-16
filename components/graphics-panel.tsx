'use client';
import { GRAPHICS_PRESETS, type GraphicsSettings } from '../lib/graphics-settings';
import { setGraphicsSettings, useGraphicsSettings } from '../hooks/use-graphics-settings';
export function GraphicsPanel() {
  const custom = useGraphicsSettings();
  const value = custom ?? GRAPHICS_PRESETS.high;
  const patch = (v: Partial<GraphicsSettings>) => setGraphicsSettings({ ...value, ...v });
  const select = (key: keyof GraphicsSettings, label: string, options: number[]) => <label className="field">{label}<select value={String(value[key])} onChange={e => patch({ [key]: Number(e.target.value) })}>{options.map(n => <option key={n} value={n}>{n === 0 ? 'Выключено' : n}</option>)}</select></label>;
  return <details className="graphics-panel"><summary>Расширенные настройки графики</summary>
    <p>Настройки сохраняются только на этом устройстве. Текстуры и детализация относятся к Urban Realism.</p>
    <div className="graphics-presets">{Object.keys(GRAPHICS_PRESETS).map(p => <button type="button" key={p} aria-pressed={!!custom && JSON.stringify(custom) === JSON.stringify(GRAPHICS_PRESETS[p])} onClick={() => setGraphicsSettings(GRAPHICS_PRESETS[p])}>{p}</button>)}</div>
    <label className="field">Масштаб изображения: {Math.round(value.scale * 100)}%<input type="range" min=".5" max="1.5" step=".05" value={value.scale} onChange={e => patch({ scale: Number(e.target.value) })}/></label>
    <small>100% — размер игровой области в CSS-пикселях; выше — более чёткое и тяжёлое изображение.</small>
    <div className="graphics-grid">{select('shadows', 'Разрешение теней', [0,512,1024,2048,4096])}{select('textures', 'Текстуры Urban', [512,1024,2048])}{select('anisotropy', 'Анизотропная фильтрация', [1,4,8,16])}{select('detail', 'Детализация Urban (1–4)', [1,2,3,4])}</div>
    <label className="field">Экспозиция: {value.exposure.toFixed(2)}<input type="range" min=".6" max="1.5" step=".05" value={value.exposure} onChange={e => patch({ exposure: Number(e.target.value) })}/></label>
    <label><input type="checkbox" checked={value.antialias} onChange={e => patch({ antialias: e.target.checked })}/> Сглаживание FXAA</label>
    <label><input type="checkbox" checked={value.bloom} onChange={e => patch({ bloom: e.target.checked })}/> Свечение ярких поверхностей</label>
    <button type="button" onClick={() => setGraphicsSettings(null)}>Вернуть настройки выбранного пакета</button>
    <small>{custom ? 'Индивидуальные настройки активны' : 'Используются настройки пакета и основного профиля качества'}</small>
  </details>;
}
