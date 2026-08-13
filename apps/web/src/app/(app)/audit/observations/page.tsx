import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getAuditObservations } from "../../../_data/loaders";
import { ObservationsTable } from "./ObservationsTable";
import { LogObservationButton } from "./LogObservationButton";

export default async function AuditObservationsPage() {
  const { data: items, source } = await getAuditObservations();

  const open = items.filter((i) => i.status === "open").length;
  const underReply = items.filter((i) => i.status === "replied").length;
  const settled = items.filter((i) => i.status === "closed").length;
  const totalAmount = items.reduce((s, i) => s + (i.amount ?? 0), 0);

  return (
    <main className="wrap">
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
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Settled (FY)" value={settled} />
        <StatCard icon="💰" iconBg="var(--infobg)" label="Money Value" value={totalAmount > 0 ? formatMoney(totalAmount) : "₹0.00"} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <ObservationsTable items={items} />
    </main>
  );
}
