import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSAOnboarding } from "@/app/_data/loaders";
import { OnboardingTable } from "./OnboardingTable";

export default async function OnboardingPage() {
  const { data: queue, source } = await getSAOnboarding();
  const newReqs = queue.filter((q) => String(q.stage).toLowerCase() === "new request").length;
  const inProgress = queue.filter((q) => !["new request", "go-live pending", "completed"].includes(String(q.stage).toLowerCase())).length;
  const ready = queue.filter((q) => String(q.stage).toLowerCase() === "go-live pending").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside OnboardingTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <PageHeader title="Tenant Onboarding Queue" subtitle="New tenant requests and onboarding pipeline status." back="/admin" />
      <StatGrid>
        <StatCard icon="📥" iconBg="#eef2ff" label="In Queue" value={queue.length} />
        <StatCard icon="🆕" iconBg="#ecfdf3" label="New Requests" value={newReqs} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="In Progress" value={inProgress} />
        <StatCard icon="🚀" iconBg="#fce7ee" label="Ready for Go-Live" value={ready} />
      </StatGrid>
      <Card title="Onboarding Pipeline">
        <OnboardingTable queue={queue} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
