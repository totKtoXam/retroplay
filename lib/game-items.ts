export const PAINTS = [
  ['coral', 'Коралл', '#ff647c'],
  ['amber', 'Янтарь', '#ffb851'],
  ['lemon', 'Лимон', '#f5e879'],
  ['mint', 'Мята', '#7fe0b8'],
  ['cyan', 'Бирюза', '#64d4ef'],
  ['blue', 'Ультрамарин', '#6482ff'],
  ['violet', 'Лаванда', '#bc91f5'],
  ['pink', 'Розовый', '#f49fd6'],
].map(([id, label, color]) => ({ id, label, color, icon: '●' }));
export const CONFETTI = [
  ['classic', 'Классика', '▰', '#ffb851'],
  ['stars', 'Звёздочки', '★', '#f5e879'],
  ['snow', 'Снежки', '❄', '#c5eaff'],
  ['hearts', 'Сердечки', '♥', '#ff647c'],
  ['digital', 'Цифровое', '01', '#7fe0b8'],
  ['petals', 'Лепестки', '✿', '#f49fd6'],
  ['comets', 'Кометы', '✦', '#bc91f5'],
  ['shanyrak', 'Шаңырақ', '☀', '#ffcb65'],
].map(([id, label, icon, color]) => ({ id, label, icon, color }));
export const GRENADES = [
  ['pinata', 'Пиньята', '🪅', '#f49fd6'],
  ['paintburst', 'Взрыв красок', '◉', '#64d4ef'],
  ['snowglobe', 'Снежный шар', '❄', '#c5eaff'],
  ['heartburst', 'Валентинка', '♥', '#ff647c'],
  ['pixel', 'Пиксельная', '▦', '#7fe0b8'],
  ['meteor', 'Метеор', '✦', '#ffb851'],
].map(([id, label, icon, color]) => ({ id, label, icon, color }));
export type WheelItem = {
  id: string;
  label: string;
  color: string;
  icon: string;
};
export const effectStyle = (kind: string, value: unknown) =>
  (kind === 'grenade' ? GRENADES : CONFETTI).find((v) => v.id === value)?.id ||
  (kind === 'grenade' ? 'pinata' : 'classic');
export const effectCooldown = (kind: string) =>
  kind === 'grenade' ? 1400 : kind === 'confetti' ? 250 : 90;
export const effectDamage = (kind: string) =>
  kind === 'grenade' ? 45 : kind === 'paint' ? 20 : 5;
/** Capsule approximation, evaluated against server-stored participant positions. */
export function inHitRange(
  kind: string,
  origin: number[],
  target: number[],
  pose: { x: number; y: number; z: number; stance: string },
) {
  const center = [
    pose.x,
    pose.y + (pose.stance === 'lie' ? 0.35 : pose.stance === 'sit' ? 0.8 : 1.1),
    pose.z,
  ];
  if (kind === 'grenade')
    return Math.hypot(...center.map((v, i) => v - target[i])) < 4;
  const direction = target.map((v, i) => v - origin[i]);
  const length2 = direction.reduce((s, v) => s + v * v, 0);
  const t = Math.max(
    0,
    Math.min(
      1,
      center.reduce((s, v, i) => s + (v - origin[i]) * direction[i], 0) /
        (length2 || 1),
    ),
  );
  return (
    Math.hypot(...center.map((v, i) => v - origin[i] - t * direction[i])) < 0.8
  );
}
