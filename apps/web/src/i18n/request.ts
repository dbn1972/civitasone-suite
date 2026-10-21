import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale, type SupportedLocale } from './config'
import { withEnglishFallback } from './withEnglishFallback'

// Merged (English-under-locale) catalogue per non-English locale, built once
// per server process rather than on every request.
const mergedCache = new Map<SupportedLocale, Record<string, unknown>>()

async function loadMessages(locale: SupportedLocale): Promise<Record<string, unknown>> {
  const own = (await import(`../messages/${locale}.json`)).default as Record<string, unknown>
  if (locale === DEFAULT_LOCALE) return own
  // GAP-CRM-DATA-QUALITY-07: ta/te/kn (and hi, between translation tranches)
  // do not carry every key. Fall back to English per key instead of letting
  // next-intl print the raw "namespace.key" path.
  const cached = mergedCache.get(locale)
  if (cached) return cached
  const english = (await import('../messages/en.json')).default as Record<string, unknown>
  const merged = withEnglishFallback(english, own)
  mergedCache.set(locale, merged)
  return merged
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const safeLocale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value)
  return {
    locale: safeLocale,
    messages: await loadMessages(safeLocale),
  }
})
