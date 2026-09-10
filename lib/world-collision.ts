/**
 * 3D World Collision, Ground Height Detection & Building Navigation
 * Provides accurate multi-floor ground detection, stair stepping,
 * 3D obstacle avoidance, and window/doorway passability.
 */

export type BoxCollider3D = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  label?: string;
};

export const WORLD_STATIONS = [
  [-9, -6],
  [9, -6],
  [-9, 9],
  [9, 9],
];

/**
 * 3D Colliders for the world.
 * Wall segments have clear gaps for doorways and windows.
 */
export const CAMPUS_WALL_COLLIDERS: BoxCollider3D[] = [
  // --- South (Front) Wall at z = -13.5 (z in [-13.7, -13.3]) ---
  // Left wall segment (x: -4.6 to -1.4)
  { minX: -4.6, maxX: -1.4, minZ: -13.7, maxZ: -13.3, minY: 0, maxY: 3.5, label: 'south-wall-left' },
  // Right wall segment (x: 1.4 to 4.6)
  { minX: 1.4, maxX: 4.6, minZ: -13.7, maxZ: -13.3, minY: 0, maxY: 3.5, label: 'south-wall-right' },
  // Door lintel above the entrance (door opening is x in [-1.4, 1.4], y in [0.2, 2.6])
  { minX: -1.4, maxX: 1.4, minZ: -13.7, maxZ: -13.3, minY: 2.6, maxY: 3.5, label: 'south-door-lintel' },

  // --- North (Back) Wall at z = -22.5 (z in [-22.7, -22.3]) ---
  // Left corner
  { minX: -4.6, maxX: -3.2, minZ: -22.7, maxZ: -22.3, minY: 0, maxY: 3.5 },
  // Center pillar
  { minX: -1.0, maxX: 1.0, minZ: -22.7, maxZ: -22.3, minY: 0, maxY: 3.5 },
  // Right corner
  { minX: 3.2, maxX: 4.6, minZ: -22.7, maxZ: -22.3, minY: 0, maxY: 3.5 },
  // Window NW sill (below opening)
  { minX: -3.2, maxX: -1.0, minZ: -22.7, maxZ: -22.3, minY: 0, maxY: 0.95 },
  // Window NW lintel (above opening)
  { minX: -3.2, maxX: -1.0, minZ: -22.7, maxZ: -22.3, minY: 2.5, maxY: 3.5 },
  // Window NE sill
  { minX: 1.0, maxX: 3.2, minZ: -22.7, maxZ: -22.3, minY: 0, maxY: 0.95 },
  // Window NE lintel
  { minX: 1.0, maxX: 3.2, minZ: -22.7, maxZ: -22.3, minY: 2.5, maxY: 3.5 },

  // --- West Wall at x = -4.5 (x in [-4.7, -4.3]) ---
  // Corner South
  { minX: -4.7, maxX: -4.3, minZ: -15.5, maxZ: -13.3, minY: 0, maxY: 3.5 },
  // Center pillar
  { minX: -4.7, maxX: -4.3, minZ: -18.5, maxZ: -17.5, minY: 0, maxY: 3.5 },
  // Corner North
  { minX: -4.7, maxX: -4.3, minZ: -22.7, maxZ: -20.5, minY: 0, maxY: 3.5 },
  // Window W1 sill & lintel (opening z: [-17.5, -15.5], y: [0.95, 2.5])
  { minX: -4.7, maxX: -4.3, minZ: -17.5, maxZ: -15.5, minY: 0, maxY: 0.95 },
  { minX: -4.7, maxX: -4.3, minZ: -17.5, maxZ: -15.5, minY: 2.5, maxY: 3.5 },
  // Window W2 sill & lintel (opening z: [-20.5, -18.5], y: [0.95, 2.5])
  { minX: -4.7, maxX: -4.3, minZ: -20.5, maxZ: -18.5, minY: 0, maxY: 0.95 },
  { minX: -4.7, maxX: -4.3, minZ: -20.5, maxZ: -18.5, minY: 2.5, maxY: 3.5 },

  // --- East Wall at x = 4.5 (x in [4.3, 4.7]) ---
  // Corner South
  { minX: 4.3, maxX: 4.7, minZ: -15.5, maxZ: -13.3, minY: 0, maxY: 3.5 },
  // Center pillar
  { minX: 4.3, maxX: 4.7, minZ: -18.5, maxZ: -17.5, minY: 0, maxY: 3.5 },
  // Corner North
  { minX: 4.3, maxX: 4.7, minZ: -22.7, maxZ: -20.5, minY: 0, maxY: 3.5 },
  // Window E1 sill & lintel
  { minX: 4.3, maxX: 4.7, minZ: -17.5, maxZ: -15.5, minY: 0, maxY: 0.95 },
  { minX: 4.3, maxX: 4.7, minZ: -17.5, maxZ: -15.5, minY: 2.5, maxY: 3.5 },
  // Window E2 sill & lintel
  { minX: 4.3, maxX: 4.7, minZ: -20.5, maxZ: -18.5, minY: 0, maxY: 0.95 },
  { minX: 4.3, maxX: 4.7, minZ: -20.5, maxZ: -18.5, minY: 2.5, maxY: 3.5 },

  // --- Floor 2 Exterior Walls & Balcony (y in [3.5, 7.0]) ---
  // South Panoramic Window / Balcony Railing (sill y: [3.5, 4.35], opening y: [4.35, 6.2])
  { minX: -4.6, maxX: 4.6, minZ: -13.7, maxZ: -13.3, minY: 3.5, maxY: 4.35, label: 'balcony-sill' },
  { minX: -4.6, maxX: 4.6, minZ: -13.7, maxZ: -13.3, minY: 6.2, maxY: 7.0, label: 'balcony-lintel' },
  // Corner posts for balcony
  { minX: -4.6, maxX: -4.2, minZ: -13.7, maxZ: -13.3, minY: 4.35, maxY: 6.2 },
  { minX: 4.2, maxX: 4.6, minZ: -13.7, maxZ: -13.3, minY: 4.35, maxY: 6.2 },

  // North Wall Floor 2
  { minX: -4.6, maxX: 4.6, minZ: -22.7, maxZ: -22.3, minY: 3.5, maxY: 4.4 },
  { minX: -4.6, maxX: 4.6, minZ: -22.7, maxZ: -22.3, minY: 6.2, maxY: 7.0 },
  { minX: -4.6, maxX: -3.2, minZ: -22.7, maxZ: -22.3, minY: 4.4, maxY: 6.2 },
  { minX: -1.0, maxX: 1.0, minZ: -22.7, maxZ: -22.3, minY: 4.4, maxY: 6.2 },
  { minX: 3.2, maxX: 4.6, minZ: -22.7, maxZ: -22.3, minY: 4.4, maxY: 6.2 },

  // West Wall Floor 2
  { minX: -4.7, maxX: -4.3, minZ: -22.7, maxZ: -13.3, minY: 3.5, maxY: 4.4 },
  { minX: -4.7, maxX: -4.3, minZ: -22.7, maxZ: -13.3, minY: 6.2, maxY: 7.0 },
  { minX: -4.7, maxX: -4.3, minZ: -15.5, maxZ: -13.3, minY: 4.4, maxY: 6.2 },
  { minX: -4.7, maxX: -4.3, minZ: -18.5, maxZ: -17.5, minY: 4.4, maxY: 6.2 },
  { minX: -4.7, maxX: -4.3, minZ: -22.7, maxZ: -20.5, minY: 4.4, maxY: 6.2 },

  // East Wall Floor 2
  { minX: 4.3, maxX: 4.7, minZ: -22.7, maxZ: -13.3, minY: 3.5, maxY: 4.4 },
  { minX: 4.3, maxX: 4.7, minZ: -22.7, maxZ: -13.3, minY: 6.2, maxY: 7.0 },
  { minX: 4.3, maxX: 4.7, minZ: -15.5, maxZ: -13.3, minY: 4.4, maxY: 6.2 },
  { minX: 4.3, maxX: 4.7, minZ: -18.5, maxZ: -17.5, minY: 4.4, maxY: 6.2 },
  { minX: 4.3, maxX: 4.7, minZ: -22.7, maxZ: -20.5, minY: 4.4, maxY: 6.2 },

  // Stairwell safety railing on Floor 2 (prevents falling into stairwell from side)
  { minX: -2.7, maxX: -2.5, minZ: -19.4, maxZ: -15.2, minY: 3.5, maxY: 4.4, label: 'stair-railing-side' },
  { minX: -4.2, maxX: -2.5, minZ: -15.3, maxZ: -15.1, minY: 3.5, maxY: 4.4, label: 'stair-railing-front' },
];

