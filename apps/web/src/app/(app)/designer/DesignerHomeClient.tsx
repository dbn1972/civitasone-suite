"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  PageHeader, StatGrid, StatCard, Tabs, DataTable, EmptyState, StatusPill,
} from "@/app/_components/ds";
import type { DesignerServiceRow, DomainPackRow } from "./_data/designerLoader";

interface Props {
  services: DesignerServiceRow[];
  domainPacks: DomainPackRow[];
}

export function DesignerHomeClient({ services, domainPacks }: Props) {
  const [tab, setTab] = useState("My Services");

  const stats = useMemo(() => ({
    drafts: services.filter((s) => s.status === "draft").length,
    inReview: services.filter((s) => s.status === "submitted" || s.status === "in_review").length,
    published: services.filter((s) => s.status === "published").length,
    attention: services.filter((s) => s.status === "rejected").length,
  }), [services]);

  const tableRows = services.map((s) => ({
    id: s.id,
    name: s.name,
    pattern: s.servicePattern,
    office: s.ownerDepartment || "—",
    version: `v${s.version}`,
    status: s.status,
    updated: s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : "—",
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
          <Link href="/designer/new" className="btn primary" style={{ minHeight: 40 }}>
            New Service
          </Link>
        }
      />

      <StatGrid>
        <StatCard label="Drafts" value={String(stats.drafts)} hint="Work in progress" />
        <StatCard label="In Review" value={String(stats.inReview)} hint="Awaiting checker" />
        <StatCard label="Published" value={String(stats.published)} hint="Live services" />
        <StatCard label="Needs Attention" value={String(stats.attention)} hint="Rejected or blocked" />
      </StatGrid>

      <div style={{ marginTop: 20 }}>
        <Tabs
          tabs={["My Services", "Pack Library", "Domain Packs"]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "My Services" && (
        services.length === 0 ? (
          <EmptyState
            icon="🧩"
            title="No services yet"
            message="Start from a template — most offices begin with a Domain Pack."
            action={
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <Link href="/designer/library" className="btn ghost">Browse Domain Packs</Link>
                <Link href="/designer/new" className="btn primary">New Service</Link>
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
        domainPacks.length === 0 ? (
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

export function PatternLabel({ pattern }: { pattern: string }) {
  return <StatusPill status={pattern} />;
}
