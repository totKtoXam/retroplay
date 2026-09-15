import type * as T from 'three';
import { GRAPHICS_PRESETS, type GraphicsSettings } from '../../lib/graphics-settings';
import type { ResourcePackId } from '../../lib/resource-packs';
import type { RoomState } from '../../lib/model';
type Presentation = { sync(state: RoomState): void; update(dt: number, camera: T.Camera, state: RoomState): number | undefined; impact(at: T.Vector3, color: string): void; readonly textureBytes: number; dispose(): void };

/** Default is the existing live scene. Pack changes never reconstruct the game engine. */
export function createVisualProvider(options: {
  scene: T.Scene;
  renderer: T.WebGLRenderer;
  hands: T.Group;
  quality: string;
  graphics?: () => GraphicsSettings | null;
  stations: number[][];
  restore: () => void;
  status: (state: 'default' | 'loading' | 'ready' | 'error') => void;
}) {
  let selected: ResourcePackId = 'default',
    generation = 0,
    disposed = false;
  let presentation: Presentation | undefined;
  let syncKey = '';
  let graphicsKey = '';
  let activeId: ResourcePackId = 'default';
  return {
    get id() { return activeId; },
    get active() {
      return !!presentation;
    },
    get textureBytes() {
      return presentation?.textureBytes ?? 0;
    },
    async select(id: ResourcePackId, state: RoomState) {
      const settings = options.graphics?.() ?? GRAPHICS_PRESETS.high;
      const key = id === 'urban-realism' ? JSON.stringify([settings.textures, settings.anisotropy, settings.detail]) : '';
      if ((id === selected && key === graphicsKey) || disposed) return;
      graphicsKey = key;
      activeId = 'default';
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
        const factory = id === 'urban-realism'
          ? await import('./urban/runtime').then(async module => { await module.prepareUrbanScans(); return () => module.createUrbanPresentation(options.scene, options.hands, settings, options.renderer); })
          : await import('./realistic/runtime').then(module => () => module.createRealisticPresentation(options.scene, options.hands, options.quality, options.stations));
        if (disposed || request !== generation) return;
        presentation = factory();
        activeId = id;
        presentation.sync(state);
        options.status('ready');
      } catch (error) {
        console.error('Visual resource pack failed to load', error);
        if (disposed || request !== generation) return;
        presentation?.dispose(); presentation = undefined;
        activeId = 'default'; selected = 'default';
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
