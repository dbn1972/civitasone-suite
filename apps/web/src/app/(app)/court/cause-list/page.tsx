import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader } from "@/app/_components/ds";
import { getCases } from "../_data/loaders";
import { CauseListConsole } from "./CauseListConsole";

export const dynamic = "force-dynamic";

export default async function CauseListPage() {
  const cases = await getCases();

  return (
    <>
      <PageHeader
        title="Daily Cause List"
        subtitle="Generate the day's cause list for a court, then list cases onto numbered slots and courtrooms for the bench."
        back="/court"
        backLabel="Court"
      />
      {cases.source === "error" && <DataSourceBadge source="error" />}
      <CauseListConsole cases={cases.data} casesSource={cases.source} />
    </>
  );
}
