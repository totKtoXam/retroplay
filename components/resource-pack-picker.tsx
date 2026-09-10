'use client';
import { RESOURCE_PACKS } from '../lib/resource-packs';
import {
  useResourcePack,
  chooseResourcePack,
} from '../hooks/use-resource-pack';
export function ResourcePackPicker() {
  const selected = useResourcePack();
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
            onClick={() => chooseResourcePack(pack.id)}
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
      <p>Личный выбор · сохраняется на этом устройстве</p>
    </fieldset>
  );
}
