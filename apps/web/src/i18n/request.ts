import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale } from './config'
import { withEnglishFallback, type MessageTree } from './mergeMessages'

// The merged catalogue for a non-English locale never changes while the
// process runs (the JSON files are bundled), so build it once per locale.
const merged = new Map<string, MessageTree>()

async function loadMessages(locale: string): Promise<MessageTree> {
  const own = (await import(`../messages/${locale}.json`)).default as MessageTree
  if (locale === DEFAULT_LOCALE) return own
  const cached = merged.get(locale)
  if (cached) return cached
  const english = (await import('../messages/en.json')).default as MessageTree
  // GAP-HR-TRANSFER-10: keys a locale has not translated yet fall back to
  // English instead of rendering as raw key paths.
  const full = withEnglishFallback(english, own)
  merged.set(locale, full)
  return full
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const safeLocale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value)
  return {
    locale: safeLocale,
    messages: await loadMessages(safeLocale),
  }
})
