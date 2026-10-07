import Link from "next/link";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getLegalOpinions } from "../../../_data/loaders";
import { OpinionsTable } from "./OpinionsTable";

export default async function LegalOpinionsPage() {
  const { data: items, source } = await getLegalOpinions();

  // GAP-LEGAL-OPINIONS-01: compute Avg TAT from real data (issuedDate - requestDate)
  // rather than showing a hard-coded "6.2 d" fabricated KPI.
  const total = items.length;
  const pending = items.filter((i) => i.status === "pending").length;
  const issued = items.filter((i) => i.status === "issued").length;
  const issuedItems = items.filter((i) => i.status === "issued" && i.issuedDate && i.requestDate && i.requestDate !== "—");
  let avgTatLabel: string | null = null;
  if (issuedItems.length > 0) {
    let totalDays = 0;
    for (const it of issuedItems) {
      const req = new Date(it.requestDate);
      const iss = new Date(it.issuedDate!);
      if (!isNaN(req.getTime()) && !isNaN(iss.getTime())) {
        totalDays += Math.max(0, Math.round((iss.getTime() - req.getTime()) / 86_400_000));
      }
    }
    avgTatLabel = `${Math.round(totalDays / issuedItems.length)} d`;
  }

  return (
    <div className="wrap">
      <PageHeader
        title="Legal Opinions"
        subtitle="Searchable repository of legal opinions & precedents."
        actions={
          <>
            {/* GAP-LEGAL-OPINIONS-03: removed the non-functional "Search precedents"
                PlaceholderButton — the opinion table's own filter box already
                searches the repository, so a disabled coming-soon control was
                dead UX. */}
            <Link href="/legal/opinions/new" className="btn primary">+ Seek Opinion</Link>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📚" iconBg="#f1f5f9" label="Opinions" value={total.toLocaleString("en-IN")} />
        <StatCard icon="✍️" iconBg="#fffaeb" label="Pending" value={pending} />
        {/* GAP-LEGAL-OPINIONS-01: Avg TAT computed from real issuedDate - requestDate. */}
        <StatCard icon="⏱" iconBg="#eff6ff" label="Avg TAT" value={avgTatLabel} />
        {/* GAP-LEGAL-OPINIONS-03: relabelled from "Precedents Tagged" (no tagging) to "Issued". */}
        <StatCard icon="🔖" iconBg="#ecfdf3" label="Issued" value={issued} />
      </div>
      {/* UX-012: the data-source badge now lives inside OpinionsTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <OpinionsTable items={items} source={source} />
    </div>
  );
}
