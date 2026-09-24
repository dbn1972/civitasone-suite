import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinancePFMSScrolls } from "@/app/_data/loaders";
import { PFMSTable } from "./PFMSTable";

export default async function PfmsPage() {
  const { data: scrolls, source } = await getFinancePFMSScrolls();
  // The pfms/batches row calls this field submissionStatus, not status.
  // Real values this enum ever takes (traced every writer in pfms/consumer.ts
  // and payments/schema.ts's default): "pending", "signed", "submitted".
  // "approved"/"rejected" are never written anywhere in this codebase — those
  // two stats were permanently stuck at 0.
  const signed = scrolls.filter((s) => String(s.submissionStatus).toLowerCase() === "signed").length;
  const pending = scrolls.filter((s) => String(s.submissionStatus).toLowerCase() === "pending").length;
  const submitted = scrolls.filter((s) => String(s.submissionStatus).toLowerCase() === "submitted").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="PFMS Integration"
        subtitle="Public Financial Management System — payment scroll tracking and beneficiary verification."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="📜" iconBg="#e7edfd" label="Total Scrolls" value={scrolls.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Signed" value={signed} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="📤" iconBg="#eff6ff" label="Submitted" value={submitted} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside PFMSTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title="Payment Scrolls">
        <PFMSTable scrolls={scrolls} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
