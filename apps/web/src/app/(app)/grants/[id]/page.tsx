import { notFound } from "next/navigation";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { hasAnyRole } from "@/lib/auth/roleGuard";
import { GRANTS_DISBURSE_ROLES, GRANTS_UC_VALIDATE_ROLES } from "../roles";
import { getGrantById } from "../../../_data/loaders";
import { GrantInstallmentsTable, GrantUCsTable } from "./GrantDetailTables";

export default async function GrantDetailPage({ params }: { params: { id: string } }) {
  const { data: grant, source, status } = await getGrantById(params.id);

  // GAP-GRANTS-DETAIL-02: a failed fetch must NOT masquerade as a genuine
  // 404 "that grant was removed". Only a real 404 (or a successful null)
  // calls notFound(); every other failure shows a retry state.
  if (!grant && source === "error" && status !== 404) {
    return (
      <>
        <PageHeader back="/grants/list" backLabel="All grants" title="Grant" />
        <RefreshErrorState
          error={toHumanError("load", { area: "grant" })}
          backHref="/grants/list"
          source={{ status, area: "grant" }}
        />
      </>
    );
  }

  if (!grant) {
    notFound();
  }

  const roles = getSessionRoles();
  const canRelease = hasAnyRole(roles, GRANTS_DISBURSE_ROLES);
  const canVerify = hasAnyRole(roles, GRANTS_UC_VALIDATE_ROLES);

  return (
    <>
      {/* UX: PageHeader's `back`/`backLabel` props already render the single
          breadcrumb (icon + "All grants" link) below — this page used to ALSO
          render its own manual <nav aria-label="Breadcrumb"> here, which
          doubled it into "← All grants ← All grants". Removed; do not re-add
          a second breadcrumb alongside the `back` prop. */}
      <PageHeader
        back="/grants/list"
        backLabel="All grants"
        title={grant.title}
        subtitle={grant.grantNo}
      />
      {source === "error" && <DataSourceBadge source="error" />}

      <div aria-label="Grant details">
        <Card title="Grant Details" padding>
          <dl className="fields">
            <div>
              <dt className="lab">Grantee</dt>
              <dd>{grant.granteeName ?? "—"}</dd>
            </div>
            <div>
              <dt className="lab">Grantor</dt>
              <dd>{grant.grantor ?? "—"}</dd>
            </div>
            <div>
              <dt className="lab">Purpose</dt>
              <dd>{grant.purpose ?? "—"}</dd>
            </div>
            <div>
              <dt className="lab">Sanction Date</dt>
              <dd>{formatIndianDate(grant.sanctionDate)}</dd>
            </div>
            <div>
              <dt className="lab">Status</dt>
              <dd>
                <StatusPill status={grant.status} />
              </dd>
            </div>
            <div>
              <dt className="lab">Total Amount</dt>
              <dd>{formatMoney(grant.totalAmount)}</dd>
            </div>
            <div>
              <dt className="lab">Disbursed</dt>
              <dd>{formatMoney(grant.disbursedAmount)}</dd>
            </div>
            <div>
              <dt className="lab">Pending</dt>
              <dd>{formatMoney(grant.pendingAmount)}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Installments">
          <GrantInstallmentsTable
            installments={grant.installments}
            grantStatus={grant.status}
            granteeName={grant.granteeName}
            canRelease={canRelease}
          />
        </Card>

        <Card title="Utilization Certificates">
          <GrantUCsTable ucs={grant.ucs} canVerify={canVerify} />
        </Card>
      </div>
    </>
  );
}
