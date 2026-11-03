"use client";
/**
 * UAT-P2-D3 (A11Y-20 / GLB-04, GIGW 3.0 identity, footer, last-updated):
 * the app shell had no footer / contentinfo landmark, no owning department,
 * no "last updated" date and no links to the mandatory compliance pages.
 *
 * DEFERRED-content: the owning department / ministry name and the content
 * "last updated" date must be supplied by the owner (Web Information
 * Manager). They are read from NEXT_PUBLIC_GIGW_OWNER and
 * NEXT_PUBLIC_CONTENT_UPDATED_AT (build-time, non-secret); until those are
 * set the footer shows a clearly marked placeholder instead of an invented
 * value.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatIndianDate } from "@/lib/formatters";

export const GIGW_FOOTER_LINKS = [
  { href: "/accessibility-statement", key: "footerAccessibility" },
  { href: "/screen-reader-access", key: "footerScreenReader" },
  { href: "/website-policies", key: "footerPolicies" },
  { href: "/help", key: "footerHelp" },
] as const;

export function AppFooter() {
  const t = useTranslations("shell");
  const owner = process.env.NEXT_PUBLIC_GIGW_OWNER?.trim() || null;
  const updated = process.env.NEXT_PUBLIC_CONTENT_UPDATED_AT?.trim() || null;
  const updatedLabel = updated ? formatIndianDate(updated) : null;

  return (
    <footer className="app-foot" aria-label={t("footerLabel")}>
      <p className="app-foot-owner">
        {owner ? t("footerOwner", { owner }) : <span data-deferred-content="owner">{t("footerOwnerPending")}</span>}
        {" · "}
        {updatedLabel && updatedLabel !== "—" ? (
          t("footerLastUpdated", { date: updatedLabel })
        ) : (
          <span data-deferred-content="last-updated">{t("footerLastUpdatedPending")}</span>
        )}
      </p>
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
