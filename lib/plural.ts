const rules = new Intl.PluralRules('ru-RU');

/** «1 идея», «3 идеи», «5 идей»: форма слова по русским правилам для целого числа. */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const form = rules.select(n);
  return `${n} ${form === 'one' ? one : form === 'few' ? few : many}`;
}
