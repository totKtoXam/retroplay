import * as T from 'three';
import { createUrbanMaterials, prepareUrbanScans } from './materials';
import { createUrbanDistrict, createUrbanSuit, disposeGeometry } from './assets';
import { createAvatar } from '../../world-avatar';
import type { GraphicsCheck, GraphicsSettings } from '../../../lib/graphics-settings';
/** Representative rendering, not a hardware-name guess or a promise of match FPS. */
export async function benchmarkUrban(settings:GraphicsSettings, signal:AbortSignal):Promise<GraphicsCheck> {
  if(document.hidden)throw Error('Вернитесь во вкладку игры для проверки.');
  await prepareUrbanScans();
  if(signal.aborted)throw Error('Проверка отменена.');
  const canvas=document.createElement('canvas');
  const gl=canvas.getContext('webgl2',{antialias:false});
  if(!gl)throw Error('UNSUPPORTED: Для этого пакета необходим WebGL 2.');
  const renderer=new T.WebGLRenderer({canvas,context:gl,antialias:false});
  let release=()=>{};
  try {
    const width=Math.max(320,Math.min(2560,innerWidth)),height=Math.max(240,Math.min(1440,innerHeight));
    renderer.setPixelRatio(settings.scale);renderer.setSize(width,height,false);renderer.shadowMap.enabled=settings.shadows>0;
    renderer.toneMapping=T.ACESFilmicToneMapping;
    const scene=new T.Scene();scene.background=new T.Color('#a5bcc8');
    const camera=new T.PerspectiveCamera(64,width/height,.1,300);
    const materials=createUrbanMaterials(settings), district=createUrbanDistrict(scene,materials,settings.detail);
    const actors:ReturnType<typeof createUrbanSuit>[]=[];
    release=()=>{actors.forEach(a=>a.dispose());district.dispose();disposeGeometry(scene);materials.dispose();};
    scene.add(new T.HemisphereLight('#dae7f1','#423c31',1.2));
    const sun=new T.DirectionalLight('#ffe4c8',3);sun.position.set(10,25,8);sun.castShadow=true;
    sun.shadow.mapSize.setScalar(settings.shadows||512);sun.shadow.camera.left=-20;sun.shadow.camera.right=20;sun.shadow.camera.top=20;sun.shadow.camera.bottom=-20;scene.add(sun);
    const floor=new T.Mesh(new T.BoxGeometry(45,.2,45),materials.stone);floor.receiveShadow=true;scene.add(floor);
    for(let i=0;i<12;i++){const a=createAvatar('#799eb1');a.position.set((i%4)*3-5,0,Math.floor(i/4)*3-5);scene.add(a);actors.push(createUrbanSuit(a,materials));}
    const samples:number[]=[];let start=0,last=0;
    await new Promise<void>((resolve,reject)=>{
      let raf=0;
      const abort=()=>{cancelAnimationFrame(raf);reject(Error('Проверка отменена.'));};signal.addEventListener('abort',abort,{once:true});
      const end=(error?:Error)=>{signal.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
      const frame=(now:number)=>{
        if(signal.aborted){end(Error('Проверка отменена.'));return;}
        if(document.hidden){end(Error('Проверка прервана: вкладка скрыта. Повторите её в активной вкладке.'));return;}
        if(!start)start=now;
        camera.position.set(Math.sin(now*.0002)*12,5,14);camera.lookAt(0,1,0);district.update(camera);
        try {renderer.render(scene,camera);gl.finish();}catch(e){end(e as Error);return;}
        if(last-start>700)samples.push(now-last);last=now;
        if(now-start>3500&&samples.length>4){end();return;}raf=requestAnimationFrame(frame);
      };raf=requestAnimationFrame(frame);
    });
    samples.sort((a,b)=>a-b);
    return {fps:Math.round(1000/(samples.reduce((a,b)=>a+b,0)/samples.length)),p95:Math.round(samples[Math.floor(samples.length*.95)]),width:Math.round(width*settings.scale),height:Math.round(height*settings.scale),at:Date.now(),settings:JSON.stringify(settings)};
  } finally {release();renderer.dispose();renderer.forceContextLoss();}
}
