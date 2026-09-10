import * as T from 'three';
import { fieldSign } from './signage.ts';
import { createFieldVfx } from './vfx.ts';
import type { RoomState } from '../../../lib/model.ts';
import { createRealisticMaterials, type Surface } from './materials.ts';
import { createFieldEnvironment } from './environment.ts';
import { dressFieldCharacter, dressFieldWeapons } from './characters.ts';

type MaterialPair = {
  original: T.Material | T.Material[];
  replacement: T.Material | T.Material[];
};
export function createRealisticPresentation(
  scene: T.Scene,
  hands: T.Group,
  quality: string,
  stations: number[][],
) {
  const library = createRealisticMaterials(quality);
  const vfx = createFieldVfx(scene, quality);
  const signs: ReturnType<typeof fieldSign>[] = [];
  const replacements = new Map<T.Mesh, MaterialPair>();
  const materialCache = new Map<
    T.MeshStandardMaterial | T.MeshToonMaterial,
    T.MeshStandardMaterial
  >();
  const actors = new Map<T.Group, ReturnType<typeof dressFieldCharacter>>();
  const extras = createFieldEnvironment(scene, library, quality, stations);
  const weapons = dressFieldWeapons(hands, library);
  const lightDefaults = new Map<
    T.Light,
    { color: T.Color; intensity: number }
  >();
  scene.traverse((o) => {
    if (o instanceof T.Light && !extras.root.getObjectById(o.id))
      lightDefaults.set(o, { color: o.color.clone(), intensity: o.intensity });
  });
  const defaultFog = scene.fog?.clone() ?? null;
  const defaultEnvironmentIntensity = scene.environmentIntensity;
  const hsl = { h: 0, s: 0, l: 0 };
  function material(original: T.MeshStandardMaterial | T.MeshToonMaterial) {
    if (materialCache.has(original)) return materialCache.get(original)!;
    original.color.getHSL(hsl);
    const kind: Surface =
      'metalness' in original && original.metalness > 0.45
        ? 'steel'
        : 'roughness' in original && original.roughness < 0.3
          ? 'wetstone'
          : hsl.l < 0.19
            ? 'rubber'
            : hsl.l > 0.7
              ? 'plaster'
              : 'concrete';
    const resource = library.get(kind),
      m =
        original instanceof T.MeshStandardMaterial
          ? original.clone()
          : new T.MeshStandardMaterial({
              color: original.color,
              transparent: original.transparent,
              opacity: original.opacity,
              side: original.side,
              depthWrite: original.depthWrite,
              depthTest: original.depthTest,
              vertexColors: original.vertexColors,
              emissive: original.emissive,
            });
    // Copy texture channels only; transparency, side and depth flags remain canonical.
    m.map = resource.map;
    m.normalMap = resource.normalMap;
    m.normalScale.copy(resource.normalScale);
    m.roughnessMap = resource.roughnessMap;
    m.metalnessMap = resource.metalnessMap;
    m.aoMap = resource.aoMap;
    m.aoMapIntensity = 0.5;
    m.roughness = resource.roughness;
    m.metalness = resource.metalness;
    m.bumpMap = null;
    m.emissiveIntensity = Math.min(original.emissiveIntensity, 0.4);
    // Preserve paint/team colour information, while pulling environmental accents into mineral hues.
    m.color.setHSL(
      hsl.h,
      Math.min(hsl.s * 0.2, 0.13),
      Math.max(0.55, Math.min(1, hsl.l + 0.35)),
    );
    m.onBeforeCompile = (shader) => {
      // World-scale surface coordinates replace only shading UVs, never geometry or hit UVs.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
          vec3 fieldP=(modelMatrix*vec4(position,1.)).xyz;
          vec3 fieldN=abs(normalize(mat3(modelMatrix)*normal));
          vec2 fieldUV=fieldN.y>.55?fieldP.xz:(fieldN.x>.55?fieldP.zy:fieldP.xy);
          #ifdef USE_MAP
          vMapUv=fieldUV*.32;
          #endif
          #ifdef USE_NORMALMAP
          vNormalMapUv=fieldUV*.32;
          #endif
          #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv=fieldUV*.32;
          #endif
          #ifdef USE_METALNESSMAP
          vMetalnessMapUv=fieldUV*.32;
          #endif
          #ifdef USE_AOMAP
          vAoMapUv=fieldUV*.32;
          #endif`,
      );
      if (m.vertexColors)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb=mix(vec3(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))),diffuseColor.rgb,.25);',
        );
    };
    m.customProgramCacheKey = () => 'field-world-material-v2';
    materialCache.set(original, m);
    return m;
  }
  function registerScene() {
    // Only run on membership/theme changes, not a full traversal every rendered frame.
    scene.traverse((o) => {
      if (!(o instanceof T.Mesh) || replacements.has(o)) return;
      if (o.userData.presentationLabel) {
        const sign = fieldSign(o.userData.presentationLabel); signs.push(sign);
        replacements.set(o, { original: o.material, replacement: sign.material }); o.material = sign.material;
        return;
      }
      for (let p: T.Object3D | null = o; p; p = p.parent) {
        if (
          p.userData.presentationOnly ||
          p.name === 'player-avatar' ||
          p === hands
        )
          return;
      }
      if (
        !(
          o.material instanceof T.MeshStandardMaterial ||
          o.material instanceof T.MeshToonMaterial
        )
      )
        return;
      const original = o.material;
      replacements.set(o, { original, replacement: material(original) });
      o.material = material(original);
    });
  }
  registerScene();
  // Hand materials keep dynamic paint tint and tool indicators; separate textile/PBR finishes.
  const handMaterials = new Map<
    T.MeshStandardMaterial,
    T.MeshStandardMaterial
  >();
  hands.traverse((o) => {
    if (
      !(o instanceof T.Mesh) ||
      !(o.material instanceof T.MeshStandardMaterial) ||
      o.userData.presentationOnly
    )
      return;
    const original = o.material;
    if (!handMaterials.has(original)) {
      original.color.getHSL(hsl);
      const resource = library.get(
        original.metalness > 0.4 ? 'steel' : hsl.l < 0.12 ? 'rubber' : 'canvas',
      );
      const replacement = original.clone();
      replacement.map = resource.map;
      replacement.normalMap = resource.normalMap;
      replacement.normalScale.set(0.23, 0.23);
      replacement.roughnessMap = resource.roughnessMap;
      replacement.roughness = 0.95;
      handMaterials.set(original, replacement);
    }
    const replacement = handMaterials.get(original)!;
    replacements.set(o, { original, replacement });
    o.material = replacement;
  });
  let lastState = '',
    elapsed = 0;
  function sync(state: RoomState) {
    const key = `${state.time}/${state.season}/${state.visualStyle}/${state.interior}/${state.theme}`;
    if (key !== lastState) {
      registerScene();
      lastState = key;
    }
    replacements.forEach(({ replacement }, mesh) => {
      mesh.material = replacement;
    });
    const night = state.time === 'night',
      sunset = state.time === 'sunset',
      dawn = state.time === 'dawn';
    scene.fog = new T.Fog(
      night ? '#141b23' : sunset ? '#a79a89' : '#9da5a5',
      58,
      180,
    );
    scene.environmentIntensity = night ? 0.3 : 0.55;
    for (const light of lightDefaults.keys()) {
      if (light instanceof T.HemisphereLight) {
        light.intensity = night ? 0.32 : 0.54;
        light.color.set(night ? '#9aaec1' : '#d5dce0');
      } else if (light instanceof T.DirectionalLight && light.castShadow) {
        light.intensity = night ? 0.52 : sunset ? 2.25 : dawn ? 1.8 : 2.3;
        light.color.set(night ? '#9aaabd' : sunset ? '#f5cfaa' : '#f3eee2');
      } else if (light instanceof T.DirectionalLight) light.intensity = 0.08;
    }
    scene.traverse((o) => {
      if (o instanceof T.Group && o.name === 'player-avatar' && !actors.has(o))
        actors.set(o, dressFieldCharacter(o, library));
    });
    for (const [actor, presentation] of actors)
      if (!actor.parent) {
        presentation.dispose();
        actors.delete(actor);
      }
    actors.forEach((presentation) => presentation.sync());
  }
  return {
    sync,
    impact(at: T.Vector3, color: string) { vfx.impact(at, color); },
    update(dt: number, camera: T.Camera, state: RoomState) {
      elapsed += dt; vfx.update(dt);
      extras.update(elapsed, camera, state.season === 'winter');
      handMaterials.forEach((replacement, original) =>
        replacement.color.copy(original.color),
      );
      // Approximate meter from existing outdoor/indoor lighting. It never reads gameplay entities.
      return state.time === 'night'
        ? 1.08
        : state.interior
          ? 1.06
          : state.time === 'day'
            ? 0.92
            : 0.98;
    },
    get textureBytes() {
      return library.textureBytes;
    },
    dispose() {
      actors.forEach((a) => a.dispose());
      actors.clear();
      weapons.dispose();
      extras.dispose();
      replacements.forEach(({ original }, mesh) => {
        mesh.material = original;
      });
      materialCache.forEach((m) => m.dispose());
      handMaterials.forEach((m) => m.dispose());
      lightDefaults.forEach((v, light) => {
        light.color.copy(v.color);
        light.intensity = v.intensity;
      });
      scene.fog = defaultFog;
      scene.environmentIntensity = defaultEnvironmentIntensity;
      signs.forEach((s) => s.dispose()); vfx.dispose();
      library.dispose();
    },
  };
}
