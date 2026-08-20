import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getFinanceAuditParaById } from "@/app/_data/loaders";
import { formatMoney } from "@/lib/formatters";

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

/** Best-effort minor-unit amount from a loosely-typed record (number | numeric string | bigint). */
function amountMinorOf(data: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/** Long-form text field with an honest fallback instead of a bare dash. */
function longText(data: Record<string, unknown>, fallback: string, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return fallback;
}

type TimelineRow = { date: string; event: string; actor: string };

function timelineOf(data: Record<string, unknown>): TimelineRow[] {
  const raw = data["timeline"] ?? data["events"] ?? data["history"];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
    .map((r) => ({
      date: field(r, "date", "at", "createdAt"),
      event: field(r, "event", "title", "description"),
      actor: field(r, "actor", "by", "user"),
    }));
}

export default async function AuditParaDetailPage({ params }: { params: { id: string } }) {
  const { data: para, source } = await getFinanceAuditParaById(params.id);

  if (!para) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Audit Para Detail" back="/finance/audit-paras" />
        <EmptyState icon="📝" title="Audit para not found" message="This audit para may have been removed or the ID is invalid." />
      </main>
    );
  }

  const paraNo = field(para, "paraNo", "paraNumber");
  const dept = field(para, "dept", "department");
  const status = field(para, "status");
  // "source" here is the issuing authority (CAG | AG | internal) — a real, always-populated
  // column on finance_audit_paras, unlike the fabricated "Year" stat it replaces below.
  const paraSource = field(para, "source");
  const amountMinor = amountMinorOf(para, "moneyValueMinor", "amountMinor", "amount");
  const timeline = timelineOf(para);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Audit Para ${paraNo}`}
        subtitle={dept !== "—" ? dept : undefined}
        back="/finance/audit-paras"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="₹" iconBg="#fce7ee" label="Amount" value={amountMinor !== undefined ? formatMoney(amountMinor) : "—"} />
        <StatCard icon="🏛️" iconBg="#e7edfd" label="Source" value={paraSource} />
        <StatCard icon="🏢" iconBg="#fffaeb" label="Department" value={dept} />
        <StatCard icon="⏳" iconBg="#fce7ee" label="Status" value={status} />
      </StatGrid>

      <Card title="Observation" padding>
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          {longText(para, "No observation on file.", "observation", "narrative", "description", "subject")}
        </p>
      </Card>

      <Card title="Department Reply" padding>
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          {longText(para, "No reply on file.", "reply", "departmentReply", "response")}
        </p>
      </Card>

      <Card title="Action Taken" padding>
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          {longText(para, "No action recorded.", "actionTaken", "action")}
        </p>
        <div style={{ marginTop: 12 }}>
          <span className="label">Current Status: </span><StatusPill status={status} />
        </div>
      </Card>

      <Card title="Timeline" padding>
        {timeline.length === 0 ? (
          <EmptyState icon="🕒" title="No timeline recorded" message="No history events have been recorded for this audit para." />
        ) : (
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Audit para timeline">
            {timeline.map((item, i) => (
              <li key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: i < timeline.length - 1 ? "1px solid var(--border)" : "none" }}>
                <span style={{ minWidth: 100, fontSize: 13, color: "var(--muted)" }}>{item.date}</span>
                <span style={{ flex: 1 }}>{item.event}</span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{item.actor}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </main>
  );
}
