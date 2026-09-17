'use client';

// Правила режима «Предатель» по клавише I: цель, роли, этапы партии, действия, саботаж, карта и
// клавиши — текстом и рисунками. Все числа (таймеры, перезарядки, дальности) берутся из тех же
// констант и настроек комнаты, что и у сервера, а план корабля рисуется из данных карты: правила
// не могут разойтись с игрой.
import { useState } from 'react';
import type { GameMap, TaskKind } from '@/lib/maps/types';
import {
  CRITICAL_MS,
  IMPOSTOR_DEFAULTS,
  MIN_PLAYERS,
  SABOTAGE_COOLDOWN_MS,
  type ImpostorSettings,
  type ImpostorRole,
} from '@/lib/impostor';

type Tab = 'goal' | 'flow' | 'crew' | 'impostor' | 'map' | 'keys';
const TABS: { id: Tab; title: string }[] = [
  { id: 'goal', title: 'Цель' },
  { id: 'flow', title: 'Ход партии' },
  { id: 'crew', title: 'Экипаж' },
  { id: 'impostor', title: 'Предатель' },
  { id: 'map', title: 'Карта' },
  { id: 'keys', title: 'Клавиши' },
];

// ---------------------------------------------------------------- рисунки

/** Член экипажа: скафандр с визором и ранцем. */
function Crewmate({ color, knife = false, ghost = false, size = 72 }: { color: string; knife?: boolean; ghost?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 64 72" width={size} height={size * (72 / 64)} aria-hidden="true" opacity={ghost ? 0.45 : 1}>
      <rect x="8" y="24" width="10" height="26" rx="4" fill={color} stroke="#0b0f18" strokeWidth="2.5" />
      <path d="M16 18 Q16 4 32 4 Q48 4 48 18 V58 H38 V66 H28 V58 H22 V66 H14 V58 Q16 58 16 50 Z" fill={color} stroke="#0b0f18" strokeWidth="2.5" />
      <rect x="28" y="14" width="24" height="14" rx="7" fill="#9fd8f0" stroke="#0b0f18" strokeWidth="2.5" />
      <rect x="34" y="17" width="10" height="4" rx="2" fill="#e8f7fd" />
      {knife && (
        <g transform="translate(46 34) rotate(35)">
          <rect x="0" y="0" width="5" height="10" rx="1" fill="#3a2a1c" />
          <path d="M-1 10 H6 L2.5 30 Z" fill="#dfe6ee" stroke="#0b0f18" strokeWidth="1.5" />
        </g>
      )}
      {ghost && <path d="M14 58 Q20 70 26 60 Q32 70 38 60 Q44 70 50 58" fill="none" stroke={color} strokeWidth="3" />}
    </svg>
  );
}

function Body({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 80 40" width="80" height="40" aria-hidden="true">
      <path d="M8 34 Q8 18 26 18 H52 V34 Z" fill={color} stroke="#0b0f18" strokeWidth="2.5" />
      <path d="M52 22 L60 14 M52 30 L62 32" stroke="#f4efe6" strokeWidth="4" strokeLinecap="round" />
      <circle cx="61" cy="13" r="3" fill="#f4efe6" />
    </svg>
  );
}

const TASK_ICON: Record<TaskKind, { title: string; draw: React.JSX.Element }> = {
  wires: {
    title: 'Провода — соедините одинаковые цвета',
    draw: (
      <>
        {['#e5484d', '#3e8ef7', '#f5d90a'].map((c, i) => (
          <g key={c}>
            <rect x="4" y={8 + i * 14} width="8" height="6" fill={c} />
            <rect x="52" y={8 + ((i + 1) % 3) * 14} width="8" height="6" fill={c} />
            <path d={`M12 ${11 + i * 14} C32 ${11 + i * 14} 32 ${11 + ((i + 1) % 3) * 14} 52 ${11 + ((i + 1) % 3) * 14}`} stroke={c} strokeWidth="3" fill="none" />
          </g>
        ))}
      </>
    ),
  },
  hold: {
    title: 'Удержание — держите кнопку, пока шкала не заполнится',
    draw: (
      <>
        <rect x="6" y="6" width="52" height="8" rx="4" fill="#26324a" />
        <rect x="6" y="6" width="34" height="8" rx="4" fill="#4ade80" />
        <circle cx="32" cy="36" r="12" fill="#6d5dfc" />
      </>
    ),
  },
  calibrate: {
    title: 'Калибровка — трижды остановите метку в зелёной зоне',
    draw: (
      <>
        <rect x="4" y="20" width="56" height="12" rx="3" fill="#26324a" />
        <rect x="26" y="20" width="12" height="12" fill="#4ade80" opacity="0.7" />
        <rect x="30" y="16" width="3" height="20" fill="#fcd34d" />
      </>
    ),
  },
  code: {
    title: 'Код — наберите цифры с записки',
    draw: (
      <>
        <rect x="18" y="2" width="28" height="9" rx="2" fill="#fef3c7" />
        {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={16 + c * 11} y={16 + r * 11} width="9" height="9" rx="2" fill="#3b4760" />))}
      </>
    ),
  },
  upload: {
    title: 'Загрузка — нажмите и дождитесь конца',
    draw: (
      <>
        <path d="M32 6 L44 20 H36 V32 H28 V20 H20 Z" fill="#7fe0f0" />
        <rect x="6" y="40" width="52" height="7" rx="3" fill="#26324a" />
        <rect x="6" y="40" width="22" height="7" rx="3" fill="#4ade80" />
      </>
    ),
  },
};

