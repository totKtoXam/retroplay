import type { MagazineSnapshot, Blaster } from './tool-magazine.ts';
export type WeaponCommand = {
  id: string;
  action: 'reload' | 'cancel' | 'sync';
  tool?: Blaster;
  life?: number;
};
export type WeaponReply = {
  id: string;
  ok: boolean;
  reason?: string;
  now: number;
  life: number;
  revision: number;
  magazine: MagazineSnapshot;
};
