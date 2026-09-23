// Память бота «Предателя»: кого и где он видел. Отдельно от мозга (lib/impostor-bot.ts), потому
// что это ровно то место, где бот должен быть похож на человека, а не на камеру наблюдения.
//
// Человек не записывает всё подряд. Он замечает не каждого, кто попал в поле зрения: дальнего и
// стоящего в стороне легко пропустить, особенно когда занят своим делом или погас свет. Запомнив,
// он помнит не координаты, а «кто и примерно где»: место плывёт, время сдвигается, а отсек в
// памяти может оказаться соседним. Издалека и в темноте можно перепутать человека с похожим —
// вблизи при свете уже нет. Всё это выцветает: свежее помнится уверенно, старое превращается в
// «вроде кто-то там был», а потом забывается совсем. И помещается в голову лишь несколько встреч.
//
// Поэтому бот ошибается: обвиняет не того, путает отсек, забывает важное. Это не баг, а то, из-за
// чего с ним интересно спорить на собрании.
import { zoneOf } from './impostor-bot-talk.ts';
import type { GameMap } from './maps/types.ts';

export type Glimpse = {
  /** Кого, как кажется боту, он видел: при ошибке опознания — другой человек. */
  who: string;
  /** Отсек, каким он запомнился (может оказаться соседним); '' — коридоры. */
  zone: string;
  /** Место, каким оно запомнилось: с погрешностью тем большей, чем дальше был человек. */
  x: number;
  z: number;
  /** Время, каким оно запомнилось: со сдвигом. */
  at: number;
  /** Насколько крепко это запомнилось в момент встречи, 0…1. */
  strength: number;
  /** Разглядел ли, кто это: вблизи и при свете — да, издалека и в темноте — нет. */
  sure: boolean;
};

/** Насколько человек забывчив и внимателен. Числа — из уровня бота (lib/impostor-bot-levels.ts). */
export type MemoryRules = {
  /** Сколько живёт воспоминание, мс. */
  memory: number;
  /** Доля замеченных встреч вблизи; с расстоянием шанс падает. */
  attention: number;
  /** Вероятность перепутать человека, когда лица не разглядеть. */
  mixUp: number;
  /** Сколько встреч помещается в голове. */
  capacity: number;
};

/** Ближе этого и при свете человека узнают точно, м. */
const SURE_RANGE = 6;
/** Слабее этого воспоминание не вспоминается вовсе. */
const FADED = 0.15;
/** Одна и та же встреча в том же отсеке не запоминается заново, если прошло меньше этого, мс. */
const SAME_MEETING_MS = 6000;

/** Сколько осталось от воспоминания через `age` мс: свежее — как было, старое тает всё быстрее. */
export function recalled(strength: number, age: number, memory: number) {
  if (age <= 0) return strength;
  const k = Math.min(1, age / memory);
  return strength * Math.max(0, 1 - k * k * (3 - 2 * k));
}

/** Цвет как три числа: по ним ищем, на кого похож человек, которого не разглядели. */
function rgb(color: string) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return null;
  const n = parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** На кого из `others` похож `color` — на того и можно перепутать. */