/**
 * Station board colliders and tables
 */
export const STATION_COLLIDERS: BoxCollider3D[] = WORLD_STATIONS.map(([sx, sz]) => ({
  minX: sx - 2.9,
  maxX: sx + 2.9,
  minZ: sz - 0.25,
  maxZ: sz + 0.25,
  minY: 0,
  maxY: 4.8,
  label: 'station-board',
}));

// Add station table benches
for (const [sx, sz] of WORLD_STATIONS) {
  STATION_COLLIDERS.push({
    minX: sx - 1.8,
    maxX: sx + 1.8,
    minZ: sz + 2.8,
    maxZ: sz + 3.4,
    minY: 0,
    maxY: 0.85,
    label: 'station-table',
  });
}

// Pond center boulder
STATION_COLLIDERS.push({
  minX: -20.2,
  maxX: -17.8,
  minZ: 0.8,
  maxZ: 3.2,
  minY: 0,
  maxY: 1.6,
  label: 'pond-rock',
});

// Central plaza dastarkhan table
STATION_COLLIDERS.push({
  minX: -1.4,
  maxX: 1.4,
  minZ: -11.4,
  maxZ: -8.6,
  minY: 0,
  maxY: 1.05,
  label: 'dastarkhan-table',
});

/**
 * 3D Colliders for West and East Campus Buildings.
 * Both buildings are enterable 2-story buildings with wide plaza-facing doorways,
 * panoramic windows, stairs, and 2nd floor balconies.
 */
