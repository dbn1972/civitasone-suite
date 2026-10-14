/**
 * SF-14c: the HR/payroll/recruitment form schemas return message KEYS (namespace `hrFormErrors2`), never
 * display text. Components translate them at the point of use so inline validation errors follow the
 * active locale (en/hi).
 */
type Translator = { (key: string): string; has: (key: string) => boolean };

export function translateHrErrors<K extends string>(
  errors: Partial<Record<K, string>>,
  t: Translator,
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of Object.keys(errors) as K[]) {
    const key = errors[k];
    if (key) out[k] = t.has(key) ? t(key) : t("invalidValue");
  }
  return out;
}
