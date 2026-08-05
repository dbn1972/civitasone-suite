import { PageHeader } from "../../../_components/ds";
import { StageAgeingDashboard } from "../../../_components/crm/StageAgeingDashboard";

/** OP-005 — opportunities exceeding their stage day-limit + limits config. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Stage Ageing"
        subtitle="Opportunities that have stalled past their configured stage limit, plus the per-stage day limits that drive the alert."
        back="/crm"
        backLabel="CRM"
      />
      <StageAgeingDashboard />
    </>
  );
}