export const SIDE_BUILDINGS_COLLIDERS: BoxCollider3D[] = [
  // ===================== WEST BUILDING (x ~ -27, z ~ -8) =====================
  // --- East Wall (Plaza entrance at x = -23.5: x in [-23.7, -23.3]) ---
  { minX: -23.7, maxX: -23.3, minZ: -17.2, maxZ: -9.5, minY: 0, maxY: 3.5, label: 'west-bldg-east-wall-n' },
  { minX: -23.7, maxX: -23.3, minZ: -6.5, maxZ: 1.2, minY: 0, maxY: 3.5, label: 'west-bldg-east-wall-s' },
  { minX: -23.7, maxX: -23.3, minZ: -9.5, maxZ: -6.5, minY: 2.6, maxY: 3.5, label: 'west-bldg-door-lintel' },

  // --- West Wall (x = -30.5: x in [-30.7, -30.3]) ---
  { minX: -30.7, maxX: -30.3, minZ: -17.2, maxZ: -15.0, minY: 0, maxY: 3.5 },
  { minX: -30.7, maxX: -30.3, minZ: -1.0, maxZ: 1.2, minY: 0, maxY: 3.5 },
  { minX: -30.7, maxX: -30.3, minZ: -15.0, maxZ: -1.0, minY: 0, maxY: 0.95 },
  { minX: -30.7, maxX: -30.3, minZ: -15.0, maxZ: -1.0, minY: 2.5, maxY: 3.5 },

  // --- North Wall (z = -17.0: z in [-17.2, -16.8]) ---
  { minX: -30.7, maxX: -28.5, minZ: -17.2, maxZ: -16.8, minY: 0, maxY: 3.5 },
  { minX: -25.5, maxX: -23.3, minZ: -17.2, maxZ: -16.8, minY: 0, maxY: 3.5 },
  { minX: -28.5, maxX: -25.5, minZ: -17.2, maxZ: -16.8, minY: 0, maxY: 0.95 },
  { minX: -28.5, maxX: -25.5, minZ: -17.2, maxZ: -16.8, minY: 2.5, maxY: 3.5 },

  // --- South Wall (z = 1.0: z in [0.8, 1.2]) ---
  { minX: -30.7, maxX: -28.5, minZ: 0.8, maxZ: 1.2, minY: 0, maxY: 3.5 },
  { minX: -25.5, maxX: -23.3, minZ: 0.8, maxZ: 1.2, minY: 0, maxY: 3.5 },
  { minX: -28.5, maxX: -25.5, minZ: 0.8, maxZ: 1.2, minY: 0, maxY: 0.95 },
  { minX: -28.5, maxX: -25.5, minZ: 0.8, maxZ: 1.2, minY: 2.5, maxY: 3.5 },

  // --- Floor 2 Exterior Walls & Balcony (y in [3.5, 7.0]) ---
  { minX: -23.7, maxX: -23.3, minZ: -17.2, maxZ: 1.2, minY: 3.5, maxY: 4.35, label: 'west-bldg-balcony-sill' },
  { minX: -23.7, maxX: -23.3, minZ: -17.2, maxZ: 1.2, minY: 6.2, maxY: 7.0, label: 'west-bldg-balcony-lintel' },
  { minX: -30.7, maxX: -30.3, minZ: -17.2, maxZ: 1.2, minY: 3.5, maxY: 4.4 },
  { minX: -30.7, maxX: -30.3, minZ: -17.2, maxZ: 1.2, minY: 6.2, maxY: 7.0 },
  { minX: -30.7, maxX: -23.3, minZ: -17.2, maxZ: -16.8, minY: 3.5, maxY: 4.4 },
  { minX: -30.7, maxX: -23.3, minZ: -17.2, maxZ: -16.8, minY: 6.2, maxY: 7.0 },
  { minX: -30.7, maxX: -23.3, minZ: 0.8, maxZ: 1.2, minY: 3.5, maxY: 4.4 },
  { minX: -30.7, maxX: -23.3, minZ: 0.8, maxZ: 1.2, minY: 6.2, maxY: 7.0 },

  // ===================== EAST BUILDING (x ~ 27, z ~ -8) =====================
  // --- West Wall (Plaza entrance at x = 23.5: x in [23.3, 23.7]) ---
  { minX: 23.3, maxX: 23.7, minZ: -17.2, maxZ: -9.5, minY: 0, maxY: 3.5, label: 'east-bldg-west-wall-n' },
  { minX: 23.3, maxX: 23.7, minZ: -6.5, maxZ: 1.2, minY: 0, maxY: 3.5, label: 'east-bldg-west-wall-s' },
  { minX: 23.3, maxX: 23.7, minZ: -9.5, maxZ: -6.5, minY: 2.6, maxY: 3.5, label: 'east-bldg-door-lintel' },

  // --- East Wall (x = 30.5: x in [30.3, 30.7]) ---
  { minX: 30.3, maxX: 30.7, minZ: -17.2, maxZ: -15.0, minY: 0, maxY: 3.5 },
  { minX: 30.3, maxX: 30.7, minZ: -1.0, maxZ: 1.2, minY: 0, maxY: 3.5 },
  { minX: 30.3, maxX: 30.7, minZ: -15.0, maxZ: -1.0, minY: 0, maxY: 0.95 },
  { minX: 30.3, maxX: 30.7, minZ: -15.0, maxZ: -1.0, minY: 2.5, maxY: 3.5 },

  // --- North Wall (z = -17.0: z in [-17.2, -16.8]) ---
  { minX: 23.3, maxX: 25.5, minZ: -17.2, maxZ: -16.8, minY: 0, maxY: 3.5 },
  { minX: 28.5, maxX: 30.7, minZ: -17.2, maxZ: -16.8, minY: 0, maxY: 3.5 },
  { minX: 25.5, maxX: 28.5, minZ: -17.2, maxZ: -16.8, minY: 0, maxY: 0.95 },
  { minX: 25.5, maxX: 28.5, minZ: -17.2, maxZ: -16.8, minY: 2.5, maxY: 3.5 },

  // --- South Wall (z = 1.0: z in [0.8, 1.2]) ---
  { minX: 23.3, maxX: 25.5, minZ: 0.8, maxZ: 1.2, minY: 0, maxY: 3.5 },
  { minX: 28.5, maxX: 30.7, minZ: 0.8, maxZ: 1.2, minY: 0, maxY: 3.5 },
  { minX: 25.5, maxX: 28.5, minZ: 0.8, maxZ: 1.2, minY: 0, maxY: 0.95 },
  { minX: 25.5, maxX: 28.5, minZ: 0.8, maxZ: 1.2, minY: 2.5, maxY: 3.5 },

  // --- Floor 2 Exterior Walls & Balcony (y in [3.5, 7.0]) ---
  { minX: 23.3, maxX: 23.7, minZ: -17.2, maxZ: 1.2, minY: 3.5, maxY: 4.35, label: 'east-bldg-balcony-sill' },
  { minX: 23.3, maxX: 23.7, minZ: -17.2, maxZ: 1.2, minY: 6.2, maxY: 7.0, label: 'east-bldg-balcony-lintel' },
  { minX: 30.3, maxX: 30.7, minZ: -17.2, maxZ: 1.2, minY: 3.5, maxY: 4.4 },
  { minX: 30.3, maxX: 30.7, minZ: -17.2, maxZ: 1.2, minY: 6.2, maxY: 7.0 },
  { minX: 23.3, maxX: 30.7, minZ: -17.2, maxZ: -16.8, minY: 3.5, maxY: 4.4 },
  { minX: 23.3, maxX: 30.7, minZ: -17.2, maxZ: -16.8, minY: 6.2, maxY: 7.0 },
  { minX: 23.3, maxX: 30.7, minZ: 0.8, maxZ: 1.2, minY: 3.5, maxY: 4.4 },
  { minX: 23.3, maxX: 30.7, minZ: 0.8, maxZ: 1.2, minY: 6.2, maxY: 7.0 },
];

