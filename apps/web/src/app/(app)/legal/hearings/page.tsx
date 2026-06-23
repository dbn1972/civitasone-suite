import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getLegalHearings } from "../../../_data/loaders";
import { HearingsTable } from "./HearingsTable";

export default async function LegalHearingsPage() {
  const { data: items, source } = await getLegalHearings();

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  const thisWeek = items.filter((i) => i.date >= today && i.date <= weekEnd).length;
  const tmrw = items.filter((i) => i.date === tomorrow).length;
  const prepPending = items.filter((i) => i.status === "scheduled" && i.date >= today && !i.outcome).length;
  const counsels = new Set(items.map((i) => i.court)).size;

  return (
    <div className="wrap">
      <PageHeader
        title="Hearings"
        subtitle="Court-wise hearing calendar with prep & reminders."
        actions={
          <>
            <button className="btn ghost">Calendar view</button>
            <button className="btn primary">Sync cause list</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🗓️" iconBg="#f1f5f9" label="Hearings (wk)" value={thisWeek} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Tomorrow" value={tmrw} />
        <StatCard icon="✍️" iconBg="#fef3f2" label="Prep Pending" value={prepPending} />
        <StatCard icon="👨‍⚖️" iconBg="#eff6ff" label="Courts" value={counsels} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <HearingsTable items={items} source={source} />
    </div>
  );
}
