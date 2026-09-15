import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { RoomState } from '../../../lib/model.ts';
import type { GraphicsSettings } from '../../../lib/graphics-settings.ts';
export { prepareUrbanScans } from './materials.ts';
import { createUrbanMaterials } from './materials.ts';
import { createUrbanDistrict, createUrbanSuit, createUrbanTool } from './assets.ts';
/** This pack owns its resources; it never mutates geometry, physics, room state or animation clocks. */
export function createUrbanPresentation(scene:T.Scene,hands:T.Group,settings:GraphicsSettings,renderer:T.WebGLRenderer) {
  const m=createUrbanMaterials(settings), district=createUrbanDistrict(scene,m,settings.detail),tool=createUrbanTool(hands,m);
  const replacements=new Map<T.Mesh,{original:T.Material|T.Material[];next:T.Material|T.Material[]}>();
  const clones=new Map<T.Material,T.Material>();
  const actors=new Map<T.Group,ReturnType<typeof createUrbanSuit>>();
  const lights=new Map<T.Light,{color:T.Color;intensity:number}>();
  const fog=scene.fog, background=scene.background, environment=scene.environment, environmentIntensity=scene.environmentIntensity;
  const generator=new T.PMREMGenerator(renderer), studio=new RoomEnvironment();
  const reflection=generator.fromScene(studio,.04);studio.dispose();generator.dispose();
  scene.environment=reflection.texture;scene.environmentIntensity=.65;
  scene.traverse(o=>{if(o instanceof T.Light)lights.set(o,{color:o.color.clone(),intensity:o.intensity});});
  function material(source:T.Material) {
    if(clones.has(source))return clones.get(source)!;
    if(!(source instanceof T.MeshStandardMaterial||source instanceof T.MeshToonMaterial)||source.transparent||source.map||source.emissiveIntensity>1)return source;
    const hsl={h:0,s:0,l:0};source.color.getHSL(hsl);
    const base='metalness' in source&&source.metalness>.4?m.metal:hsl.l<.2?m.rubber:m.stone;
    const next=base.clone();next.color.copy(source.color);next.color.lerp(new T.Color(hsl.l>.5?'#ddd2b9':'#4a6570'),.45);
    next.side=source.side;next.vertexColors=source.vertexColors;next.depthWrite=source.depthWrite;
    next.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
        vec3 urbanP=(modelMatrix*vec4(position,1.)).xyz;
        vec3 urbanN=abs(normalize(mat3(modelMatrix)*normal));
        vec2 urbanUV=(urbanN.y>.55?urbanP.xz:(urbanN.x>.55?urbanP.zy:urbanP.xy))*.25;
        #ifdef USE_MAP
        vMapUv=urbanUV;
        #endif
        #ifdef USE_NORMALMAP
        vNormalMapUv=urbanUV;
        #endif
        #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv=urbanUV;
        #endif
      `);
    };
    next.customProgramCacheKey=()=> 'urban-world-pbr-v1';
    clones.set(source,next);return next;
  }
  function sync(state:RoomState) {
    const meshes:T.Mesh[]=[],avatars:T.Group[]=[];
    scene.traverse(o=>{
      if(o instanceof T.Group&&o.name==='player-avatar')avatars.push(o);
      if(!(o instanceof T.Mesh)||replacements.has(o))return;
      for(let p:T.Object3D|null=o;p;p=p.parent)if(p.userData.presentationOnly||p.name==='player-avatar'||p===hands||p.userData.presentationLabel)return;
      meshes.push(o);
    });
    meshes.forEach(o=>{const original=o.material,next=Array.isArray(original)?original.map(material):material(original);replacements.set(o,{original,next});});
    replacements.forEach((r,o)=>{o.material=r.next;});
    avatars.forEach(a=>{if(!actors.has(a))actors.set(a,createUrbanSuit(a,m));});
    for(const [a,suit]of actors)if(!a.parent){suit.dispose();actors.delete(a);}else suit.sync();
    const night=state.time==='night',warm=state.time==='sunset'||state.time==='dawn';
    const sky=night?'#111e35':warm?'#d9b29c':'#a5bcc8';
    scene.background=new T.Color(sky);scene.fog=new T.Fog(sky,95,260);
    lights.forEach((_,light)=>{
      if(light instanceof T.HemisphereLight){light.color.set(night?'#748aaa':'#d9e7f0');light.intensity=night?.4:.65;}
      if(light instanceof T.DirectionalLight){light.color.set(night?'#9ebee6':warm?'#ffc18c':'#fff1d3');light.intensity=night?.65:2.1;}
    });
  }
  return {sync,textureBytes:m.textureBytes,impact(_at:T.Vector3,_color:string){},
    update(_dt:number,camera:T.Camera,state:RoomState){district.update(camera);return state.time==='night'?1.05:.88;},
    dispose(){actors.forEach(a=>a.dispose());tool.dispose();district.dispose();replacements.forEach((r,o)=>{o.material=r.original;});clones.forEach(c=>c.dispose());lights.forEach((v,l)=>{l.color.copy(v.color);l.intensity=v.intensity;});scene.fog=fog;scene.background=background;scene.environment=environment;scene.environmentIntensity=environmentIntensity;reflection.dispose();m.dispose();}};
}
