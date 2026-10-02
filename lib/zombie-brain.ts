// Мозг зомби режима «Выживание»: чует ближайшего выжившего, идёт к нему по сетке
// проходимости и кусает вплотную. Живёт в сервере комнаты (worker/room-hub.ts) и
// ходит через те же ворота, что бот и человек: шаг проходит `applyPresence`
// (скорость, стены), укус считает lib/room-hub-core.ts. Зомби не стреляет и не
// прячется — его сила в числе, а не в уме, поэтому мозг нарочно проще BotBrain.
import type { HubMember, HubState } from './room-hub-core.ts';
import { stanceHeight, type GameMap } from './maps/types.ts';
import { isBlocked3D, rayCastWorldObstacle } from './world-collision.ts';
import { navFor, type NavGrid } from './bot-brain.ts';
import { isZombieId, ZOMBIES, type ZombieKind } from './survival.ts';
import { ONLINE_MS } from './model.ts';

/** Радиус тела для своих проверок: с запасом к серверным 0.25. */
const BODY_RADIUS = 0.32;
/** Подъём выше этого шагом не берётся; обрыв глубже — не прыгаем. */
const CLIMB = 0.55;
const FALL = 3.5;
/** Пересматривать цель и маршрут не чаще, мс: толпа в двадцать голов — это десять тактов в секунду. */
const RETARGET_MS = 500;
const REPLAN_MS = 1500;
/** Цель ушла от конца маршрута дальше этого — маршрут устарел. */
const PATH_DRIFT = 4;
/** Залипание: хотел идти, а за это время сдвинулся меньше чем на STUCK_DIST. */
const STUCK_MS = 1500;
const STUCK_DIST = 0.3;
/** Без цели зомби бредёт к последнему месту, где кого-то чуял, или стоит. */
const WANDER_SPEED = 0.6;

type Point = { x: number; z: number };
type PathNode = { x: number; z: number; y: number; crouch: boolean };

export type ZombieContext = { state: HubState; map: GameMap; now: number };
export type ZombiePresence = {
  life: number;
  ping: number;
  pose: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    stance: 'stand';
    moving: boolean;
    speed: number;
    forward: number;
    strafe: number;
    pitch: number;
    tool?: string;
  };
};
export type ZombieTurn = { presence: ZombiePresence; bite?: string };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Yaw взгляда из точки a в точку b: вперёд — это (−sin yaw, −cos yaw), как у игрока. */
const yawTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(-(bx - ax), -(bz - az));

export class ZombieBrain {
  readonly id: string;
  readonly kind: ZombieKind;
  private readonly random: () => number;
  /** Своя скорость: толпа идёт не в ногу. */
  private readonly speed: number;
  private readonly reach: number;
  private readonly sight: number;
  private mapId = '';
  private nav: NavGrid | null = null;
  private lastStepAt = 0;
  private yaw = 0;
  private moving = false;
  private next: { x: number; y: number; z: number } | null = null;
  private target = '';
  private targetAt = 0;
  private lastSeen: Point | null = null;
  private path: PathNode[] | null = null;
  private pathIndex = 0;
  private pathGoal: Point | null = null;
  private pathAt = 0;
  private slideTurn = 0;
  private slideUntil = 0;
  private slideSign: number;
  private stuckAnchor: Point | null = null;
  private stuckAt = 0;
  private wantMove = false;

  constructor(id: string, kind: ZombieKind, random: () => number = Math.random) {
    this.id = id;
    this.kind = kind;
    this.random = random;
    const rules = ZOMBIES[kind];
    this.speed = rules.speed * (0.9 + random() * 0.25);
    this.reach = rules.reach;
    this.sight = rules.sight;
    this.slideSign = random() < 0.5 ? 1 : -1;
    this.yaw = random() * Math.PI * 2;
  }

