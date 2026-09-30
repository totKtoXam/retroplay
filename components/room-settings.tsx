'use client';

import {
  Bot,
  Dices,
  Gauge,
  ListChecks,
  MousePointer2,
  ShieldCheck,
  Sun,
  Swords,
  UserRound,
} from 'lucide-react';
import { isActionKind, type Person, type Room, type RoomState } from '@/lib/model';
import type { GameMode } from '@/lib/maps/catalog';
import type { WeaponAimModes } from '@/lib/aim-settings';
import {
  AccessSection,
  BotsPanel,
  ControlsSection,
  GraphicsSection,
  ModePanel,
  ProfileSection,
  WidgetsPanel,
  WorldPanel,
} from './room-panels';
import { SettingsShell, type SettingsGroup } from './settings-shell';
import type { useRoomSync } from './use-room-sync';

type Act = ReturnType<typeof useRoomSync>['act'];

/** Двухколоночные настройки комнаты (панель «menu»): личное, встреча и правила комнаты. */
export function RoomSettings({
  room,
  s,
  me,
  host,
  gameMode,
  online,
  settingsSection,
  setSettingsSection,
  fps,
  fpsLimit,
  setFpsLimit,
  quality,
  setQuality,
  sensitivity,
  setSensitivity,
  invertCamera,
  setInvertCamera,
  aimModes,
  setAimModes,
  sound,
  changeSound,
  selectedSkin,
  setSelectedSkin,
  selectedBandanaColor,
  setSelectedBandanaColor,
  spinOptions,
  setSpinOptions,
  spinner,
  setPanel,
  changeRoomSettings,
  setPrivateWriting,
  changeAccessType,
  act,
}: {
  room: Room;
  s: RoomState;
  me: Person | undefined;
  host: boolean;
  gameMode: GameMode;
  online: Person[];
  settingsSection: string;
  setSettingsSection: (section: string) => void;
  fps: number;
  fpsLimit: number;
  setFpsLimit: (fps: number) => void;
  quality: string;
  setQuality: (quality: string) => void;
  sensitivity: number;
  setSensitivity: (value: number) => void;
  invertCamera: boolean;
  setInvertCamera: (value: boolean) => void;
  aimModes: WeaponAimModes;
  setAimModes: (next: WeaponAimModes) => void;
  sound: boolean;
  changeSound: (value: boolean) => void;
  selectedSkin: string;
  setSelectedSkin: (skin: string) => void;
  selectedBandanaColor: string;
  setSelectedBandanaColor: (color: string) => void;
  spinOptions: string;
  setSpinOptions: (options: string) => void;
  spinner: string;
  setPanel: (panel: string) => void;
  changeRoomSettings: (patch: Record<string, unknown>) => Promise<void>;
  setPrivateWriting: (next: boolean) => Promise<void>;
  changeAccessType: (accessType: 'public' | 'private') => Promise<void>;
  act: Act;
}) {
  // Сколько пунктов плана ещё не сделано — подпись раздела «План действий»
  // отвечает на вопрос «надо ли туда заходить» до того, как его открыли.
  const actionsLeft =
    s?.notes.filter((n) => isActionKind(n.kind) && !n.done).length ?? 0;
  // Разделы настроек. Личное отделено от правил комнаты: раньше они лежали в
  // одном плоском списке, и было не видно, что можешь менять ты, а что ведущий.
  // Сюда же переехали разовые действия из бывшего меню комнаты: своих входов
  // (горячих клавиш, кнопок в шапке) у них нет, и без меню они стали бы
  // недостижимы. У инвентаря и выбора стороны такие входы есть — Q / I и G, —
  // поэтому их в настройках нет.
  const settingsGroups: SettingsGroup[] = [
    {
      id: 'mine',
      title: 'Моё',
      sections: [
        {
          id: 'graphics',
          title: 'Графика',
          hint: 'Качество картинки и лимит FPS на этом устройстве',
          icon: Gauge,
        },
        {
          id: 'controls',
          title: 'Управление',
          hint: 'Мышь, камера, прицеливание и список клавиш',
          icon: MousePointer2,
        },
        {
          id: 'profile',
          title: 'Профиль',
          hint: 'Имя в комнате и звуки встречи',
          icon: UserRound,
        },
      ],
    },
    {
      id: 'meeting',
      title: 'Встреча',
      sections: [
        {
          id: 'results',
          title: 'Итоги встречи',
          hint: actionsLeft
            ? `План действий: ${actionsLeft} не сделано`
            : 'План действий, экспорт, история и завершение',
          icon: ListChecks,
        },
        {
          id: 'widgets',
          title: 'Для живой встречи',
          hint: 'Таймер, спиннер, счётчик и реакции',
          icon: Dices,
        },
      ],
    },
    {
      id: 'room',
      title: 'Комната',
      sections: [
        {
          id: 'mode',
          title: 'Режим и карта',
          hint: 'Во что играем: режим, карта и правила матча',
          icon: Swords,
          hostOnly: true,
        },
        {
          id: 'bots',
          title: 'Боты',
          hint:
            gameMode === 'impostor'
              ? s?.bots?.length
                ? `На корабле: ${s.bots.length}`
                : 'Экипаж и предатели четырёх уровней'
              : gameMode !== 'battle'
                ? 'Играют в бою и в «Предателе»'
                : s?.bots?.length
                  ? `В бою: ${s.bots.length}`
                  : 'Соперники и напарники четырёх уровней',
          icon: Bot,
          hostOnly: true,
        },
        {
          id: 'world',
          title: 'Облик мира',
          hint: 'Стиль и тема оформления',
          icon: Sun,
          hostOnly: true,
        },
        {
          id: 'access',
          title: 'Доступ и приватность',
          hint: 'Кто входит и что видно участникам',
          icon: ShieldCheck,
          hostOnly: true,
        },
      ],
    },
    // План действий, экспорт, история с отменой и завершение встречи
    // переехали в отдельную панель «Итоги» (components/room-results.tsx): её
    // открывают из шапки и кнопкой этапа. В настройках от них осталась ссылка
    // «Итоги встречи» в группе «Встреча».
  ];
  return (
    <SettingsShell
      groups={settingsGroups}
      section={settingsSection}
      onSection={setSettingsSection}
      host={host}
    >
      {settingsSection === 'graphics' && (
        <GraphicsSection
          fps={fps}
          me={me}
          fpsLimit={fpsLimit}
          onFpsLimitChange={(v) => {
            setFpsLimit(Number(v));
            localStorage.setItem('jinaly-fps-limit', v);
          }}
          quality={quality}
          onQualityChange={(q) => {
            setQuality(q);
            localStorage.setItem('jinaly-quality', q);
          }}
        />
      )}
      {settingsSection === 'controls' && (
        <ControlsSection
          mode={gameMode}
          sensitivity={sensitivity}
          onSensitivityChange={(v) => {
            setSensitivity(v);
            localStorage.setItem('jinaly-sensitivity', String(v));
          }}
          invertCamera={invertCamera}
          onInvertCameraChange={(v) => {
            setInvertCamera(v);
            localStorage.setItem('jinaly-invert-camera', String(v));
          }}
          aimModes={aimModes}
          onAimModesChange={(next) => {
            setAimModes(next);
            localStorage.setItem(
              'jinaly-aim-modes',
              JSON.stringify(next),
            );
          }}
        />
      )}
      {settingsSection === 'profile' && (
        <ProfileSection
          me={me}
          sound={sound}
          onSoundChange={changeSound}
          onUpdateName={(name) => {
            void act({ type: 'profile', name });
            localStorage.setItem('jinaly-name', name);
          }}
        />
      )}
      {settingsSection === 'mode' && (
        <ModePanel
          s={s}
          host={host}
          onSettings={(patch) => void changeRoomSettings(patch)}
        />
      )}
      {settingsSection === 'bots' && (
        <BotsPanel
          s={s}
          host={host}
          members={room.members}
          onAct={(op) => void act(op)}
        />
      )}
      {settingsSection === 'world' && (
        <WorldPanel
          s={s}
          host={host}
          onStyleChange={(visualStyle) =>
            void act({ type: 'room.settings', patch: { visualStyle } })
          }
          onThemeChange={(theme, season) =>
            void act({
              type: 'room.settings',
              patch: { theme, season },
            })
          }
          onInteriorChange={(interior) =>
            void act({ type: 'room.settings', patch: { interior } })
          }
        />
      )}
      {settingsSection === 'access' && (
        <AccessSection
          s={s}
          host={host}
          onAnonymousPlayersChange={(anonymousPlayers) =>
            void act({
              type: 'room.settings',
              patch: { anonymousPlayers },
            })
          }
          onHidePlayerStatusChange={(hidePlayerStatus) =>
            void act({
              type: 'room.settings',
              patch: { hidePlayerStatus },
            })
          }
          onPrivateWritingChange={(privateWriting) =>
            void setPrivateWriting(privateWriting)
          }
          onAnonymousChange={(anonymous) =>
            void act({ type: 'room.settings', patch: { anonymous } })
          }
          onLayoutLockedChange={(layoutLocked) =>
            void act({ type: 'room.settings', patch: { layoutLocked } })
          }
          onAccessTypeChange={(accessType) =>
            void changeAccessType(accessType)
          }
          onMaxPlayersChange={(maxPlayers) => {
            void act({ type: 'access.max_players', maxPlayers });
          }}
        />
      )}
      {settingsSection === 'results' && (
        <div className="settings-results-link">
          <p>
            План действий, экспорт, история изменений и завершение
            встречи теперь на отдельном экране — он открывается и из
            шапки, и кнопкой этапа «Итоги».
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => setPanel('results')}
          >
            <ListChecks size={16} aria-hidden="true" />
            Итоги встречи → открыть
          </button>
        </div>
      )}
      {settingsSection === 'widgets' && (
        <WidgetsPanel
          me={me}
          onMoodChange={(mood) =>
            void act({
              type: 'profile',
              mood,
            })
          }
          selectedSkin={selectedSkin}
          onSelectSkin={(skinId) => {
            setSelectedSkin(skinId);
            localStorage.setItem('jinaly-custom-skin', skinId);
            void act({
              type: 'profile',
              hat: skinId,
              color: selectedBandanaColor,
            });
          }}
          selectedBandanaColor={selectedBandanaColor}
          onBandanaColorChange={(color) => {
            setSelectedBandanaColor(color);
            localStorage.setItem('jinaly-bandana-color', color);
            void act({
              type: 'profile',
              hat: selectedSkin,
              color,
            });
          }}
          onConfetti={() =>
            void act({ type: 'event', kind: 'confetti', value: '🎉' })
          }
          onHat={() =>
            void act({ type: 'event', kind: 'hat', value: '🎩' })
          }
          onBuzzer={() => {
            changeSound(true);
            void act({ type: 'event', kind: 'buzzer' });
          }}
          onPing={() => void act({ type: 'event', kind: 'ping' })}
          s={s}
          onDecrementCounter={() =>
            void act({ type: 'counter', down: true })
          }
          onIncrementCounter={() => void act({ type: 'counter' })}
          spinOptions={spinOptions}
          onSpinOptionsChange={setSpinOptions}
          online={online}
          onSpin={(value) =>
            void act({
              type: 'event',
              kind: 'spin',
              value,
            })
          }
          spinner={spinner}
          sound={sound}
          onSoundChange={changeSound}
        />
      )}
    </SettingsShell>
  );
}
