import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PlaceholderButton } from "../../../_components/PlaceholderButton";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getLegalOpinions } from "../../../_data/loaders";
import { OpinionsTable } from "./OpinionsTable";

export default async function LegalOpinionsPage() {
  const { data: items, source } = await getLegalOpinions();

  const today = new Date().toISOString().slice(0, 10);

  const total = items.length;
  const pending = items.filter((i) => i.status === "pending").length;
  const issued = items.filter((i) => i.status === "issued").length;

  return (
    <div className="wrap">
      <PageHeader
        title="Legal Opinions"
        subtitle="Searchable repository of legal opinions & precedents."
        actions={
          <>
            <PlaceholderButton label="Search precedents" />
            <Link href="/legal/opinions/new" className="btn primary">+ Seek Opinion</Link>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📚" iconBg="#f1f5f9" label="Opinions" value={total.toLocaleString("en-IN")} />
        <StatCard icon="✍️" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="⏱" iconBg="#eff6ff" label="Avg TAT" value="6.2 d" delta="-1d" up />
        <StatCard icon="🔖" iconBg="#ecfdf3" label="Precedents Tagged" value={issued} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <OpinionsTable items={items} source={source} />
    </div>
  );
}
