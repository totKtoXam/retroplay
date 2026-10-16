import * as T from 'three';
import { terrainHeightAt, type ArenaDef, type MapNpc } from '@/lib/maps/types';

/*
 * Фигуры для атмосферы (`ArenaDef.npcs`): зомби бредут на месте, выжившие стоят у костра.
 * Это декор, а не боты: столкновений нет, луч их не проверяет (скелетный меш проверялся
 * бы по каждой вершине на процессоре). Анимация считается только у ближних фигур, тень
 * — только у самых ближних: сотня скелетов на карте стоила бы дороже всей стрельбы.
 */

/** Ближе этого фигура анимируется. */
const ANIMATE_RANGE = 120;
/** Дальше этого фигура не рисуется вовсе. */
const VISIBLE_RANGE = 160;
/** Ближе этого фигура отбрасывает тень. */
const SHADOW_RANGE = 40;
/** Сколько файлов фигур грузится разом. */
const LOAD_PARALLEL = 4;

/** Псевдослучайное 0…1 по месту фигуры: фаза и скорость не меняются от загрузки к загрузке. */
const seeded = (x: number, z: number, salt: number) => {
  const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

type Figure = {
  root: T.Object3D;
  mixer: T.AnimationMixer;
  meshes: T.Mesh[];
  gore: boolean;
  x: number;
  z: number;
  /** Время, накопленное, пока фигура была вне дальности анимации. */
  idle: number;
  shadow: boolean;
};

/**
 * Клип по имени: точно, потом без регистра, потом по вхождению (`walk` → `Zombie_Walk`),
 * иначе первый. Если рядом есть вариант «на месте» (`Walk_InPlace`), берётся он: у
 * обычной ходьбы бывает движение корня, и фигура уходила бы сквозь стены.
 */
function pickClip(clips: T.AnimationClip[], name: string) {
  const lower = name.toLowerCase();
  const flat = (c: T.AnimationClip) =>
    c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const inPlace = clips.find(
    (c) => flat(c) === `${lower.replace(/[^a-z0-9]/g, '')}inplace`,
  );
  if (inPlace && !lower.includes('inplace')) return inPlace;
  return (
    clips.find((c) => c.name === name) ??
    clips.find((c) => c.name.toLowerCase() === lower) ??
    clips.find((c) => c.name.toLowerCase().includes(lower)) ??
    clips[0]
  );
}

export function createAmbientNpcs(def: ArenaDef) {
  const group = new T.Group();
  group.name = 'ambient-npcs';
  const models = def.propKit?.models ?? {};
  const terrain = def.terrain;
  const figures: Figure[] = [];
  const sources: T.Object3D[] = [];
  let goreOn = true;
  let disposed = false;

  const byFile = new Map<string, MapNpc[]>();
  for (const n of def.npcs ?? []) {
    const file = models[n.m]?.file;
    if (!file) continue;
    byFile.set(file, [...(byFile.get(file) ?? []), n]);
  }

  const place = (
    gltf: { scene: T.Object3D; animations: T.AnimationClip[] },
    list: MapNpc[],
    clone: (o: T.Object3D) => T.Object3D,
  ) => {
    for (const n of list) {
      const info = models[n.m];
      const root = clone(gltf.scene);
      const y = n.y ?? (terrain ? terrainHeightAt(terrain, n.x, n.z) : 0);
      root.position.set(n.x, y, n.z);
      root.rotation.y = n.yaw ?? 0;
      root.scale.setScalar(n.s ?? 1);
      const meshes: T.Mesh[] = [];
      root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        meshes.push(o);
        o.castShadow = false;
        o.receiveShadow = true;
        o.raycast = () => {};
      });
      root.userData.noCameraCollision = true;
      root.userData.projectileCollision = 'ignore';
      const mixer = new T.AnimationMixer(root);
      const clip = pickClip(gltf.animations, n.clip);
      if (clip) {
        const action = mixer.clipAction(clip);
        // Разная фаза и ±10 % скорости: толпа не шагает в ногу.
        action.timeScale = 0.9 + 0.2 * seeded(n.x, n.z, 1);
        action.play();
        action.time = seeded(n.x, n.z, 2) * clip.duration;
        mixer.update(0);
      }
      // Зомби и тела прячет настройка «Кровь и жестокость».
      const gore = !!info?.gore || n.m.startsWith('zombies/');
      root.visible = goreOn || !gore;
      figures.push({
        root,
        mixer,
        meshes,
        gore,
        x: n.x,
        z: n.z,
        idle: 0,
        shadow: false,
      });
      group.add(root);
    }
  };

  const ready =
    byFile.size === 0
      ? Promise.resolve()
      : Promise.all([
          import('three/addons/loaders/GLTFLoader.js'),
          import('three/addons/libs/meshopt_decoder.module.js'),
          import('three/addons/utils/SkeletonUtils.js'),
        ]).then(([{ GLTFLoader }, { MeshoptDecoder }, { clone }]) => {
          const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
          const files = [...byFile];
          const next = async (): Promise<void> => {
            const job = files.shift();
            if (!job || disposed) return;
            const [file, list] = job;
            try {
              const gltf = await loader.loadAsync(file);
              if (disposed) return;
              sources.push(gltf.scene);
              place(gltf, list, clone);
            } catch (error) {
              console.warn('Фигура не загрузилась', file, error);
            }
            return next();
          };
          return Promise.all(
            Array.from({ length: LOAD_PARALLEL }, () => next()),
          ).then(() => undefined);
        });

  return {
    group,
    ready,
    /** Каждый кадр: анимация ближних, видимость и тени по дальности от камеры. */
    update(dt: number, eye: T.Vector3) {
      for (const f of figures) {
        const d = Math.hypot(f.x - eye.x, f.z - eye.z);
        const visible = (goreOn || !f.gore) && d < VISIBLE_RANGE;
        f.root.visible = visible;
        if (!visible || d >= ANIMATE_RANGE) {
          f.idle += dt;
          continue;
        }
        // Вернувшаяся в дальность фигура догоняет пропущенное время — без рывка фазы.
        f.mixer.update(dt + f.idle);
        f.idle = 0;
        const shadow = d < SHADOW_RANGE;
        if (shadow !== f.shadow) {
          f.shadow = shadow;
          for (const mesh of f.meshes) mesh.castShadow = shadow;
        }
      }
    },
    /** Настройка «Кровь и жестокость»: зомби видны или спрятаны. */
    setGore(on: boolean) {
      goreOn = on;
      for (const f of figures) if (f.gore) f.root.visible = on;
    },
    dispose() {
      disposed = true;
      for (const f of figures) {
        f.mixer.stopAllAction();
        f.mixer.uncacheRoot(f.root);
      }
      // Клоны делят геометрию и материалы с исходной сценой файла.
      for (const scene of sources)
        scene.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          o.geometry.dispose();
          for (const mat of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            for (const v of Object.values(mat))
              if (v instanceof T.Texture) v.dispose();
            mat.dispose();
          }
        });
      for (const f of figures)
        f.root.traverse((o) => {
          if (o instanceof T.SkinnedMesh) o.skeleton.dispose();
        });
    },
  };
}
