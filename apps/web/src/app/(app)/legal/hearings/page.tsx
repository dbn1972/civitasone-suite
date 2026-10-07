import { PageHeader, StatCard } from "../../../_components/ds";
import { getLegalHearings } from "../../../_data/loaders";
import { HearingsTable } from "./HearingsTable";
import { HearingsActions } from "./HearingsActions";
import { todayIST, addDaysIST } from "@/lib/formatters";

export default async function LegalHearingsPage() {
  const { data: items, source } = await getLegalHearings();

  // GAP-LEGAL-HEARINGS-04: IST calendar date (not UTC) so the "Today"/"This
  // week" window and the countdown are correct between 00:00-05:30 IST.
  const today = todayIST();
  const tomorrow = addDaysIST(today, 1);
  const weekEnd = addDaysIST(today, 7);

  const thisWeek = items.filter((i) => i.date >= today && i.date <= weekEnd).length;
  const tmrw = items.filter((i) => i.date === tomorrow).length;
  const prepPending = items.filter((i) => i.status === "scheduled" && i.date >= today && !i.outcome).length;
  const counsels = new Set(items.map((i) => i.court)).size;

  return (
    <div className="wrap">
      <PageHeader
        title="Hearings"
        subtitle="Court-wise hearing calendar with prep & reminders."
        actions={<HearingsActions />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🗓️" iconBg="#f1f5f9" label="Hearings (wk)" value={thisWeek} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Tomorrow" value={tmrw} />
        <StatCard icon="✍️" iconBg="#fef3f2" label="Prep Pending" value={prepPending} />
        <StatCard icon="👨‍⚖️" iconBg="#eff6ff" label="Courts" value={counsels} />
      </div>
      {/* GAP-LEGAL-HEARINGS-04: pass IST today to the client component so
          the filter/countdown match the server-rendered stats without a
          hydration mismatch. */}
      <HearingsTable items={items} source={source} today={today} />
    </div>
  );
}
