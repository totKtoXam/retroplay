import { ZONES } from '../lib/model';
import { makeGrenade, setGrenadeStyle, partyGeometry } from './party-geometry';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createFirstPersonHands(camera: T.Camera) {
  const group = new T.Group();
  group.name = 'first-person-hands';
  camera.add(group);
  const weapon = new T.Group();
  group.add(weapon);
  const metal = new T.MeshStandardMaterial({
    color: '#d1dcd7',
    metalness: 0.72,
    roughness: 0.28,
    depthTest: false,
  });
  const grip = new T.MeshStandardMaterial({
    color: '#131a20',
    roughness: 0.86,
    depthTest: false,
  });
  const sleeve = new T.MeshStandardMaterial({
    color: '#263d49',
    roughness: 0.9,
    depthTest: false,
  });
  const skin = new T.MeshStandardMaterial({
    color: '#bd8c68',
    roughness: 0.8,
    depthTest: false,
  });
  const accent = new T.MeshStandardMaterial({
    color: '#ed646d',
    metalness: 0.5,
    roughness: 0.31,
    depthTest: false,
  });
  const paint = new T.MeshStandardMaterial({
    color: '#aa86f6',
    roughness: 0.3,
    metalness: 0.2,
    depthTest: false,
  });
  const gold = new T.MeshStandardMaterial({
    color: '#f5c358',
    metalness: 0.85,
    roughness: 0.2,
    depthTest: false,
  });
  const lensGlow = new T.MeshBasicMaterial({
    color: '#64d4ef',
    depthTest: false,
  });

  const paintGun = new T.Group();
  paintGun.name = 'paint-launcher';
  weapon.add(paintGun);

  const shotgun = new T.Group();
  weapon.add(shotgun);

  const sniperRifle = new T.Group();
  weapon.add(sniperRifle);

  const likeBlaster = new T.Group();
  weapon.add(likeBlaster);

  const part = (
    geo: T.BufferGeometry,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
    parent: T.Group = weapon,
  ) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.renderOrder = 1000;
    m.raycast = () => {};
    parent.add(m);
    return m;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
    parent: T.Group = weapon,
  ) => part(new RoundedBoxGeometry(w, h, d, 2, 0.018), mat, x, y, z, parent);
  const barrel = (
    r: number,
    length: number,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
    parent: T.Group = weapon,
  ) => {
    const m = part(new T.CylinderGeometry(r, r, length, 16), mat, x, y, z, parent);
    m.rotation.x = Math.PI / 2;
    return m;
  };

  // --- 1. PAINT GUN MESH ---
  box(0.15, 0.14, 0.45, metal, 0, 0, -0.15, paintGun);
  barrel(0.044, 0.29, metal, 0, 0.025, -0.48, paintGun);
  barrel(0.055, 0.06, accent, 0, 0.025, -0.64, paintGun);
  box(0.055, 0.035, 0.29, grip, 0, 0.09, -0.15, paintGun);
  for (let i = 0; i < 7; i++)
    box(0.075, 0.012, 0.012, metal, 0, 0.11, -0.26 + i * 0.037, paintGun);
  box(0.08, 0.2, 0.1, grip, 0, -0.14, -0.02, paintGun).rotation.x = -0.2;
  const hopper = part(
    new RoundedBoxGeometry(0.05, 0.045, 0.2, 2, 0.008),
    paint,
    0.077,
    0.01,
    -0.15,
    paintGun,
  );
  hopper.scale.setScalar(1);
  const cartridge = box(0.085, 0.18, 0.11, grip, 0, -0.12, -0.23, paintGun);

  // --- 2. CONFETTI SHOTGUN MESH ---
  box(0.16, 0.16, 0.42, metal, 0, 0.01, -0.14, shotgun);
  box(0.165, 0.07, 0.24, gold, 0, 0.01, -0.14, shotgun);
  barrel(0.052, 0.44, metal, 0, 0.05, -0.52, shotgun);
  barrel(0.044, 0.40, grip, 0, -0.03, -0.50, shotgun);
  barrel(0.062, 0.07, accent, 0, 0.05, -0.73, shotgun);
  const shotgunPump = box(0.12, 0.10, 0.22, grip, 0, -0.03, -0.41, shotgun);
  for (let s = 0; s < 3; s++) {
    const shellMat = s === 0 ? accent : s === 1 ? paint : gold;
    const shell = part(
      new T.CylinderGeometry(0.018, 0.018, 0.075, 12),
      shellMat,
      -0.088,
      0.02 - s * 0.038,
      -0.12,
      shotgun,
    );
    shell.rotation.z = Math.PI / 2;
  }
  const bead = part(new T.SphereGeometry(0.014, 8, 8), gold, 0, 0.11, -0.71, shotgun);
  bead.scale.setScalar(1);

  // --- 3. SNIPER RIFLE MESH ---
  box(0.11, 0.13, 0.52, grip, 0, 0.01, -0.12, sniperRifle);
  barrel(0.032, 0.76, metal, 0, 0.035, -0.68, sniperRifle);
  box(0.068, 0.058, 0.09, metal, 0, 0.035, -1.05, sniperRifle);
  barrel(0.046, 0.38, grip, 0, 0.145, -0.18, sniperRifle);
  barrel(0.062, 0.08, metal, 0, 0.145, -0.37, sniperRifle);
  barrel(0.058, 0.06, metal, 0, 0.145, 0.03, sniperRifle);
  box(0.022, 0.09, 0.03, metal, 0, 0.07, -0.13, sniperRifle);
  box(0.022, 0.09, 0.03, metal, 0, 0.07, -0.23, sniperRifle);
  const sniperLens = part(
    new T.CylinderGeometry(0.038, 0.038, 0.015, 16),
    lensGlow,
    0,
    0.145,
    -0.38,
    sniperRifle,
  );
  sniperLens.rotation.x = Math.PI / 2;
  box(0.075, 0.18, 0.09, grip, 0, -0.13, -0.01, sniperRifle).rotation.x = -0.25;
  const sniperMag = box(0.065, 0.16, 0.13, grip, 0, -0.13, -0.18, sniperRifle);
  const sniperBolt = box(0.022, 0.022, 0.06, metal, 0.062, 0.045, -0.06, sniperRifle);
  const turretTop = barrel(0.018, 0.035, gold, 0, 0.198, -0.18, sniperRifle);
  turretTop.rotation.x = 0;
  const turretSide = barrel(0.018, 0.035, gold, 0.055, 0.145, -0.18, sniperRifle);
  turretSide.rotation.z = Math.PI / 2;
  box(0.065, 0.16, 0.13, grip, 0, -0.13, -0.18, sniperRifle);

  // Like Blaster (Лайкомёт) parts
  box(0.08, 0.14, 0.26, accent, 0, 0.02, -0.14, likeBlaster);
  barrel(0.038, 0.22, gold, 0, 0.045, -0.28, likeBlaster);
  barrel(0.048, 0.04, metal, 0, 0.045, -0.39, likeBlaster);
  const likeHeartCrystal = part(partyGeometry('hearts'), accent, 0, 0.105, -0.16, likeBlaster);
  likeHeartCrystal.scale.setScalar(0.7);
  box(0.065, 0.15, 0.09, grip, 0, -0.11, -0.05, likeBlaster).rotation.x = -0.2;
  const likeMag = barrel(0.03, 0.12, lensGlow, 0, -0.07, -0.17, likeBlaster);
  likeMag.rotation.x = 0;

  // Arms and sleeves (attached to shared weapon group)
  barrel(0.08, 0.28, sleeve, 0.07, -0.23, 0.17).rotation.z = -0.14;
  box(0.1, 0.12, 0.14, skin, 0.055, -0.12, 0.03).rotation.z = -0.15;
  barrel(0.075, 0.34, sleeve, -0.21, -0.21, -0.08).rotation.y = -0.85;
  box(0.12, 0.09, 0.16, skin, -0.09, -0.09, -0.25);
  for (let i = 0; i < 4; i++)
    box(0.024, 0.06, 0.045, skin, -0.069 + i * 0.026, -0.055, -0.29);
  const tablet = new T.Group();
  group.add(tablet);
  const frame = new T.Mesh(
    new RoundedBoxGeometry(0.48, 0.34, 0.024, 2, 0.018),
    grip,
  );
  tablet.add(frame);
  const screen = new T.Mesh(
    new T.PlaneGeometry(0.435, 0.285),
    new T.MeshBasicMaterial({ color: '#91c3c3', depthTest: false }),
  );
  screen.position.z = 0.014;
  tablet.add(screen);
  for (let i = 0; i < 3; i++) {
    const card = new T.Mesh(
      new RoundedBoxGeometry(0.112, 0.16, 0.006, 1, 0.006),
      new T.MeshBasicMaterial({
        color: ['#fff0c9', '#e3b6b0', '#deedf0'][i],
        depthTest: false,
      }),
    );
    card.position.set(-0.143 + i * 0.143, -0.016, 0.022);
    tablet.add(card);
    for (let j = 0; j < 3; j++) {
      const line = new T.Mesh(new T.BoxGeometry(0.077, 0.005, 0.003), grip);
      line.position.set(-0.143 + i * 0.143, 0.025 - j * 0.021, 0.027);
      tablet.add(line);
    }
  }
  tablet.rotation.x = -0.22;
  tablet.position.set(-0.1, -0.03, -0.17);
  tablet.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.renderOrder = 1001;
      o.raycast = () => {};
    }
  });

  // Sticky Note Pad model in hands
  const stickyPad = new T.Group();
  group.add(stickyPad);
  const padBack = new T.Mesh(
    new RoundedBoxGeometry(0.24, 0.26, 0.016, 2, 0.012),
    grip,
  );
  stickyPad.add(padBack);
  const padPaperStack = new T.Mesh(
    new RoundedBoxGeometry(0.21, 0.22, 0.018, 1, 0.008),
    new T.MeshBasicMaterial({ color: '#fef3c7', depthTest: false }),
  );
  padPaperStack.position.z = 0.012;
  stickyPad.add(padPaperStack);
  const padTopNote = new T.Mesh(
    new RoundedBoxGeometry(0.19, 0.20, 0.005, 1, 0.006),
    new T.MeshBasicMaterial({ color: '#8db9a1', depthTest: false }),
  );
  padTopNote.position.z = 0.022;
  stickyPad.add(padTopNote);
  const pencil = barrel(0.012, 0.22, metal, 0.13, 0, 0.015, stickyPad);
  pencil.rotation.z = Math.PI / 2;
  stickyPad.rotation.x = -0.25;
  stickyPad.position.set(-0.06, -0.06, -0.19);
  stickyPad.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.renderOrder = 1001;
      o.raycast = () => {};
    }
  });

  let recoil = 0,
    equip = 0,
    lastTool = '';
  const grenadeHands = new T.Group();
  group.add(grenadeHands);
  for (const child of weapon.children) {
    if (
      child instanceof T.Mesh &&
      [skin, sleeve].includes(child.material as T.MeshStandardMaterial)
    )
      grenadeHands.add(child.clone());
  }
  const grenade = makeGrenade('#f49fd6');
  grenade.position.set(0.03, -0.02, -0.2);
  group.add(grenade);
  grenade.traverse((o) => {
    if (o instanceof T.Mesh) {
      (o.material as T.Material).depthTest = false;
      o.renderOrder = 1001;
    }
  });
  return {
    group,
    shoot: (weaponType = 'paint') => {
      recoil =
        weaponType === 'sniper'
          ? 1.4
          : weaponType === 'confetti'
            ? 1.2
            : weaponType === 'like'
              ? 0.75
              : 0.85;
    },
    update(
      dt: number,
      time: number,
      speed: number,
      tool: string,
      color: string,
      active: boolean,
      aim: number,
      reload: number,
      variant = 'pinata',
      tabletInspect = 0,
    ) {
      group.visible = active && !(tool === 'sniper' && aim > 0.12);
      weapon.visible =
        tool === 'paint' ||
        tool === 'confetti' ||
        tool === 'sniper' ||
        tool === 'like';
      paintGun.visible = tool === 'paint';
      shotgun.visible = tool === 'confetti';
      sniperRifle.visible = tool === 'sniper' && aim <= 0.12;
      likeBlaster.visible = tool === 'like';
      tablet.visible = tool === 'pointer';
      stickyPad.visible = tool === 'sticky';
      if (lastTool !== tool) {
        lastTool = tool;
        equip = 1;
      }
      equip = Math.max(0, equip - dt * 5);
      recoil *= Math.exp(-15 * dt);

      // Multi-phase procedural reload choreography
      let reloadRotX = 0,
        reloadRotY = 0,
        reloadRotZ = 0;
      let reloadPosY = 0,
        reloadPosZ = 0;

      if (reload > 0) {
        if (reload < 0.25) {
          // Phase 1: Tilt inward and drop empty magazine
          const t1 = reload / 0.25;
          reloadRotZ = -0.42 * t1;
          reloadRotY = 0.25 * t1;
          reloadRotX = -0.15 * t1;
          reloadPosY = -0.06 * t1;
          cartridge.position.y = -0.12 - t1 * 0.24;
          sniperMag.position.y = -0.13 - t1 * 0.24;
          likeMag.position.y = -0.07 - t1 * 0.22;
        } else if (reload < 0.62) {
          // Phase 2: Insert fresh magazine and palm-slap lock
          const t2 = (reload - 0.25) / 0.37;
          reloadRotZ = -0.42 * (1 - t2 * 0.2);
          reloadRotY = 0.25;
          reloadRotX = -0.12;
          const insert = Math.min(1, t2 * 1.35);
          cartridge.position.y = -0.36 + insert * 0.24;
          sniperMag.position.y = -0.37 + insert * 0.24;
          likeMag.position.y = -0.29 + insert * 0.22;
          if (reload >= 0.52 && reload <= 0.62) {
            const slap = Math.sin(((reload - 0.52) / 0.1) * Math.PI);
            reloadPosY = slap * 0.045;
            reloadPosZ = slap * 0.03;
            reloadRotX += slap * 0.12;
          }
        } else if (reload < 0.86) {
          // Phase 3: Cocking handle / pump action / bolt cycle
          const t3 = (reload - 0.62) / 0.24;
          const rack = Math.sin(t3 * Math.PI);
          cartridge.position.y = -0.12;
          sniperMag.position.y = -0.13;
          likeMag.position.y = -0.07;
          reloadRotZ = -0.33 * (1 - t3);
          reloadRotY = 0.2 * (1 - t3);
          reloadPosZ = -rack * 0.04;
          shotgunPump.position.z = -0.41 + rack * 0.09;
          sniperBolt.position.z = -0.06 + rack * 0.07;
          sniperBolt.rotation.z = rack * 0.5;
        } else {
          // Phase 4: Smooth return to ready stance
          const t4 = (reload - 0.86) / 0.14;
          cartridge.position.y = -0.12;
          sniperMag.position.y = -0.13;
          likeMag.position.y = -0.07;
          shotgunPump.position.z = -0.41;
          sniperBolt.position.z = -0.06;
          sniperBolt.rotation.z = 0;
          const settle = Math.sin(t4 * Math.PI) * 0.015;
          reloadPosY = settle;
        }
      } else {
        cartridge.position.y = -0.12;
        sniperMag.position.y = -0.13;
        likeMag.position.y = -0.07;
        shotgunPump.position.z = -0.41;
        sniperBolt.position.z = -0.06;
        sniperBolt.rotation.z = 0;
      }

      grenade.visible = tool === 'grenade';
      grenadeHands.visible = grenade.visible;
      if (grenade.visible) setGrenadeStyle(grenade, variant, true);
      if (tool === 'sticky') {
        (padTopNote.material as T.MeshBasicMaterial).color.set(
          ZONES.find((z) => z.id === variant)?.color || '#8db9a1',
        );
      }
      if (tool === 'pointer') {
        if (tabletInspect > 0) {
          tablet.position.x = T.MathUtils.lerp(-0.1, 0, tabletInspect);
          tablet.position.y = T.MathUtils.lerp(-0.03, -0.01, tabletInspect);
          tablet.position.z = T.MathUtils.lerp(-0.17, -0.22, tabletInspect);
          tablet.rotation.x = T.MathUtils.lerp(-0.22, 0.04, tabletInspect);
          const bootColor = new T.Color('#38bdf8').lerp(
            new T.Color('#ffffff'),
            Math.min(1, tabletInspect * 1.3),
          );
          (screen.material as T.MeshBasicMaterial).color.copy(bootColor);
        } else {
          tablet.position.set(-0.1, -0.03, -0.17);
          tablet.rotation.set(-0.22, 0, 0);
          (screen.material as T.MeshBasicMaterial).color.set('#527982');
        }
      }
      paint.color.set(color);

      const targetAimY = tool === 'sniper' ? -0.145 : -0.115;
      const isItem = tool === 'pointer' || tool === 'sticky';
      const defaultX = isItem ? 0.08 : 0.28;
      const targetX =
        tabletInspect > 0
          ? T.MathUtils.lerp(defaultX, 0, tabletInspect)
          : T.MathUtils.lerp(defaultX, 0, aim);
      const targetY =
        tabletInspect > 0
          ? T.MathUtils.lerp(-0.3, -0.16, tabletInspect)
          : T.MathUtils.lerp(-0.3, targetAimY, aim);
      const targetZ =
        tabletInspect > 0
          ? T.MathUtils.lerp(-0.52, -0.38, tabletInspect)
          : -0.52 + recoil * 0.075 + reloadPosZ;

      group.position.set(
        targetX +
          Math.sin(time * speed * 2.4) *
            Math.min(speed, 0.9) *
            0.009 *
            (1 - aim * 0.9) *
            (1 - tabletInspect),
        targetY +
          Math.cos(time * speed * 4.8) *
            Math.min(speed, 1) *
            0.011 *
            (1 - aim * 0.9) *
            (1 - tabletInspect) +
          reloadPosY -
          equip * 0.22,
        targetZ,
      );
      group.rotation.set(
        recoil * 0.095 +
          equip * 0.25 +
          reloadRotX +
          (tabletInspect > 0 ? -0.15 * tabletInspect : 0),
        reloadRotY,
        reloadRotZ +
          Math.sin(time * 0.8) * 0.005 * (1 - tabletInspect),
      );
    },
  };
}
