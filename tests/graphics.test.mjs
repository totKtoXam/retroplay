import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { GRAPHICS_PRESETS, normalizeGraphics, recommendation } from '../lib/graphics-settings.ts';
import { parseResourcePack } from '../lib/resource-packs.ts';
import { createUrbanMaterials } from '../components/resource-packs/urban/materials.ts';
import { createUrbanSuit, createUrbanDistrict } from '../components/resource-packs/urban/assets.ts';
import { createAvatar, setAvatarAnonymous } from '../components/world-avatar.ts';
test('Graphics settings validate persistent input and presets stay within bounds',()=>{
  assert.equal(parseResourcePack('urban-realism'),'urban-realism');
  for(const p of Object.values(GRAPHICS_PRESETS))assert.deepEqual(normalizeGraphics(p),p);
  const invalid=normalizeGraphics({scale:Infinity,detail:999,textures:16384,shadows:-1,bloom:'true',exposure:NaN});
  assert.equal(invalid.textures,2048);assert.equal(invalid.detail,4);assert.equal(invalid.scale,1);
  assert.equal(normalizeGraphics({scale:20}).scale,1.5);
  assert.equal(recommendation({fps:65,p95:60}),'low','bad frame pacing warns despite high average');
  assert.equal(recommendation({fps:45,p95:23}),'medium');
});
test('Urban rig keeps original hit surfaces, joints and anonymous head behavior; disposal restores materials',()=>{
  const m=createUrbanMaterials(GRAPHICS_PRESETS.low), avatar=createAvatar('#6688aa');
  const canonical=[];avatar.traverse(o=>{if(o instanceof T.Mesh)canonical.push({o,geometry:o.geometry,material:o.material,visible:o.visible});});
  const ray=new T.Raycaster(new T.Vector3(0,1.3,-5),new T.Vector3(0,0,1));avatar.updateMatrixWorld(true);
  const hits=()=>ray.intersectObjects(canonical.map(x=>x.o),false).map(h=>[h.object.id,h.distance]);
  const before=hits();const suit=createUrbanSuit(avatar,m);avatar.updateMatrixWorld(true);assert.deepEqual(hits(),before);
  for(const x of canonical){assert.equal(x.o.geometry,x.geometry);assert.equal(x.o.visible,x.visible);}
  setAvatarAnonymous(avatar,true);assert.equal(avatar.getObjectByName('unmasked-head').visible,false);
  suit.dispose();for(const x of canonical)assert.equal(x.o.material,x.material);
  m.dispose();
});
test('Urban district has LOD, keeps scenery outside playable bounds and releases attached objects',()=>{
  const m=createUrbanMaterials(GRAPHICS_PRESETS.low),scene=new T.Scene(),d=createUrbanDistrict(scene,m,1);
  let lods=0;d.root.traverse(o=>{if(o instanceof T.LOD){lods++;assert.ok(Math.hypot(o.position.x,o.position.z)>=100);}});
  assert.equal(lods,24);d.dispose();assert.equal(scene.children.length,0);m.dispose();
});