// All 3D obstacle colliders combined
export const ALL_3D_COLLIDERS: BoxCollider3D[] = [
  ...CAMPUS_WALL_COLLIDERS,
  ...SIDE_BUILDINGS_COLLIDERS,
  ...STATION_COLLIDERS,
];

/**
 * Returns the exact walkable ground/floor height at (x, z)
 * considering base terrain, bridge, station platforms, building floors, and stairs.
 * Also checks tops of solid obstacles so player can cleanly land on tables/rocks/walls.
 */
export function getGroundHeight(x: number, z: number, currentY = 0): number {
  let baseGround = 0.0;

  // 1. Central Campus Building Area (x: [-4.7, 4.7], z: [-22.7, -13.3])
  if (x >= -4.7 && x <= 4.7 && z >= -22.7 && z <= -13.3) {
    // Check if player is on the interior staircase
    // Continuous smooth incline ramp rising from 0.2m to 3.6m as -z goes from 15.2 to 20.8
    if (x >= -4.2 && x <= -2.6 && z >= -20.8 && z <= -15.2) {
      const progress = Math.max(0, Math.min(1, (-z - 15.2) / 5.6));
      const stairY = 0.2 + progress * 3.4;
      if (currentY >= stairY - 0.7) {
        baseGround = Math.max(baseGround, stairY);
      }
    }

    // Check Floor 2: slab at y = 3.6 with floor-level hysteresis
    // Stair opening is at x in [-4.2, -2.6], z in [-20.8, -15.2]
    const inStairOpening = x >= -4.2 && x <= -2.6 && z >= -20.8 && z <= -15.2;
    if (!inStairOpening && currentY >= 2.2) {
      baseGround = Math.max(baseGround, 3.6);
    } else if (baseGround < 0.2) {
      // Floor 1 slab: y = 0.2
      baseGround = 0.2;
    }
  }

  // 2. West Campus Building (x: [-30.5, -23.5], z: [-17.0, 1.0])
  else if (x >= -30.5 && x <= -23.5 && z >= -17.0 && z <= 1.0) {
    // Interior stairs along west wall: x in [-30.2, -28.4], z in [-15.5, -9.5]
    if (x >= -30.2 && x <= -28.4 && z >= -15.5 && z <= -9.5) {
      const progress = Math.max(0, Math.min(1, (-z - 9.5) / 6.0));
      const stairY = 0.2 + progress * 3.4;
      if (currentY >= stairY - 0.7) {
        baseGround = Math.max(baseGround, stairY);
      }
    }

    const inStairOpening = x >= -30.2 && x <= -28.4 && z >= -15.5 && z <= -9.5;
    if (!inStairOpening && currentY >= 2.2) {
      baseGround = Math.max(baseGround, 3.6);
    } else if (baseGround < 0.2) {
      baseGround = 0.2;
    }
  }

  // 3. East Campus Building (x: [23.5, 30.5], z: [-17.0, 1.0])
  else if (x >= 23.5 && x <= 30.5 && z >= -17.0 && z <= 1.0) {
    // Interior stairs along east wall: x in [28.4, 30.2], z in [-15.5, -9.5]
    if (x >= 28.4 && x <= 30.2 && z >= -15.5 && z <= -9.5) {
      const progress = Math.max(0, Math.min(1, (-z - 9.5) / 6.0));
      const stairY = 0.2 + progress * 3.4;
      if (currentY >= stairY - 0.7) {
        baseGround = Math.max(baseGround, stairY);
      }
    }

    const inStairOpening = x >= 28.4 && x <= 30.2 && z >= -15.5 && z <= -9.5;
    if (!inStairOpening && currentY >= 2.2) {
      baseGround = Math.max(baseGround, 3.6);
    } else if (baseGround < 0.2) {
      baseGround = 0.2;
    }
  }

  // 4. Central Entrance canopy / porch outside front door (x in [-2.2, 2.2], z in [-13.6, -12.4])
  else if (x >= -2.2 && x <= 2.2 && z >= -13.6 && z <= -12.4) {
    if (currentY >= 2.0) {
      baseGround = 2.7; // Front entrance canopy roof (jumpable from Floor 2 window!)
    } else {
      baseGround = 0.1; // Entrance step
    }
  }

  // 5. Wooden Bridge over the pond (x in [-21.5, -16.5], z in [-0.5, 4.5])
  else if (x >= -21.5 && x <= -16.5 && z >= -0.5 && z <= 4.5) {
    baseGround = 0.43; // Walk smoothly on the bridge planks
  }

  // 6. Station Raised Platforms
  else {
    for (const [sx, sz] of WORLD_STATIONS) {
      if (x >= sx - 3.3 && x <= sx + 3.3 && z >= sz - 1.3 && z <= sz + 3.5) {
        baseGround = 0.28;
        break;
      }
    }
  }

  // 7. Check landing surfaces on top of solid obstacle colliders (tables, rocks, railings, walls)
  // When a player jumps from above, allow landing cleanly on top of obstacles without getting stuck inside
  let obstacleTop = 0.0;
  for (const c of ALL_3D_COLLIDERS) {
    if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) {
      if (currentY >= c.maxY - 0.6) {
        if (c.maxY > obstacleTop) {
          obstacleTop = c.maxY;
        }
      }
    }
  }

  return Math.max(baseGround, obstacleTop);
}

