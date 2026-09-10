import type * as T from 'three';
import type { ResourcePackId } from '../../lib/resource-packs';
import type { RoomState } from '../../lib/model';
import type { createRealisticPresentation } from './realistic/runtime';

/** Default is the existing live scene. Pack changes never reconstruct the game engine. */
export function createVisualProvider(options: {
  scene: T.Scene;
  hands: T.Group;
  quality: string;
  stations: number[][];
  restore: () => void;
  status: (state: 'default' | 'loading' | 'ready' | 'error') => void;
}) {
  let selected: ResourcePackId = 'default',
    generation = 0,
    disposed = false;
  let presentation: ReturnType<typeof createRealisticPresentation> | undefined;
  let syncKey = '';
  return {
    get active() {
      return !!presentation;
    },
    get textureBytes() {
      return presentation?.textureBytes ?? 0;
    },
    async select(id: ResourcePackId, state: RoomState) {
      if (id === selected || disposed) return;
      selected = id;
      const request = ++generation;
      presentation?.dispose();
      presentation = undefined;
      syncKey = '';
      options.restore();
      if (id === 'default') {
        options.status('default');
        return;
      }
      options.status('loading');
      try {
        const { createRealisticPresentation } =
          await import('./realistic/runtime');
        if (disposed || request !== generation) return;
        presentation = createRealisticPresentation(
          options.scene,
          options.hands,
          options.quality,
          options.stations,
        );
        presentation.sync(state);
        options.status('ready');
      } catch (error) {
        console.error('Visual resource pack failed to load', error);
        selected = 'default';
        options.restore();
        options.status('error');
      }
    },
    update(dt: number, camera: T.Camera, state: RoomState, members: string) {
      const key = `${state.time}/${state.season}/${state.visualStyle}/${state.interior}/${state.theme}/${members}`;
      if (presentation && key !== syncKey) {
        presentation.sync(state);
        syncKey = key;
      }
      return presentation?.update(dt, camera, state);
    },
    impact(at: T.Vector3, color: string) { presentation?.impact(at, color); },
    invalidate() {
      syncKey = '';
    },
    dispose() {
      disposed = true;
      generation++;
      presentation?.dispose();
      presentation = undefined;
    },
  };
}
