"use client";
/**
 * DataQualityView — DQ-004. Completeness distribution + missing/invalid/stale
 * counts per entity, with an entity selector and filter tabs that list the
 * affected records with drill-down. Every stat is gated on source==="error":
 * on a failed load we render "—" + DataSourceBadge, never a fabricated zero.
 */
import { useEffect, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { StatGrid, StatCard, Card, Segmented, Tabs, EmptyState, ProgressBar } from "../ds";
import {
  getDataQuality,
  type DataQualityReport,
  type DqEntity,
  type DqFilter,
  type DqSource,
} from "@/lib/crm/dataQuality";

const ENTITIES: DqEntity[] = ["contacts", "leads", "accounts"];
const FILTERS: DqFilter[] = ["missing", "invalid", "stale"];
const ENTITY_LABEL: Record<DqEntity, string> = {
  contacts: "Contacts",
  leads: "Leads",
  accounts: "Accounts",
};
const FILTER_LABEL: Record<DqFilter, string> = {
  missing: "Missing data",
  invalid: "Invalid format",
  stale: "Stale records",
};

/** Drill-down link base per entity so a record row opens its detail page. */
const DETAIL_BASE: Record<DqEntity, string> = {
  contacts: "/crm/contacts/",
  leads: "/crm/contacts/",
  accounts: "/crm/accounts/",
};

function statValue(source: DqSource, value: number): string {
  return source === "error" ? "—" : value.toLocaleString("en-IN");
}

export function DataQualityView() {
  const [entity, setEntity] = useState<DqEntity>("contacts");
  const [filter, setFilter] = useState<DqFilter>("missing");
  const [report, setReport] = useState<DataQualityReport | null>(null);
  const [source, setSource] = useState<DqSource | "loading">("loading");

  useEffect(() => {
    let alive = true;
    setSource("loading");
    void getDataQuality(entity, filter).then(({ data, source: s }) => {
      if (!alive) return;
      setReport(data);
      setSource(s);
    });
    return () => {
      alive = false;
    };
  }, [entity, filter]);

  const counts = report?.counts ?? { missing: 0, invalid: 0, stale: 0 };
  const distribution = report?.distribution ?? [];
  const records = report?.records ?? [];
  const maxBucket = distribution.reduce((m, b) => Math.max(m, b.count), 0) || 1;
  const isError = source === "error";
  const isLoading = source === "loading";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Segmented
          options={ENTITIES.map((e) => ENTITY_LABEL[e])}
          value={ENTITY_LABEL[entity]}
          onChange={(label) => {
            const next = ENTITIES.find((e) => ENTITY_LABEL[e] === label);
            if (next) setEntity(next);
          }}
        />
        {isError ? <DataSourceBadge source="error" /> : null}
      </div>

      <StatGrid>
        <StatCard icon="🕳️" iconBg="#fef3c7" label="Missing data" value={isLoading ? "…" : statValue(source, counts.missing)} />
        <StatCard icon="🚫" iconBg="#fee2e2" label="Invalid format" value={isLoading ? "…" : statValue(source, counts.invalid)} />
        <StatCard icon="🕰️" iconBg="#e0e7ff" label="Stale records" value={isLoading ? "…" : statValue(source, counts.stale)} />
      </StatGrid>

      <Card title="Completeness distribution">
        <div className="pad" style={{ display: "grid", gap: 10 }}>
          {isError ? (
            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              — Distribution unavailable. <DataSourceBadge source="error" />
            </p>
          ) : distribution.length === 0 ? (
            <EmptyState icon="📊" title="No distribution data" message="Nothing to summarise for this selection yet." />
          ) : (
            distribution.map((b) => (
              <div key={b.label} style={{ display: "grid", gridTemplateColumns: "160px 1fr 60px", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13 }}>{b.label}</span>
                <ProgressBar value={(b.count / maxBucket) * 100} />
                <span className="num" style={{ fontSize: 13 }}>{b.count.toLocaleString("en-IN")}</span>
              </div>
            ))
          )}
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Tabs
          tabs={FILTERS.map((f) => FILTER_LABEL[f])}
          active={FILTER_LABEL[filter]}
          onChange={(label) => {
            const next = FILTERS.find((f) => FILTER_LABEL[f] === label);
            if (next) setFilter(next);
          }}
        />
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-h"><h3>{FILTER_LABEL[filter]} — {ENTITY_LABEL[entity]}</h3></div>
        {isLoading ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>Loading records…</p>
        ) : isError ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
            — Records unavailable right now. <DataSourceBadge source="error" />
          </p>
        ) : records.length === 0 ? (
          <EmptyState icon="✅" title="Nothing flagged" message={`No ${ENTITY_LABEL[entity].toLowerCase()} match this data-quality filter.`} />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Record</th>
                <th style={{ textAlign: "right" }}>Quality score</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td><a href={`${DETAIL_BASE[entity]}${r.id}`}>{r.id}</a></td>
                  <td className="num">{Math.round(r.score * 100)}%</td>
                  <td style={{ fontSize: 13 }}>{r.issues.length > 0 ? r.issues.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
