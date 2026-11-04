"use client";
/**
 * UAT post-b14 (A-N2, GIGW 3.0): the public site footer carries the same
 * owner / last-updated identity line as the app shell footer, and links to
 * every GIGW page. Colours come from the footer tokens (.site-foot, A-N1).
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SiteIdentityLine } from "@/app/_components/AppFooter";
import { GIGW_PAGE_LINKS } from "./gigwContent";

export function SiteFooterGigwLinks() {
  const t = useTranslations("gigw") as unknown as (key: string) => string;
  return (
    <div className="col-span-2">
      <h3 className="site-foot-heading text-sm font-semibold">{t("footerInfoHeading")}</h3>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {GIGW_PAGE_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-sm">{t(l.label)}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooterIdentity() {
  return <SiteIdentityLine className="mt-2" />;
}
