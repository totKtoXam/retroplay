'use client';

import type { Person } from '@/lib/model';
import { AvatarPreview } from './avatar-preview';
import { AVATAR_SKINS, PRESET_BANDANA_COLORS } from './world-skins';

type Side = 'red' | 'blue';

/** Стороны в порядке слева направо, как на экране выбора в CS. */
const SIDES: {
  team: Side;
  mark: string;
  title: string;
  role: string;
  color: string;
}[] = [
  {
    team: 'red',
    mark: 'ШТ',
    title: 'КРАСНЫЕ',
    role: 'Штурм · давят и захватывают',
    color: '#ff5d52',
  },
  {
    team: 'blue',
    mark: 'ОБ',
    title: 'СИНИЕ',
    role: 'Оборона · держат позиции',
    color: '#5aa9ff',
  },
];

/** «1 игрок», «2 игрока», «5 игроков». */
function players(n: number) {
  const tail = n % 100 > 10 && n % 100 < 15 ? 0 : n % 10;
  return `${n} ${tail === 1 ? 'игрок' : tail > 1 && tail < 5 ? 'игрока' : 'игроков'}`;
}

/**
 * Экран выбора стороны и внешнего вида в духе CS: две крупные карточки команд
 * с составами и сетка скинов рядом с превью бойца. Ничего не делает с захватом
 * курсора: его отпускает мир, когда диалог открыт, и возвращает Esc.
 */
export function SidePicker({
  self,
  members,
  onTeam,
  selectedSkin,
  onSelectSkin,
  selectedBandanaColor,
  onBandanaColorChange,
  anime,
  anonymous,
  onClose,
}: {
  self: Person | undefined;
  members: Person[];
  onTeam: (team: Side) => void;
  selectedSkin: string;
  onSelectSkin: (skinId: string) => void;
  selectedBandanaColor: string;
  onBandanaColorChange: (color: string) => void;
  anime: boolean;
  anonymous: boolean;
  onClose: () => void;
}) {
  const roster = (team: Side) => members.filter((m) => m.team === team);
  const size = (team: Side) => roster(team).length;
  /**
   * Почему в сторону нельзя перейти. Сервер (balanceTeam) распределяет только
   * новичков без команды и переход не проверяет, поэтому перекос держим здесь:
   * запрещаем всё, после чего команда станет больше соперника более чем на
   * одного игрока.
   */
  const blockedBy = (team: Side): '' | 'full' | 'skew' => {
    if (self?.team === team) return '';
    const other: Side = team === 'red' ? 'blue' : 'red';
    const after = size(team) + 1;
    const rest = size(other) - (self?.team === other ? 1 : 0);
    if (after - rest <= 1) return '';
    return size(team) > size(other) ? 'full' : 'skew';
  };
  const mySide = SIDES.find((s) => s.team === self?.team);
  const skin = AVATAR_SKINS.find((s) => s.id === selectedSkin);

  return (
    <div className="side-picker">
      <section className="sp-sides" aria-label="Сторона">
        {SIDES.map((side) => {
          const mine = self?.team === side.team;
          const block = blockedBy(side.team);
          const state = mine
            ? 'ВЫ ЗДЕСЬ'
            : block === 'full'
              ? 'ПЕРЕПОЛНЕНА'
              : block === 'skew'
                ? 'НАРУШИТ БАЛАНС'
                : 'ВСТУПИТЬ';
          const names = roster(side.team);
          return (
            <button
              key={side.team}
              type="button"
              className={`sp-side ${side.team} ${mine ? 'is-mine' : ''} ${block ? 'is-full' : ''}`}
              style={{ '--sp-team': side.color } as React.CSSProperties}
              aria-pressed={mine}
              /* Не disabled: карточка остаётся в фокусе, чтобы с клавиатуры
                 можно было прочитать, почему сторона недоступна. */
              aria-disabled={!!block}
              aria-label={`${side.title}, ${players(size(side.team))}. ${state}`}
              onClick={() => !mine && !block && onTeam(side.team)}
            >
              <span className="sp-side-head">
                <span className="sp-side-mark" aria-hidden="true">
                  {side.mark}
                </span>
                <span className="sp-side-name">
                  <strong>{side.title}</strong>
                  <small>{side.role}</small>
                </span>
              </span>
              <span className="sp-side-count">{players(size(side.team))}</span>
              <span className="sp-side-roster">
                {names.length === 0 && <em>пока никого</em>}
                {names.slice(0, 6).map((m) => (
                  <span key={m.id} className="sp-chip">
                    {m.name}
                    {m.id === self?.id ? ' (вы)' : ''}
                  </span>
                ))}
                {names.length > 6 && (
                  <span className="sp-chip more">+{names.length - 6}</span>
                )}
              </span>
              <span className="sp-side-state">{state}</span>
            </button>
          );
        })}
      </section>
      <p className="sp-hint">
        {mySide
          ? `Смена стороны возрождает вас на спавне новой команды. Сейчас: ${mySide.title.toLowerCase()}.`
          : 'Сторона ещё не выбрана — сервер поставит вас в меньшую команду.'}
      </p>
      <section className="sp-look" aria-label="Внешний вид">
        <div className="sp-look-preview">
          <AvatarPreview
            color={mySide ? mySide.color : self?.color || '#718cdd'}
            anime={anime}
            anonymous={anonymous}
          />
          <p className="sp-look-caption">
            <strong>{skin?.name || 'Скин'}</strong>
            <small>{skin?.description || 'Выберите внешний вид бойца'}</small>
          </p>
        </div>
        <div className="sp-look-choices">
          <fieldset className="sp-group">
            <legend className="sp-subtitle">Скин</legend>
            <div className="sp-skins">
              {AVATAR_SKINS.map((sk) => (
                <button
                  key={sk.id}
                  type="button"
                  className={`sp-skin ${selectedSkin === sk.id ? 'is-on' : ''}`}
                  title={sk.description}
                  aria-label={`${sk.name}. ${sk.description}`}
                  aria-pressed={selectedSkin === sk.id}
                  onClick={() => onSelectSkin(sk.id)}
                >
                  <span className="sp-skin-icon" aria-hidden="true">
                    {sk.icon}
                  </span>
                  <span className="sp-skin-name">{sk.name}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="sp-group">
            <legend className="sp-subtitle">Цвет банданы</legend>
            <div className="sp-colors">
              {PRESET_BANDANA_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`sp-color ${selectedBandanaColor === c ? 'is-on' : ''}`}
                  style={{ background: c }}
                  title={c}
                  aria-label={'Цвет банданы ' + c}
                  aria-pressed={selectedBandanaColor === c}
                  onClick={() => onBandanaColorChange(c)}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </section>
      <footer className="sp-footer">
        <span className="sp-esc">
          <kbd>Esc</kbd> закрыть · <kbd>Ё</kbd> табло
        </span>
        <button type="button" className="sp-done" onClick={onClose}>
          В БОЙ
        </button>
      </footer>
    </div>
  );
}
