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
  /**
   * Detailed model drawn in place of the plain box (components/world-interior.ts), e.g.
   * `console:wires` or `floor:tile`. Collision still uses the box itself.
   */
  art?: string;
  /** Yaw of the model's front (+z at 0), for `art` models that face somewhere. */
  yaw?: number;
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
  /** Detailed model drawn in place of the plain cylinder, as `MapBox.art`. */
  art?: string;
};
/**
 * Purely visual detail (door frame, window, pipe, wall screen): no collision, so it must
 * stay out of the way — on a wall or above head height. Front faces +z rotated by `yaw`.
 */
export type MapDecor = {
  kind: string;
  x: number;
  y: number;
  z: number;
  /** Size along the local x (width) and y (height); depth is up to the model. */
  w: number;
  h: number;
  yaw: number;
  label?: string;
};
export type MapSphere = { x: number; y: number; z: number; r: number; color: string };
export type MapWater = Bounds & { y: number; color?: string };
export type MapLight = { x: number; y: number; z: number; color: string; intensity: number; distance: number };
/** Kind of mini-game at a task station (режим «Предатель», lib/impostor.ts). */
export type TaskKind = 'wires' | 'hold' | 'calibrate' | 'code' | 'upload';
/** A place where a crewmate does a task: the player must stand within reach of (x, z). */
export type TaskStation = { id: string; kind: TaskKind; title: string; room: string; x: number; z: number };
/**
 * Sabotage of the impostor mode: `lights` cuts the crew's vision, `comms` hides task lists,
 * `reactor` and `o2` are critical — unrepaired in time, they win the game for the impostors.
 */
export type SabotageKind = 'lights' | 'comms' | 'reactor' | 'o2';
/** A panel where a sabotage is repaired; a kind may need several panels. */
export type SabotagePanel = { id: string; sabotage: SabotageKind; title: string; room: string; x: number; z: number };
/** A vent: impostors hide in it and crawl to the linked vents. Links are symmetric. */
export type MapVent = { id: string; room: string; x: number; z: number; links: string[] };
/** A named room of a map. */
export type MapZone = Bounds & { id: string; name: string };
/** The meeting table with the emergency button at its centre. */
export type MeetingPoint = { x: number; z: number; /** Seat ring radius around the table. */ seats: number };

export type ArenaDef = {
  id: string;
  title: string;
  /** Playable area; the client and the server clamp poses to exactly these bounds. */
  bounds: Bounds;
  groundColor: string;
  /**
   * The season the map is painted in (lib/season-colors.ts); other seasons recolour it
   * from there. Missing means summer.
   */
  season?: 'spring' | 'summer' | 'autumn' | 'winter';
  /** Terrain beyond the walls. */
  outsideColor?: string;
  boxes: MapBox[];
  ramps?: MapRamp[];
  cylinders?: MapCylinder[];
  spheres?: MapSphere[];
  water?: MapWater[];
  lights?: MapLight[];
  spawns: Record<Team, SpawnPoint[]>;
  /** Task stations of the impostor mode. */
  stations?: TaskStation[];
  meeting?: MeetingPoint;
  /** Named rooms, e.g. to tell a player where they are. */
  zones?: MapZone[];
  /** The whole map is indoors: no precipitation and no wind. */
  indoor?: boolean;
  /** Sabotage repair panels of the impostor mode. */
  panels?: SabotagePanel[];
  vents?: MapVent[];
  /** Visual-only details: door frames, windows, pipes. */
  decor?: MapDecor[];
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
  /** Task stations of the impostor mode; empty on other maps. */
  stations: TaskStation[];
  meeting?: MeetingPoint;
  panels: SabotagePanel[];
  vents: MapVent[];
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
    stations: def.stations ?? [],
    meeting: def.meeting,
    panels: def.panels ?? [],
    vents: def.vents ?? [],
  };
}
