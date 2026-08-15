'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export function LanguageToggle() {
  const router = useRouter()
  const [locale, setLocale] = useState('en')
  useEffect(() => {
    const c = document.cookie.split('; ').find(r => r.startsWith('locale='))
    if (c) setLocale(c.split('=')[1])
  }, [])
  const toggle = () => {
    const next = locale === 'en' ? 'hi' : 'en'
    document.cookie = `locale=${next};path=/;max-age=31536000`
    setLocale(next)
    router.refresh()
  }
  return (
    <button
      onClick={toggle}
      title={locale === 'en' ? 'हिंदी में बदलें' : 'Switch to English'}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: 'var(--text-2)' }}
      aria-label={locale === 'en' ? 'Switch to Hindi' : 'Switch to English'}
    >
      {locale === 'en' ? 'हिंदी' : 'EN'}
    </button>
  )
}
