import * as T from 'three';

/*
 * Модели оружия: Ultimate Guns Pack от Quaternius (CC0, public/models/weapons,
 * сборка — scripts/build-weapon-models.mjs). Одни и те же модели держит игрок
 * от первого лица (world-hands.ts) и бойцы в мире (world-avatar.ts): у всех
 * копий общие геометрия и материалы, своего у копии — только положение.
 *
 * Модели в файле уже приведены к виду, в котором их держат: ствол к −Z, верх
 * к +Y, размер настоящий, в метрах, начало координат — точка хвата правой
 * ладонью на рукоятке. Точки прицела и дула — в lib/weapon-sights.ts, в тех же
 * координатах.
 */

const URL = '/models/weapons/weapons.glb';

/** Какая модель у какого инструмента. */
export const WEAPON_MODEL: Record<string, string> = {
  paint: 'marker',
  confetti: 'shotgun',
  sniper: 'sniper',
  like: 'pistol',
};

/**
 * Куда ложится левая ладонь (координаты модели): под цевьё винтовок и помпу
 * дробовика; у пистолета — под правую кисть, обхватом снизу.
 */
export const WEAPON_SUPPORT: Record<string, [number, number, number]> = {
  marker: [0, 0.025, -0.29],
  shotgun: [0, -0.025, -0.37],
  sniper: [0, -0.01, -0.35],
  pistol: [-0.012, -0.035, 0.004],
};

/**
 * Каких размеров оружие в руках бойца. Мир рассчитан на бойцов ростом около
 * 2,1 м (world-human.ts, HUMAN_SCALE): настоящая винтовка у них выглядела бы
 * игрушкой. От первого лица модели в настоящую величину.
 */
export const WORLD_WEAPON_SCALE = 1.18;

let pending: Promise<Map<string, T.Object3D> | null> | null = null;
let ready: Map<string, T.Object3D> | null = null;

/** Загружает модели один раз на вкладку. Ошибку не бросает: без файла оружие остаётся прежним. */
export function preloadWeaponModels() {
  pending ??= Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ])
    .then(([{ GLTFLoader }, { MeshoptDecoder }]) =>
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(URL),
    )
    .then((gltf) => {
      const models = new Map<string, T.Object3D>();
      for (const id of new Set(Object.values(WEAPON_MODEL))) {
        const model = gltf.scene.getObjectByName(`weapon-${id}`);
        if (!model) continue;
        // Своё положение и масштаб у узла — это распаковка сжатых вершин
        // (quantize при сборке), их не трогаем: модель ставят через родителя.
        model.removeFromParent();
        prepare(model);
        models.set(id, model);
      }
      ready = models;
      return models;
    })
    .catch((error) => {
      console.warn('Модели оружия не загрузились', error);
      pending = null;
      return null;
    });
  return pending;
}

/** Загруженные модели или null, пока файл не пришёл. */
export function weaponModels() {
  return ready;
}

/**
 * Материалы набора — почти чёрные, с одинаковой шероховатостью на всём. Чуть
 * осветляем и разводим по фактуре: металл блестит, дерево и пластик матовые.
 * Иначе в тени оружие сливается в сплошной силуэт.
 */
function prepare(model: T.Object3D) {
  const tuned = new Map<T.Material, T.Material>();
  model.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    // Общие у всех копий: чистка бойца и сцены их не освобождает (fighterShared, world-avatar.ts).
    o.geometry.userData.fighterShared = true;
    const source = o.material as T.MeshStandardMaterial;
    let material = tuned.get(source) as T.MeshStandardMaterial | undefined;
    if (!material) {
      material = source;
      const name = source.name.toLowerCase();
      const metal = name.includes('metal') || name === 'main' || name === 'maindark' || name === 'mainlight';
      const glass = name.includes('glass');
      material.color.multiplyScalar(glass ? 1 : 1.9);
      material.metalness = glass ? 0.2 : metal ? 0.55 : 0.05;
      material.roughness = glass ? 0.08 : metal ? 0.42 : name.includes('wood') ? 0.7 : 0.62;
      material.userData.fighterShared = true;
      tuned.set(source, material);
    }
    o.material = material;
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

/** Держатели оружия у бойца (world-avatar.ts): инструмент → узел под группой `gun`. */
export const WORLD_WEAPON_PIVOT: Record<string, string> = {
  paint: 'gun-paint',
  confetti: 'gun-shotgun',
  sniper: 'gun-sniper',
  like: 'gun-pistol',
};

/**
 * Вкладывает модели оружия в держатели бойца вместо процедурных стволов. Один
 * раз на бойца, как только модели загрузились; до этого остаются процедурные.
 * Начало модели — хват правой ладонью, он и совпадает с кистью (world-human.ts
 * holdItem ставит кисть в начало держателя).
 */
export function dressWorldWeapons(gun: T.Object3D) {
  if (gun.userData.weaponsDressed || !ready) return;
  gun.userData.weaponsDressed = true;
  for (const [tool, name] of Object.entries(WORLD_WEAPON_PIVOT)) {
    let pivot = gun.getObjectByName(name);
    if (!pivot) {
      pivot = new T.Group();
      pivot.name = name;
      pivot.visible = false;
      gun.add(pivot);
    }
    for (const child of pivot.children) child.visible = false;
    const model = weaponModel(WEAPON_MODEL[tool]);
    if (!model) continue;
    const holder = new T.Group();
    holder.name = 'weapon-model';
    holder.scale.setScalar(WORLD_WEAPON_SCALE);
    holder.add(model);
    pivot.add(holder);
  }
}

/** Копия модели: геометрия и материалы общие с оригиналом. */
export function weaponModel(id: string) {
  const template = ready?.get(id);
  if (!template) return null;
  const copy = template.clone(true);
  copy.name = `weapon-model-${id}`;
  return copy;
}
