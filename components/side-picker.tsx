'use client';

import { useState } from 'react';
import type { Person } from '@/lib/model';
import { AvatarPreview } from './avatar-preview';
import { AVATAR_SKINS, PRESET_BANDANA_COLORS } from '@/lib/avatar-catalog';

type Side = 'red' | 'blue';

/** Что отправить на сервер по кнопке «В БОЙ»; несменившееся не присылаем. */
export type SidePick = {
  team?: Side;
  skin?: string;
  bandanaColor?: string;
};

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
 *
 * Выбор копится в компоненте и уходит на сервер одним махом по «В БОЙ»: клик по
 * карточке — это ещё не переход, иначе игрок платил бы за каждое случайное
 * нажатие (смена стороны в бою стоит жизни и очка убийства). Закрытие окна без
 * кнопки просто выбрасывает черновик — окно размонтируется вместе с ним.
 */
export function SidePicker({
  self,
  members,
  selectedSkin,
  selectedBandanaColor,
  anime,
  anonymous,
  onApply,
  onClose,
}: {
  self: Person | undefined;
  members: Person[];
  selectedSkin: string;
  selectedBandanaColor: string;
  anime: boolean;
  anonymous: boolean;
  onApply: (pick: SidePick) => void;
  onClose: () => void;
}) {
  /*
   * Пустая строка — «игрок ничего не трогал»: тогда показываем то, что стоит на
   * сервере, и оно продолжает обновляться само. Отдельного эффекта синхронизации
   * не нужно, и черновик не спорит с ответом сервера.
   */
  const [pickedTeam, setPickedTeam] = useState<Side | ''>('');
  const [pickedSkin, setPickedSkin] = useState('');
  const [pickedColor, setPickedColor] = useState('');
  const serverTeam: Side | '' =
    self?.team === 'red' || self?.team === 'blue' ? self.team : '';
  const team = pickedTeam || serverTeam;
  const skinId = pickedSkin || selectedSkin;
  const bandana = pickedColor || selectedBandanaColor;
  const teamChanged = team !== serverTeam;
  // Первый выбор стороны сервер не штрафует: уходить пока не от кого.
  const costly = teamChanged && !!serverTeam;
  const lookChanged =
    skinId !== selectedSkin || bandana !== selectedBandanaColor;
  const dirty = teamChanged || lookChanged;

  const roster = (side: Side) => members.filter((m) => m.team === side);
  const size = (side: Side) => roster(side).length;
  /**
   * Почему в сторону нельзя перейти. Сервер (balanceTeam) распределяет только
   * новичков без команды и переход не проверяет, поэтому перекос держим здесь:
   * запрещаем всё, после чего команда станет больше соперника более чем на
   * одного игрока. Считаем по составам с сервера: черновик туда ещё не попал.
   */
  const blockedBy = (side: Side): '' | 'full' | 'skew' => {
    if (serverTeam === side) return '';
    const other: Side = side === 'red' ? 'blue' : 'red';
    const after = size(side) + 1;
    const rest = size(other) - (serverTeam === other ? 1 : 0);
    if (after - rest <= 1) return '';
    return size(side) > size(other) ? 'full' : 'skew';
  };
  const mySide = SIDES.find((s) => s.team === team);
  const skin = AVATAR_SKINS.find((s) => s.id === skinId);

  const apply = () => {
    if (dirty)
      onApply({
        ...(teamChanged && team ? { team } : {}),
        ...(lookChanged ? { skin: skinId, bandanaColor: bandana } : {}),
      });
    onClose();
  };

  return (
    <div className="side-picker">
      <section className="sp-sides" aria-label="Сторона">
        {SIDES.map((side) => {
          const chosen = team === side.team;
          const block = blockedBy(side.team);
          const state = chosen
            ? serverTeam === side.team
              ? 'ВЫ ЗДЕСЬ'
              : 'ВЫБРАНО'
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
              className={`sp-side ${side.team} ${chosen ? 'is-mine' : ''} ${block ? 'is-full' : ''}`}
              style={{ '--sp-team': side.color } as React.CSSProperties}
              aria-pressed={chosen}
              /* Не disabled: карточка остаётся в фокусе, чтобы с клавиатуры
                 можно было прочитать, почему сторона недоступна. */
              aria-disabled={!!block}
              aria-label={`${side.title}, ${players(size(side.team))}. ${state}`}
              onClick={() => !chosen && !block && setPickedTeam(side.team)}
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
        {costly
          ? 'Переход посреди боя стоит жизни и одного очка убийства — иначе можно было бы бесплатно перебегать к тем, кто выигрывает.'
          : serverTeam
            ? `Ничего не уходит на сервер, пока вы не нажмёте «В БОЙ». Сейчас: ${SIDES.find((s) => s.team === serverTeam)!.title.toLowerCase()}.`
            : 'Сторона ещё не выбрана — сервер поставит вас в меньшую команду.'}
      </p>
      <section className="sp-look" aria-label="Внешний вид">
        <div className="sp-look-preview">
          <AvatarPreview
            color={mySide ? mySide.color : self?.color || '#718cdd'}
            anime={anime}
            anonymous={anonymous}
            skin={skinId}
            bandanaColor={bandana}
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
                  className={`sp-skin ${skinId === sk.id ? 'is-on' : ''}`}
                  title={sk.description}
                  aria-label={`${sk.name}. ${sk.description}`}
                  aria-pressed={skinId === sk.id}
                  onClick={() => setPickedSkin(sk.id)}
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
                  className={`sp-color ${bandana === c ? 'is-on' : ''}`}
                  style={{ background: c }}
                  title={c}
                  aria-label={'Цвет банданы ' + c}
                  aria-pressed={bandana === c}
                  onClick={() => setPickedColor(c)}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </section>
      <footer className="sp-footer">
        <span className="sp-esc">
          <kbd>Esc</kbd> отменить · <kbd>Ё</kbd> табло
        </span>
        <span className="sp-apply">
          {costly && (
            <span className="sp-cost">Цена перехода: смерть и −1 убийство</span>
          )}
          <button
            type="button"
            className={`sp-done ${dirty ? 'is-dirty' : ''}`}
            title={
              dirty
                ? 'Отправить выбор на сервер и вернуться в бой'
                : 'Ничего не изменилось — просто закрыть'
            }
            onClick={apply}
          >
            {dirty ? 'ПРИМЕНИТЬ И В БОЙ' : 'В БОЙ'}
          </button>
        </span>
      </footer>
    </div>
  );
}
