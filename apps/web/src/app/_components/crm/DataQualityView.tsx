"use client";
/**
 * DataQualityView — DQ-004. Completeness distribution + missing/invalid/stale
 * counts per entity, with an entity selector and filter tabs that list the
 * affected records with drill-down. Every stat is gated on source==="error":
 * on a failed load we render "—" + DataSourceBadge, never a fabricated zero.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { StatGrid, StatCard, Card, Segmented, Tabs, EmptyState, ProgressBar } from "../ds";
import {
  getDataQuality,
  parseDqIssue,
  type DataQualityReport,
  type DqEntity,
  type DqFilter,
  type DqSource,
} from "@/lib/crm/dataQuality";

/**
 * GAP-CRM-DATA-QUALITY-04: a lead is stored as a contact in crm-service and is
 * scored by the same profile, so a separate "Leads" scope showed the identical
 * records twice and suggested two datasets. One scope covers both. The API still
 * accepts `entity=leads` (and DETAIL_BASE keeps it routable) for old callers.
 */
const ENTITIES: DqEntity[] = ["contacts", "accounts"];
const FILTERS: DqFilter[] = ["missing", "invalid", "stale"];
const EMPTY_REPORT: DataQualityReport = {
  distribution: [],
  counts: { missing: 0, invalid: 0, stale: 0 },
  records: [],
  recordsByFilter: { missing: [], invalid: [], stale: [] },
};
/** Record fields the report names in an issue; the label comes from messages (fieldLabel.*). */
const ISSUE_FIELDS = [
  "name", "email", "phone", "company", "designation", "city", "leadSource",
  "pincode", "gstin", "pan", "industry", "website",
] as const;
const FILTER_LABEL: Record<DqFilter, string> = {
  missing: "Missing data",
  invalid: "Invalid format",
  stale: "Stale records",
};

/**
 * Drill-down link base per entity so a record row opens its detail page.
 * GAP-CRM-DATA-QUALITY-04: there is no separate /crm/leads/:id screen — a lead
 * is stored as a contact in crm-service, so a flagged lead opens its CONTACT
 * record (same as the contacts scope). The row link title spells this out so
 * the two scopes are not read as two datasets that happen to share a screen.
 */
const DETAIL_BASE: Record<DqEntity, string> = {
  contacts: "/crm/contacts/",
  leads: "/crm/contacts/",
  accounts: "/crm/accounts/",
};

function statValue(source: DqSource, value: number): string {
  return source === "error" ? "—" : value.toLocaleString("en-IN");
}

