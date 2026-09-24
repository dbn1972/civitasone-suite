import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getTenders } from "../_data/loaders";
import { TendersTable } from "./TendersTable";

export default async function TendersPage() {
  const { data: tenders, source } = await getTenders();

  const total = tenders.length;
  const open = tenders.filter((t) => t.status === "open").length;
  const closed = tenders.filter((t) => t.status === "closed").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside TendersTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <PageHeader
        title="Tender Pipeline"
        subtitle="Pre-tender, quotation, and award management."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link href="/works/tenders/new" className="btn primary" style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}>+ New pre-tender</Link>
          </div>
        }
      />
      <StatGrid>
        <StatCard icon="📢" iconBg="#eff6ff" label="Total Tenders" value={total} />
        <StatCard icon="📝" iconBg="#fffaeb" label="Open" value={open} />
        <StatCard icon="🏆" iconBg="#f0fdf4" label="Closed" value={closed} />
      </StatGrid>
      <Card title="Tenders">
        <TendersTable tenders={tenders} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
