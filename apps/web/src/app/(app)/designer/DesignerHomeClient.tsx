"use client";

import { formatIndianDate } from "@/lib/formatters";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  PageHeader, StatGrid, StatCard, Tabs, DataTable, EmptyState, RefreshErrorState,
} from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import type { LoaderSource } from "@/app/_data/apiClient";
import type { DesignerServiceRow, DomainPackRow } from "./_data/designerLoader";
import { SERVICE_PATTERN_OPTIONS } from "./_data/designerConstants";

interface Props {
  services: DesignerServiceRow[];
  domainPacks: DomainPackRow[];
  /** GAP-DESIGNER-HOME-01: loader outcome for the services list. */
  servicesSource?: LoaderSource;
  /** GAP-DESIGNER-HOME-01: loader outcome for the domain packs list. */
  domainPacksSource?: LoaderSource;
  /**
   * GAP2-DESIGNER-HOME-01: whether the caller may author services (create a new
   * service). Computed server-side from the session roles vs the citizen
   * catalogue ADMIN_ROLES. When false, the "New Service" affordances are hidden
   * (read views stay open); the service remains the authority on write.
   */
  canAuthor?: boolean;
}

/** GAP-DESIGNER-HOME-03: title-case label for a raw service-pattern token. */
function patternLabel(pattern: string): string {
  return SERVICE_PATTERN_OPTIONS.find((p) => p.id === pattern)?.title ?? pattern;
}

export function DesignerHomeClient({
  services,
  domainPacks,
  servicesSource = "api",
  domainPacksSource = "api",
  canAuthor = false,
}: Props) {
  const [tab, setTab] = useState("My Services");

  const servicesError = servicesSource === "error";
  const domainPacksError = domainPacksSource === "error";

  // The catalogue only has two lifecycle statuses: draft | published. "Submit"
  // sets submittedBy on a draft (awaiting a second approver) and "reject"
  // clears it again, so there is no stored "in review"/"rejected" status.
  // "In Review" is therefore derived: a draft with submittedBy set. A draft is
  // counted in exactly one of Drafts / In Review.
  const stats = useMemo(() => {
    const awaitingApproval = (s: DesignerServiceRow) =>
      s.status === "draft" && Boolean(s.submittedBy);
    return {
      drafts: services.filter((s) => s.status === "draft" && !s.submittedBy).length,
      inReview: services.filter(awaitingApproval).length,
      published: services.filter((s) => s.status === "published").length,
      // Needs attention = a draft whose most recent sandbox test failed (a
      // rejected submission returns to draft, so it is covered by this rule
      // only when its test failed; there is no separate "rejected" status).
      attention: services.filter((s) => s.status === "draft" && s.latestTestStatus === "fail").length,
    };
  }, [services]);

  // GAP-DESIGNER-HOME-01: never fabricate 0 counts when the loader failed.
  const stat = (n: number) => (servicesError ? "—" : String(n));

  const tableRows = services.map((s) => ({
    id: s.id,
    name: s.name,
    // GAP-DESIGNER-HOME-03: show title-case pattern label, not raw token.
    pattern: patternLabel(s.servicePattern),
    office: s.ownerDepartment || "—",
    version: `v${s.version}`,
    status: s.status,
    updated: s.updatedAt ? formatIndianDate(s.updatedAt) : "—",
  }));

  const packRows = domainPacks.map((p) => ({
    id: p.id,
    name: p.name,
    key: p.domainPackKey,
    sector: p.sector,
    packs: p.packCount,
    version: `v${p.version}`,
  }));

  return (
    <>
      <PageHeader
        title="Service Designer"
        subtitle="Compose government services from templates — form, approval chain, fee, and certificate."
        actions={
          canAuthor ? (
            <Link href="/designer/new" className="btn primary" style={{ minHeight: 40 }}>
              New Service
            </Link>
          ) : null
        }
      />

      <StatGrid>
        <StatCard icon="📝" iconBg="var(--panel)" label="Drafts" value={stat(stats.drafts)} />
        <StatCard icon="🔍" iconBg="var(--info-bg)" label="In Review" value={stat(stats.inReview)} />
        <StatCard icon="✅" iconBg="var(--good-bg)" label="Published" value={stat(stats.published)} />
        <StatCard icon="⚠️" iconBg="var(--warn-bg)" label="Needs Attention" value={stat(stats.attention)} />
      </StatGrid>

      <div style={{ marginTop: 20 }}>
        <Tabs
          tabs={["My Services", "Pack Library", "Domain Packs"]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "My Services" && (
        servicesError ? (
          // GAP-DESIGNER-HOME-01: an outage must show an honest retry state,
          // never "No services yet" (which can prompt duplicate creation).
          <div style={{ marginTop: 12 }}>
            <RefreshErrorState
              error={toHumanError("load", { area: "your services" })}
              backHref="/dashboard"
              source={{ area: "service list" }}
            />
          </div>
        ) : services.length === 0 ? (
          <EmptyState
            icon="🧩"
            title="No services yet"
            message="Start from a template — most offices begin with a Domain Pack."
            action={
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <Link href="/designer/library" className="btn ghost">Browse Domain Packs</Link>
                {canAuthor ? (
                  <Link href="/designer/new" className="btn primary">New Service</Link>
                ) : null}
              </div>
            }
          />
        ) : (
          <DataTable
            columns={[
              { key: "name", label: "Service" },
              { key: "pattern", label: "Pattern" },
              { key: "office", label: "Owning Office" },
              { key: "version", label: "Version" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "updated", label: "Updated" },
            ]}
            rows={tableRows}
            rowLinkKey="id"
            rowLinkPrefix="/designer/"
            filterable
            filterPlaceholder="Search services…"
            emptyTitle="No matching services"
            emptyMessage="Try a different search term."
          />
        )
      )}

      {tab === "Domain Packs" && (
        domainPacksError ? (
          // GAP-DESIGNER-HOME-01: a failed packs load must not read as
          // "No domain packs imported" (which looks like an empty registry).
          <div style={{ marginTop: 12 }}>
            <RefreshErrorState
              error={toHumanError("load", { area: "domain packs" })}
              backHref="/dashboard"
              source={{ area: "domain pack list" }}
            />
          </div>
        ) : domainPacks.length === 0 ? (
          <EmptyState
            icon="🏛️"
            title="No domain packs imported"
            message="Platform packs appear here after migration or import."
            action={<Link href="/designer/library" className="btn primary">Browse Pack Library</Link>}
          />
        ) : (
          <DataTable
            columns={[
              { key: "name", label: "Domain Pack" },
              { key: "sector", label: "Sector" },
              { key: "packs", label: "Packs" },
              { key: "version", label: "Version" },
            ]}
            rows={packRows}
            filterable
            filterPlaceholder="Search domain packs…"
          />
        )
      )}

      {tab === "Pack Library" && (
        <div className="card pad" style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 12px", color: "var(--ink2)" }}>
            Import a starter pack as a draft — nothing goes live until your office publishes it.
          </p>
          <Link href="/designer/library" className="btn primary">Open Pack Library</Link>
        </div>
      )}
    </>
  );
}

// PatternLabel was removed: GAP-DESIGNER-HOME-03 — pattern column now uses
// the title-case label from SERVICE_PATTERN_OPTIONS in tableRows directly.
