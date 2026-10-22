/**
 * Deep-merge a locale's messages OVER the English catalogue so a key the locale
 * has not translated yet resolves to its English string instead of next-intl's
 * "namespace.key" fallback text (GAP-CRM-DATA-QUALITY-07).
 *
 * ta/te/kn deliberately cover only a slice of the app (see
 * messages/restored-locales.test.ts) and hi is translated tranche by tranche;
 * every page that calls t("some.key") for a not-yet-translated key used to show
 * the raw key path in those locales. English is the documented fallback.
 *
 * Pure and non-mutating. Plain objects merge recursively; arrays and scalars in
 * the locale replace the English value outright.
 */
type Messages = { [key: string]: unknown };

function isPlainObject(value: unknown): value is Messages {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function withEnglishFallback(english: Messages, locale: Messages): Messages {
  const out: Messages = { ...english };
  for (const [key, value] of Object.entries(locale)) {
    const base = out[key];
    out[key] = isPlainObject(base) && isPlainObject(value) ? withEnglishFallback(base, value) : value;
  }
  return out;
}
