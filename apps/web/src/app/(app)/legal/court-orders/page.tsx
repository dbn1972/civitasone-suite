import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PlaceholderButton } from "../../../_components/PlaceholderButton";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getCourtOrders } from "../../../_data/loaders";
import { CourtOrdersTable } from "./CourtOrdersTable";

export default async function CourtOrdersPage() {
  const { data: items, source } = await getCourtOrders();

  const today = new Date().toISOString().slice(0, 10);

  const total = items.length;
  const pendingCompliance = items.filter((i) => i.complianceRequired && i.status === "pending").length;
  const complied = items.filter((i) => i.status === "complied").length;
  const contemptRisk = items.filter(
    (i) => i.complianceRequired && i.status === "pending" && i.complianceDeadline && i.complianceDeadline <= today,
  ).length;

  return (
    <div className="wrap">
      <div className="banner" style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", color: "#334155", borderRadius: 12, padding: "13px 16px", marginBottom: 18, fontSize: 13 }}>
        <span aria-hidden="true">📜</span> <b>Order compliance</b> routed to the owning dept; non-compliance risks contempt. Linked to Establishment files for action.
      </div>
      <PageHeader
        title="Court Order Compliance"
        subtitle="Track implementation of court orders & judgments."
        actions={
          <>
            <PlaceholderButton label="Contempt watch" />
            <Link href="/legal/court-orders/new" className="btn primary">+ Record Order</Link>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📜" iconBg="#f1f5f9" label="Orders Tracked" value={total} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Compliance Due" value={pendingCompliance} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Complied" value={complied} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Contempt Risk" value={contemptRisk} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <CourtOrdersTable items={items} today={today} />
    </div>
  );
}
