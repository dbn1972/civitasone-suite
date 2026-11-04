/**
 * UAT b15 item 5: modules the app links to ("How this works" -> /help/<slug>) that have no full guide in
 * helpContent.ts yet. /help/[module] used to answer "Guide not found" for them (e.g. /help/ai); it now shows a short
 * overview with a link to the module and back to the Help Centre. The words are in messages
 * (helpFallback.topics.<slug>, en + hi): neutral descriptions only, no operating steps. A full guide in HELP_MODULES
 * always wins over this list.
 */
export const HELP_FALLBACK_TOPICS: Readonly<Record<string, { href: string }>> = {
  ai: { href: "/ai" },
  cdp: { href: "/cdp" },
  crm: { href: "/crm" },
  field: { href: "/field" },
  identity: { href: "/identity" },
  inspection: { href: "/inspection" },
  journeys: { href: "/journeys" },
  locations: { href: "/locations" },
  loyalty: { href: "/loyalty" },
  plugins: { href: "/plugins" },
  recommendations: { href: "/recommendations" },
  themes: { href: "/themes" },
};

export function getHelpFallback(slug: string): { slug: string; href: string } | undefined {
  const t = Object.prototype.hasOwnProperty.call(HELP_FALLBACK_TOPICS, slug) ? HELP_FALLBACK_TOPICS[slug] : undefined;
  return t ? { slug, href: t.href } : undefined;
}
