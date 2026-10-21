/**
 * Deep-merge a locale's messages over the English catalogue so a key the
 * locale has not translated yet resolves to its English text instead of a raw
 * key path ("transfer.title").
 *
 * GAP-HR-TRANSFER-10 / GAP-HR-DEPUTATION-06: i18n/request.ts used to hand
 * next-intl ONLY the selected locale file. hi.json lacked whole namespaces
 * (`transfer`, `deputation`, `confirmation`) and kn/ta/te cover only the small
 * legacy key set (see messages/restored-locales.test.ts), so on those locales
 * a page rendered by getTranslations() showed raw key paths. The locale's own
 * strings always win; English only fills gaps. Arrays are leaves (never merged
 * element-wise), and a locale value of a different shape than English (string
 * vs object) is kept as-is.
 */
export type MessageTree = { [key: string]: MessageTree | string | number | boolean | null | MessageTree[] | string[] };

function isTree(v: unknown): v is MessageTree {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function withEnglishFallback(english: MessageTree, locale: MessageTree): MessageTree {
  const out: MessageTree = {};
  for (const key of Object.keys(english)) {
    const base = english[key];
    if (!(key in locale)) {
      out[key] = base as MessageTree[string];
      continue;
    }
    const own = locale[key];
    out[key] = (isTree(base) && isTree(own) ? withEnglishFallback(base, own) : own) as MessageTree[string];
  }
  for (const key of Object.keys(locale)) {
    if (!(key in english)) out[key] = locale[key] as MessageTree[string];
  }
  return out;
}
