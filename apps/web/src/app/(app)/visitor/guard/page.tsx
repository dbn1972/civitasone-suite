import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader } from "@/app/_components/ds";
import { getVisitRequests, getVisitorLocations } from "../_data/loaders";
import { isToday } from "../_data/format";
import { GuardConsole } from "./GuardConsole";

export const dynamic = "force-dynamic";

export default async function GuardConsolePage() {
  const [locations, approved] = await Promise.all([
    getVisitorLocations(),
    getVisitRequests("approved"),
  ]);

  const expectedToday = approved.data.filter((r) => isToday(r.scheduledAt));
  const source =
    locations.source === "error" || approved.source === "error" ? "error" : "api";

  return (
    <>
      <PageHeader
        title="Guard Console"
        subtitle="Verify passes at the gate, track occupancy and manage the inside-now roster."
        back="/visitor"
        backLabel="Visitor"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <GuardConsole
        locations={locations.data}
        expectedToday={expectedToday}
        expectedTodaySource={approved.source}
      />
    </>
  );
}