  /** Один такт: куда шагнуть и кого кусать. Пакет присутствия сервер проверит, как у человека. */
  think(ctx: ZombieContext, me: HubMember): ZombieTurn {
    const { now, map } = ctx;
    const dt = clamp(this.lastStepAt ? (now - this.lastStepAt) / 1000 : 0.1, 0.02, 0.4);
    this.lastStepAt = now;
    if (map.id !== this.mapId) {
      this.mapId = map.id;
      this.nav = navFor(map);
      this.path = null;
    }
    this.next = null;
    this.moving = false;
    this.wantMove = false;
    let bite: string | undefined;
    const victim = this.pickTarget(ctx, me);
    const z = ctx.state.survival.zombies[this.id];
    if (victim) {
      const p = victim.pose;
      const dist = Math.hypot(p.x - me.pose.x, p.z - me.pose.z);
      this.lastSeen = { x: p.x, z: p.z };
      this.yaw = this.turn(yawTo(me.pose.x, me.pose.z, p.x, p.z), dt, 6);
      if (dist <= this.reach && Math.abs(p.y - me.pose.y) < 1.8) {
        this.path = null;
        if (z && now >= z.attackAt) bite = victim.id;
      } else this.navigate(ctx, me, dt, { x: p.x, z: p.z });
    } else if (this.lastSeen && Math.hypot(this.lastSeen.x - me.pose.x, this.lastSeen.z - me.pose.z) > 2) {
      // Никого не чует — бредёт туда, где кто-то был.
      this.navigate(ctx, me, dt, this.lastSeen, WANDER_SPEED / this.speed);
    }
    this.trackStuck(now, me);
    const pos = this.next ?? me.pose;
    const biting = !!z && now < z.biteUntil;
    return {
      presence: {
        life: me.life,
        ping: 0,
        pose: {
          x: r3(pos.x),
          y: r3(pos.y),
          z: r3(pos.z),
          yaw: r3(this.yaw),
          stance: 'stand',
          moving: this.moving,
          speed: r3(this.moving ? this.speed : 0),
          forward: this.moving ? 1 : 0,
          strafe: 0,
          pitch: 0,
          ...(biting || bite ? { tool: 'bite' } : {}),
        },
      },
      bite,
    };
  }

  /** Ближайший живой выживший в пределах чутья; стены не мешают — зомби идёт на запах. */
  private pickTarget(ctx: ZombieContext, me: HubMember): HubMember | null {
    const { now, state } = ctx;
    const current = this.target ? state.members.get(this.target) : undefined;
    const alive = (m: HubMember | undefined): m is HubMember =>
      !!m && !isZombieId(m.id) && m.hp > 0 && m.seen > now - ONLINE_MS;
    if (alive(current) && now < this.targetAt + RETARGET_MS) return current;
    this.targetAt = now;
    let best: HubMember | null = null;
    let bestD = this.sight;
    for (const m of state.members.values()) {
      if (!alive(m)) continue;
      const d = Math.hypot(m.pose.x - me.pose.x, m.pose.z - me.pose.z);
      // Нынешнюю цель держим, пока другая не оказалась заметно ближе: иначе зомби
      // между двумя игроками дёргался бы туда-сюда.
      if (d < bestD * (m.id === this.target ? 1.3 : 1)) {
        bestD = m.id === this.target ? d / 1.3 : d;
        best = m;
      }
    }
    this.target = best?.id ?? '';
    return best;
  }

  private turn(to: number, dt: number, rate: number) {
    const diff = wrapAngle(to - this.yaw);
    const step = rate * dt;
    return wrapAngle(this.yaw + clamp(diff, -step, step));
  }

  private replan(now: number, me: HubMember, goal: Point) {
    const nav = this.nav;
    if (!nav) return null;
    this.pathAt = now;
    this.pathGoal = { ...goal };
    this.pathIndex = 0;
    // По прямой проходимо — маршрут не нужен: это и есть большинство случаев в поле.
    if (nav.clearLine(me.pose.x, me.pose.z, me.pose.y, goal.x, goal.z)) {
      this.path = [{ x: goal.x, z: goal.z, y: me.pose.y, crouch: false }];
      return this.path;
    }
    this.path = nav.find(me.pose.x, me.pose.z, goal.x, goal.z);
    return this.path;
  }

