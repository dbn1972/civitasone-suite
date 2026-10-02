import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { getFinanceAuditParaById } from "@/app/_data/loaders";
import { formatIndianDate, formatMoney, humanizeStatus } from "@/lib/formatters";
import { auditParaTone } from "../auditParaTone";

export default async function AuditParaDetailPage({ params }: { params: { id: string } }) {
  const result = await getFinanceAuditParaById(params.id);
  const { data: para, source, status } = result;

  // GAP-FINANCE-AUDIT-PARAS-DETAIL-01: only a real 404 means "not found". Any
  // other failed load (5xx / network / schema) is an outage the user can retry,
  // and a 403 is a permission decision -- never "may have been removed".
  if (source === "error" && status !== 404) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Audit Para Detail" back="/finance/audit-paras" />
        <LoadErrorState result={result} area="audit para" backHref="/finance/audit-paras" />
      </div>
    );
  }

  if (!para) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Audit Para Detail" back="/finance/audit-paras" />
        <EmptyState icon="📝" title="Audit para not found" message="This audit para may have been removed or the ID is invalid." />
      </div>
    );
  }

  // GAP-FINANCE-AUDIT-PARAS-DETAIL-02: read the typed FinanceAuditParaSummary
  // contract directly (finance-service audit/routes.ts serialize() returns
  // exactly these fields for the detail endpoint). No alias lists: a backend
  // rename now fails the loader's zod schema (source "error") instead of
  // silently rendering "No ... on file". Amount is moneyValueMinor (paise).
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Audit Para ${para.paraNo}`}
        subtitle={para.dept || undefined}
        back="/finance/audit-paras"
      />
      <StatGrid>
        <StatCard icon="₹" iconBg="#fce7ee" label="Amount" value={formatMoney(para.moneyValueMinor)} />
        <StatCard icon="🏛️" iconBg="#e7edfd" label="Source" value={para.source} />
        <StatCard icon="🏢" iconBg="#fffaeb" label="Department" value={para.dept} />
        <StatCard icon="⏳" iconBg="#fce7ee" label="Status" value={humanizeStatus(para.status)} />
      </StatGrid>

      <Card title="Register record" padding>
        <div style={{ marginBottom: 12 }}>
          <span className="label">Current Status: </span>
          <StatusPill status={para.status} variant={auditParaTone(para.status)} />
        </div>
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px" }}>
          <dt className="label">Raised</dt>
          <dd style={{ margin: 0 }}>{formatIndianDate(para.createdAt)}</dd>
          <dt className="label">Last updated</dt>
          <dd style={{ margin: 0 }}>{formatIndianDate(para.updatedAt)}</dd>
          <dt className="label">Version</dt>
          <dd style={{ margin: 0 }}>{para.version}</dd>
        </dl>
      </Card>

      <Card title="Observation, reply and timeline" padding>
        <EmptyState
          icon="🕒"
          title="Not captured in the audit register yet"
          message="The audit register stores the para number, source, department, amount and status. Observation text, department reply, action taken and a history timeline are not recorded by the service yet."
        />
      </Card>
    </div>
  );
}
