export type SkinMeta = {
  id: string;
  name: string;
  icon: string;
  description: string;
};

export const AVATAR_SKINS: SkinMeta[] = [
  { id: 'classic', name: 'Классика', icon: '👤', description: 'Базовый блочный стиль' },
  { id: 'agent', name: 'Агент AERO', icon: '🕶️', description: 'Тактический агент с гарнитурой' },
  { id: 'ninja', name: 'Ниндзя', icon: '🥷', description: 'Скрытный синоби с парными катанами' },
  { id: 'cyber', name: 'Киберпанк', icon: '🤖', description: 'Неоновый визор и кибернетический экзоскелет' },
  { id: 'knight', name: 'Рыцарь', icon: '🛡️', description: 'Стальные латы, наплечники и шлем с гребнем' },
  { id: 'hazmat', name: 'Химзащита', icon: '☣️', description: 'Защитный костюм с кислородными баллонами' },
  { id: 'cosmo', name: 'Космонавт', icon: '🚀', description: 'Скафандр с купольным шлемом и ранцем' },
  // ===== Экипаж (Among Us): общий боб-скафандр вместо тела рига, косметика — только головной убор =====
  { id: 'crewmate', name: 'Член экипажа', icon: '🫘', description: 'Скафандр-боб экипажа без опознавательных знаков' },
  { id: 'crew-captain', name: 'Капитан', icon: '🧢', description: 'Скафандр экипажа с фуражкой командира' },
  { id: 'crew-doctor', name: 'Доктор', icon: '🩺', description: 'Скафандр экипажа: зеркальце на лбу и халат поверх' },
  { id: 'crew-mechanic', name: 'Механик', icon: '🔧', description: 'Скафандр экипажа: каска и комбинезон с карманами' },
  { id: 'crew-chef', name: 'Шеф', icon: '👨‍🍳', description: 'Скафандр экипажа с поварским колпаком' },
  { id: 'crew-sprout', name: 'Росток', icon: '🌱', description: 'Скафандр экипажа с ростком-питомцем на шлеме' },
  { id: 'crew-party', name: 'Вечеринка', icon: '🥳', description: 'Скафандр экипажа с праздничным колпаком' },
];

export const PRESET_BANDANA_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#10b981',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#14b8a6',
  '#f8fafc',
];
