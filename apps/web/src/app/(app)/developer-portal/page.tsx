import Link from "next/link";
import {
  KeyRound,
  BookOpen,
  Puzzle,
  Webhook,
  FlaskConical,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { PageHeader, StatCard, Card, StatusPill, RefreshErrorState } from "../../_components/ds";
import { getAPIKeys } from "../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

type CapabilityStatus = "active" | "preview" | "planned";

interface Capability {
  Icon: LucideIcon;
  title: string;
  description: string;
  status: CapabilityStatus;
  statusLabel: string;
  href?: string;
  linkLabel?: string;
}

// GAP-DEVELOPER-PORTAL-HOME-02 (roadmap accuracy): status + copy re-derived
// against the shipped marketing surfaces.
//  - API Reference: a curated static reference page EXISTS at /docs/api, so it
//    is no longer "Planned". It is NOT the auto-published-per-release reference
//    the old copy promised, so it is "preview" with honest copy and a link.
//  - Sandbox: /sandbox exists but is a public marketing *demo*, not the
//    "isolated test tenant with disposable credentials" described — so it stays
//    "planned" for the described capability, while linking to the demo that
//    does exist. (DECISION, flagged for HUMAN REVIEW: confirm with product
//    whether the per-release reference / disposable-credential tenant are
//    committed; copy states only what exists today.)
const CAPABILITIES: Capability[] = [
  {
    Icon: KeyRound,
    title: "API Keys",
    description:
      "Issue, rotate and revoke service-to-service and external access keys with scoped permissions.",
    status: "active",
    statusLabel: "Available",
    href: "/tenant-admin/api-keys",
    linkLabel: "Manage API keys",
  },
  {
    Icon: BookOpen,
    title: "API Reference",
    description:
      "A curated reference for the public CivitasOne API. Auto-publishing a full per-release OpenAPI reference for every service is still to come.",
    status: "preview",
    statusLabel: "Preview",
    href: "/docs/api",
    linkLabel: "Open API reference",
  },
  {
    Icon: Puzzle,
    title: "Plugin SDK",
    description:
      "Plugin manifest validator and SDK scaffolding for building tenant-installable extensions.",
    status: "planned",
    statusLabel: "Planned",
  },
  {
    Icon: Webhook,
    title: "Webhooks",
    description:
      "Subscribe external systems to domain events with signed, retried delivery and a delivery log.",
    status: "preview",
    statusLabel: "Preview",
  },
  {
    Icon: FlaskConical,
    title: "Sandbox & Test Tenant",
    description:
      "A public demo sandbox is available today. Bootstrapping an isolated test tenant with seeded data and disposable credentials is still planned.",
    status: "planned",
    statusLabel: "Planned",
    href: "/sandbox",
    linkLabel: "Open demo sandbox",
  },
  {
    Icon: Stethoscope,
    title: "Environment Diagnostics",
    description:
      "Live health, version and connectivity diagnostics for each platform service in your environment.",
    status: "preview",
    statusLabel: "Preview",
  },
];

const STATUS_PILL: Record<CapabilityStatus, string> = {
  active: "active",
  preview: "in progress",
  planned: "draft",
};

export default async function DeveloperPortalPage() {
  const { data: keys, source } = await getAPIKeys();
  const errored = source === "error";

  const totalKeys = keys.length;
  const activeKeys = keys.filter((k) => k.status === "active").length;

  // GAP-DEVELOPER-PORTAL-HOME-03 (FABRICATED): these are counts of a static,
  // hard-coded array describing the platform roadmap — NOT live telemetry — so
  // they are presented as a labelled roadmap legend, not as KPI StatCards sat
  // beside the live key counts.
  const availableCount = CAPABILITIES.filter((c) => c.status === "active").length;
  const previewCount = CAPABILITIES.filter((c) => c.status === "preview").length;
  const plannedCount = CAPABILITIES.filter((c) => c.status === "planned").length;

  return (
    <div className="wrap">
      <PageHeader
        title="Developer Portal"
        subtitle="API access, reference docs, plugin SDK guidance and environment diagnostics."
      />

      {/*
        GAP-DEVELOPER-PORTAL-HOME-01 (FAILMASK): on a load failure the key
        counts must NOT render as the fact "0 keys / 0 active" — that is
        indistinguishable from a genuinely empty tenant. Show an honest,
        retryable error in place of the key stats and the recent-keys card; the
        static capability section still renders. A real zero (source==='api',
        no keys) still shows 0 with no error.
      */}
      {errored ? (
        <div style={{ marginBottom: 18 }}>
          <RefreshErrorState
            error={toHumanError("load", { area: "API keys" })}
            backHref="/dashboard"
            source={{ area: "API keys", code: null }}
          />
        </div>
      ) : (
        <div className="grid g-4" style={{ marginBottom: 18 }}>
          <StatCard icon="🔑" tone="info" label="API keys issued" value={totalKeys} />
          <StatCard icon="✅" tone="good" label="Active keys" value={activeKeys} />
        </div>
      )}

      <Card title="Platform capabilities" padding>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginBottom: 12 }}>
          What the developer platform offers today and what is on the way. Available
          capabilities link straight to their management surface.
        </p>
        {/*
          GAP-DEVELOPER-PORTAL-HOME-03: roadmap legend (static counts of the
          list below), explicitly labelled so it never reads as live metrics.
        */}
        <div
          role="list"
          aria-label="Platform roadmap summary"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}
        >
          <span role="listitem">
            <StatusPill status="active" label={`${availableCount} available`} />
          </span>
          <span role="listitem">
            <StatusPill status="in progress" label={`${previewCount} in preview`} />
          </span>
          <span role="listitem">
            <StatusPill status="draft" label={`${plannedCount} planned`} />
          </span>
        </div>
        <ul
          className="grid g-3"
          style={{ listStyle: "none", margin: 0, padding: 0 }}
          aria-label="Developer platform capabilities"
        >
          {CAPABILITIES.map((cap) => {
            const { Icon } = cap;
            return (
              <li
                key={cap.title}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  // GAP-DEVELOPER-PORTAL-HOME-06 (THEME): theme token, not #fff,
                  // so dark mode shows no white tiles.
                  background: "var(--panel)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: "var(--bg2, var(--line2))",
                      color: "var(--primary)",
                    }}
                  >
                    <Icon size={18} />
                  </span>
                  <StatusPill status={STATUS_PILL[cap.status]} label={cap.statusLabel} />
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", margin: 0 }}>
                  {cap.title}
                </h3>
                <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0, flex: 1 }}>
                  {cap.description}
                </p>
                {cap.href ? (
                  <Link href={cap.href} className="btn ghost" style={{ alignSelf: "flex-start", marginTop: 4 }}>
                    {cap.linkLabel ?? "Open"}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {/*
        GAP-DEVELOPER-PORTAL-HOME-01: the recent-keys card is only meaningful
        when the fetch succeeded. On error we show nothing here (the error
        state above owns the message); on a real success it shows the keys, or
        nothing when there are genuinely none.
      */}
      {!errored && totalKeys > 0 ? (
        <Card title="Recently issued API keys" padding>
          <p style={{ color: "var(--ink2)", fontSize: 14, marginBottom: 12 }}>
            A read-only summary of credentials in this environment. Issue, rotate or revoke
            keys from{" "}
            <Link href="/tenant-admin/api-keys" style={{ color: "var(--primary)", fontWeight: 600 }}>
              API Keys management
            </Link>
            .
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {keys.slice(0, 5).map((k) => (
              <li
                key={k.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  borderBottom: "1px solid var(--line)",
                  paddingBottom: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{k.keyName}</div>
                  <div style={{ fontSize: 12, color: "var(--mut)", fontFamily: "monospace" }}>
                    {k.keyPrefix}••••••••
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>
                    {formatIndianDate(k.createdAt)}
                  </span>
                  <StatusPill status={k.status} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
