import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Attaches the custom skin accessory sets (ninja/cyber/knight/hazmat/cosmo), the crewmate
 * suit family («Среди нас») and the customizable bandana to the avatar rig.
 */
export function attachCustomSkins(avatar: T.Group): {
  dispose: () => void;
  bandanaMat: T.MeshStandardMaterial;
  suitMat: T.MeshStandardMaterial;
} {
  const head = avatar.getObjectByName('head') as T.Group | undefined;
  const chest = avatar.getObjectByName('chest') as T.Group | undefined;
  const legL = avatar.getObjectByName('legL') as T.Group | undefined;
  const legR = avatar.getObjectByName('legR') as T.Group | undefined;
  if (!head || !chest || !legL || !legR)
    return {
      dispose: () => {},
      bandanaMat: new T.MeshStandardMaterial(),
      suitMat: new T.MeshStandardMaterial(),
    };

  const materials: T.Material[] = [];
  const trackMat = <M extends T.Material>(m: M): M => {
    materials.push(m);
    return m;
  };

  const mat = (color: string, roughness = 0.5, metalness = 0.1, emissive?: string) =>
    trackMat(
      new T.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        emissive: emissive ? emissive : '#000000',
        emissiveIntensity: emissive ? 1.0 : 0,
      }),
    );

  const bandanaMat = trackMat(
    new T.MeshStandardMaterial({
      color: '#3b82f6',
      roughness: 0.6,
      metalness: 0.05,
    }),
  );

  /**
   * Лицо рига смотрит в −Z: в createAvatar глаза и рот стоят на z ≈ −0.21. Весь этот
   * файл собран «лицом к +Z», поэтому каждый набор разворачиваем целиком — детали
   * симметричны по X, так что разворот ничего не искажает, а маски, визоры и узел
   * банданы оказываются там, где задумывались, а не на затылке.
   */
  const dressed = (name: string) => {
    const g = new T.Group();
    g.name = name;
    g.rotation.y = Math.PI;
    return g;
  };

  // ===================== BANDANA (All skins can wear) =====================
  const bandanaGroup = dressed('avatar-bandana');
  /*
   * Лента обязана быть ШИРЕ головы. Голова — это шар лица (радиусы ≈ 0.225 × 0.267 × 0.223)
   * и «шапка» причёски радиусом 0.255 поверх него; прежний брусок 0.48 × 0.44 был меньше их
   * обоих и целиком тонул внутри черепа — цвет менялся, а видно ничего не было. Кольцо
   * радиусом 0.268–0.278 садится поверх причёски, поэтому читается с любой стороны.
   */
  const band = new T.Mesh(new T.CylinderGeometry(0.268, 0.278, 0.1, 14), bandanaMat);
  band.position.set(0, 0.105, -0.02);
  bandanaGroup.add(band);

  // Knot and two trailing tails on back of head
  const knot = new T.Mesh(new T.SphereGeometry(0.055, 8, 6), bandanaMat);
  knot.position.set(0, 0.105, -0.29);
  bandanaGroup.add(knot);

  for (const side of [-1, 1]) {
    const tail = new T.Mesh(new RoundedBoxGeometry(0.05, 0.22, 0.018, 2, 0.006), bandanaMat);
    tail.position.set(side * 0.05, 0, -0.3);
    tail.rotation.z = side * 0.25;
    tail.rotation.x = -0.15;
    bandanaGroup.add(tail);
  }
  head.add(bandanaGroup);

  // ===================== 1. NINJA / SHINOBI =====================
  const ninjaHead = dressed('skin-ninja-head');
  // Cloth mouth/nose mask
  const ninjaMask = new T.Mesh(
    new RoundedBoxGeometry(0.46, 0.22, 0.22, 2, 0.02),
    mat('#18181b', 0.8),
  );
  ninjaMask.position.set(0, -0.06, 0.14);
  ninjaHead.add(ninjaMask);
  // Glowing crimson ninja eyes
  for (const side of [-1, 1]) {
    const eye = new T.Mesh(
      new RoundedBoxGeometry(0.06, 0.02, 0.01, 2, 0.004),
      mat('#ef4444', 0.2, 0.1, '#dc2626'),
    );
    eye.position.set(side * 0.1, 0.08, 0.225);
    ninjaHead.add(eye);
  }
  head.add(ninjaHead);

  const ninjaChest = dressed('skin-ninja-chest');
  // Twin crossed katanas on back
  for (const side of [-1, 1]) {
    const scabbard = new T.Mesh(
      new T.CylinderGeometry(0.026, 0.026, 0.72, 8),
      mat('#09090b', 0.4, 0.6),
    );
    scabbard.position.set(side * 0.09, 0.06, -0.22);
    scabbard.rotation.z = side * 0.52;
    ninjaChest.add(scabbard);

    // Katana gold tsuba (guard) & hilt
    const tsuba = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.015, 8), mat('#eab308', 0.3, 0.8));
    tsuba.position.set(side * 0.24, 0.38, -0.23);
    tsuba.rotation.z = side * 0.52;
    ninjaChest.add(tsuba);

    const hilt = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.22, 8), mat('#ffffff', 0.7));
    hilt.position.set(side * 0.29, 0.48, -0.23);
    hilt.rotation.z = side * 0.52;
    ninjaChest.add(hilt);
  }
  chest.add(ninjaChest);

  // ===================== 2. CYBERPUNK RUNNER =====================
  const cyberHead = dressed('skin-cyber-head');
  // Wide glowing neon visor
  const visor = new T.Mesh(
    new RoundedBoxGeometry(0.44, 0.11, 0.08, 2, 0.015),
    mat('#06b6d4', 0.1, 0.2, '#0891b2'),
  );
  visor.position.set(0, 0.06, 0.21);
  cyberHead.add(visor);
  // Tech comms headset on left side
  const comms = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.04, 12), mat('#334155', 0.3, 0.7));
  comms.position.set(-0.24, 0.04, 0.02);
  comms.rotation.z = Math.PI / 2;
  cyberHead.add(comms);
  head.add(cyberHead);

  const cyberChest = dressed('skin-cyber-chest');
  // Futuristic tech core in center of chest
  const reactor = new T.Mesh(
    new T.CylinderGeometry(0.065, 0.065, 0.03, 12),
    mat('#22d3ee', 0.1, 0.2, '#06b6d4'),
  );
  reactor.position.set(0, 0.02, 0.2);
  reactor.rotation.x = Math.PI / 2;
  cyberChest.add(reactor);
  // Glowing spine data array on back
  for (let s = 0; s < 4; s++) {
    const node = new T.Mesh(
      new RoundedBoxGeometry(0.08, 0.035, 0.02, 2, 0.005),
      mat('#06b6d4', 0.1, 0.2, '#0891b2'),
    );
    node.position.set(0, 0.12 - s * 0.09, -0.21);
    cyberChest.add(node);
  }
  chest.add(cyberChest);

  // ===================== 3. KNIGHT / PALADIN =====================
  const knightHead = dressed('skin-knight-head');
  // Steel greathelm visor
  const helmVisor = new T.Mesh(
    new RoundedBoxGeometry(0.46, 0.24, 0.2, 2, 0.02),
    mat('#94a3b8', 0.2, 0.85),
  );
  helmVisor.position.set(0, 0.02, 0.15);
  knightHead.add(helmVisor);
  // Eye slit
  const slit = new T.Mesh(new RoundedBoxGeometry(0.32, 0.022, 0.02, 2, 0.004), mat('#0f172a', 0.9));
  slit.position.set(0, 0.04, 0.25);
  knightHead.add(slit);
  // Golden plume crest on top
  const crest = new T.Mesh(
    new RoundedBoxGeometry(0.06, 0.16, 0.38, 2, 0.02),
    mat('#eab308', 0.3, 0.8),
  );
  crest.position.set(0, 0.28, 0.02);
  knightHead.add(crest);
  head.add(knightHead);

  const knightChest = dressed('skin-knight-chest');
  // Heavy shoulder pauldrons
  for (const side of [-1, 1]) {
    const pauldron = new T.Mesh(
      new RoundedBoxGeometry(0.18, 0.12, 0.26, 2, 0.03),
      mat('#94a3b8', 0.25, 0.85),
    );
    pauldron.position.set(side * 0.32, 0.15, 0);
    pauldron.rotation.z = -side * 0.25;
    knightChest.add(pauldron);
  }
  chest.add(knightChest);

  // ===================== 4. HAZMAT OPERATIVE =====================
  const hazmatHead = dressed('skin-hazmat-head');
  // Curved protective face shield
  const shield = new T.Mesh(
    new RoundedBoxGeometry(0.42, 0.28, 0.12, 2, 0.03),
    mat('#38bdf8', 0.1, 0.3, '#0284c7'),
  );
  shield.position.set(0, 0.02, 0.2);
  hazmatHead.add(shield);
  // Twin circular respirator filters
  for (const side of [-1, 1]) {
    const canister = new T.Mesh(
      new T.CylinderGeometry(0.055, 0.055, 0.04, 12),
      mat('#475569', 0.6, 0.4),
    );
    canister.position.set(side * 0.14, -0.12, 0.22);
    canister.rotation.x = Math.PI / 2;
    hazmatHead.add(canister);
  }
  head.add(hazmatHead);

  const hazmatChest = dressed('skin-hazmat-chest');
  // Twin vertical air/oxygen tanks on back
  for (const side of [-1, 1]) {
    const tank = new T.Mesh(
      new T.CylinderGeometry(0.065, 0.065, 0.46, 12),
      mat('#f59e0b', 0.4, 0.5),
    );
    tank.position.set(side * 0.1, 0.02, -0.26);
    hazmatChest.add(tank);

    // Valve caps
    const valve = new T.Mesh(new T.CylinderGeometry(0.028, 0.028, 0.05, 8), mat('#ef4444', 0.5));
    valve.position.set(side * 0.1, 0.27, -0.26);
    hazmatChest.add(valve);
  }
  chest.add(hazmatChest);

  // ===================== 5. RETRO COSMONAUT =====================
  const cosmoHead = dressed('skin-cosmo-head');
  // Spherical bubble astronaut helmet
  const bubble = new T.Mesh(
    new T.SphereGeometry(0.28, 16, 12),
    mat('#f8fafc', 0.2, 0.6),
  );
  bubble.position.set(0, 0.02, 0.06);
  cosmoHead.add(bubble);
  // Golden reflective sun visor
  const goldVisor = new T.Mesh(
    new RoundedBoxGeometry(0.38, 0.2, 0.08, 2, 0.03),
    mat('#f59e0b', 0.15, 0.9, '#b45309'),
  );
  goldVisor.position.set(0, 0.03, 0.24);
  cosmoHead.add(goldVisor);
  head.add(cosmoHead);

  const cosmoChest = dressed('skin-cosmo-chest');
  // EVA life support backpack with dual thrusters
  const lifePack = new T.Mesh(
    new RoundedBoxGeometry(0.34, 0.42, 0.16, 2, 0.02),
    mat('#f8fafc', 0.3, 0.4),
  );
  lifePack.position.set(0, 0.02, -0.26);
  cosmoChest.add(lifePack);
  // Thruster cones
  for (const side of [-1, 1]) {
    const thruster = new T.Mesh(
      new T.ConeGeometry(0.045, 0.08, 12),
      mat('#64748b', 0.4, 0.7),
    );
    thruster.position.set(side * 0.11, -0.22, -0.26);
    thruster.rotation.x = Math.PI;
    cosmoChest.add(thruster);
  }
  // Chest display panel
  const panel = new T.Mesh(
    new RoundedBoxGeometry(0.18, 0.12, 0.02, 2, 0.005),
    mat('#1e293b', 0.5),
  );
  panel.position.set(0, 0.04, 0.2);
  cosmoChest.add(panel);
  chest.add(cosmoChest);

  // ===================== 6. CREWMATE FAMILY (в духе Among Us) =====================
  /*
   * Тут вместо накладки поверх рига — целиком свой корпус: настоящее тело рига
   * (legacy-skin/agent-skin) для этих скинов гасится в applyAvatarSkin, а плоть
   * заменяет один цельный «боб». Цвет — как у банданы, тот же принцип личного/
   * командного цвета, поэтому материал так же возвращаем наружу и красим при
   * каждом applyAvatarSkin.
   */
  const suitMat = trackMat(
    new T.MeshStandardMaterial({ color: '#3b82f6', roughness: 0.55, metalness: 0.05 }),
  );
  const trimMat = mat('#7d8a99', 0.6, 0.2); // ранец и ботинки — нейтральный цвет для всех скафандров
  const visorMat = mat('#8fd6f7', 0.12, 0.4, '#2f8fc9'); // лёгкое свечение стекла визора
  const glareMat = mat('#eef8ff', 0.05, 0.1); // блик в углу визора

  // Корпус: капсула сама по себе даёт форму боба — голова и туловище одним целым.
  const crewChest = dressed('skin-crew-body-chest');
  const torso = new T.Mesh(new T.CapsuleGeometry(0.3, 0.46, 4, 12), suitMat);
  torso.scale.set(1.05, 1.05, 0.82);
  torso.position.set(0, 0.26, 0);
  torso.name = 'crew-torso';
  crewChest.add(torso);
  // Ранец на спине (локально «сзади» тут отрицательный Z — см. комментарий у dressed()).
  const backpack = new T.Mesh(new RoundedBoxGeometry(0.26, 0.32, 0.15, 2, 0.05), trimMat);
  backpack.position.set(0, 0.24, -0.32);
  crewChest.add(backpack);
  chest.add(crewChest);

  // Визор: большая скруглённая пластина спереди на голове рига, пониже и покрупнее,
  // чтобы читаться отдельной деталью, а не сливаться с бобом в шапочку на макушке.
  const crewHead = dressed('skin-crew-body-head');
  const crewVisor = new T.Mesh(new T.SphereGeometry(0.27, 16, 12), visorMat);
  crewVisor.scale.set(1.05, 0.62, 0.62);
  crewVisor.position.set(0, -0.08, 0.19);
  crewHead.add(crewVisor);
  const glare = new T.Mesh(new T.SphereGeometry(0.05, 8, 6), glareMat);
  glare.scale.set(1, 1.5, 0.4);
  glare.position.set(-0.1, -0.03, 0.235);
  crewHead.add(glare);
  head.add(crewHead);

  /*
   * Ноги-столбики: прицеплены прямо к костям бёдер (legL/legR), а не к рукам рига,
   * поэтому наследуют бедренное вращение из animateAvatar и качаются при ходьбе без
   * правок world-avatar.ts. Высота посчитана так, чтобы подошва доставала до земли:
   * бедро висит на y=0.92 над полом (см. createAvatar), капсула и ботинок в сумме
   * дают те же 0.92 — иначе персонаж парил бы или проваливался в пол.
   */
  for (const bone of [legL, legR]) {
    const leg = new T.Group();
    leg.name = 'skin-crew-body-leg';
    const stub = new T.Mesh(new T.CapsuleGeometry(0.13, 0.54, 3, 8), suitMat);
    stub.position.set(0, -0.4, 0);
    leg.add(stub);
    const boot = new T.Mesh(new RoundedBoxGeometry(0.24, 0.12, 0.3, 2, 0.035), trimMat);
    boot.position.set(0, -0.86, 0.04);
    leg.add(boot);
    bone.add(leg);
  }

  // ---- Головные уборы и костюмы поверх базового скафандра (косметика, как в Among Us) ----

  // «Капитан»: фуражка с золотой лентой и козырьком вперёд.
  const captainHead = dressed('skin-crew-captain-head');
  const crown = new T.Mesh(new T.CylinderGeometry(0.235, 0.25, 0.14, 14), mat('#1d3557', 0.5, 0.2));
  crown.position.set(0, 0.28, -0.01);
  captainHead.add(crown);
  const crownBand = new T.Mesh(new T.CylinderGeometry(0.252, 0.252, 0.045, 14), mat('#d7ae72', 0.35, 0.6));
  crownBand.position.set(0, 0.212, -0.01);
  captainHead.add(crownBand);
  const brim = new T.Mesh(new RoundedBoxGeometry(0.34, 0.02, 0.16, 2, 0.008), mat('#12233a', 0.4, 0.3));
  brim.position.set(0, 0.203, 0.17);
  captainHead.add(brim);
  head.add(captainHead);

  // «Доктор»: круглое зеркальце на налобной ленте + распахнутый халат на груди.
  // Лента сидит на верхнем крае визора (а не выше макушки), иначе выглядит нимбом.
  const doctorHead = dressed('skin-crew-doctor-head');
  const headband = new T.Mesh(new T.TorusGeometry(0.2, 0.016, 6, 16, Math.PI * 1.3), mat('#e2e8f0', 0.5));
  headband.position.set(0, 0.05, -0.02);
  headband.rotation.x = Math.PI / 2;
  doctorHead.add(headband);
  const mirrorArm = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.08, 6), mat('#94a3b8', 0.5));
  mirrorArm.position.set(0, 0.1, 0.24);
  mirrorArm.rotation.x = 0.5;
  doctorHead.add(mirrorArm);
  const mirror = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.015, 14), mat('#cbd5e1', 0.1, 0.9, '#e2e8f0'));
  mirror.position.set(0, 0.05, 0.29);
  mirror.rotation.x = Math.PI / 2;
  doctorHead.add(mirror);
  head.add(doctorHead);

  const doctorChest = dressed('skin-crew-doctor-chest');
  for (const side of [-1, 1]) {
    const lapel = new T.Mesh(new RoundedBoxGeometry(0.16, 0.34, 0.06, 2, 0.02), mat('#f8fafc', 0.7));
    lapel.position.set(side * 0.15, 0.15, 0.19);
    lapel.rotation.z = -side * 0.12;
    doctorChest.add(lapel);
  }
  const collar = new T.Mesh(new RoundedBoxGeometry(0.3, 0.1, 0.06, 2, 0.02), mat('#f8fafc', 0.7));
  collar.position.set(0, 0.36, 0.18);
  doctorChest.add(collar);
  chest.add(doctorChest);

  // «Механик»: строительная каска с гребнем и комбинезон с накладными карманами и ремнём.
  const mechHead = dressed('skin-crew-mechanic-head');
  const helmet = new T.Mesh(
    new T.SphereGeometry(0.245, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.8),
    mat('#f59e0b', 0.5, 0.15),
  );
  helmet.position.set(0, 0.19, -0.02);
  mechHead.add(helmet);
  const helmetBrim = new T.Mesh(new T.CylinderGeometry(0.27, 0.27, 0.03, 16), mat('#d97706', 0.5, 0.15));
  helmetBrim.position.set(0, 0.09, -0.02);
  mechHead.add(helmetBrim);
  const helmetRidge = new T.Mesh(new RoundedBoxGeometry(0.035, 0.16, 0.42, 2, 0.015), mat('#d97706', 0.5, 0.15));
  helmetRidge.position.set(0, 0.24, -0.02);
  mechHead.add(helmetRidge);
  head.add(mechHead);

  /*
   * Капсула боба книзу сужается почти в точку (см. комментарий у torso выше), поэтому
   * ремень и карманы посажены не на самый низ, а в цилиндрическую часть повыше — иначе
   * ремень фиксированного радиуса торчит «летающей тарелкой» на почти нулевой талии.
   */
  const mechChest = dressed('skin-crew-mechanic-chest');
  for (const side of [-1, 1]) {
    const pocket = new T.Mesh(new RoundedBoxGeometry(0.13, 0.14, 0.05, 2, 0.015), mat('#475569', 0.6, 0.2));
    pocket.position.set(side * 0.16, 0.1, 0.22);
    mechChest.add(pocket);
  }
  const belt = new T.Mesh(new T.CylinderGeometry(0.32, 0.32, 0.05, 16), mat('#334155', 0.5, 0.3));
  belt.position.set(0, 0.05, 0);
  mechChest.add(belt);
  const buckle = new T.Mesh(new RoundedBoxGeometry(0.08, 0.06, 0.02, 2, 0.008), mat('#d7ae72', 0.3, 0.7));
  buckle.position.set(0, 0.05, 0.225);
  mechChest.add(buckle);
  chest.add(mechChest);

  // «Шеф»: классический высокий поварской колпак.
  const chefHead = dressed('skin-crew-chef-head');
  const hatBase = new T.Mesh(new T.CylinderGeometry(0.19, 0.19, 0.14, 14), mat('#f8fafc', 0.6));
  hatBase.position.set(0, 0.24, -0.01);
  chefHead.add(hatBase);
  const hatPoof = new T.Mesh(new T.SphereGeometry(0.2, 14, 10), mat('#f8fafc', 0.6));
  hatPoof.scale.set(1, 0.85, 1);
  hatPoof.position.set(0, 0.42, -0.01);
  chefHead.add(hatPoof);
  head.add(chefHead);

  // «Росток»: мини-питомец на голове — стебель с двумя листьями в горшочке.
  const sproutHead = dressed('skin-crew-sprout-head');
  const pot = new T.Mesh(new T.CylinderGeometry(0.05, 0.06, 0.06, 10), mat('#78350f', 0.7));
  pot.position.set(0, 0.22, -0.02);
  sproutHead.add(pot);
  const stem = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.12, 6), mat('#4d7c2b', 0.6));
  stem.position.set(0, 0.29, -0.02);
  sproutHead.add(stem);
  for (const [x, ang] of [
    [-0.045, 0.5],
    [0.045, -0.5],
  ] as const) {
    const leaf = new T.Mesh(new T.SphereGeometry(0.05, 8, 6), mat('#65a30d', 0.5));
    leaf.scale.set(1.6, 0.5, 0.9);
    leaf.position.set(x, 0.34, -0.02);
    leaf.rotation.z = ang;
    sproutHead.add(leaf);
  }
  head.add(sproutHead);

  // «Вечеринка»: конусный колпак с ободками и помпоном.
  const partyHead = dressed('skin-crew-party-head');
  const cone = new T.Mesh(new T.ConeGeometry(0.19, 0.38, 12), mat('#f43f5e', 0.5));
  cone.position.set(0, 0.36, -0.02);
  partyHead.add(cone);
  for (let i = 0; i < 2; i++) {
    const ring = new T.Mesh(new T.TorusGeometry(0.15 - i * 0.05, 0.012, 6, 16), mat('#fde047', 0.5));
    ring.position.set(0, 0.3 + i * 0.12, -0.02);
    ring.rotation.x = Math.PI / 2;
    partyHead.add(ring);
  }
  const pompom = new T.Mesh(new T.SphereGeometry(0.045, 8, 6), mat('#fde047', 0.6));
  pompom.position.set(0, 0.55, -0.02);
  partyHead.add(pompom);
  head.add(partyHead);

  return {
    dispose: () => materials.forEach((m) => m.dispose()),
    bandanaMat,
    suitMat,
  };
}

