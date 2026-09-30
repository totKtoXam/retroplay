import { Fragment } from 'react';
import type { GameMode } from '@/lib/maps/catalog';
import {
  CONTEXT_TITLES,
  GROUP_ORDER,
  GROUP_TITLES,
  bindingsFor,
  type KeyBinding,
  type KeySpec,
} from '@/lib/keymap';

/** Одна клавиша: <kbd>, у мыши и «Ё» — полное название во всплывающей подсказке. */
function Key({ spec }: { spec: KeySpec }) {
  const cap = spec.title ? <abbr title={spec.title}>{spec.label}</abbr> : spec.label;
  return spec.alt ? (
    <>
      <kbd>Alt</kbd>
      {' + '}
      <kbd>{cap}</kbd>
    </>
  ) : (
    <kbd>{cap}</kbd>
  );
}

/** Клавиши действия; одинаковые подписи (левый и правый Shift, два Enter) — одной клавишей. */
function Keys({ binding }: { binding: KeyBinding }) {
  const seen = new Set<string>();
  const specs = binding.keys.filter((k) => {
    const id = `${k.alt ? 'Alt+' : ''}${k.label}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  // WASD читается как один блок, остальное — как альтернативы.
  const joined = binding.action === 'move' || binding.action === 'look-keys' || binding.action === 'wheel-browse';
  return (
    <>
      {specs.map((spec, i) => (
        <Fragment key={spec.code + (spec.alt ? '+alt' : '')}>
          {i > 0 &&
            (joined ? (
              ' '
            ) : (
              <>
                <span aria-hidden="true"> / </span>
                <span className="sr-only"> или </span>
              </>
            ))}
          <Key spec={spec} />
        </Fragment>
      ))}
    </>
  );
}

/**
 * Справка по клавишам режима, по группам. Всё берётся из lib/keymap.ts — отдельного списка
 * клавиш в разметке нет. `compact` — только обычное управление в мире, без пояснений:
 * для карточки входа и паузы.
 */
export function KeysHelp({
  mode,
  compact = false,
  headingLevel = 3,
}: {
  mode: GameMode;
  compact?: boolean;
  headingLevel?: 2 | 3 | 4;
}) {
  const all = bindingsFor(mode).filter((b) => !compact || !b.context || b.context === 'world');
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={`help-copy keys-help${compact ? ' keys-help-compact' : ''}`}>
      {GROUP_ORDER.map((group) => {
        const rows = all.filter((b) => b.group === group);
        if (!rows.length) return null;
        const id = `keys-help-${mode}-${group}${compact ? '-compact' : ''}`;
        return (
          <section key={group} className="keys-help-group" aria-labelledby={id}>
            <Heading id={id}>{GROUP_TITLES[group]}</Heading>
            <dl>
              {rows.map((b, i) => {
                const context = b.context && b.context !== 'world' ? CONTEXT_TITLES[b.context] : '';
                const hints = compact
                  ? []
                  : b.keys.flatMap((k) => (k.hint ? [`${k.label} — ${k.hint}`] : []));
                return (
                  <div key={`${b.action}-${i}`} className="keys-help-row">
                    <dt>
                      <Keys binding={b} />
                    </dt>
                    <dd>
                      {b.label}
                      {b.hold && <span className="keys-help-hold"> (удерживать)</span>}
                      {context && <span className="keys-help-context"> — {context}</span>}
                      {!compact && (b.note || hints.length > 0) && (
                        <small className="keys-help-note">
                          {[...hints, b.note].filter(Boolean).join('. ')}
                        </small>
                      )}
                      {!compact && b.conflictNote && (
                        <small className="keys-help-warning">{b.conflictNote}</small>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
