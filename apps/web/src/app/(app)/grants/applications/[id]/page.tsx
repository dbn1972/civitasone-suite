import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, StatGrid, StatCard, StatusPill, LoadErrorState } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getSessionRoles, getSessionUserId, hasAnyRole } from "@/lib/auth/roleGuard";
import { GRANTS_MAKER_ROLES, GRANT_REVIEWER_ROLES } from "../../roles";
import { getApplicationById, getSchemeById } from "../../_data";
import { getGranteeById } from "@/app/_data/loaders";
import { ApplicationActions } from "./ApplicationActions";

const STATUS_ACTIONS: Record<string, string[]> = {
  submitted:    ["assign-reviewer", "score", "approve", "reject"],
  under_review: ["score", "approve", "reject"],
  approved:     [],
  rejected:     [],
  cancelled:    [],
  draft:        ["withdraw"],
};

// Statuses that are genuinely terminal — no actions AND no "what next" note.
const TERMINAL_STATUSES = new Set(["approved", "rejected", "cancelled", "withdrawn", "completed"]);

function amountLabel(minor: number) {
  return minor > 0 ? formatMoney(minor) : "—";
}

export default async function ApplicationDetailPage({ params }: { params: { id: string } }) {
  const result = await getApplicationById(params.id);
  const { data: application, source, status } = result;

  // GAP-GRANTS-APPLICATIONS-DETAIL-03: a failed fetch must not read as a 404
  // "Page not found". Only a real 404 (or a successful null) → notFound();
  // every other failure → a status-aware retry/permission state.
  if (!application && source === "error" && status !== 404) {
    return (
      <>
        <PageHeader back="/grants/applications" backLabel="Applications" title="Application" />
        <LoadErrorState result={result} area="application" backHref="/grants/applications" />
      </>
    );
  }
  if (!application) {
    notFound();
  }

  const actions = STATUS_ACTIONS[application.status] ?? [];

  // GAP-GRANTS-APPLICATIONS-DETAIL-01/02: role + maker-checker gating.
  const roles = getSessionRoles();
  const viewerId = getSessionUserId();
  const canApprove = hasAnyRole(roles, GRANTS_MAKER_ROLES);
  const canReview = hasAnyRole(roles, GRANT_REVIEWER_ROLES);
  const isOwnApplication = viewerId != null && application.submittedBy === viewerId;

  // GAP-GRANTS-APPLICATIONS-DETAIL-04/06: resolve the scheme (name + sanction
  // range) and grantee (name) so the UI shows meaning, not uuids, and the
  // approve dialog can validate against the scheme range.
  const [schemeRes, granteeRes] = await Promise.all([
    application.schemeId ? getSchemeById(application.schemeId) : Promise.resolve(null),
    application.beneficiaryId ? getGranteeById(application.beneficiaryId) : Promise.resolve(null),
  ]);
  const scheme = schemeRes?.data ?? null;
  const grantee = granteeRes?.data ?? null;

  const hasEvaluation =
    application.technicalScore != null || application.financialScore != null || !!application.recommendation;

  return (
    <>
      <PageHeader
        back="/grants/applications"
        backLabel="Applications"
        title={application.grantNo ?? "Application Detail"}
        subtitle={application.purpose.slice(0, 80)}
        actions={<StatusPill status={application.status} />}
      />

      <StatGrid>
        <StatCard icon="💰" iconBg="#ecfdf5" label="Requested" value={amountLabel(application.amountRequestedMinor)} />
        <StatCard
          icon="✅"
          iconBg="#dbeafe"
          label="Approved"
          value={application.amountApprovedMinor != null ? amountLabel(application.amountApprovedMinor) : "Pending"}
        />
        <StatCard icon="📋" iconBg="#fef3c7" label="Status" value={application.status.replace(/_/g, " ")} />
        <StatCard icon="📅" iconBg="#f1f5f9" label="Submitted" value={application.submittedAt ? formatIndianDate(application.submittedAt) : "—"} />
      </StatGrid>

      <Card title="Application Details" padding>
        <dl className="fields">
          {/* GAP-GRANTS-APPLICATIONS-DETAIL-06: scheme + grantee NAMES, not uuids. */}
          <div>
            <dt className="lab">Scheme</dt>
            <dd>{scheme ? `${scheme.name} (${scheme.code})` : "—"}</dd>
          </div>
          <div>
            <dt className="lab">Grantee</dt>
            <dd>{grantee?.name ?? "—"}</dd>
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
            <dt className="lab">Submitted At</dt>
            <dd>{application.submittedAt ? formatIndianDate(application.submittedAt) : "—"}</dd>
          </div>
          {application.approvedAt && (
            <div>
              <dt className="lab">Approved At</dt>
              <dd>{formatIndianDate(application.approvedAt)}</dd>
            </div>
          )}
        </dl>
      </Card>

      {/* GAP-GRANTS-APPLICATIONS-DETAIL-05: show the evaluation after scoring. */}
      {hasEvaluation && (
        <Card title="Evaluation" padding>
          <dl className="fields">
            <div><dt className="lab">Technical score</dt><dd>{application.technicalScore ?? "—"}</dd></div>
            <div><dt className="lab">Financial score</dt><dd>{application.financialScore ?? "—"}</dd></div>
            <div><dt className="lab">Total score</dt><dd>{application.totalScore ?? "—"}</dd></div>
            {application.reviewerRef && (
              <div><dt className="lab">Reviewer</dt><dd className="mono">{application.reviewerRef}</dd></div>
            )}
            {application.recommendation && (
              <div><dt className="lab">Recommendation</dt><dd style={{ gridColumn: "1 / -1" }}>{application.recommendation}</dd></div>
            )}
          </dl>
        </Card>
      )}

      {actions.length > 0 ? (
        <Card title="Actions" padding>
          <ApplicationActions
            applicationId={params.id}
            actions={actions}
            canApprove={canApprove}
            canReview={canReview}
            isOwnApplication={isOwnApplication}
            requestedMinor={application.amountRequestedMinor}
            minMinor={scheme?.minAmountMinor ?? null}
            maxMinor={scheme?.maxAmountMinor ?? null}
          />
        </Card>
      ) : !TERMINAL_STATUSES.has(application.status) ? (
        // GAP-GRANTS-APPLICATIONS-DETAIL-07: a non-terminal status with no
        // mapped actions gets an explanatory note instead of silent emptiness.
        <Card title="Actions" padding>
          <p style={{ color: "var(--ink2)", margin: 0 }}>
            No actions are available for this application in status “{application.status.replace(/_/g, " ")}”.
          </p>
        </Card>
      ) : null}

      {application.status === "approved" && (
        <Card title="Next Steps" padding>
          <p style={{ color: "var(--ink2)", marginBottom: 12 }}>
            This application has been approved. You can now schedule disbursement installments.
          </p>
          {/* GAP-GRANTS-APPLICATIONS-DETAIL-07: next/link, and the installments
              page reads ?appId to scope to this application. */}
          <Link href={`/grants/installments?appId=${params.id}`} className="btn primary">
            View installments
          </Link>
        </Card>
      )}
    </>
  );
}
