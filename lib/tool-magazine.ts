export type Blaster = 'paint' | 'confetti' | 'sniper' | 'like';
export const CAPACITY: Record<Blaster, number> = {
  paint: 24,
  confetti: 6,
  sniper: 5,
  like: 12,
};
/** Локальные игровые заряды. Серверные карточки и права комнаты не затрагиваются. */
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
      end:
        now +
        (tool === 'paint'
          ? 1450
          : tool === 'confetti'
            ? 1700
            : tool === 'like'
              ? 1250
              : 1900),
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
  fire(tool: Blaster, now: number) {
    this.tick(now);
    const cooldown =
      tool === 'paint'
        ? 180
        : tool === 'confetti'
          ? 550
          : tool === 'like'
            ? 320
            : 1050;
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
