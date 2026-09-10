import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type SkinMeta = {
  id: string;
  name: string;
  icon: string;
  description: string;
};

export const AVATAR_SKINS: SkinMeta[] = [
  { id: 'classic', name: 'Классика', icon: '👤', description: 'Базовый блочный стиль' },
  { id: 'agent', name: 'Агент AERO', icon: '🕶️', description: 'Тактический агент с гарнитурой' },
  { id: 'ninja', name: 'Ниндзя', icon: '🥷', description: 'Скрытный синоби с парными катанами' },
  { id: 'cyber', name: 'Киберпанк', icon: '🤖', description: 'Неоновый визор и кибернетический экзоскелет' },
  { id: 'knight', name: 'Рыцарь', icon: '🛡️', description: 'Стальные латы, наплечники и шлем с гребнем' },
  { id: 'hazmat', name: 'Химзащита', icon: '☣️', description: 'Защитный костюм с кислородными баллонами' },
  { id: 'cosmo', name: 'Космонавт', icon: '🚀', description: 'Скафандр с купольным шлемом и ранцем' },
];

export const PRESET_BANDANA_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#10b981',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#14b8a6',
  '#f8fafc',
];

/**
 * Attaches the 5 custom skin accessory sets and the customizable bandana to the avatar rig.
 */
export function attachCustomSkins(avatar: T.Group): {
  dispose: () => void;
  bandanaMat: T.MeshStandardMaterial;
} {
  const head = avatar.getObjectByName('head') as T.Group | undefined;
  const chest = avatar.getObjectByName('chest') as T.Group | undefined;
  if (!head || !chest) return { dispose: () => {}, bandanaMat: new T.MeshStandardMaterial() };

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

  // ===================== BANDANA (All skins can wear) =====================
  const bandanaGroup = new T.Group();
  bandanaGroup.name = 'avatar-bandana';
  // Headband strip around forehead (head dimensions are approx 0.44 x 0.46 x 0.42)
  const band = new T.Mesh(new RoundedBoxGeometry(0.48, 0.08, 0.44, 2, 0.015), bandanaMat);
  band.position.set(0, 0.1, 0.01);
  bandanaGroup.add(band);

  // Knot and two trailing tails on back of head
  const knot = new T.Mesh(new T.SphereGeometry(0.04, 8, 6), bandanaMat);
  knot.position.set(0, 0.1, -0.22);
  bandanaGroup.add(knot);

  for (const side of [-1, 1]) {
    const tail = new T.Mesh(new RoundedBoxGeometry(0.045, 0.18, 0.015, 2, 0.005), bandanaMat);
    tail.position.set(side * 0.04, 0.01, -0.23);
    tail.rotation.z = side * 0.25;
    tail.rotation.x = -0.15;
    bandanaGroup.add(tail);
  }
  head.add(bandanaGroup);

  // ===================== 1. NINJA / SHINOBI =====================
  const ninjaHead = new T.Group();
  ninjaHead.name = 'skin-ninja-head';
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

  const ninjaChest = new T.Group();
  ninjaChest.name = 'skin-ninja-chest';
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
  const cyberHead = new T.Group();
  cyberHead.name = 'skin-cyber-head';
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

  const cyberChest = new T.Group();
  cyberChest.name = 'skin-cyber-chest';
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
  const knightHead = new T.Group();
  knightHead.name = 'skin-knight-head';
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

  const knightChest = new T.Group();
  knightChest.name = 'skin-knight-chest';
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
  const hazmatHead = new T.Group();
  hazmatHead.name = 'skin-hazmat-head';
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

  const hazmatChest = new T.Group();
  hazmatChest.name = 'skin-hazmat-chest';
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
  const cosmoHead = new T.Group();
  cosmoHead.name = 'skin-cosmo-head';
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

  const cosmoChest = new T.Group();
  cosmoChest.name = 'skin-cosmo-chest';
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

  return {
    dispose: () => materials.forEach((m) => m.dispose()),
    bandanaMat,
  };
}

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

  const isNinja = skinId === 'ninja';
  const isCyber = skinId === 'cyber';
  const isKnight = skinId === 'knight';
  const isHazmat = skinId === 'hazmat';
  const isCosmo = skinId === 'cosmo';
  const isAgent = skinId === 'agent' || (!isNinja && !isCyber && !isKnight && !isHazmat && !isCosmo && skinId !== 'classic');

  avatar.traverse((o) => {
    if (o.name === 'skin-ninja-head' || o.name === 'skin-ninja-chest') o.visible = isNinja;
    if (o.name === 'skin-cyber-head' || o.name === 'skin-cyber-chest') o.visible = isCyber;
    if (o.name === 'skin-knight-head' || o.name === 'skin-knight-chest') o.visible = isKnight;
    if (o.name === 'skin-hazmat-head' || o.name === 'skin-hazmat-chest') o.visible = isHazmat;
    if (o.name === 'skin-cosmo-head' || o.name === 'skin-cosmo-chest') o.visible = isCosmo;
    if (o.name === 'agent-skin') o.visible = isAgent;
  });
}
