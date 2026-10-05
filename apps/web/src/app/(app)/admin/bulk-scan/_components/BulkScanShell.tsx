"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/app/_components/ds";
import { formatReference } from "@/lib/errorCatalogue";

export type BulkScanNavKey = "batches" | "review" | "links" | "search" | "profiles" | "settings";

const NAV: ReadonlyArray<{ key: BulkScanNavKey; href: string }> = [
  { key: "batches", href: "/admin/bulk-scan" },
  { key: "review", href: "/admin/bulk-scan/review" },
  { key: "links", href: "/admin/bulk-scan/links" },
  { key: "search", href: "/admin/bulk-scan/search" },
  { key: "profiles", href: "/admin/bulk-scan/profiles" },
  { key: "settings", href: "/admin/bulk-scan/settings" },
];

/** Common page chrome for every Bulk scan screen: header plus the section navigation. */
export function BulkScanShell({ title, subtitle, actions, active, back, children }: {
  title: string; subtitle?: ReactNode; actions?: ReactNode; active?: BulkScanNavKey; back?: string; children: ReactNode;
}) {
  const t = useTranslations("bulkScan");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={title} {...(subtitle ? { subtitle } : {})} {...(actions ? { actions } : {})} back={back ?? "/admin"} backLabel={back ? t("nav.back") : t("nav.backAdmin")} />
      <nav aria-label={t("nav.label")} style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 16px" }}>
        {NAV.map((n) => (
          <Link key={n.key} href={n.href} className={`btn sm ${active === n.key ? "primary" : "ghost"}`} {...(active === n.key ? { "aria-current": "page" as const } : {})}>
            {t(`nav.${n.key}`)}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

/** Inline, retryable failure for a client-side refetch (the initial server load uses LoadErrorState). */
export function InlineError({ message, reference, onRetry, retryLabel }: { message: string; reference?: string | null; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="card" style={{ padding: 16, borderInlineStart: "4px solid var(--bad)" }}>
      <p style={{ margin: 0 }}><span aria-hidden="true">✕ </span>{message}</p>
      {reference ? <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink2)" }}>{formatReference(reference)}</p> : null}
      {onRetry ? <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={onRetry}>{retryLabel}</button> : null}
    </div>
  );
}
