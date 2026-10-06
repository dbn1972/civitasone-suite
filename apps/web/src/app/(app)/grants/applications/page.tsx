import { z } from "zod";
import { PageHeader, Card, StatGrid, StatCard } from "@/app/_components/ds";
import { getGrantApplications, type GrantApplicationSummary } from "../_data";
import { ApplicationsTable } from "./ApplicationsTable";
import { FilterButton, APPLICATION_FILTERS } from "./FilterButton";

// GAP-GRANTS-APPLICATIONS-02: validate the status filter against the real
// application-stage statuses; anything else (incl. the old bogus "pending")
// is ignored so a stray/forged query never silently filters to nothing.
const statusParam = z.enum(APPLICATION_FILTERS);

export default async function GrantApplicationsPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const { data: applications, source } = await getGrantApplications();

  const parsedStatus = statusParam.safeParse(searchParams?.status);
  const activeFilter = parsedStatus.success ? parsedStatus.data : null;
  const rows = activeFilter ? applications.filter((a) => a.status === activeFilter) : applications;

  const failed = source === "error";
  const dash = "—";
  const countBy = (s: GrantApplicationSummary["status"]) => applications.filter((a) => a.status === s).length;

  return (
    <>
      <PageHeader
        title="Grant Applications"
        subtitle="All applications across schemes with approval status."
        back="/grants"
        backLabel="Grants"
        help="grants"
        actions={<FilterButton activeStatus={activeFilter} />}
      />
      <div aria-label="Grant applications">
        <StatGrid>
          <StatCard icon="📄" iconBg="#f1f5f9" label="Total" value={failed ? dash : applications.length} />
          <StatCard icon="📝" iconBg="#e0f2fe" label="Submitted" value={failed ? dash : countBy("submitted")} />
          <StatCard icon="🔎" iconBg="#fef9c3" label="Under review" value={failed ? dash : countBy("under_review")} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Approved" value={failed ? dash : countBy("approved")} />
        </StatGrid>
        <Card title="Applications">
          <ApplicationsTable applications={rows} source={source} />
        </Card>
      </div>
    </>
  );
}
