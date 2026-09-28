import * as T from 'three';
import { fighterOutlineMaterial, setFighterTemplate, tintedSkinMaterial } from './world-avatar.ts';

/*
 * Шаблон бойца из файла public/models/fighter/fighter.glb (сборка —
 * scripts/build-fighter-model.mjs). Тело, скин «Агента», оружие в руках,
 * планшет и аксессуары всех скинов приходят готовыми сетками: игра их не
 * собирает, а копирует (world-avatar.ts createAvatar). Пока файл не загружен,
 * шаблон собирается процедурно — вид тот же, файл из него и сделан.
 */
const URL = '/models/fighter/fighter.glb';
let pending: Promise<T.Group | null> | null = null;

/** Загрузить шаблон один раз на вкладку. Ошибку не бросает: остаётся процедурный шаблон. */
export function preloadFighterModel() {
  pending ??= Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ])
    .then(([{ GLTFLoader }, { MeshoptDecoder }]) =>
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(URL),
    )
    .then((gltf) => {
      const template = fighterFromFile(gltf.scene);
      setFighterTemplate(template);
      return template;
    })
    .catch((error) => {
      console.warn('Шаблон бойца не загрузился, собираю процедурно', error);
      pending = null;
      return null;
    });
  return pending;
}

/**
 * Возвращает загруженной сцене вид процедурного шаблона: исходные имена
 * (загрузчик делает повторяющиеся имена уникальными), материал тела с цветом
 * игрока, обводку аниме-стиля (glTF не хранит шейдерные материалы), тени и
 * видимость по умолчанию. Экспортируется для проверки в тестах.
 */
export function fighterFromFile(scene: T.Object3D) {
  const root = (scene.getObjectByName('fighter') ?? scene.children[0] ?? scene) as T.Group;
  const skin = tintedSkinMaterial();
  skin.userData.fighterSkin = true;
  skin.userData.fighterShared = true;
  root.traverse((o) => {
    // Безымянным сеткам загрузчик придумывает имена (mesh_12, …_instance_0) — у шаблона их нет.
    const original = o.userData.name;
    if (typeof original === 'string') o.name = original;
    else if (o instanceof T.Mesh) o.name = '';
    if (!(o instanceof T.Mesh)) return;
    const tint = o.geometry.getAttribute('_tint');
    if (tint) {
      o.geometry.setAttribute('tint', tint);
      o.geometry.deleteAttribute('_tint');
    }
    o.geometry.userData.fighterShared = true;
    const material = o.material as T.Material;
    if (o.name === 'anime-outline') {
      o.material = fighterOutlineMaterial;
      o.visible = false;
    } else if (material.userData.fighterSkin) {
      material.dispose();
      o.material = skin;
      o.castShadow = true;
    } else {
      if (!material.userData.perFighter) material.userData.fighterShared = true;
      o.castShadow = true;
    }
  });
  // Видимость в glTF не хранится: скрываем то, что у процедурного шаблона скрыто.
  root.traverse((o) => {
    if (o.name.startsWith('skin-') || o.name === 'avatar-bandana' || o.name === 'anonymous-bag') o.visible = false;
  });
  root.removeFromParent();
  root.position.set(0, 0, 0);
  return root;
}
