import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader } from "@/app/_components/ds";
import { getVisitRequests } from "../_data/loaders";
import { isToday } from "../_data/format";
import { HostPortal } from "./HostPortal";

export const dynamic = "force-dynamic";

export default async function HostPortalPage() {
  const [pending, approved] = await Promise.all([
    getVisitRequests("pending_approval"),
    getVisitRequests("approved"),
  ]);

  const expectedToday = approved.data.filter((r) => isToday(r.scheduledAt));
  const source =
    pending.source === "error" || approved.source === "error" ? "error" : "api";

  return (
    <>
      <PageHeader
        title="Host Portal"
        subtitle="Approve or reject the visitors requesting to see you, and review today's expected arrivals."
        back="/visitor"
        backLabel="Visitor"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <HostPortal
        pending={pending.data}
        pendingSource={pending.source}
        expectedToday={expectedToday}
        expectedTodaySource={approved.source}
      />
    </>
  );
}
