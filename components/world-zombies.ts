import * as T from 'three';
import { isOnline, type Room } from '@/lib/model';
import type { GameMap } from '@/lib/maps/types';
import { OUTBREAK_REAL_MODELS } from '@/lib/maps/outbreak-real-models';
import { decalTextures } from '@/lib/maps/decals';
import { BITE_MS, ZOMBIES, type ZombieKind } from '@/lib/survival';
import {
  ANIMATE_RANGE,
  CORPSE_LINGER_MS,
  FALL_MS,
  HP_BAR_RANGE,
  hashId,
  pickClip,
  SHADOW_RANGE,
  walkTimeScale,
  zombieModelFor,
} from '@/lib/survival-client';

/*
 * Зомби режима «Выживание» и аптечки. Зомби — участники комнаты с полем `zombie`
 * (lib/survival.ts): сервер водит их и считает укусы и урон, клиент только рисует
 * снимок — скелетную модель из набора карты «Зона заражения», клипы `walk`/`idle`/
 * `attack`, полоску здоровья и падение тела. Люди остаются в
 * components/world-remote-players.ts, зомби он пропускает.
 *
 * Снимок приходит раз в 100 мс, поэтому фигура не стоит на серверной точке, а
 * мягко догоняет её с экстраполяцией по скорости вдоль yaw — иначе толпа дёргалась
 * бы десять раз в секунду. Стены при этом не проверяются: зомби ходит по сетке
 * проходимости сервера и в стену не целится, а мягкий lerp за ~120 мс не успевает
 * увести его далеко от истинной точки.
 */

/** Фигура догоняет серверную точку с такой постоянной времени, с. */
const FOLLOW_S = 0.12;
/** Дальше этого фигура не догоняет, а переставляется: зомби появился заново. */
const SNAP_DIST_SQ = 36;
/** Самое старое пятно крови уступает место новому. */
const MAX_STAINS = 48;
/** Пятно крови живёт столько, мс, потом исчезает: пол не должен стать сплошь бурым. */
const STAIN_MS = 90_000;
/** Длина перехода между клипами, с. */
const FADE_S = 0.18;
/** Тело уходит под землю за последнюю секунду перед исчезновением. */
const SINK_MS = 1200;

type Gltf = { scene: T.Object3D; animations: T.AnimationClip[] };
type Clone = (o: T.Object3D) => T.Object3D;

type Figure = {
  id: string;
  kind: ZombieKind;
  /** Стоит на серверной позиции, повёрнут по yaw; всё остальное — его дети. */
  root: T.Group;
  /** Клон модели: его наклоняем при укусе и роняем при смерти. */
  body: T.Object3D;
  mixer: T.AnimationMixer;
  actions: { idle?: T.AnimationAction; walk?: T.AnimationAction; attack?: T.AnimationAction };
  current: T.AnimationAction | null;
  hitbox: T.Mesh;
  meshes: T.Mesh[];
  bar: T.Group;
  barFill: T.Sprite;
  /** Серверная точка последнего снимка и когда она изменилась (performance.now). */
  lastX: number;
  lastY: number;
  lastZ: number;
  lastYaw: number;
  lastTime: number;
  /** Когда увидели hp = 0; null — жив. */
  diedAt: number | null;
  /** Когда пропал из снимка; null — ещё в нём. */
  goneAt: number | null;
  /** Укус без клипа `attack`: когда начался наклон корпуса. */
  leanAt: number | null;
  biting: boolean;
  shadow: boolean;
  /** Накопленное время вне дальности анимации. */
  idle: number;
  /** Упал лицом вниз (иначе на спину) — чтобы вся толпа не ложилась одинаково. */
  faceDown: boolean;
};

export type WorldZombies = ReturnType<typeof createWorldZombies>;