export function lookAlike(color: string, others: { id: string; color: string }[]) {
  const a = rgb(color);
  let best: string | null = null,
    closest = Infinity;
  for (const other of others) {
    const b = rgb(other.color);
    // Без цвета сравнивать нечего: такой кандидат просто чуть менее вероятен, чем похожий.
    const d = a && b ? (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 : 200_000;
    if (d < closest) {
      closest = d;
      best = other.id;
    }
  }
  return best;
}

export class BotMemory {
  private glimpses: Glimpse[] = [];
  private rules: MemoryRules;
  private random: () => number;

  constructor(rules: MemoryRules, random: () => number) {
    this.rules = rules;
    this.random = random;
  }

  setRules(rules: MemoryRules) {
    this.rules = rules;
  }

  forget() {
    this.glimpses = [];
  }

  /**
   * Бот посмотрел вокруг и увидел человека. Вернёт true, если встреча отложилась в памяти.
   *
   * `busy` — бот занят пультом и смотрит на мини-игру; `dark` — авария со светом.
   * `others` нужны, чтобы было с кем перепутать того, кого не разглядели.
   */
  see(
    now: number,
    who: string,
    at: { x: number; z: number },
    ctx: {
      map: GameMap;
      from: { x: number; z: number };
      range: number;
      busy?: boolean;
      dark?: boolean;
      others: { id: string; color: string }[];
    },
  ) {
    const distance = Math.hypot(ctx.from.x - at.x, ctx.from.z - at.z);
    const closeness = Math.max(0, 1 - distance / Math.max(1, ctx.range));
    // Замечают в первую очередь тех, кто рядом; занятый делом — вдвое реже.
    const notice = this.rules.attention * (0.35 + 0.65 * closeness) * (ctx.busy ? 0.5 : 1) * (ctx.dark ? 0.6 : 1);
    if (this.random() > notice) return false;

    const sure = distance <= SURE_RANGE && !ctx.dark;
    let name = who;
    if (!sure && this.random() < this.rules.mixUp) {
      const similar = lookAlike(ctx.others.find((o) => o.id === who)?.color ?? '', ctx.others.filter((o) => o.id !== who));
      if (similar) name = similar;
    }
    // Место плывёт тем сильнее, чем дальше человек; отсек берём из того места, какое запомнилось.
    const blur = 0.5 + distance * 0.25;
    const x = at.x + (this.random() * 2 - 1) * blur;
    const z = at.z + (this.random() * 2 - 1) * blur;
    const strength = Math.min(1, (sure ? 0.7 : 0.45) + 0.3 * closeness);
    const drift = (this.random() * 2 - 1) * (400 + 1600 * (1 - strength));
    const zone = zoneOf(ctx.map, { x, z });

    // Тот же человек в том же отсеке пару минут спустя — не новая встреча, а та же самая,
    // только запомнившаяся крепче: в памяти она одна, «он был там-то».
    const same = this.glimpses.find((g) => g.who === name && g.zone === zone && now - g.at < SAME_MEETING_MS);
    if (same) {
      same.at = now + drift;
      same.x = x;
      same.z = z;
      same.strength = Math.min(1, same.strength + 0.15);
      same.sure = same.sure || sure;
      return true;
    }
    this.glimpses.push({ who: name, zone, x, z, at: now + drift, strength, sure });
    this.tidy(now);
    return true;
  }

  /** Забыть выцветшее и лишнее: в голове помещается лишь несколько встреч. */
  private tidy(now: number) {
    this.glimpses = this.glimpses.filter((g) => recalled(g.strength, now - g.at, this.rules.memory) > FADED);
    if (this.glimpses.length <= this.rules.capacity) return;
    // Забывается сначала самое слабое: тусклое старое, мельком увиденное.
    this.glimpses.sort((a, b) => recalled(b.strength, now - b.at, this.rules.memory) - recalled(a.strength, now - a.at, this.rules.memory));
    this.glimpses.length = this.rules.capacity;
  }

  /** Что бот сейчас может вспомнить: `sureness` — насколько он в этом уверен, 0…1. */
  recall(now: number): (Glimpse & { sureness: number })[] {
    this.tidy(now);
    return this.glimpses.map((g) => ({
      ...g,
      sureness: recalled(g.strength, now - g.at, this.rules.memory) * (g.sure ? 1 : 0.75),
    }));
  }

  /** Последнее, что помнит о живых рядом: кого назвать в алиби («рядом был такой-то»). */
  latest(now: number, alive: (id: string) => boolean, within = 12_000) {
    let best: (Glimpse & { sureness: number }) | null = null;
    for (const g of this.recall(now)) {
      if (!alive(g.who) || now - g.at > within || g.sureness < 0.4) continue;
      if (!best || g.at > best.at) best = g;
    }
    return best;
  }
}
