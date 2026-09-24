import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getBills } from "../_data/loaders";
import { BillingTable } from "./BillingTable";

export default async function BillingPage() {
  const { data: bills, source } = await getBills();

  const total = bills.length;
  const pending = bills.filter((b) => b.status === "pending" || b.status === "draft").length;
  const finalized = bills.filter((b) => b.status === "finalized").length;
  const submitted = bills.filter((b) => b.status === "submitted_ifms").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside BillingTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <PageHeader
        title="Bills & Measurement Books"
        subtitle="e-MB, RA bills, and abstract bill processing."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link
              href="/works/billing/new-mb"
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Issue MB
            </Link>
          </div>
        }
      />
      <StatGrid>
        <StatCard icon="💰" iconBg="#eff6ff" label="Total Bills" value={total} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Finalized" value={finalized} />
        <StatCard icon="📤" iconBg="#f0fdf4" label="Submitted to IFMS" value={submitted} />
      </StatGrid>
      <Card title="Works Bills">
        <BillingTable bills={bills} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
