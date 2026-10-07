import Link from "next/link";
import { PageHeader, Card } from "@/app/_components/ds";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { AA_CREATE_ROLES, TS_CREATE_ROLES } from "@/lib/auth/workRoles";
import { getApprovalsAa, getApprovalsTs } from "../_data/loaders";
import { ApprovalsTable } from "./ApprovalsTable";

export default async function ApprovalsPage() {
  const [{ data: aaApprovals, source: aaSource }, { data: tsApprovals, source: tsSource }] = await Promise.all([
    getApprovalsAa(),
    getApprovalsTs(),
  ]);

  const source = aaSource === "error" || tsSource === "error" ? "error" : "api";

  // Role-gate the create actions (GAP-WORKS-APPROVALS-05): the works-service
  // only accepts AA/TS creates from WRITE_ROLES, so a user without them would
  // meet a 403 after navigating. Hide the links instead. The create pages are
  // the server's authority; this is UX + defence-in-depth.
  const roles = getSessionRoles();
  const canCreateAa = hasAnyRole(roles, AA_CREATE_ROLES);
  const canCreateTs = hasAnyRole(roles, TS_CREATE_ROLES);

  return (
    <div className="page-main wrap">
      {/* UX-012: the data-source badge and the stat counts both live inside
          ApprovalsTable now, driven by the same useSeededResource calls that
          produce its rows — so a cache fallback can never make the counts
          disagree with the rows on screen (GAP-WORKS-APPROVALS-03). */}
      <PageHeader
        title="AA / TS Register"
        subtitle="Administrative Approval and Technical Sanction registers."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {canCreateAa ? (
              <Link href="/works/approvals/new" className="btn sm">+ New AA</Link>
            ) : null}
            {canCreateTs ? (
              <Link href="/works/approvals/ts-new" className="btn primary sm">+ New TS</Link>
            ) : null}
          </div>
        }
      />
      <Card title="Approvals">
        <ApprovalsTable aaApprovals={aaApprovals} tsApprovals={tsApprovals} source={source} />
      </Card>
    </div>
  );
}
