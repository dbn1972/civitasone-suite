"use client";
/**
 * UAT-P2-D3 (A11Y-20 / GLB-04, GIGW 3.0 identity, footer, last-updated):
 * the app shell had no footer / contentinfo landmark, no owning department,
 * no "last updated" date and no links to the mandatory compliance pages.
 *
 * DEFERRED-content: the owning department / ministry name must be supplied by
 * the owner (Web Information Manager) through NEXT_PUBLIC_GIGW_OWNER
 * (build-time, non-secret); until it is set the footer shows a clearly marked
 * placeholder instead of an invented value.
 *
 * A-N2 (UAT post-b14): "last updated" is real. It is the build time baked in
 * by next.config.mjs (NEXT_PUBLIC_BUILD_TIME); an owner-set
 * NEXT_PUBLIC_CONTENT_UPDATED_AT still takes precedence.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatIndianDate } from "@/lib/formatters";
import { contentLastUpdated, GIGW_OWNER_CONFIG } from "@/lib/gigw/siteIdentity";

export const GIGW_FOOTER_LINKS = [
  { href: "/accessibility-statement", key: "footerAccessibility" },
  { href: "/screen-reader-access", key: "footerScreenReader" },
  { href: "/website-policies", key: "footerPolicies" },
  { href: "/sitemap", key: "footerSitemap" },
  { href: "/contact-us", key: "footerContactUs" },
  { href: "/feedback", key: "footerFeedback" },
  { href: "/help", key: "footerHelp" },
] as const;

/** Owner + last-updated line, shared by the app shell and the public site footer. */
export function SiteIdentityLine({ className }: { className?: string }) {
  const t = useTranslations("shell");
  const owner = process.env.NEXT_PUBLIC_GIGW_OWNER?.trim() || null;
  const updated = contentLastUpdated(process.env.NEXT_PUBLIC_CONTENT_UPDATED_AT, process.env.NEXT_PUBLIC_BUILD_TIME);
  const updatedLabel = updated ? formatIndianDate(updated) : null;

  return (
    <p className={className}>
      {owner ? (
        t("footerOwner", { owner })
      ) : (
        <span data-deferred-content="owner" data-owner-config={GIGW_OWNER_CONFIG}>{t("footerOwnerPending")}</span>
      )}
      {" · "}
      {updatedLabel && updatedLabel !== "—" ? (
        t("footerLastUpdated", { date: updatedLabel })
      ) : (
        <span data-deferred-content="last-updated">{t("footerLastUpdatedPending")}</span>
      )}
    </p>
  );
}

export function AppFooter() {
  const t = useTranslations("shell");
  return (
    <footer className="app-foot" aria-label={t("footerLabel")}>
      <SiteIdentityLine className="app-foot-owner" />
      <nav aria-label={t("footerNavLabel")}>
        <ul className="app-foot-links">
          {GIGW_FOOTER_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href}>{t(l.key)}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