export function DataQualityView() {
  const t = useTranslations("crmDataQualityView");
  const [entity, setEntity] = useState<DqEntity>("contacts");
  const [filter, setFilter] = useState<DqFilter>("missing");
  const [report, setReport] = useState<DataQualityReport | null>(null);
  const [source, setSource] = useState<DqSource | "loading">("loading");
  // GAP-CRM-DATA-QUALITY-03: the report is fetched ONCE per entity, with the rows
  // of every filter in the same response (filter=all), and cached for the life of
  // the screen. The filter tabs just pick a list client-side, so clicking
  // "Invalid format" makes no request, never blanks the stat cards or the
  // distribution, and cannot turn a transient error into a fabricated zero.
  const cache = useRef(new Map<DqEntity, DataQualityReport>());

  useEffect(() => {
    let alive = true;
    const cached = cache.current.get(entity);
    if (cached) {
      setReport(cached);
      setSource("api");
      return;
    }
    setSource("loading");
    setReport(null);
    void getDataQuality(entity, "all").then(({ data, source: s }) => {
      if (!alive) return;
      if (s === "api") cache.current.set(entity, data);
      setReport(data);
      setSource(s);
    });
    return () => {
      alive = false;
    };
  }, [entity]);

  const entityLabel = (e: DqEntity) => t(e === "accounts" ? "entityAccounts" : "entityContacts");
  const fieldLabel = (field: string) =>
    (ISSUE_FIELDS as readonly string[]).includes(field) ? t(`fieldLabel.${field}`) : field;
  const issueText = (raw: string) => {
    const issue = parseDqIssue(raw);
    if (issue.kind === "missing") return t("issueMissing", { field: fieldLabel(issue.field) });
    if (issue.kind === "invalid") return t("issueInvalid", { field: fieldLabel(issue.field) });
    if (issue.kind === "stale") return t("issueStale");
    return issue.raw;
  };

  const shown = report ?? EMPTY_REPORT;
  const counts = shown.counts;
  const distribution = shown.distribution;
  const records = shown.recordsByFilter[filter];
  // The service caps each list; say so rather than implying the table is complete.
  const flaggedTotal = counts[filter];
  const truncated = source === "api" && flaggedTotal > records.length;
  // GAP-CRM-DATA-QUALITY-02: bars are a share of the master (all records), not
  // of the largest bucket, so a dominant bucket no longer flattens the rest to
  // invisibility and each bar reads as a true percentage.
  const distributionTotal = distribution.reduce((sum, b) => sum + b.count, 0);
  const isError = source === "error";
  const isLoading = source === "loading";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Segmented
          options={ENTITIES.map((e) => ({ value: e, label: entityLabel(e) }))}
          value={entity}
          onChange={(value) => {
            const next = ENTITIES.find((e) => e === value);
            if (next) setEntity(next);
          }}
        />
        {isError ? <DataSourceBadge source="error" /> : null}
      </div>

      <StatGrid>
        <StatCard icon="🕳️" tone="warn" label="Missing data" value={isLoading ? "…" : statValue(source, counts.missing)} />
        <StatCard icon="🚫" tone="bad" label="Invalid format" value={isLoading ? "…" : statValue(source, counts.invalid)} />
        <StatCard icon="🕰️" tone="neutral" label="Stale records" value={isLoading ? "…" : statValue(source, counts.stale)} />
      </StatGrid>

      <Card title="Completeness distribution">
        <div className="pad" style={{ display: "grid", gap: 10 }}>
          {isLoading ? (
            <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              {t("loadingDistribution")}
            </p>
          ) : isError ? (
            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              — Distribution unavailable. <DataSourceBadge source="error" />
            </p>
          ) : distribution.length === 0 ? (
            <EmptyState icon="📊" title="No distribution data" message="Nothing to summarise for this selection yet." />
          ) : (
            distribution.map((b) => {
              const pct = distributionTotal > 0 ? (b.count / distributionTotal) * 100 : 0;
              const pctLabel = `${pct.toFixed(1)}%`;
              return (
                <div key={b.label} style={{ display: "grid", gridTemplateColumns: "160px 1fr 110px", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13 }}>{b.label}</span>
                  <span role="img" aria-label={t("distributionBarAria", { label: b.label, pct: pctLabel })} style={{ display: "block" }}>
                    <ProgressBar value={pct} />
                  </span>
                  <span className="num" style={{ fontSize: 13 }}>
                    {b.count.toLocaleString("en-IN")} ({pctLabel})
                  </span>
                </div>
              );
            })
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
        <div className="card-h"><h3>{FILTER_LABEL[filter]} — {entityLabel(entity)}</h3></div>
        {/*
          GAP-CRM-DATA-QUALITY-06: the quality score was shown as a bare
          percentage with no explanation of how it is derived or what each
          filter means. Describe them in plain language. Exact field weights
          and freshness windows are configured server-side; this states the
          general definition rather than inventing specific thresholds.
        */}
        <p style={{ fontSize: 12, color: "var(--muted)", padding: "0 12px", margin: "4px 0" }}>
          Quality score is the share of a record&apos;s expected fields that are present and valid
          (100% = complete and well-formed). <strong>Missing data</strong> = required fields left
          blank; <strong>Invalid format</strong> = fields that fail format checks (e.g. phone, PIN,
          GSTIN, PAN); <strong>Stale records</strong> = records not updated within the office&apos;s
          freshness window.
        </p>
        {isLoading ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>Loading records…</p>
        ) : isError ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
            — Records unavailable right now. <DataSourceBadge source="error" />
          </p>
        ) : records.length === 0 ? (
          <EmptyState icon="✅" title="Nothing flagged" message={t("nothingFlaggedMessage", { entity: entityLabel(entity).toLowerCase() })} />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Record</th>
                <th style={{ textAlign: "end" }}>Quality score</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>
                    {/* The id is for the hover title only: a steward recognises a record by
                        name, and a bare UUID in the row is noise (GAP-CRM-DATA-QUALITY-01). */}
                    <a href={`${DETAIL_BASE[entity]}${r.id}`} title={t("openRecord", { kind: t(entity === "accounts" ? "kindAccount" : "kindContact"), id: r.id })}>
                      {r.name ?? t("unnamedRecord")}
                    </a>
                  </td>
                  <td className="num">{Math.round(r.score * 100)}%</td>
                  <td style={{ fontSize: 13 }}>{r.issues.length > 0 ? r.issues.map(issueText).join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {truncated && records.length > 0 ? (
          <p role="note" style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px", margin: 0 }}>
            {t("truncatedNote", { shown: records.length.toLocaleString("en-IN"), total: flaggedTotal.toLocaleString("en-IN") })}
          </p>
        ) : null}
      </div>
    </>
  );
}
