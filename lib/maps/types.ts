// Game maps. The hub keeps its own hand-built scene and collision (lib/world-collision.ts);
// team-battle maps are declarative ArenaDefs: one list of boxes, ramps, cylinders and water
// from which both the scene (components/world-arena-scene.ts) and the collision are built,
// so what players see and what blocks them cannot drift apart.
import type { BoxCollider3D } from '../world-collision.ts';

export type Stance = 'stand' | 'sit' | 'lie';
/** Body height for collisions: crouching ('sit') and lying fit through low openings. */
export const STANCE_HEIGHT: Record<Stance, number> = { stand: 1.8, sit: 1.2, lie: 0.6 };
export const stanceHeight = (stance?: string) => STANCE_HEIGHT[stance as Stance] ?? 1.8;

export type Team = 'red' | 'blue';
export type SpawnPoint = { x: number; z: number; y?: number; yaw?: number };
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Axis-aligned box given by its centre (x, y, z) and size (w along x, h along y, d along z). */
export type MapBox = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: string;
  /** Blocks movement and shots (walls, furniture, hedges). */
  solid?: boolean;
  /** Walkable top surface (floor slab, balcony); its underside is a ceiling. */
  floor?: boolean;
};
/** Sloped walkway: height goes from y0 at `from` to y1 at `to` along `axis`. */
export type MapRamp = Bounds & {
  axis: 'x' | 'z';
  from: number;
  to: number;
  y0: number;
  y1: number;
  color: string;
};
export type MapCylinder = {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
  color: string;
  /** Blocks as its bounding box. */
  solid?: boolean;
  sides?: number;
};
export type MapSphere = { x: number; y: number; z: number; r: number; color: string };
export type MapWater = Bounds & { y: number; color?: string };
export type MapLight = { x: number; y: number; z: number; color: string; intensity: number; distance: number };

export type ArenaDef = {
  id: string;
  title: string;
  /** Playable area; keep it inside |x|, |z| <= 36 (the server clamps poses there). */
  bounds: Bounds;
  groundColor: string;
  /** Terrain beyond the walls. */
  outsideColor?: string;
  boxes: MapBox[];
  ramps?: MapRamp[];
  cylinders?: MapCylinder[];
  spheres?: MapSphere[];
  water?: MapWater[];
  lights?: MapLight[];
  spawns: Record<Team, SpawnPoint[]>;
};

export type GameMap = {
  id: string;
  title: string;
  bounds: Bounds;
  colliders: BoxCollider3D[];
  /** Walkable height under (x, z) for a body whose feet are at `y`. */
  groundHeight: (x: number, z: number, y?: number) => number;
  /** Lowest ceiling above feet at `y` (Infinity: open sky). */
  ceilingHeight: (x: number, z: number, y?: number) => number;
  spawns: Record<Team, SpawnPoint[]>;
  /** Set for declarative maps; the hub builds its own scene. */
  arena?: ArenaDef;
};

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const within = (c: Bounds, x: number, z: number) =>
  x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ;

export const boxCollider = (b: MapBox, label?: string): BoxCollider3D => ({
  minX: b.x - b.w / 2,
  maxX: b.x + b.w / 2,
  minZ: b.z - b.d / 2,
  maxZ: b.z + b.d / 2,
  minY: b.y - b.h / 2,
  maxY: b.y + b.h / 2,
  label,
});

/** Height of a ramp at (x, z). */
export const rampHeight = (r: MapRamp, x: number, z: number) =>
  r.y0 + (r.y1 - r.y0) * clamp01(((r.axis === 'x' ? x : z) - r.from) / (r.to - r.from));

/** Four solid walls just inside `bounds`. */
export function perimeterWalls(b: Bounds, height = 4, thickness = 0.6, color = '#8a8f98'): MapBox[] {
  const w = b.maxX - b.minX,
    d = b.maxZ - b.minZ,
    t = thickness,
    y = height / 2;
  return [
    { x: (b.minX + b.maxX) / 2, y, z: b.minZ + t / 2, w, h: height, d: t, color, solid: true },
    { x: (b.minX + b.maxX) / 2, y, z: b.maxZ - t / 2, w, h: height, d: t, color, solid: true },
    { x: b.minX + t / 2, y, z: (b.minZ + b.maxZ) / 2, w: t, h: height, d, color, solid: true },
    { x: b.maxX - t / 2, y, z: (b.minZ + b.maxZ) / 2, w: t, h: height, d, color, solid: true },
  ];
}

/** Collision for a declarative map. Base ground is y = 0 everywhere. */
export function buildArena(def: ArenaDef): GameMap {
  const colliders: BoxCollider3D[] = [
    ...def.boxes.filter((b) => b.solid).map((b) => boxCollider(b)),
    ...(def.cylinders ?? [])
      .filter((c) => c.solid)
      .map((c) => ({
        minX: c.x - c.r,
        maxX: c.x + c.r,
        minZ: c.z - c.r,
        maxZ: c.z + c.r,
        minY: c.y - c.h / 2,
        maxY: c.y + c.h / 2,
      })),
  ];
  const floors = def.boxes.filter((b) => b.floor).map((b) => boxCollider(b));
  const ramps = def.ramps ?? [];
  const groundHeight = (x: number, z: number, y = 0) => {
    let ground = 0;
    for (const r of ramps) {
      if (!within(r, x, z)) continue;
      const h = rampHeight(r, x, z);
      if (y >= h - 0.7) ground = Math.max(ground, h);
    }
    for (const f of floors) if (within(f, x, z) && y >= f.maxY - 0.7) ground = Math.max(ground, f.maxY);
    // Tops of furniture and walls can be landed on, as in the hub.
    for (const c of colliders) if (within(c, x, z) && y >= c.maxY - 0.6) ground = Math.max(ground, c.maxY);
    return ground;
  };
  const ceilingHeight = (x: number, z: number, y = 0) => {
    let ceiling = Number.POSITIVE_INFINITY;
    for (const c of [...floors, ...colliders])
      if (within(c, x, z) && c.minY >= y + 0.3) ceiling = Math.min(ceiling, c.minY);
    return ceiling;
  };
  return {
    id: def.id,
    title: def.title,
    bounds: def.bounds,
    colliders,
    groundHeight,
    ceilingHeight,
    spawns: def.spawns,
    arena: def,
  };
}