export function createWorldZombies({
  scene,
  latest,
  map,
  gore,
  shadows = true,
  eye,
  blood,
}: {
  scene: T.Scene;
  latest: { readonly current: { room: Room } };
  map: GameMap;
  /** Настройка «Кровь и жестокость» на момент создания. */
  gore: boolean;
  /** Тени от фигур (на низком качестве теней нет вовсе). */
  shadows?: boolean;
  /** Откуда смотрит камера: по расстоянию решаем, кого анимировать и кому рисовать тень. */
  eye: () => T.Vector3;
  /** Всплеск крови при смерти, если у VFX есть подходящий эффект (components/world-vfx.ts). */
  blood?: (at: T.Vector3) => void;
}) {
  const group = new T.Group();
  group.name = 'survival';
  // Фигуры не мешают камере от третьего лица: толпа у спины дёргала бы её каждый кадр.
  group.userData.noCameraCollision = true;
  scene.add(group);
  const stainsGroup = new T.Group();
  stainsGroup.name = 'blood';
  stainsGroup.userData.projectileCollision = 'ignore';
  stainsGroup.visible = gore;
  group.add(stainsGroup);

  let goreOn = gore;
  let disposed = false;
  const figures = new Map<string, Figure>();
  /** Загрузка модели для id уже идёт — второй раз не запускаем. */
  const pending = new Set<string>();
  const sources = new Map<string, Promise<Gltf | null>>();
  let tools: Promise<{ load: (file: string) => Promise<Gltf>; clone: Clone } | null> | null = null;

  /**
   * Загрузчик и клонирование — из отдельных чанков three/addons: в комнате без
   * «Выживания» этот код не нужен. Один GLB грузится один раз, фигуры — его клоны
   * со своим скелетом (SkeletonUtils.clone), геометрия и материалы общие.
   */
  const loadTools = () =>
    (tools ??= Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
      import('three/addons/utils/SkeletonUtils.js'),
    ])
      .then(([{ GLTFLoader }, { MeshoptDecoder }, { clone }]) => {
        const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
        return { load: (file: string) => loader.loadAsync(file) as Promise<Gltf>, clone };
      })
      .catch((error) => {
        console.warn('Загрузчик моделей зомби недоступен', error);
        return null;
      }));
  const source = (file: string) => {
    let p = sources.get(file);
    if (!p) {
      p = loadTools().then((t) =>
        t
          ? t.load(file).catch((error) => {
              console.warn('Модель зомби не загрузилась', file, error);
              return null;
            })
          : null,
      );
      sources.set(file, p);
    }
    return p;
  };

  // --- Общие ресурсы: мишень для попаданий, полоска здоровья, пятно крови, аптечка.

  // Мишень — коробка по серверному хитбоксу (lib/game-items.ts inHitRange: радиус 0,46,
  // позвоночник 0,2…2,1 м). Луч выстрела пересекает её, а не десятки тысяч треугольников
  // скелетной сетки; материал невидим, как у упрощённого тела человека (world-human.ts).
  const hitGeo = new T.BoxGeometry(0.92, 1.9, 0.92);
  const hitMat = new T.MeshBasicMaterial({ visible: false });
  const barBackMat = new T.SpriteMaterial({ color: '#0b0f14', transparent: true, opacity: 0.7, depthWrite: false });
  const barFillMat = new T.SpriteMaterial({ color: '#e24b3c', depthWrite: false });
  const BAR_W = 0.7,
    BAR_H = 0.07;

  const stainGeo = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // Текстура — та же процедурная лужа, что у пятен карты (lib/maps/decals.ts). Пока она
  // не загрузилась, материал невидим: квадрат без маски был бы бурой плиткой.
  const stainMat = new T.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    visible: false,
  });
  const stainTextures: T.Texture[] = [];
  let stainLoading = false;
  const loadStain = () => {
    if (stainLoading) return;
    stainLoading = true;
    const spec = decalTextures('proc-blood');
    const loader = new T.TextureLoader();
    const one = (url: string | undefined, color: boolean) =>
      url
        ? loader.loadAsync(url).then(
            (tex) => {
              tex.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
              tex.anisotropy = 8;
              stainTextures.push(tex);
              return tex;
            },
            () => undefined,
          )
        : Promise.resolve(undefined);
    void Promise.all([one(spec.map, true), one(spec.normalMap, false)]).then(([mapTex, normalTex]) => {
      if (disposed || !mapTex) return;
      stainMat.map = mapTex;
      stainMat.normalMap = normalTex ?? null;
      stainMat.visible = true;
      stainMat.needsUpdate = true;
    });
  };
  const stains: { mesh: T.Mesh; born: number }[] = [];

  // Аптечка: белый бокс с красным крестом сверху, без ассетов — её видно и издали.
  const kitGeo = new T.BoxGeometry(0.44, 0.26, 0.44);
  const kitMat = new T.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.45, metalness: 0.05 });
  const crossGeo = new T.BoxGeometry(0.26, 0.03, 0.09);
  const crossMat = new T.MeshStandardMaterial({ color: '#d6281e', roughness: 0.5, emissive: '#5a0c08' });
  const drops = new Map<string, { group: T.Group; phase: number }>();

  const up = new T.Vector3(0, 1, 0);
  const scratch = new T.Vector3(),
    normal = new T.Vector3(),
    tilt = new T.Quaternion(),
    yawQ = new T.Quaternion();

  const mark = (o: T.Object3D) => {
    // По этому флагу world.tsx не берёт наши объекты в кэш мишеней сцены.
    o.userData.survivalProp = true;
  };

  /** Пятно крови на земле под телом: наклонено по рельефу, повёрнуто как попало. */
  const stain = (x: number, z: number, y: number, size: number, now: number) => {
    loadStain();
    const mesh = new T.Mesh(stainGeo, stainMat);
    mark(mesh);
    mesh.userData.projectileCollision = 'ignore';
    const ground = map.groundHeight(x, z, y);
    // Нормаль по четырём соседним высотам: на склоне плоское пятно ушло бы под землю.
    const hx = map.groundHeight(x + 0.5, z, y) - map.groundHeight(x - 0.5, z, y);
    const hz = map.groundHeight(x, z + 0.5, y) - map.groundHeight(x, z - 0.5, y);
    normal.set(-hx, 1, -hz).normalize();
    tilt.setFromUnitVectors(up, normal);
    yawQ.setFromAxisAngle(up, Math.random() * Math.PI * 2);
    mesh.quaternion.copy(tilt).multiply(yawQ);
    mesh.position.set(x, ground + 0.02, z);
    mesh.scale.setScalar(size);
    mesh.receiveShadow = true;
    stainsGroup.add(mesh);
    stains.push({ mesh, born: now });
    while (stains.length > MAX_STAINS) stains.shift()?.mesh.removeFromParent();
  };

  const makeBar = () => {
    const bar = new T.Group();
    const back = new T.Sprite(barBackMat);
    back.scale.set(BAR_W + 0.04, BAR_H + 0.03, 1);
    const fill = new T.Sprite(barFillMat);
    // Заполнение растёт от левого края: центр спрайта сдвинут к нему.
    fill.center.set(0, 0.5);
    fill.position.x = -BAR_W / 2;
    fill.position.z = 0.001;
    fill.scale.set(BAR_W, BAR_H, 1);
    mark(back);
    mark(fill);
    back.userData.presentationOnly = true;
    fill.userData.presentationOnly = true;
    bar.add(back, fill);
    bar.visible = false;
    return { bar, fill };
  };

  const build = (id: string, kind: ZombieKind, gltf: Gltf, clone: Clone, modelId: string) => {
    const info = OUTBREAK_REAL_MODELS[modelId as keyof typeof OUTBREAK_REAL_MODELS];
    const root = new T.Group();
    root.name = id;
    mark(root);
    const body = clone(gltf.scene);
    const scale = ZOMBIES[kind].scale;
    body.scale.setScalar(scale);
    body.userData.projectileCollision = 'ignore';
    const meshes: T.Mesh[] = [];
    body.traverse((o) => {
      mark(o);
      if (!(o instanceof T.Mesh)) return;
      meshes.push(o);
      o.castShadow = false;
      o.receiveShadow = true;
      // Сфера отсечения с запасом на любую позу: считать её по вершинам каждый кадр дорого.
      o.frustumCulled = true;
      o.geometry.boundingSphere ??= new T.Sphere();
      o.geometry.boundingSphere.set(new T.Vector3(0, 1 / scale, 0), 2.2 / scale);
    });
    const hitbox = new T.Mesh(hitGeo, hitMat);
    hitbox.position.y = 1.15;
    hitbox.userData.projectileCollision = 'block';
    mark(hitbox);
    const { bar, fill } = makeBar();
    bar.position.y = ((info?.max[1] ?? 1.8) + 0.25) * scale + 0.05;
    root.add(body, hitbox, bar);
    const mixer = new T.AnimationMixer(body);
    const action = (name: string) => {
      const clip = pickClip(gltf.animations, name);
      return clip ? mixer.clipAction(clip) : undefined;
    };
    const actions = { idle: action('idle'), walk: action('walk'), attack: action('attack') };
    // Разная фаза: толпа не шагает в ногу.
    const phase = (hashId(id) % 1000) / 1000;
    for (const a of Object.values(actions)) if (a) a.time = phase * a.getClip().duration;
    const f: Figure = {
      id,
      kind,
      root,
      body,
      mixer,
      actions,
      current: null,
      hitbox,
      meshes,
      bar,
      barFill: fill,
      lastX: NaN,
      lastY: 0,
      lastZ: 0,
      lastYaw: 0,
      lastTime: 0,
      diedAt: null,
      goneAt: null,
      leanAt: null,
      biting: false,
      shadow: false,
      idle: 0,
      faceDown: (hashId(id) & 1) === 1,
    };
    figures.set(id, f);
    group.add(root);
    return f;
  };

  const spawn = (id: string, kind: ZombieKind) => {
    const modelId = zombieModelFor(id, kind);
    const file = OUTBREAK_REAL_MODELS[modelId as keyof typeof OUTBREAK_REAL_MODELS]?.file;
    if (!file) return;
    pending.add(id);
    void Promise.all([source(file), loadTools()]).then(([gltf, t]) => {
      pending.delete(id);
      if (disposed || !gltf || !t || figures.has(id)) return;
      // Пока грузилось, зомби уже убрали из снимка — фигуру не ставим.
      if (!latest.current.room.members.some((m) => m.id === id && m.zombie)) return;
      build(id, kind, gltf, t.clone, modelId);
    });
  };

  const play = (f: Figure, next: T.AnimationAction | undefined, timeScale = 1) => {
    if (!next) return;
    if (f.current !== next) {
      f.current?.fadeOut(FADE_S);
      next.reset().setEffectiveWeight(1).fadeIn(FADE_S).play();
      f.current = next;
    }
    next.timeScale = timeScale;
  };

  const retire = (f: Figure) => {
    figures.delete(f.id);
    f.mixer.stopAllAction();
    f.mixer.uncacheRoot(f.body);
    f.root.removeFromParent();
    // Клон делит геометрию и материалы с исходной сценой файла — у него свой только скелет.
    f.body.traverse((o) => {
      if (o instanceof T.SkinnedMesh) o.skeleton.dispose();
    });
  };

  const makeDrop = () => {
    const g = new T.Group();
    const box = new T.Mesh(kitGeo, kitMat);
    box.castShadow = true;
    const a = new T.Mesh(crossGeo, crossMat);
    a.position.y = 0.145;
    const b = new T.Mesh(crossGeo, crossMat);
    b.position.y = 0.145;
    b.rotation.y = Math.PI / 2;
    g.add(box, a, b);
    g.userData.projectileCollision = 'ignore';
    g.userData.noCameraCollision = true;
    g.traverse(mark);
    return g;
  };

  const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

  return {
    group,
    /** Каждый кадр: позы из снимка, клипы, падение тел, полоски здоровья, аптечки. */
    update(now: number, dt: number) {
      if (disposed) return;
      const room = latest.current.room;
      const serverNow = room.serverNow ?? Date.now();
      const at = eye();
      const seen = new Set<string>();
      for (const m of room.members) {
        if (!m.zombie || !isOnline(m.lastSeen, serverNow)) continue;
        seen.add(m.id);
        const f = figures.get(m.id);
        if (!f) {
          if (!pending.has(m.id)) spawn(m.id, m.zombie);
          continue;
        }
        f.goneAt = null;
        const p = m.pose;
        if (Number.isNaN(f.lastX)) {
          // Первый снимок: ставим сразу, догонять нечего.
          f.root.position.set(p.x, p.y, p.z);
          f.root.rotation.y = p.yaw || 0;
          f.lastX = p.x;
          f.lastY = p.y;
          f.lastZ = p.z;
          f.lastYaw = p.yaw || 0;
          f.lastTime = now;
        } else if (p.x !== f.lastX || p.y !== f.lastY || p.z !== f.lastZ || p.yaw !== f.lastYaw) {
          f.lastX = p.x;
          f.lastY = p.y;
          f.lastZ = p.z;
          f.lastYaw = p.yaw || 0;
          f.lastTime = now;
        }
        const dead = (m.hp ?? 100) <= 0;
        if (dead && f.diedAt === null) {
          f.diedAt = now;
          f.current = null;
          f.mixer.stopAllAction();
          f.hitbox.visible = false;
          f.bar.visible = false;
          if (goreOn) {
            const size = (f.kind === 'brute' ? 2 : 1.5) + Math.random() * 0.6;
            stain(p.x, p.z, p.y, size, now);
            blood?.(scratch.set(f.root.position.x, f.root.position.y + 1, f.root.position.z).clone());
          }
        }
        const dist = Math.hypot(f.root.position.x - at.x, f.root.position.z - at.z);
        if (!dead) {
          // Цель: серверная точка плюс ход за время с последнего снимка вдоль yaw
          // (вперёд = (−sin yaw, −cos yaw), как у игрока), но не дальше одного тика с запасом.
          let tx = p.x,
            tz = p.z;
          if (p.moving && (p.speed || 0) > 0) {
            const ahead = Math.min(0.25, Math.max(0, (now - f.lastTime) / 1000));
            tx += -Math.sin(f.lastYaw) * (p.speed || 0) * ahead;
            tz += -Math.cos(f.lastYaw) * (p.speed || 0) * ahead;
          }
          const dx = tx - f.root.position.x,
            dz = tz - f.root.position.z;
          if (dx * dx + dz * dz > SNAP_DIST_SQ) {
            f.root.position.set(tx, p.y, tz);
            f.root.rotation.y = f.lastYaw;
          } else {
            const k = 1 - Math.exp(-dt / FOLLOW_S);
            f.root.position.x += dx * k;
            f.root.position.z += dz * k;
            f.root.position.y += (p.y - f.root.position.y) * (1 - Math.exp(-dt / 0.08));
            let dyaw = (f.lastYaw - f.root.rotation.y) % (Math.PI * 2);
            if (dyaw > Math.PI) dyaw -= Math.PI * 2;
            if (dyaw < -Math.PI) dyaw += Math.PI * 2;
            f.root.rotation.y += dyaw * (1 - Math.exp(-dt / 0.07));
          }
          // Укус: клип `attack`, а у моделей без него — рывок корпусом вперёд.
          const biting = p.tool === 'bite';
          if (biting && !f.biting) f.leanAt = now;
          f.biting = biting;
          if (biting && f.actions.attack) play(f, f.actions.attack, 1.1);
          else if (p.moving && (p.speed || 0) > 0.05)
            play(f, f.actions.walk ?? f.actions.idle, walkTimeScale(p.speed || ZOMBIES[f.kind].speed));
          else play(f, f.actions.idle ?? f.actions.walk, f.actions.idle ? 1 : 0.0001);
          if (f.leanAt !== null && !f.actions.attack) {
            const t = (now - f.leanAt) / BITE_MS;
            if (t >= 1) {
              f.leanAt = null;
              f.body.rotation.x = 0;
            } else f.body.rotation.x = -Math.sin(t * Math.PI) * 0.5;
          }
          if (dist < ANIMATE_RANGE) {
            // Вернувшаяся в дальность фигура догоняет пропущенное время — без рывка фазы.
            f.mixer.update(Math.min(dt + f.idle, 2));
            f.idle = 0;
          } else f.idle += dt;
          // Полоска здоровья — только раненым и вблизи: толпа с полосками рябит.
          const max = m.maxHp ?? ZOMBIES[f.kind].hp;
          const hp = Math.max(0, Math.min(max, m.hp ?? max));
          const wounded = hp < max && dist < HP_BAR_RANGE;
          f.bar.visible = wounded;
          if (wounded) f.barFill.scale.x = Math.max(0.01, BAR_W * (hp / max));
        }
        const shadow = shadows && dist < SHADOW_RANGE && !dead;
        if (shadow !== f.shadow) {
          f.shadow = shadow;
          for (const mesh of f.meshes) mesh.castShadow = shadow;
        }
      }
      for (const f of figures.values()) {
        if (!seen.has(f.id) && f.goneAt === null) {
          f.goneAt = now;
          // Живого убрали из снимка (партия остановлена) — фигуре лежать незачем.
          if (f.diedAt === null) {
            retire(f);
            continue;
          }
        }
        if (f.diedAt !== null) {
          // Падение: тело наклоняется на 90° вокруг оси плеч и чуть оседает.
          const t = easeOut(Math.min(1, (now - f.diedAt) / FALL_MS));
          f.body.rotation.x = (f.faceDown ? -1 : 1) * (Math.PI / 2) * t;
          let sink = 0.12 * t;
          if (f.goneAt !== null) {
            const since = now - f.goneAt;
            if (since >= CORPSE_LINGER_MS) {
              retire(f);
              continue;
            }
            // Последняя секунда — тело уходит под землю, а не пропадает рывком.
            const s = Math.max(0, (since - (CORPSE_LINGER_MS - SINK_MS)) / SINK_MS);
            sink += 1.1 * s * s;
          }
          f.body.position.y = -sink;
        }
      }
      // Пятна крови со временем исчезают.
      while (stains.length && now - stains[0].born > STAIN_MS) stains.shift()?.mesh.removeFromParent();

      // Аптечки: есть в снимке — парят и крутятся, нет — исчезают.
      const list = room.survival?.drops ?? [];
      const live = new Set<string>();
      for (const d of list) {
        live.add(d.id);
        let drop = drops.get(d.id);
        if (!drop) {
          drop = { group: makeDrop(), phase: (hashId(d.id) % 628) / 100 };
          group.add(drop.group);
          drops.set(d.id, drop);
        }
        const g = drop.group;
        g.position.set(d.x, d.y + 0.5 + Math.sin(now / 1000 * 2.2 + drop.phase) * 0.08, d.z);
        g.rotation.y = now / 1000 * 1.3 + drop.phase;
      }
      if (drops.size !== live.size)
        for (const [id, drop] of drops)
          if (!live.has(id)) {
            drop.group.removeFromParent();
            drops.delete(id);
          }
    },
    /** Мишени живых зомби для лучей выстрела (попадание, маркер, краска). */
    meshes() {
      const out: T.Mesh[] = [];
      for (const f of figures.values()) if (f.diedAt === null) out.push(f.hitbox);
      return out;
    },
    /** Группа живого зомби по id участника — для маркера попадания и краски на теле. */
    groupOf(id: string) {
      const f = figures.get(id);
      return f && f.diedAt === null ? f.root : undefined;
    },
    /** Настройка «Кровь и жестокость»: прячет кровь, но не самих зомби — они противники. */
    setGore(on: boolean) {
      goreOn = on;
      stainsGroup.visible = on;
    },
    dispose() {
      disposed = true;
      for (const f of Array.from(figures.values())) retire(f);
      for (const s of stains) s.mesh.removeFromParent();
      stains.length = 0;
      for (const d of drops.values()) d.group.removeFromParent();
      drops.clear();
      group.removeFromParent();
      hitGeo.dispose();
      hitMat.dispose();
      barBackMat.dispose();
      barFillMat.dispose();
      stainGeo.dispose();
      stainMat.dispose();
      for (const t of stainTextures) t.dispose();
      kitGeo.dispose();
      kitMat.dispose();
      crossGeo.dispose();
      crossMat.dispose();
      // Исходные сцены файлов: геометрия и материалы, общие для всех клонов.
      for (const p of sources.values())
        void p.then((gltf) => {
          gltf?.scene.traverse((o) => {
            if (!(o instanceof T.Mesh)) return;
            o.geometry.dispose();
            for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
              for (const v of Object.values(mat)) if (v instanceof T.Texture) v.dispose();
              mat.dispose();
            }
          });
        });
      sources.clear();
    },
  };
}
