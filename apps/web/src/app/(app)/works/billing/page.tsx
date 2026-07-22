import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { BillingTable } from "./BillingTable";

type ApiBill = Record<string, unknown>;

async function getBills() {
  return fetchJson<unknown, ApiBill[]>("/api/v1/works/billing/bills", [], {
    telemetryKey: "works.billing",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiBill[] })?.data;
      return Array.isArray(arr) ? (arr as ApiBill[]) : null;
    },
  });
}

export default async function BillingPage() {
  const { data: bills, source } = await getBills();

  const total = bills.length;
  const pending = bills.filter((b) => String(b.status ?? "").toLowerCase() === "pending").length;
  const finalized = bills.filter((b) => String(b.status ?? "").toLowerCase() === "finalized").length;
  const submitted = bills.filter((b) => String(b.status ?? "").toLowerCase() === "submitted_ifms").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Bills & Measurement Books"
        subtitle="e-MB, RA bills, and abstract bill processing."
        back="/works"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
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
    </main>
  );
}