  private navigate(ctx: ZombieContext, me: HubMember, dt: number, goal: Point, scale = 1) {
    const { now } = ctx;
    const pos = me.pose;
    const stale =
      !this.path ||
      !this.pathGoal ||
      Math.hypot(this.pathGoal.x - goal.x, this.pathGoal.z - goal.z) > PATH_DRIFT ||
      now - this.pathAt > REPLAN_MS;
    if (stale && !this.replan(now, me, goal)) {
      // Пути нет (цель на крыше или за забором без прохода) — ломимся напрямую: упрёмся
      // в стену и будем топтаться у неё, как и положено зомби.
      this.walk(ctx, me, dt, goal.x - pos.x, goal.z - pos.z, scale);
      return;
    }
    const path = this.path as PathNode[];
    let node = path[this.pathIndex];
    while (node && Math.hypot(node.x - pos.x, node.z - pos.z) < 0.8) {
      this.pathIndex++;
      node = path[this.pathIndex];
    }
    if (!node) {
      this.path = null;
      this.walk(ctx, me, dt, goal.x - pos.x, goal.z - pos.z, scale);
      return;
    }
    this.walk(ctx, me, dt, node.x - pos.x, node.z - pos.z, scale);
  }

  /** Шаг в сторону (dirX, dirZ) с обходом препятствий: та же проверка стен, что у сервера. */
  private walk(ctx: ZombieContext, me: HubMember, dt: number, dirX: number, dirZ: number, scale: number) {
    const { now, map } = ctx;
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-3) return;
    this.wantMove = true;
    const from = me.pose;
    const ux = dirX / len;
    const uz = dirZ / len;
    const step = this.speed * scale * dt;
    // Выбранный обход держим полсекунды, но прямой путь пробуем первым: иначе
    // удачный обход «держал» бы сам себя, и зомби уходил бы по дуге в сторону.
    const held = now < this.slideUntil ? this.slideTurn : 0;
    const turns = held ? [0, held, held * 1.8, -held] : [0, 0.4, -0.4, 0.9, -0.9, 1.4, -1.4];
    const [low, high] = map.heightRange ?? [0, 10];
    for (const turn of turns) {
      const a = held ? turn : turn * (turn ? this.slideSign : 1);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const nx = from.x + (ux * cos - uz * sin) * step;
      const nz = from.z + (ux * sin + uz * cos) * step;
      const ground = map.groundHeight(nx, nz, from.y);
      if (ground - from.y > CLIMB || from.y - ground > FALL) continue;
      const ny = clamp(ground, low, high);
      if (isBlocked3D(nx, nz, ny, BODY_RADIUS, stanceHeight('stand'), map.colliders)) continue;
      const h = Math.min(0.9, stanceHeight('stand') / 2);
      const wall = rayCastWorldObstacle([from.x, from.y + h, from.z], [nx, ny + h, nz], map.colliders);
      if (wall && wall.hit) continue;
      this.next = { x: nx, y: ny, z: nz };
      this.moving = true;
      // Идёт лицом по ходу, если не смотрит на жертву.
      if (!this.target) this.yaw = this.turn(yawTo(from.x, from.z, nx, nz), dt, 5);
      if (a) {
        this.slideTurn = a;
        this.slideUntil = now + 500;
      } else this.slideUntil = 0;
      return;
    }
    this.slideSign = -this.slideSign;
    this.slideUntil = 0;
  }

  /** Залип у препятствия — забываем маршрут и пробуем обойти с другой стороны. */
  private trackStuck(now: number, me: HubMember) {
    const pos = me.pose;
    if (!this.wantMove || !this.stuckAnchor) {
      this.stuckAnchor = { x: pos.x, z: pos.z };
      this.stuckAt = now;
      return;
    }
    if (Math.hypot(pos.x - this.stuckAnchor.x, pos.z - this.stuckAnchor.z) > STUCK_DIST) {
      this.stuckAnchor = { x: pos.x, z: pos.z };
      this.stuckAt = now;
      return;
    }
    if (now - this.stuckAt < STUCK_MS) return;
    this.path = null;
    this.pathAt = 0;
    this.slideSign = -this.slideSign;
    this.slideTurn = this.slideSign * 1.2;
    this.slideUntil = now + 700;
    this.stuckAnchor = { x: pos.x, z: pos.z };
    this.stuckAt = now;
  }
}