/**
 * Returns ceiling height at (x, z, currentY) to prevent head clipping through roofs/floors.
 */
export function getCeilingHeight(x: number, z: number, currentY = 0): number {
  // Central Campus Building
  if (x >= -4.7 && x <= 4.7 && z >= -22.7 && z <= -13.3) {
    const inStairOpening = x >= -4.2 && x <= -2.6 && z >= -19.5 && z <= -15.2;
    if (currentY < 3.2 && !inStairOpening) {
      return 3.5;
    }
    return 6.8;
  }

  // West Campus Building
  if (x >= -30.5 && x <= -23.5 && z >= -17.0 && z <= 1.0) {
    const inStairOpening = x >= -30.2 && x <= -28.4 && z >= -15.5 && z <= -9.5;
    if (currentY < 3.2 && !inStairOpening) {
      return 3.5;
    }
    return 6.8;
  }

  // East Campus Building
  if (x >= 23.5 && x <= 30.5 && z >= -17.0 && z <= 1.0) {
    const inStairOpening = x >= 28.4 && x <= 30.2 && z >= -15.5 && z <= -9.5;
    if (currentY < 3.2 && !inStairOpening) {
      return 3.5;
    }
    return 6.8;
  }

  return Number.POSITIVE_INFINITY;
}

/**
 * Checks if a 3D bounding capsule/cylinder at (x, z, y) collides with any solid obstacle.
 */
export function isBlocked3D(
  x: number,
  z: number,
  y: number,
  playerRadius = 0.32,
  playerHeight = 1.8,
  colliders: BoxCollider3D[] = ALL_3D_COLLIDERS,
): boolean {
  for (const c of colliders) {
    // If player's feet are essentially on top of this collider (within 0.1m of maxY),
    // they are walking ON TOP of it, not colliding horizontally with its vertical face.
    if (y >= c.maxY - 0.1) {
      continue;
    }

    // Check horizontal AABB overlap with player radius
    if (
      x + playerRadius > c.minX &&
      x - playerRadius < c.maxX &&
      z + playerRadius > c.minZ &&
      z - playerRadius < c.maxZ
    ) {
      // Check vertical overlap:
      // Player foot is at y, head is at y + playerHeight.
      // Small step buffer (0.35m) allows walking over minor floor transitions.
      const feetY = y + 0.35;
      const headY = y + playerHeight - 0.05;
      if (headY > c.minY && feetY < c.maxY) {
        return true;
      }
    }
  }
  return false;
}
