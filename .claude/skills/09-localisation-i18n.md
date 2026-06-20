# Skill — Localisation (i18n / l10n)

**When to load:** Any PR touching user-facing copy, dates, money, numbers, or RTL layout.

---

## Supported locales (Phase 1)

| Locale | Language | Script direction | Currency | Date pattern |
|---|---|---|---|---|
| en-IN | English (India) | LTR | INR | DD/MM/YYYY |
| hi-IN | Hindi | LTR (Devanagari) | INR | DD/MM/YYYY |
| ar-SA | Arabic (Saudi Arabia) | RTL | SAR | DD/MM/YYYY (Arabic numerals) |
| or-IN | Odia | LTR | INR | DD/MM/YYYY |
| ta-IN | Tamil | LTR | INR | DD/MM/YYYY |
| te-IN | Telugu | LTR | INR | DD/MM/YYYY |

Locale resolution order: user preference → tenant default → `en-IN` fallback.

## Translation pipeline

- Source: `apps/web/src/i18n/messages/en-IN/*.json` (English baseline, authored by engineering)
- Format: ICU MessageFormat (handles plurals, gender, select)
- Tool: `next-intl` for web, `intl` package for Flutter
- Workflow:
  1. Engineer adds keys + English strings in PR
  2. CI publishes diff to translation service (Lokalise / Crowdin)
  3. Translators produce per-locale files
  4. Translation PR auto-opened with new locale files
  5. Review + merge

## Key naming convention

```
{module}.{screen}.{element}
```

Examples:
- `finance.journal.title`
- `finance.journal.submit_button`
- `finance.journal.error.unbalanced`
- `helpdesk.ticket.sla.first_response`

## ICU patterns to use

### Plurals
```
{count, plural,
  =0 {No tickets}
  one {# ticket}
  other {# tickets}
}
```

### Gender (where appropriate, never assume)
```
{actor_role, select,
  manager {Manager approved}
  admin   {Admin approved}
  other   {Approver approved}
}
```

### Dates
```
{date, date, long}        →  "23 May 2026"
{date, date, ::yyyyMMdd}  →  "23/05/2026" (locale-aware)
```

### Numbers and money
```
{amount, number, ::currency/INR}  →  "₹12,345.67" (en-IN) or "12,345.67 ₹" (locale-aware)
{count, number}                    →  "1,234" or "१,२३४" or "١,٢٣٤"
```

## Forbidden patterns in code

- ❌ Hardcoded string in JSX: `<span>Submit</span>`
  - ✅ `<span>{t("finance.journal.submit_button")}</span>`

- ❌ String concatenation for sentences: `t("hello") + " " + name`
  - ✅ ICU with placeholder: `t("greeting", { name })` → key value: `"Hello, {name}"`

- ❌ Pluralising with ternary: `count === 1 ? "ticket" : "tickets"`
  - ✅ ICU plural pattern

- ❌ Formatting date manually: `${day}/${month}/${year}`
  - ✅ `new Intl.DateTimeFormat(locale, options).format(date)` or `t("...", { date })`

- ❌ Concatenating currency symbol: `"₹" + amount`
  - ✅ `new Intl.NumberFormat(locale, { style: "currency", currency: "INR" }).format(amount)`

## RTL layout (Arabic)

CSS:
- Use logical properties: `margin-inline-start` not `margin-left`
- Use `padding-block` not `padding-top/bottom`
- `dir="rtl"` on `<html>` for RTL locales (handled by next-intl middleware)

Icons:
- Directional icons (arrows, chevrons) must flip in RTL — use CSS `transform: scaleX(-1)` or RTL-aware icon variants
- Non-directional icons (settings, search) stay as-is

Layout:
- Test every screen in RTL — many layouts break (e.g. hardcoded `left/right` positions)
- Flexbox `row` automatically reverses in RTL — `row-reverse` becomes `row` visually
- Always use logical properties (`start/end`) in Tailwind: `ms-4`, `me-4`, `ps-2`, `pe-2`

## Mobile (Flutter) i18n

- Use `flutter_localizations` + `intl` package
- ARB files per locale in `apps/mobile/lib/l10n/`
- Run `flutter gen-l10n` to produce typed accessors
- `Directionality.of(context)` for RTL-aware widgets

## Translator-facing rules

- Maximum string length hints provided where layout-sensitive
- Context comment for every key (where it appears, what it does)
- Variable names self-explanatory (`{userName}` not `{var1}`)
- Never split a sentence across keys (translator needs the full sentence to translate idiomatically)

## Locale-specific business rules (out of scope of i18n proper, but adjacent)

- Indian rupee formatting: lakh / crore separators in en-IN (`12,34,567`)
- Hindi numerals: tenant-configurable preference (Devanagari vs Arabic numerals)
- Working week: Sat-Thu in some Govt edition locales (configurable)
- Holiday calendars: per tenant, sourced at install

## Testing

- Unit test: snapshot test per locale on key screens
- Visual regression test: Percy / Chromatic per locale, dark mode, RTL
- Manual sign-off by native speaker before locale GA

## Forbidden patterns

- Hardcoded strings anywhere in user-facing code
- Sentence splitting across multiple i18n keys
- Date/money/number formatting bypassing Intl API
- `left`/`right` CSS without RTL alternative
- Translating in code (`if (locale === 'hi-IN') ...`) — all translation in ARB/JSON
- Shipping a new screen without all supported locales (even if "draft" — drafts cause hardcoded English)