/** Скины экипажа («Среди нас»): общий скафандр + своя косметика у каждого. */
const CREW_SKIN_IDS = new Set([
  'crewmate',
  'crew-captain',
  'crew-doctor',
  'crew-mechanic',
  'crew-chef',
  'crew-sprout',
  'crew-party',
]);

/**
 * Toggles visibility of the selected skin accessory set and updates bandana color.
 */
export function applyAvatarSkin(
  avatar: T.Group,
  skinId = 'agent',
  bandanaColor = '#3b82f6',
  bandanaMat?: T.MeshStandardMaterial,
) {
  if (bandanaMat) {
    bandanaMat.color.set(bandanaColor);
  }
  // Скафандр экипажа красится в тот же личный/командный цвет, что и бандана.
  const suitMesh = avatar.getObjectByName('crew-torso') as T.Mesh | undefined;
  const suitMat = suitMesh?.material as T.MeshStandardMaterial | undefined;
  if (suitMat) suitMat.color.set(bandanaColor);

  const isNinja = skinId === 'ninja';
  const isCyber = skinId === 'cyber';
  const isKnight = skinId === 'knight';
  const isHazmat = skinId === 'hazmat';
  const isCosmo = skinId === 'cosmo';
  const isCrew = CREW_SKIN_IDS.has(skinId);

  /*
   * Тело у аватара ровно одно из двух: блочное legacy-skin («Классика» и аниме-стиль)
   * или костюм AERO agent-skin. Ниндзя, рыцарь и прочие — это накладки ПОВЕРХ него.
   * Раньше здесь для них гасились оба тела сразу, и от бойца оставались висящие в
   * воздухе аксессуары; текущий стиль читаем по группе 'anime-detail', которую
   * переключает setAvatarStyle, чтобы не спорить с ней.
   */
  const anime = !!avatar.getObjectByName('anime-detail')?.visible;
  const legacyBody = anime || skinId === 'classic';

  avatar.traverse((o) => {
    if (o.name === 'skin-ninja-head' || o.name === 'skin-ninja-chest') o.visible = isNinja;
    if (o.name === 'skin-cyber-head' || o.name === 'skin-cyber-chest') o.visible = isCyber;
    if (o.name === 'skin-knight-head' || o.name === 'skin-knight-chest') o.visible = isKnight;
    if (o.name === 'skin-hazmat-head' || o.name === 'skin-hazmat-chest') o.visible = isHazmat;
    if (o.name === 'skin-cosmo-head' || o.name === 'skin-cosmo-chest') o.visible = isCosmo;
    if (o.name === 'skin-crew-body-chest' || o.name === 'skin-crew-body-head' || o.name === 'skin-crew-body-leg')
      o.visible = isCrew;
    if (o.name === 'skin-crew-captain-head') o.visible = skinId === 'crew-captain';
    if (o.name === 'skin-crew-doctor-head' || o.name === 'skin-crew-doctor-chest')
      o.visible = skinId === 'crew-doctor';
    if (o.name === 'skin-crew-mechanic-head' || o.name === 'skin-crew-mechanic-chest')
      o.visible = skinId === 'crew-mechanic';
    if (o.name === 'skin-crew-chef-head') o.visible = skinId === 'crew-chef';
    if (o.name === 'skin-crew-sprout-head') o.visible = skinId === 'crew-sprout';
    if (o.name === 'skin-crew-party-head') o.visible = skinId === 'crew-party';
    if (o.name === 'legacy-skin') o.visible = legacyBody;
    if (o.name === 'agent-skin') o.visible = !legacyBody;
    // Под глухим куполом скафандра и бобом экипажа ленты не видно.
    if (o.name === 'avatar-bandana') o.visible = !isCosmo && !isCrew;
  });

  /*
   * У экипажа своё цельное тело — настоящую плоть рига (руки, ноги, торс, лицо) прячем
   * ПОВЕРХ обычной логики legacy/agent выше. Оружие и планшет не трогаем намеренно:
   * 'gun' и 'tablet' — отдельные соседние узлы у локтя, а не 'legacy-skin'/'agent-skin',
   * поэтому фонарик и прочие инструменты в руках остаются на месте.
   */
  if (isCrew) {
    const bodyJoints = new Set([
      'chest',
      'unmasked-head',
      'legL',
      'legR',
      'kneeL',
      'kneeR',
      'armL',
      'armR',
      'elbowL',
      'elbowR',
    ]);
    avatar.traverse((o) => {
      if ((o.name === 'legacy-skin' || o.name === 'agent-skin') && bodyJoints.has(o.parent?.name ?? ''))
        o.visible = false;
    });
  }
}
