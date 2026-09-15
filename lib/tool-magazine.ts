import { WEAPONS, type Blaster } from './weapon-definition.ts';
export type { Blaster } from './weapon-definition.ts';
export const CAPACITY: Record<Blaster, number> = {
  paint: WEAPONS.paint.capacity,
  confetti: WEAPONS.confetti.capacity,
  sniper: WEAPONS.sniper.capacity,
  like: WEAPONS.like.capacity,
};
export type MagazineSnapshot = {
  rounds: Record<Blaster, number>;
  loading: { tool: Blaster; start: number; end: number } | null;
  lastShot: number | null;
};
/** The same state machine runs on the authority and for immediate local prediction. */
export class ToolMagazine {
  rounds: Record<Blaster, number> = { ...CAPACITY };
  private loading: { tool: Blaster; start: number; end: number } | null = null;
  private lastShot = -Infinity;
  tick(now: number) {
    if (this.loading && now >= this.loading.end) {
      this.rounds[this.loading.tool] = CAPACITY[this.loading.tool];
      this.loading = null;
      return true;
    }
    return false;
  }
  reload(tool: Blaster, now: number) {
    if (this.loading || this.rounds[tool] === CAPACITY[tool]) return false;
    this.loading = {
      tool,
      start: now,
      end: now + WEAPONS[tool].reload,
    };
    return true;
  }
  progress(now: number) {
    return this.loading
      ? Math.min(
          1,
          Math.max(
            0,
            (now - this.loading.start) /
              (this.loading.end - this.loading.start),
          ),
        )
      : 0;
  }
  get reloading() {
    return this.loading !== null;
  }
  cancel() {
    this.loading = null;
  }
  snapshot(): MagazineSnapshot {
    return { rounds: { ...this.rounds }, loading: this.loading && { ...this.loading },
      lastShot: Number.isFinite(this.lastShot) ? this.lastShot : null };
  }
  restore(state: MagazineSnapshot, offset = 0) {
    this.rounds = { ...state.rounds };
    this.loading = state.loading && { ...state.loading,
      start: state.loading.start + offset, end: state.loading.end + offset };
    this.lastShot = state.lastShot === null ? -Infinity : state.lastShot + offset;
  }
  fire(tool: Blaster, now: number) {
    this.tick(now);
    const cooldown = WEAPONS[tool].cooldown;
    if (this.loading || now - this.lastShot < cooldown) return false;
    if (!this.rounds[tool]) {
      this.reload(tool, now);
      return false;
    }
    this.rounds[tool]--;
    this.lastShot = now;
    return true;
  }
}
