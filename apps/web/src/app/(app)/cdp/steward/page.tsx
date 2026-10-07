import { PageHeader } from "../../../_components/ds";
import { StewardQueuePanel } from "./StewardQueuePanel";
import { getSessionRoles, hasAnyRole, CDP_STEWARD_ROLES } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";

export default function Page() {
  // GAP-CDP-STEWARD-01: a merge is irreversible, so only stewards may decide.
  // cdp-service's POST /v1/cdp/steward/decide is the authority (403 otherwise);
  // this read-side gate hides Approve/Reject from non-stewards so they are not
  // offered a control that would only fail server-side. The queue itself stays
  // visible to anyone the server lets list it.
  const canDecide = hasAnyRole(getSessionRoles(), CDP_STEWARD_ROLES);
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="CDP — Data Steward"
        subtitle="Merge review queue — approve or reject profile-merge suggestions flagged by identity resolution."
        back="/cdp"
        backLabel="Customer Data Platform"
      />
      <StewardQueuePanel canDecide={canDecide} />
    </div>
  );
}
