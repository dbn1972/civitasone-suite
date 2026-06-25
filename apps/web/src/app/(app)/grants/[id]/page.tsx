import { notFound } from "next/navigation";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getGrantById } from "../../../_data/loaders";
import { GrantInstallmentsTable, GrantUCsTable } from "./GrantDetailTables";

export default async function GrantDetailPage({ params }: { params: { id: string } }) {
  const { data: grant, source } = await getGrantById(params.id);

  if (!grant) {
    notFound();
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/grants">Grants</a> <span aria-hidden="true">/</span>{" "}
        <a href="/grants/list">All grants</a>
      </nav>
      <PageHeader
        back="/grants/list"
        backLabel="All grants"
        title={grant.title}
        subtitle={grant.grantNo}
      />
      {source === "error" && <DataSourceBadge source="error" />}

      <main aria-label="Grant details">
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
          <GrantInstallmentsTable installments={grant.installments} />
        </Card>

        <Card title="Utilization Certificates">
          <GrantUCsTable ucs={grant.ucs} />
        </Card>
      </main>
    </>
  );
}
