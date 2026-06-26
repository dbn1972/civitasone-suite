import Link from "next/link";
import { PageHeader, StatCard, Card, StatusPill } from "../../_components/ds";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { getAPIKeys } from "../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

type CapabilityStatus = "active" | "preview" | "planned";

interface Capability {
  icon: string;
  title: string;
  description: string;
  status: CapabilityStatus;
  statusLabel: string;
  href?: string;
  linkLabel?: string;
}

const CAPABILITIES: Capability[] = [
  {
    icon: "🔑",
    title: "API Keys",
    description:
      "Issue, rotate and revoke service-to-service and external access keys with scoped permissions.",
    status: "active",
    statusLabel: "Available",
    href: "/tenant-admin/api-keys",
    linkLabel: "Manage API keys",
  },
  {
    icon: "📘",
    title: "API Reference",
    description:
      "Auto-published OpenAPI reference for every CivitasOne service endpoint, versioned per release.",
    status: "planned",
    statusLabel: "Planned",
  },
  {
    icon: "🧩",
    title: "Plugin SDK",
    description:
      "Plugin manifest validator and SDK scaffolding for building tenant-installable extensions.",
    status: "planned",
    statusLabel: "Planned",
  },
  {
    icon: "🪝",
    title: "Webhooks",
    description:
      "Subscribe external systems to domain events with signed, retried delivery and a delivery log.",
    status: "preview",
    statusLabel: "Preview",
  },
  {
    icon: "🧪",
    title: "Sandbox & Test Tenant",
    description:
      "Bootstrap an isolated test tenant with seeded data and disposable sandbox credentials.",
    status: "planned",
    statusLabel: "Planned",
  },
  {
    icon: "🩺",
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

  const totalKeys = keys.length;
  const activeKeys = keys.filter((k) => k.status === "active").length;
  const availableCount = CAPABILITIES.filter((c) => c.status === "active").length;
  const plannedCount = CAPABILITIES.filter((c) => c.status !== "active").length;

  return (
    <div className="wrap">
      <PageHeader
        title="Developer Portal"
        subtitle="API access, reference docs, plugin SDK guidance and environment diagnostics."
      />

      {source === "error" ? (
        <div style={{ marginBottom: 18 }}>
          <DataSourceBadge source={source} />
        </div>
      ) : null}

      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#f1f5f9" label="API keys issued" value={totalKeys} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active keys" value={activeKeys} />
        <StatCard icon="🚀" iconBg="#eef2ff" label="Capabilities available" value={availableCount} />
        <StatCard icon="🛠️" iconBg="#fffaeb" label="On the roadmap" value={plannedCount} />
      </div>

      <Card title="Platform capabilities" padding>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginBottom: 16 }}>
          What the developer platform offers today and what is on the way. Available
          capabilities link straight to their management surface.
        </p>
        <ul
          className="grid g-3"
          style={{ listStyle: "none", margin: 0, padding: 0 }}
          aria-label="Developer platform capabilities"
        >
          {CAPABILITIES.map((cap) => (
            <li
              key={cap.title}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                background: "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">
                  {cap.icon}
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
          ))}
        </ul>
      </Card>

      {totalKeys > 0 ? (
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
