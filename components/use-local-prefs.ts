'use client';

import { useCallback, useState } from 'react';
import { readAimModes, type WeaponAimModes } from '@/lib/aim-settings';
import { PREF_KEYS, readChoice, readPref, writePref } from '@/lib/user-prefs';
import { PAINTS } from '@/lib/game-items';
import { FPS_LIMITS } from './room-panels';

/** Личные настройки игрока на этом устройстве (localStorage): графика,
 *  управление, звук, краска и облик бойца. Запись — в обработчиках room-app. */
export function useLocalPrefs() {
  const [fpsLimit, setFpsLimit] = useState(60);
  const [sensitivity, setSensitivity] = useState(1),
    [invertCamera, setInvertCamera] = useState(false);
  const [aimModes, setAimModes] = useState<WeaponAimModes>(() => readAimModes());
  const [paintColor, setPaintColor] = useState('#bc91f5');
  const [quality, setQuality] = useState('balanced');
  const [sound, setSound] = useState(false);
  const [selectedSkin, setSelectedSkin] = useState<string>(() =>
    typeof localStorage !== 'undefined' ? localStorage.getItem('jinaly-custom-skin') || 'agent' : 'agent',
    ),
    [selectedBandanaColor, setSelectedBandanaColor] = useState<string>(() =>
      typeof localStorage !== 'undefined' ? localStorage.getItem('jinaly-bandana-color') || '#3b82f6' : '#3b82f6',
    );
  /** Личные настройки с этого устройства: при входе в комнату и после синхронизации с аккаунтом. */
  const loadDeviceSettings = useCallback(() => {
    const savedSensitivity = Number(
      localStorage.getItem('jinaly-sensitivity') || 1,
    );
    setSensitivity(
      Number.isFinite(savedSensitivity)
        ? Math.min(2, Math.max(0.4, savedSensitivity))
        : 1,
    );
    setInvertCamera(localStorage.getItem('jinaly-invert-camera') === 'true');
    setAimModes(readAimModes());
    const savedQuality = localStorage.getItem('jinaly-quality');
    setQuality(
      savedQuality === 'high' ? 'cinematic' : savedQuality || 'balanced',
    );
    const savedFps = Number(localStorage.getItem('jinaly-fps-limit'));
    setFpsLimit(FPS_LIMITS.includes(savedFps) ? savedFps : 60);
    setSound(readPref(PREF_KEYS.sound) === 'true');
    setPaintColor(
      readChoice(
        PREF_KEYS.paintColor,
        PAINTS.map((p) => p.color),
        '#bc91f5',
      ),
    );
  }, []);
  const changeSound = useCallback((value: boolean) => {
    setSound(value);
    writePref(PREF_KEYS.sound, String(value));
  }, []);
  const changePaintColor = useCallback((color: string) => {
    setPaintColor(color);
    writePref(PREF_KEYS.paintColor, color);
  }, []);
  return {
    fpsLimit,
    setFpsLimit,
    sensitivity,
    setSensitivity,
    invertCamera,
    setInvertCamera,
    aimModes,
    setAimModes,
    paintColor,
    quality,
    setQuality,
    sound,
    selectedSkin,
    setSelectedSkin,
    selectedBandanaColor,
    setSelectedBandanaColor,
    loadDeviceSettings,
    changeSound,
    changePaintColor,
  };
}
