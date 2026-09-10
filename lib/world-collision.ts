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

// All 3D obstacle colliders combined
export const ALL_3D_COLLIDERS: BoxCollider3D[] = [
  ...CAMPUS_WALL_COLLIDERS,
  ...STATION_COLLIDERS,
];

/**
 * Returns the exact walkable ground/floor height at (x, z)
 * considering base terrain, bridge, station platforms, building floors, and stairs.
 */
export function getGroundHeight(x: number, z: number, currentY = 0): number {
  // 1. Campus Building Area (x: [-4.4, 4.4], z: [-22.4, -13.6])
  if (x >= -4.4 && x <= 4.4 && z >= -22.4 && z <= -13.6) {
    // Check if player is on the interior staircase
    // Stair extends along west wall: x in [-4.2, -2.6], z in [-20.8, -15.2]
    if (x >= -4.2 && x <= -2.6 && z >= -20.8 && z <= -15.2) {
      // 7 step intervals rising from 0.6m to 3.6m
      const stepIndex = Math.min(6, Math.max(0, Math.floor((-z - 15.2) / 0.8)));
      const stairY = 0.6 + stepIndex * 0.5;
      // If player is within stepping reach or on stairs
      if (currentY >= stairY - 0.7) {
        return stairY;
      }
    }

    // Check Floor 2: slab at y = 3.6
    // Stair opening is at x in [-4.2, -2.6], z in [-19.8, -15.2]
    const inStairOpening = x >= -4.2 && x <= -2.6 && z >= -19.8 && z <= -15.2;
    if (!inStairOpening && currentY >= 2.6) {
      return 3.6;
    }

    // Floor 1 slab: y = 0.2
    return 0.2;
  }

  // 2. Entrance canopy / porch outside front door (x in [-2.2, 2.2], z in [-13.6, -12.4])
  if (x >= -2.2 && x <= 2.2 && z >= -13.6 && z <= -12.4) {
    if (currentY >= 2.0) {
      return 2.7; // Front entrance canopy roof (jumpable from Floor 2 window!)
    }
    return 0.1; // Entrance step
  }

  // 3. Wooden Bridge over the pond (x in [-21.5, -16.5], z in [-0.5, 4.5])
  if (x >= -21.5 && x <= -16.5 && z >= -0.5 && z <= 4.5) {
    return 0.43; // Walk smoothly on the bridge planks
  }

  // 4. Station Raised Platforms
  for (const [sx, sz] of WORLD_STATIONS) {
    if (x >= sx - 3.3 && x <= sx + 3.3 && z >= sz - 1.3 && z <= sz + 3.5) {
      return 0.28;
    }
  }

  // Default ground level
  return 0.0;
}

/**
 * Returns ceiling height at (x, z, currentY) to prevent head clipping through roofs/floors.
 */
export function getCeilingHeight(x: number, z: number, currentY = 0): number {
  if (x >= -4.4 && x <= 4.4 && z >= -22.4 && z <= -13.6) {
    const inStairOpening = x >= -4.2 && x <= -2.6 && z >= -19.8 && z <= -15.2;
    // On Floor 1 below Floor 2 ceiling
    if (currentY < 3.2 && !inStairOpening) {
      return 3.5;
    }
    // On Floor 2 below roof
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
    // Check horizontal AABB overlap with player radius
    if (
      x + playerRadius > c.minX &&
      x - playerRadius < c.maxX &&
      z + playerRadius > c.minZ &&
      z - playerRadius < c.maxZ
    ) {
      // Check vertical overlap:
      // Player foot is at y, head is at y + playerHeight.
      // Collision occurs if vertical interval overlaps.
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
