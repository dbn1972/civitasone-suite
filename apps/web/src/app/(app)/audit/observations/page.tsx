import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { isOpen, isUnderReply, isSettled } from "@/lib/audit/observationLabels";
import { toHumanError } from "@/lib/messages";
import { getAuditObservations } from "../../../_data/loaders";
import { ObservationsTable } from "./ObservationsTable";
import { LogObservationButton } from "./LogObservationButton";

// GAP-AUDIT-OBSERVATIONS-03: sum money as paise with integer (BigInt) math so a
// string paise value never concatenates and large totals never lose precision.
function sumExposure(items: { amount?: number | string | null }[]): bigint {
  let total = 0n;
  for (const i of items) {
    const raw = i.amount ?? 0;
    try {
      total += BigInt(String(raw).trim() === "" ? "0" : String(raw).split(".")[0]);
    } catch {
      // non-numeric amount — skip rather than corrupt the total.
    }
  }
  return total;
}

export default async function AuditObservationsPage() {
  const { data: items, source } = await getAuditObservations();

  if (source === "error") {
    return (
      <div className="wrap">
        <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
          <Link href="/audit/dashboard" className="lnk">Audit</Link>
          <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
          <span aria-current="page">Observations</span>
        </nav>
        <PageHeader title="Audit Observations" subtitle="Internal audit findings with risk & money value." />
        <div className="grid g-4" style={{ marginBottom: 18 }}>
          <StatCard icon="📋" iconBg="var(--badbg)" label="Open" value="—" />
          <StatCard icon="📨" iconBg="var(--warnbg)" label="Under Reply" value="—" />
          <StatCard icon="✅" iconBg="var(--goodbg)" label="Settled" value="—" />
          <StatCard icon="💰" iconBg="var(--infobg)" label="Total exposure" value="—" />
        </div>
        <DataSourceBadge source={source} />
        <Card title="Audit observations">
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "audit observations" })} />
          </div>
        </Card>
      </div>
    );
  }

  // GAP-AUDIT-OBSERVATIONS-02: KPI tiles use the SAME predicates as the table
  // segments so tile counts always equal the filtered row counts.
  const open = items.filter((i) => isOpen(i.status)).length;
  const underReply = items.filter((i) => isUnderReply(i.status)).length;
  const settled = items.filter((i) => isSettled(i.status)).length;
  // GAP-AUDIT-OBSERVATIONS-03: this is an audit *exposure* across all rows, not
  // an outstanding amount — labelled accordingly.
  const totalExposure = sumExposure(items as { amount?: number | string | null }[]);

  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/audit/dashboard" className="lnk">Audit</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
        <span aria-current="page">Observations</span>
      </nav>
      <PageHeader
        title="Audit Observations"
        subtitle="Internal audit findings with risk & money value."
        actions={<LogObservationButton />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📋" iconBg="var(--badbg)" label="Open" value={open} />
        <StatCard icon="📨" iconBg="var(--warnbg)" label="Under Reply" value={underReply} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Settled" value={settled} />
        <StatCard icon="💰" iconBg="var(--infobg)" label="Total exposure" value={formatMoney(totalExposure)} />
      </div>
      <ObservationsTable items={items} />
    </div>
  );
}
