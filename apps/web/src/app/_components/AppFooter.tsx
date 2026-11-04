"use client";
/**
 * UAT-P2-D3 (A11Y-20 / GLB-04, GIGW 3.0 identity, footer, last-updated):
 * the app shell had no footer / contentinfo landmark, no owning department,
 * no "last updated" date and no links to the mandatory compliance pages.
 *
 * The owning department comes from NEXT_PUBLIC_GIGW_OWNER (build-time,
 * non-secret, lib/gigw/departmentConfig.ts); until the department sets it the
 * footer shows the clearly labelled demonstration default
 * (gigw.defaultDepartment), never an invented real department.
 *
 * A-N2 (UAT post-b14): "last updated" is real. It is the build time baked in
 * by next.config.mjs (NEXT_PUBLIC_BUILD_TIME); an owner-set
 * NEXT_PUBLIC_CONTENT_UPDATED_AT still takes precedence.
 */
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { contentLastUpdated, formatGigwDate, GIGW_OWNER_CONFIG } from "@/lib/gigw/siteIdentity";
import { readGigwConfig } from "@/lib/gigw/departmentConfig";

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
  const g = useTranslations("gigw");
  const owner = readGigwConfig().department;
  const updated = contentLastUpdated(process.env.NEXT_PUBLIC_CONTENT_UPDATED_AT, process.env.NEXT_PUBLIC_BUILD_TIME);
  const locale = useLocale();
  const updatedLabel = updated ? formatGigwDate(updated, locale) : null;

  return (
    <p className={className}>
      {owner ? (
        t("footerOwner", { owner })
      ) : (
        <span data-gigw-default={GIGW_OWNER_CONFIG}>{t("footerOwner", { owner: g("defaultDepartment") })}</span>
      )}
      {" · "}
      {updatedLabel ? (
        t("footerLastUpdated", { date: updatedLabel })
      ) : (
        <span data-gigw-unset="NEXT_PUBLIC_BUILD_TIME">{t("footerLastUpdatedPending")}</span>
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
