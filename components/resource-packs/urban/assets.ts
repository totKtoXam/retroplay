import * as T from 'three';
import { geometryBatch, garment, visualOnly } from '../realistic/geometry.ts';
import type { UrbanMaterials } from './materials.ts';
export function disposeGeometry(root: T.Object3D) { root.removeFromParent(); root.traverse(o=>{if(o instanceof T.Mesh)o.geometry.dispose();}); }
/** Skyline outside every playable map; never adds fake cover inside the match. */
export function createUrbanDistrict(scene: T.Scene, m: UrbanMaterials, detail: number) {
  const root=visualOnly(new T.Group());root.name='urban-district';scene.add(root);
  const buildings: T.LOD[]=[];
  for(let i=0;i<24;i++) {
    const angle=i*Math.PI/12, radius=105+(i%3)*14, height=15+(i*13%32);
    const lod=new T.LOD();lod.position.set(Math.cos(angle)*radius,0,Math.sin(angle)*radius);lod.rotation.y=-angle;
    const detailed=new T.Group(), b=geometryBatch(detailed);
    b.box([12,height,14],i%2?m.stone:m.ceramic,[0,height/2,0],.08);
    for(let floor=2;floor<height;floor+=3) {
      b.box([12.15,.12,14.15],m.copper,[0,floor,0],.01);
      for(let col=-4;col<=4;col+=2) for(const side of [-1,1])
        b.box([1.4,1.9,.08],(floor+col+i)%5===0?m.glow:m.glass,[col,floor+1.3,side*7.04],.015);
    }
    if(detail>1) for(let x=-4;x<=4;x+=4) {
      b.box([1.8,1.1,2.5],m.metal,[x,height+.55,0],.12);
      for(let k=0;k<5;k++) b.box([1.5,.06,.035],m.rubber,[x,height+.2+k*.15,1.27]);
    }
    b.finish(); const distant=new T.Group(), simple=geometryBatch(distant);
    simple.box([12,height,14],m.stone,[0,height/2,0],.02);simple.finish();
    lod.addLevel(detailed,0);lod.addLevel(distant,detail<2?75:detail<4?135:190);root.add(lod);buildings.push(lod);
  }
  return {root,update(camera:T.Camera){buildings.forEach(b=>b.update(camera));},dispose(){disposeGeometry(root);}};
}
/** Original fitted ceramic/textile suit, attached to the unchanged animated joints. */
export function createUrbanSuit(avatar:T.Group,m:UrbanMaterials) {
  const groups:T.Object3D[]=[], hidden:{mesh:T.Mesh; material:T.Material|T.Material[]; shadow:boolean}[]=[];
  const invisible=new T.MeshBasicMaterial({visible:false});
  avatar.traverse(o=>{
    if(!(o instanceof T.Mesh))return;
    let body=false;
    for(let p:T.Object3D|null=o.parent;p&&p!==avatar;p=p.parent){
      if(['gun','tablet','held-grenade','anonymous-bag'].includes(p.name))return;
      if(['agent-skin','legacy-skin','classic-detail','anime-detail'].includes(p.name))body=true;
    }
    if(body){hidden.push({mesh:o,material:o.material,shadow:o.castShadow});o.material=invisible;o.castShadow=false;}
  });
  const attach=(name:string)=>{const g=visualOnly(new T.Group());avatar.getObjectByName(name)?.add(g);groups.push(g);return geometryBatch(g);};
  const chest=attach('chest');
  chest.add(garment([[-.12,.18,.12],[.1,.24,.14],[.38,.27,.15],[.51,.13,.09]]),m.fabric,[0,0,0]);
  for(const side of [-1,1]) {
    chest.box([.19,.29,.035],m.ceramic,[side*.115,.25,-.15],.04);
    chest.box([.035,.4,.035],m.copper,[side*.2,.24,-.13],.01);
    chest.box([.13,.1,.055],m.rubber,[side*.13,-.035,-.15],.018);
  }
  chest.box([.36,.35,.045],m.ceramic,[0,.22,.15],.04);
  chest.box([.07,.3,.01],m.copper,[0,.23,.18],.004);
  chest.box([.08,.12,.026],m.metal,[0,.27,-.177],.014);chest.finish();
  const head=attach('unmasked-head');
  head.add(garment([[-.08,.07,.07],[.02,.12,.11],[.18,.15,.13],[.3,.13,.12],[.35,.04,.04]]),m.ceramic,[0,0,0]);
  head.box([.26,.085,.04],m.glass,[0,.17,-.127],.025);
  head.box([.12,.08,.05],m.rubber,[0,.035,-.125],.02);head.finish();
  for(const side of ['L','R']) {
    const arm=attach('arm'+side);arm.add(garment([[-.32,.068,.068],[-.16,.086,.08],[.04,.112,.105]]),m.fabric,[0,0,0]);
    arm.box([.14,.14,.12],m.ceramic,[0,-.04,-.045],.03);arm.finish();
    const elbow=attach('elbow'+side);elbow.add(garment([[-.32,.05,.06],[-.16,.078,.085],[.01,.086,.08]]),m.fabric,[0,0,0]);
    elbow.box([.1,.16,.045],m.ceramic,[0,-.14,-.08],.02);elbow.finish();
    const leg=attach('leg'+side);leg.add(garment([[-.42,.08,.09],[-.2,.11,.115],[.02,.125,.13]]),m.fabric,[0,0,0]);leg.finish();
    const knee=attach('knee'+side);knee.add(garment([[-.43,.07,.08],[-.2,.085,.09],[.02,.09,.095]]),m.fabric,[0,0,0]);
    knee.box([.14,.14,.05],m.ceramic,[0,-.04,-.075],.025);
    knee.box([.17,.16,.29],m.rubber,[0,-.4,-.04],.035);knee.finish();
  }
  return {sync(){hidden.forEach(h=>{h.mesh.material=invisible;h.mesh.castShadow=false;});},dispose(){groups.forEach(disposeGeometry);hidden.forEach(h=>{h.mesh.material=h.material;h.mesh.castShadow=h.shadow;});invisible.dispose();}};
}
export function createUrbanTool(hands:T.Group,m:UrbanMaterials) {
  const root=visualOnly(new T.Group());hands.getObjectByName('paint-launcher')?.add(root);
  const shell=m.ceramic.clone(),metal=m.copper.clone();shell.depthTest=metal.depthTest=false;
  const b=geometryBatch(root);
  b.box([.16,.13,.27],shell,[0,.04,-.23],.028);
  for(const side of [-1,1]) for(let i=0;i<7;i++)b.box([.012,.04,.013],metal,[side*.084,.045,-.15-i*.026],.003);
  b.add(new T.TorusGeometry(.061,.007,12,32),metal,[0,.04,-.375]);
  b.box([.08,.025,.11],metal,[0,.12,-.24],.007);
  b.finish().forEach(o=>{o.renderOrder=1001;o.castShadow=false;});
  return {dispose(){disposeGeometry(root);shell.dispose();metal.dispose();}};
}