function TaskIcons() {
  return (
    <div className="impostor-rules-icons">
      {(Object.keys(TASK_ICON) as TaskKind[]).map((k) => (
        <figure key={k}>
          <svg viewBox="0 0 64 52" width="96" height="78" aria-hidden="true">
            <rect width="64" height="52" rx="6" fill="#141c2c" />
            {TASK_ICON[k].draw}
          </svg>
          <figcaption>{TASK_ICON[k].title}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Схема этапов партии со стрелками; таймеры — из настроек комнаты. */
function Flow({ s }: { s: ImpostorSettings }) {
  const W = 104;
  const steps = [
    { x: 6, title: 'Лобби', sub: `от ${MIN_PLAYERS} игроков` },
    { x: 130, title: 'Роли', sub: '5 с за столом' },
    { x: 254, title: 'Игра', sub: 'задания и охота' },
    { x: 378, title: 'Собрание', sub: s.discussionSeconds ? `обсуждение ${s.discussionSeconds} с` : 'без обсуждения' },
    { x: 502, title: 'Голосование', sub: `${s.votingSeconds} с` },
  ];
  const box = (x: number, y: number, w: number, title: string, sub: string, tone: 'plain' | 'play' | 'end' = 'plain') => (
    <g key={title}>
      <rect
        x={x}
        y={y}
        width={w}
        height="54"
        rx="10"
        fill={tone === 'play' ? '#1f3b2e' : tone === 'end' ? '#3a1d24' : '#1a2336'}
        stroke={tone === 'play' ? '#4ade80' : tone === 'end' ? '#ff5a5f' : '#3b4760'}
      />
      <text x={x + w / 2} y={y + 23} textAnchor="middle" fill="#eef3fb" fontSize="14" fontWeight="700">
        {title}
      </text>
      <text x={x + w / 2} y={y + 41} textAnchor="middle" fill="#a9b4c6" fontSize="10.5">
        {sub}
      </text>
    </g>
  );
  const arrow = (d: string, color = '#9fb0c8', dashed = false) => (
    <path d={d} fill="none" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '5 4' : undefined} markerEnd={`url(#imp-arrow-${color.slice(1)})`} />
  );
  const colors = ['#9fb0c8', '#fcd34d', '#ff5a5f'];
  return (
    <svg viewBox="0 0 612 210" className="impostor-rules-flow" aria-label="Схема этапов партии">
      <defs>
        {colors.map((c) => (
          <marker key={c} id={`imp-arrow-${c.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 Z" fill={c} />
          </marker>
        ))}
      </defs>
      {steps.map((st, i) => box(st.x, 24, W, st.title, st.sub, i === 2 ? 'play' : 'plain'))}
      {arrow('M110 51 H128')}
      {arrow('M234 51 H252')}
      {arrow('M482 51 H500')}
      {/* Из игры на собрание — только по репорту тела или кнопке. */}
      {arrow('M358 51 H376', '#fcd34d')}
      <text x="368" y="14" textAnchor="middle" fill="#fcd34d" fontSize="10.5">
        репорт или кнопка
      </text>
      {box(478, 142, 128, 'Изгнание', 'итог голосования')}
      {box(90, 142, 150, 'Итог партии', 'роли открываются всем', 'end')}
      {arrow('M554 78 V140')}
      {/* Никто не победил — снова игра. */}
      {arrow('M478 160 H306 V80')}
      <text x="392" y="152" textAnchor="middle" fill="#a9b4c6" fontSize="10.5">
        никто не победил — снова игра
      </text>
      {/* Победа возможна и прямо в игре, и после изгнания. */}
      {arrow('M280 78 V108 H165 V140', '#ff5a5f', true)}
      {arrow('M478 190 H242', '#ff5a5f', true)}
      <text x="360" y="204" textAnchor="middle" fill="#ff9a9d" fontSize="10.5">
        победа после изгнания
      </text>
      <text x="222" y="102" textAnchor="middle" fill="#ff9a9d" fontSize="10.5">
        победа в игре
      </text>
    </svg>
  );
}

/** План корабля из данных карты: пол, стены, пульты, аварийные пульты, решётки, стол и «вы здесь». */
function ShipPlan({ map, me }: { map: GameMap; me: { x: number; z: number } | null }) {
  const arena = map.arena;
  if (!arena) return <p className="impostor-muted">У этой карты нет плана.</p>;
  const b = map.bounds;
  const w = b.maxX - b.minX,
    h = b.maxZ - b.minZ;
  const floors = arena.boxes.filter((x) => !x.solid && x.h < 0.05 && x.w * x.d > 4);
  const walls = arena.boxes.filter((x) => x.solid && x.h >= 3);
  return (
    <svg viewBox={`${b.minX} ${b.minZ} ${w} ${h}`} className="impostor-rules-map" aria-label="План корабля">
      <rect x={b.minX} y={b.minZ} width={w} height={h} fill="#070a12" />
      {floors.map((f, i) => (
        <rect key={i} x={f.x - f.w / 2} y={f.z - f.d / 2} width={f.w} height={f.d} fill={f.color} opacity="0.35" />
      ))}
      {walls.map((x, i) => (
        <rect key={i} x={x.x - x.w / 2} y={x.z - x.d / 2} width={x.w} height={x.d} fill="#c4cedd" />
      ))}
      {map.meeting && (
        <>
          <circle cx={map.meeting.x} cy={map.meeting.z} r="1.6" fill="#3d7ea6" />
          <circle cx={map.meeting.x} cy={map.meeting.z} r="0.5" fill="#e5484d" />
        </>
      )}
      {map.stations.map((st) => (
        <circle key={st.id} cx={st.x} cy={st.z} r="0.75" fill="#fcd34d" />
      ))}
      {map.panels.map((p) => (
        <rect key={p.id} x={p.x - 0.8} y={p.z - 0.8} width="1.6" height="1.6" fill="#ff5a5f" transform={`rotate(45 ${p.x} ${p.z})`} />
      ))}
      {map.vents.map((v) => (
        <g key={v.id}>
          <rect x={v.x - 0.9} y={v.z - 0.6} width="1.8" height="1.2" fill="#8d97a6" stroke="#0b0f18" strokeWidth="0.2" />
        </g>
      ))}
      {(arena.zones ?? []).map((z) => (
        <text key={z.id} x={(z.minX + z.maxX) / 2} y={(z.minZ + z.maxZ) / 2 - 2.2} textAnchor="middle" fontSize="1.9" fill="#eef3fb" opacity="0.85">
          {z.name}
        </text>
      ))}
      {me && (
        <g>
          <circle cx={me.x} cy={me.z} r="1.6" fill="none" stroke="#4ade80" strokeWidth="0.5" />
          <circle cx={me.x} cy={me.z} r="0.7" fill="#4ade80" />
        </g>
      )}
    </svg>
  );
}

function Legend() {
  return (
    <ul className="impostor-rules-legend">
      <li>
        <i style={{ background: '#fcd34d', borderRadius: '50%' }} /> пульт задания
      </li>
      <li>
        <i style={{ background: '#ff5a5f', transform: 'rotate(45deg)' }} /> пульт аварии
      </li>
      <li>
        <i style={{ background: '#8d97a6' }} /> решётка вентиляции
      </li>
      <li>
        <i style={{ background: '#e5484d', borderRadius: '50%', boxShadow: '0 0 0 3px #3d7ea6' }} /> стол и кнопка собрания
      </li>
      <li>
        <i style={{ background: '#4ade80', borderRadius: '50%' }} /> вы здесь
      </li>
    </ul>
  );
}

// ---------------------------------------------------------------- окно

export default function ImpostorRules({
  map,
  settings,
  role,
  me,
  onClose,
}: {
  map: GameMap;
  settings: Partial<ImpostorSettings> | undefined;
  /** Своя роль в идущей партии — открываем правила сразу на ней. */
  role: ImpostorRole | null;
  me: { x: number; z: number } | null;
  onClose: () => void;
}) {
  const s = { ...IMPOSTOR_DEFAULTS, ...settings };
  const [tab, setTab] = useState<Tab>(role === 'impostor' ? 'impostor' : role === 'crew' ? 'crew' : 'goal');
  const critical = CRITICAL_MS / 1000;
  return (
    <div className="impostor-modal">
      <div className="impostor-card impostor-rules" role="document">
        <header>
          <strong>Правила · Предатель</strong>
          <button className="impostor-close" onClick={onClose} aria-label="Закрыть правила">
            ×
          </button>
        </header>
        <nav className="impostor-rules-tabs" aria-label="Разделы правил">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'is-active' : ''} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {t.title}
            </button>
          ))}
        </nav>

        {tab === 'goal' && (
          <section>
            <p>
              Корабль летит с экипажем, но среди экипажа прячутся <b>предатели</b>. Роли раздаются тайно в начале каждой партии: свою
              роль видите только вы, а предатели ещё и знают друг друга.
            </p>
            <div className="impostor-rules-roles">
              <div className="is-crew">
                <Crewmate color="#3e8ef7" />
                <div>
                  <h3>Экипаж</h3>
                  <p>Выполняет задания у пультов, чинит аварии и на собраниях вычисляет предателей.</p>
                  <p className="impostor-muted">Побеждает, если выполнены все задания или изгнаны все предатели.</p>
                </div>
              </div>
              <div className="is-impostor">
                <Crewmate color="#e5484d" knife />
                <div>
                  <h3>Предатель</h3>
                  <p>Притворяется своим, тайно убивает, прячется в вентиляции и устраивает аварии.</p>
                  <p className="impostor-muted">
                    Побеждает, если предателей стало столько же, сколько живого экипажа, или авария не устранена вовремя.
                  </p>
                </div>
              </div>
            </div>
            <p className="impostor-muted">
              Предателей в партии: {s.impostors ? s.impostors : 'по числу игроков (1 до 6 игроков, 2 до 10, дальше 3)'}. Их всегда меньше
              половины.
            </p>
          </section>
        )}

        {tab === 'flow' && (
          <section>
            <Flow s={s} />
            <ol className="impostor-rules-steps">
              <li>
                <b>Лобби.</b> Все собираются у стола в кафетерии. Ведущий жмёт «Начать партию», когда в сети от {MIN_PLAYERS} игроков (боты
                считаются).
              </li>
              <li>
                <b>Роли.</b> 5 секунд каждый видит свою роль, союзников (если вы предатель) и число предателей. Двигаться нельзя.
              </li>
              <li>
                <b>Игра.</b> Экипаж расходится по заданиям, предатели ищут момент. Живые молчат — говорить можно только на собраниях.
              </li>
              <li>
                <b>Собрание.</b> Начинается, когда кто-то нашёл тело и нажал «Репорт» или нажал кнопку на столе. Всех переносит за стол,
                аварии гаснут.{' '}
                {s.discussionSeconds ? `${s.discussionSeconds} секунд обсуждения голосом (Y), затем` : 'Сразу'} голосование — {s.votingSeconds}{' '}
                секунд: голос за игрока или «Пропустить».
              </li>
              <li>
                <b>Изгнание.</b> Больше всех голосов — игрок покидает корабль. Ничья или больше пропусков — никого не изгоняют.{' '}
                {s.confirmEjects ? 'Сообщается, был ли изгнанный предателем.' : 'Кем был изгнанный, не сообщается.'}
              </li>
              <li>
                <b>Итог.</b> Как только одна сторона победила, открываются все роли, а через 12 секунд все возвращаются в лобби.
              </li>
            </ol>
          </section>
        )}

        {tab === 'crew' && (
          <section>
            <p>
              У каждого члена экипажа <b>{s.tasksPerPlayer}</b> {s.tasksPerPlayer === 1 ? 'задание' : 'задания'} — список слева, над ним
              общая полоса прогресса. Подойдите к жёлтому пульту и нажмите <kbd>E</kbd>: откроется мини-игра. Уйти раньше времени нельзя — сервер
              засчитывает задание, только если вы стояли у пульта всё время.
            </p>
            <TaskIcons />
            <div className="impostor-rules-row">
              <Body color="#3e8ef7" />
              <p>
                Нашли тело — нажмите <kbd>R</kbd>, пока стоите рядом: начнётся собрание. Кнопка на столе собраний (<kbd>E</kbd> рядом со столом)
                созывает экстренное собрание — у каждого их {s.emergencyMeetings}, и во время критической аварии кнопка не работает.
              </p>
            </div>
            <div className="impostor-rules-row">
              <Crewmate color="#3e8ef7" ghost size={56} />
              <p>
                Погибшие становятся <b>призраками</b>: проходят сквозь стены, видят всех и доделывают свои задания — экипаж всё ещё может
                победить. Живые призраков не видят и не слышат; призраки говорят только между собой и не голосуют.
              </p>
            </div>
            <p className="impostor-muted">
              Обзор экипажа — около 8 метров, за стенами никого не видно. Миникарта в партии не показывает других игроков.
            </p>
          </section>
        )}

        {tab === 'impostor' && (
          <section>
            <div className="impostor-rules-row">
              <Crewmate color="#e5484d" knife size={56} />
              <p>
                <kbd>Q</kbd> — нож: убивает живого члена экипажа в паре шагов, если между вами нет стены. Перезарядка {s.killCooldownSeconds}{' '}
                секунд. Задания у предателя ложные — стойте у пультов для вида, но засчитать их нельзя. Обзор предателя — 12 метров.
              </p>
            </div>
            <div className="impostor-rules-row">
              <svg viewBox="0 0 64 44" width="64" height="44" aria-hidden="true">
                <rect x="6" y="10" width="52" height="28" rx="3" fill="#3b424d" stroke="#8d97a6" strokeWidth="2" />
                {[0, 1, 2, 3].map((i) => (
                  <rect key={i} x="12" y={14 + i * 6} width="40" height="2.5" fill="#1a1f27" />
                ))}
              </svg>
              <p>
                <b>Вентиляция.</b> У решётки нажмите <kbd>E</kbd> — вы спрятаны: вас видят только союзники. Из решётки можно переползти в
                соседнюю той же сети (кнопки внизу экрана) и вылезти <kbd>E</kbd>. Изнутри нельзя ни убивать, ни ходить.
              </p>
            </div>
            <h3>Саботаж — клавиша B</h3>
            <p className="impostor-muted">
              Одна авария за раз, перерыв между ними — {SABOTAGE_COOLDOWN_MS / 1000} секунд (и после старта, и после собрания). Чинить
              может любой живой игрок у красного пульта.
            </p>
            <div className="impostor-rules-sabotage">
              <div>
                <b>Свет</b>
                <span>Экипаж видит на пару шагов. Чинят в Электрике.</span>
              </div>
              <div>
                <b>Связь</b>
                <span>У экипажа пропадают списки заданий. Чинят в отсеке Связь.</span>
              </div>
              <div className="is-critical">
                <b>Реактор · {critical} с</b>
                <span>Два стабилизатора в Реакторе должны держать одновременно двое разных игроков.</span>
              </div>
              <div className="is-critical">
                <b>O2 · {critical} с</b>
                <span>Нужно починить оба пульта: в O2 и в Администрации.</span>
              </div>
            </div>
            <p className="impostor-muted">Не устранили реактор или O2 за {critical} секунд — предатели победили.</p>
          </section>
        )}

        {tab === 'map' && (
          <section>
            <ShipPlan map={map} me={me} />
            <Legend />
            <p className="impostor-muted">
              Два кольца коридоров огибают хранилище, а медпункт, O2, администрация, электрика и охрана — тупики: там легче остаться одному.
              Вентиляция соединяет решётки внутри четырёх отдельных сетей.
            </p>
          </section>
        )}

        {tab === 'keys' && (
          <section>
            <table className="impostor-rules-keys">
              <tbody>
                {[
                  ['WASD, мышь', 'Ходить и смотреть'],
                  ['E', 'Использовать: пульт задания или аварии, решётка вентиляции, кнопка собрания'],
                  ['R', 'Репорт тела рядом'],
                  ['Q', 'Нож (предатель)'],
                  ['B', 'Меню саботажа (предатель)'],
                  ['Y', 'Говорить голосом — на собраниях или призраком'],
                  ['M', 'Большая карта (в партии без других игроков)'],
                  ['I', 'Эти правила'],
                  ['Esc', 'Закрыть окно или мини-игру'],
                ].map(([key, text]) => (
                  <tr key={key}>
                    <td>
                      <kbd>{key}</kbd>
                    </td>
                    <td>{text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
