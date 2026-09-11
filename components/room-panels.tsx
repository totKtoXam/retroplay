'use client';

import { ChevronRight, Copy, Download, RotateCcw } from 'lucide-react';
import type { RoomAccess } from '@/lib/model';

export function HelpPanel() {
  return (
    <div className="help-copy">
      <p>
        <b>Камера:</b> кликните по миру и двигайте мышь — удерживать
        кнопки не нужно. Esc освобождает курсор для меню. Стрелки тоже
        вращают камеру. V переключает первое и третье лицо. F сбрасывает
        угол обзора. Alt + колесо меняет расстояние в третьем лице.
        Кнопка прицела включает необязательный захват мыши.
      </p>
      <p>
        <b>Краскомёт / конфетти:</b> слоты 1 и 2. ЛКМ стреляет туда,
        куда вы указываете. ПКМ — прицеливание, R — перезарядка. Краска
        исчезает через 12 секунд. Все игроки видят ваши залпы.
      </p>
      <p>
        Для игры с Ctrl + WASD включите <b>полный экран</b> кнопкой ⛶ в
        шапке: в поддерживаемом браузере игровой ввод перехватывает
        сочетания с W, A, S, D. Выход — Esc.
      </p>
      <p>
        <b>WASD</b> — движение. <b>Пробел</b> — прыжок. <b>C</b> — сесть
        / встать. <b>Дважды C</b> — лечь. <b>Ctrl</b> — присесть
        (удерживать). <b>Shift</b> — медленный шаг.
      </p>
      <p>
        <b>1–5</b> — краскомёт, дробовик, пиньято, снайперка и планшет.
        Колесо — переключение оружия, удержание колёсика — варианты снаряжения.
        <b>Q, I</b> — снаряжение. Инструменты ретро в этой панели
        сразу открывают обычную доску.
      </p>
      <p>
        <b>E</b> у доски — открыть её. <b>Ё</b> — участники и
        задержка. <b>Esc</b> — вернуть курсор.
      </p>
      <p>
        <b>На обычной доске:</b> двойной щелчок создаёт объект. Ручка в
        углу карточки позволяет перетаскивать её. Маркер рисует,
        инструмент «Связь» соединяет две выбранные карточки.
      </p>
      <p>
        В экономном режиме частота ограничена 30 FPS, со статическими
        тенями и без bloom. На устройстве без WebGL откроется обычная
        доска.
      </p>
    </div>
  );
}

export function ExportPanel({
  host,
  onExport,
  onImport,
}: {
  host: boolean;
  onExport: (format: string) => void;
  onImport: (file: File) => void;
}) {
  return (
    <>
      <div className="export-options">
        {[
          ['json', 'JSON', 'Карточки, темы и раунды голосования'],
          ['csv', 'CSV', 'Таблица для Excel и других приложений'],
          ['md', 'Markdown', 'Итоги ретроспективы текстом'],
        ].map(([format, label, sub]) => (
          <button key={format} onClick={() => onExport(format)}>
            <Download size={20} />
            <div>
              <strong>{label}</strong>
              <small>{sub}</small>
            </div>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
      {host && (
        <label className="field">
          Добавить карточки из JSON или CSV
          <input
            type="file"
            accept=".json,.csv"
            onChange={(e) => {
              if (e.target.files?.[0])
                onImport(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </label>
      )}
      <p className="muted">
        Экспорт содержит только доступные вам заметки. Импорт добавляет
        карточки к существующим, до 200 объектов за один раз.
      </p>
    </>
  );
}

export function SharePanel({
  roomId,
  access,
  host,
  onCopyLink,
  onRegenerateInvite,
}: {
  roomId: string;
  access: RoomAccess | undefined;
  host: boolean;
  onCopyLink: () => void;
  onRegenerateInvite: () => Promise<void>;
}) {
  return (
    <>
      <label className="field">
        Ссылка на комнату
        <input
          readOnly
          value={
            typeof location !== 'undefined'
              ? location.origin +
                '/room/' +
                roomId +
                (access?.type === 'private' && access.inviteToken
                  ? '?invite=' + access.inviteToken
                  : '')
              : ''
          }
          onFocus={(e) => e.target.select()}
        />
      </label>
      <div className="share-buttons">
        <button
          type="button"
          className="primary"
          onClick={() => onCopyLink()}
        >
          <Copy size={16} />
          Скопировать ссылку
        </button>
        {host && access?.type === 'private' && (
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              if (
                confirm(
                  'Создать новую ссылку-приглашение? Старая ссылка перестанет действовать.',
                )
              ) {
                await onRegenerateInvite();
              }
            }}
          >
            <RotateCcw size={16} />
            Обновить ссылку
          </button>
        )}
      </div>
      <div className="share-access-info">
        <span className={`access-badge ${access?.type || 'public'}`}>
          {access?.type === 'private'
            ? '🔒 Приватная комната'
            : '🌐 Публичная комната'}
        </span>
        <p className="muted">
          {access?.type === 'private'
            ? 'Вход только по ссылке-приглашению с подтверждением ведущего. Комната скрыта из общего списка комнат.'
            : 'Комната отображается в общем списке комнат. Любой пользователь может присоединиться свободно.'}
        </p>
      </div>
    </>
  );
}