/** Flush architectural cladding: same opaque wall footprint, no new cover or openings. */
export function createUrbanFacade(mesh:T.Mesh,m:UrbanMaterials,detail:number) {
  if(!(mesh.geometry instanceof T.BoxGeometry))return;
  mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox!;
  const size=box.getSize(new T.Vector3()), center=box.getCenter(new T.Vector3());
  const rotate=size.x<size.z, width=rotate?size.z:size.x, depth=rotate?size.x:size.z, height=size.y;
  if(width<3||height<2.4||depth>1.5||width>30||height>15)return;
  const root=visualOnly(new T.Group());root.position.copy(center);if(rotate)root.rotation.y=Math.PI/2;
  mesh.add(root);const b=geometryBatch(root);
  for(const side of [-1,1]) {
    const z=side*(depth/2+.004);
    const panels=Math.min(8,Math.max(2,Math.floor(width/1.4))), step=width/panels;
    for(let i=0;i<panels;i++) {
      const x=-width/2+step*(i+.5);
      b.box([step-.08,height*.52,.009],m.glass,[x,height*.06,z],.008);
      b.box([.038,height*.8,.018],m.copper,[x-step/2+.02,0,z],.004);
      if(detail>1) for(let k=0;k<3;k++)b.box([step-.09,.018,.025],m.metal,[x,height*.18-k*.14,z],.003);
    }
    b.box([width,.09,.025],m.ceramic,[0,height*.35,z],.008);
    b.box([width,.09,.025],m.ceramic,[0,-height*.25,z],.008);
  }
  b.finish();return {dispose(){disposeGeometry(root);}};
}
