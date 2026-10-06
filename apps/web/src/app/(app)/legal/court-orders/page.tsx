import Link from "next/link";
import { PageHeader, StatCard } from "../../../_components/ds";
import { todayIST } from "@/lib/formatters";
import { getCourtOrders } from "../../../_data/loaders";
import { CourtOrdersTable, isOverdue } from "./CourtOrdersTable";

export default async function CourtOrdersPage() {
  const { data: items, source } = await getCourtOrders();

  // GAP-LEGAL-COURT-ORDERS-03: use the IST calendar date so an order due
  // "today" in India is not mis-counted as overdue between 00:00–05:30 IST.
  const today = todayIST();

  const total = items.length;
  const pendingCompliance = items.filter((i) => i.complianceRequired && i.status === "pending").length;
  const complied = items.filter((i) => i.status === "complied").length;
  // Shared helper with the table: deadline strictly before today (IST).
  const contemptRisk = items.filter((i) => isOverdue(i, today)).length;

  // GAP-LEGAL-COURT-ORDERS-03: on a load error, show "—" instead of a
  // falsely confident 0 in the stat tiles.
  const dash = (n: number): number | string => (source === "error" ? "—" : n);

  return (
    <div className="wrap">
      <div className="banner" style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink2)", borderRadius: 12, padding: "13px 16px", marginBottom: 18, fontSize: 13 }}>
        <b>Order compliance</b> is routed to the owning department; non-compliance risks contempt.
      </div>
      <PageHeader
        title="Court Order Compliance"
        subtitle="Track implementation of court orders & judgments."
        actions={
          <>
            {/* GAP-LEGAL-COURT-ORDERS-04: real link to the at-risk view instead
                of a disabled "coming soon" placeholder. */}
            <Link href="/legal/court-orders?filter=risk" className="btn ghost">Contempt watch</Link>
            <Link href="/legal/court-orders/new" className="btn primary">+ Record Order</Link>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📜" iconBg="var(--line2)" label="Orders Tracked" value={dash(total)} />
        <StatCard icon="⏰" iconBg="var(--warnbg)" label="Compliance Due" value={dash(pendingCompliance)} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Complied" value={dash(complied)} />
        <StatCard icon="⚠️" iconBg="var(--badbg)" label="Contempt Risk" value={dash(contemptRisk)} />
      </div>
      <CourtOrdersTable items={items} today={today} source={source} />
    </div>
  );
}
