import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { LOCALE_COOKIE, resolveLocale } from './config'

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const safeLocale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value)
  return {
    locale: safeLocale,
    messages: (await import(`../messages/${safeLocale}.json`)).default,
  }
})
