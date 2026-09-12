import { notFound } from "next/navigation";
import { PageHeader, Card, StatGrid, StatCard, StatusPill, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getApplicationById } from "../../_data";
import { ApplicationActions } from "./ApplicationActions";

const STATUS_ACTIONS: Record<string, string[]> = {
  submitted:    ["assign-reviewer", "score", "approve", "reject"],
  under_review: ["score", "approve", "reject"],
  approved:     [],
  rejected:     [],
  cancelled:    [],
  draft:        ["withdraw"],
};

function amountLabel(minor: number) {
  return minor > 0 ? formatMoney(minor) : "—";
}

export default async function ApplicationDetailPage({ params }: { params: { id: string } }) {
  const { data: application, source } = await getApplicationById(params.id);

  if (!application) {
    notFound();
  }

  const actions = STATUS_ACTIONS[application.status] ?? [];

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/grants">Grants</a>{" "}
        <span aria-hidden="true">/</span>{" "}
        <a href="/grants/applications">Applications</a>{" "}
        <span aria-hidden="true">/</span>{" "}
        <span aria-current="page">{application.grantNo ?? params.id.slice(0, 8)}</span>
      </nav>

      <PageHeader
        back="/grants/applications"
        backLabel="Applications"
        title={application.grantNo ?? "Application Detail"}
        subtitle={application.purpose.slice(0, 80)}
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <StatusPill status={application.status} />
            {source === "error" && <DataSourceBadge source="error" />}
          </div>
        }
      />

      <StatGrid>
        <StatCard
          icon="💰"
          iconBg="#ecfdf5"
          label="Requested"
          value={amountLabel(application.amountRequestedMinor)}
        />
        <StatCard
          icon="✅"
          iconBg="#dbeafe"
          label="Approved"
          value={application.amountApprovedMinor != null ? amountLabel(application.amountApprovedMinor) : "Pending"}
        />
        <StatCard
          icon="📋"
          iconBg="#fef3c7"
          label="Status"
          value={application.status.replace(/_/g, " ")}
        />
        <StatCard
          icon="📅"
          iconBg="#f1f5f9"
          label="Submitted"
          value={application.submittedAt ? formatIndianDate(application.submittedAt) : "—"}
        />
      </StatGrid>

      <Card title="Application Details" padding>
        <dl className="fields">
          <div>
            <dt className="lab">Application ID</dt>
            <dd style={{ fontFamily: "monospace", fontSize: 13 }}>{application.id}</dd>
          </div>
          <div>
            <dt className="lab">Grant No</dt>
            <dd>{application.grantNo ?? "Not yet assigned"}</dd>
          </div>
          <div>
            <dt className="lab">Status</dt>
            <dd><StatusPill status={application.status} /></dd>
          </div>
          <div>
            <dt className="lab">Purpose</dt>
            <dd style={{ gridColumn: "1 / -1" }}>{application.purpose}</dd>
          </div>
          <div>
            <dt className="lab">Amount Requested</dt>
            <dd>{amountLabel(application.amountRequestedMinor)}</dd>
          </div>
          <div>
            <dt className="lab">Amount Approved</dt>
            <dd>
              {application.amountApprovedMinor != null
                ? amountLabel(application.amountApprovedMinor)
                : <span style={{ color: "var(--ink2)" }}>Pending approval</span>}
            </dd>
          </div>
          <div>
            <dt className="lab">Submitted By</dt>
            <dd>{application.submittedBy ?? "—"}</dd>
          </div>
          <div>
            <dt className="lab">Submitted At</dt>
            <dd>{application.submittedAt ? formatIndianDate(application.submittedAt) : "—"}</dd>
          </div>
          {application.approvedBy && (
            <div>
              <dt className="lab">Approved By</dt>
              <dd>{application.approvedBy}</dd>
            </div>
          )}
          {application.approvedAt && (
            <div>
              <dt className="lab">Approved At</dt>
              <dd>{formatIndianDate(application.approvedAt)}</dd>
            </div>
          )}
        </dl>
      </Card>

      {actions.length > 0 && (
        <Card title="Actions" padding>
          <ApplicationActions applicationId={params.id} actions={actions} />
        </Card>
      )}

      {application.status === "approved" && (
        <Card title="Next Steps" padding>
          <p style={{ color: "var(--ink2)", marginBottom: 12 }}>
            This application has been approved. You can now schedule disbursement installments.
          </p>
          <a
            href={`/grants/installments?appId=${params.id}`}
            className="btn primary"
          >
            View / Schedule Installments
          </a>
        </Card>
      )}
    </>
  );
}
