import * as T from 'three';
import type { GraphicsSettings } from '../../../lib/graphics-settings.ts';
let scans: HTMLImageElement[] | undefined;
let preparing: Promise<void> | undefined;
/** Self-hosted CC0 scans; a bounded decoded CPU cache shared by the benchmark and pack. */
export function prepareUrbanScans(): Promise<void> {
  return preparing ??= Promise.all(['albedo','normal','roughness'].map(name => new Promise<HTMLImageElement>((resolve,reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.onload = image.onerror = null; reject(Error('Не удалось загрузить материалы Urban. Повторите проверку.')); }, 20000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(Error('Не удалось загрузить материалы Urban.')); };
    image.src = `/resource-packs/urban/${name}.jpg`;
  }))).then(images => { scans = images; }).catch(error => { preparing = undefined; throw error; });
}
/** Original deterministic terrazzo, brushed aluminium and woven textile surfaces. */
export function createUrbanMaterials(settings: GraphicsSettings) {
  const textures: T.Texture[] = [], materials: T.Material[] = [];
  function surface(kind: number, color: string, metalness: number) {
    const n = settings.textures, base = new Uint8Array(n*n*4), normal = new Uint8Array(n*n*4), rough = new Uint8Array(n*n*4);
    for (let y=0;y<n;y++) for(let x=0;x<n;x++) {
      const i=(y*n+x)*4;
      const hash = ((Math.imul(x+17,374761393)^Math.imul(y+71,668265263))>>>0)%255;
      const seam = kind===0 && (x % (n/4)<3 || y % (n/4)<3);
      const grain = kind===2 ? ((x+y)%6<3 ? 18 : -18) : kind===1 ? (y%7)*2 : hash%34;
      const c=seam?95:195+grain;
      base.set([c,c,c,255],i); normal.set([128+(hash%9)-4,128+(kind===2?grain/3:0),250,255],i);
      const r=kind===1?80+hash%35:kind===2?220:150+hash%50;
      rough.set([r,r,r,255],i);
    }
    function texture(data: Uint8Array, srgb=false) {
      const t=new T.DataTexture(data,n,n,T.RGBAFormat);t.colorSpace=srgb?T.SRGBColorSpace:T.NoColorSpace;
      t.wrapS=t.wrapT=T.RepeatWrapping;t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter;
      t.generateMipmaps=true;t.anisotropy=settings.anisotropy;t.needsUpdate=true;textures.push(t);return t;
    }
    const mat = new T.MeshStandardMaterial({color,map:texture(base,true),normalMap:texture(normal),roughnessMap:texture(rough),roughness:1,metalness,normalScale:new T.Vector2(.15,.15)});
    materials.push(mat);return mat;
  }
  const stone=surface(0,'#c9b9a1',0), metal=surface(1,'#87949b',.85), fabric=surface(2,'#263749',0);
  if (scans) {
    const oldMaps = [stone.map,stone.normalMap,stone.roughnessMap];
    const maps = scans.map((image,i) => {
      const canvas = document.createElement('canvas');canvas.width=canvas.height=settings.textures;
      canvas.getContext('2d')!.drawImage(image,0,0,settings.textures,settings.textures);
      const texture = new T.CanvasTexture(canvas);texture.colorSpace=i===0?T.SRGBColorSpace:T.NoColorSpace;
      texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.anisotropy=settings.anisotropy;
      textures.push(texture);return texture;
    });
    oldMaps.forEach(t=>{if(t){t.dispose();textures.splice(textures.indexOf(t),1);}});
    [stone.map,stone.normalMap,stone.roughnessMap]=maps;stone.color.set('#b9b1a1');stone.normalScale.set(.4,.4);
  }
  const ceramic=new T.MeshPhysicalMaterial({color:'#d1d5d2',roughness:.28,metalness:.15,clearcoat:.5});
  const rubber=new T.MeshStandardMaterial({color:'#182126',roughness:.85});
  const copper=new T.MeshStandardMaterial({color:'#9f6840',metalness:.85,roughness:.35});
  const glass=new T.MeshPhysicalMaterial({color:'#568792',metalness:.65,roughness:.14,clearcoat:1});
  const glow=new T.MeshStandardMaterial({color:'#fff0ce',emissive:'#ffcb8b',emissiveIntensity:2.5});
  materials.push(ceramic,rubber,copper,glass,glow);
  return {stone,metal,fabric,ceramic,rubber,copper,glass,glow,
    textureBytes:textures.length*settings.textures**2*4*4/3,
    dispose(){materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
}
export type UrbanMaterials=ReturnType<typeof createUrbanMaterials>;
