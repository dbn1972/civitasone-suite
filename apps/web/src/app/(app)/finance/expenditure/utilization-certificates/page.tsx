import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceUCs } from "../../../../_data/loaders";
import { UCsTable } from "./UCsTable";
import { formatMoney } from "@/lib/formatters";

export default async function UCsPage() {
  const { data: ucs, source } = await getFinanceUCs();

  const submitted = ucs.filter((u) => u.status === "submitted" || u.status === "verified").length;
  const pending = ucs.filter((u) => u.status === "pending" || u.status === "rejected").length;
  const totalAmount = ucs.reduce((s, u) => s + u.amount, 0);

  return (
    <>
      <PageHeader
        title="Utilization Certificates"
        subtitle="Submit and track UCs for grants and scheme expenditure."
        actions={
          <>
            {/* A "Download Format" action used to link here too, identical to
                "+ New UC" — there's no UC template file to download, so the
                dead duplicate button was removed rather than left misleading. */}
            <a href="/finance/expenditure/utilization-certificates/new" className="btn primary">+ New UC</a>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Total UCs" value={ucs.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Submitted / Verified" value={submitted} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Submission" value={pending} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Covered Amount" value={formatMoney(totalAmount)} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside UCsTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title="Utilization certificates">
        <UCsTable ucs={ucs} source={source} />
      </Card>
    </>
  );
}
