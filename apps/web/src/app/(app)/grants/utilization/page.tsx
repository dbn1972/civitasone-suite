import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { isUcVerified } from "@/lib/grants/ucStatus";
import { getGrantUtilization } from "../../../_data/loaders";
import { GRANTS_UC_VALIDATE_ROLES } from "../roles";
import { UtilizationTable } from "./UtilizationTable";

export default async function GrantUtilizationPage() {
  const { data: ucs, source } = await getGrantUtilization();
  const failed = source === "error";

  // GAP-GRANTS-UTILIZATION-01: only a checker role sees Verify/Reject; the
  // grant-service validate endpoint enforces the same roles plus separation of
  // duties (validator must differ from the UC submitter).
  const canVerify = hasAnyRole(getSessionRoles(), GRANTS_UC_VALIDATE_ROLES);

  // GAP-GRANTS-UTILIZATION-02: a UC accepted as "validated" OR "verified" counts
  // as verified — not just the "verified" spelling.
  const verified = ucs.filter((u) => isUcVerified(u.status)).length;
  const submitted = ucs.filter((u) => u.status === "submitted").length;
  const pending = ucs.filter((u) => u.status === "pending").length;
  const dash = "—";

  return (
    <>
      <PageHeader
        title="Utilisation Certificates"
        subtitle="UC submission and verification tracking."
        back="/grants"
        backLabel="Grants"
      />
      <div aria-label="Utilisation certificates">
        <StatGrid>
          <StatCard icon="📋" iconBg="#f1f5f9" label="Total" value={failed ? dash : ucs.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Verified" value={failed ? dash : verified} />
          <StatCard icon="📄" iconBg="#dbeafe" label="Submitted" value={failed ? dash : submitted} />
          <StatCard icon="⏳" iconBg="#fef3c7" label="Pending" value={failed ? dash : pending} />
        </StatGrid>
        <Card title="Utilisation Certificates">
          <UtilizationTable ucs={ucs} source={source} canVerify={canVerify} />
        </Card>
      </div>
    </>
  );
}
