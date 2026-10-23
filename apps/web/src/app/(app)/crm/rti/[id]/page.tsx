import { getTranslations } from "next-intl/server";
import { fetchJson } from "../../../../_data/apiClient";
import { PageHeader, StatusPill, Card, LoadErrorState, EmptyState, Masked } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { RtiActions } from "./RtiActions";
import { formatMoney, formatIndianDateTime } from "@/lib/formatters";
import { rupeesNumberToMinorString } from "@/lib/money";
import { getSessionRoles, hasAnyRole, CRM_PII_READ_ROLES } from "@/lib/auth/roleGuard";
import { localisedSectionLabel } from "@/lib/crm/rti";
import { CaseStatusTimeline, type CaseHistoryEntry } from "../../../../_components/crm/CaseStatusTimeline";

type Translate = (key: string, values?: Record<string, string | number>) => string;

const MODE_KEY: Record<string, string> = {
  online: "modeOnline",
  post: "modePost",
  email: "modeEmail",
  in_person: "modeInPerson",
  by_hand: "modeByHand",
};

/**
 * GAP-CRM-RTI-NEW-01: render the application fee from the paise (minor-units)
 * field with formatMoney (₹ lakh/crore grouping, 2 decimals, bigint-safe),
 * never the raw rupees number interpolated as `₹${r.feeAmount}`. Falls back to
 * the legacy rupees field (×100 -> paise) for any row that predates the
 * fee_amount_minor backfill.
 */
function feeDisplay(
  r: { feePaid: boolean; feeAmountMinor?: string | number | null; feeAmount?: number },
  t: Translate,
): string {
  if (!r.feePaid) return t("feeNotPaid");
  const minor =
    r.feeAmountMinor !== undefined && r.feeAmountMinor !== null
      ? r.feeAmountMinor
      : typeof r.feeAmount === "number"
        ? rupeesNumberToMinorString(r.feeAmount)
        : null;
  if (minor === null) return t("feePaid");
  const money = formatMoney(minor);
  return money === "—" ? t("feePaid") : t("feePaidAmount", { amount: money });
}

interface RtiDetail {
  id: string;
  referenceNo: string;
  section: string;
  departmentRef: string;
  applicantName: string;
  applicantContact?: string;
  subject: string;
  description: string;
  status: string;
  feePaid: boolean;
  feeAmount?: number;
  feeAmountMinor?: string | number | null;
  mode?: string | null;
  receivedAt?: string;
  /** GAP-CRM-RTI-DETAIL-04: origin of the latest s.6(3) transfer (null/absent = never transferred). */
  previousDepartmentRef?: string | null;
  transferredAt?: string | null;
  dueAt?: string;
  firstAppealDueAt?: string;
  respondedAt?: string;
  responseText?: string;
  firstAppealOrder?: string | null;
  firstAppealOutcome?: string | null;
  firstAppealDecidedAt?: string | null;
  secondAppealAt?: string | null;
  secondAppealRef?: string | null;
  disposedAt?: string | null;
  disposalReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

function fmt(dt?: string) {
  if (!dt) return "—";
  return formatIndianDateTime(dt);
}

// crm-service's RTI route ACL (rti-route.ts CRM_ROLES). A user outside this
// set is 403'd by every RTI mutation endpoint, so the UI neither offers the
// actions nor reveals applicant PII to them.
const CRM_RTI_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

// GAP-CRM-RTI-DETAIL-01: crm-service RTI_APPELLATE_ROLES — only these may
// record the First Appellate Authority's decision or dispose a request.
const RTI_APPELLATE_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const FAA_OUTCOME_KEY: Record<string, string> = {
  allowed: "outcomeAllowed",
  partly_allowed: "outcomePartlyAllowed",
  dismissed: "outcomeDismissed",
};

/**
 * GAP-CRM-RTI-DETAIL-03 / F1-02: the applicant's name and contact are personal data.
 * This page asks the server for them MASKED for every viewer (`?maskPii=true`, which can
 * only reduce what crm-service returns -- it already masks for roles outside the CRM
 * PII-read set). A PII-read role then gets the audited reveal control: a stated reason
 * is required and crm-service writes the `pii_reveal` audit event before it returns the
 * clear value (POST /v1/crm/pii/reveal). Everyone else sees the masked value and no
 * Reveal button. The page never holds a clear value for anyone.
 */

export default async function RtiDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const t = await getTranslations("crmRtiDetail");
  const tSection = await getTranslations("crmRtiSections");
  const roles = getSessionRoles();
  const canAct = roles.some((role) => CRM_RTI_ROLES.includes(role));
  const canDecide = roles.some((role) => RTI_APPELLATE_ROLES.includes(role));
  const canRevealPii = hasAnyRole(roles, CRM_PII_READ_ROLES);
  const result = await fetchJson<unknown, RtiDetail | null>(
    `/api/v1/crm/rti/${params.id}?maskPii=true`,
    null,
    { revalidateSeconds: 0, telemetryKey: "crm.rti.detail",
      mapResponse: (p) => {
        if (p && typeof p === "object" && "data" in (p as object)) {
          return (p as { data: RtiDetail }).data;
        }
        return null;
      },
    },
  );
  const r = result.data;
  const source = result.source;

  // F6-01: status timeline — separate GET, so the detail contract is unchanged.
  const { data: history } = await fetchJson<unknown, CaseHistoryEntry[]>(
    `/api/v1/crm/rti/${params.id}/history`,
    [],
    {
      revalidateSeconds: 0,
      telemetryKey: "crm.rti.history",
      mapResponse: (p) => {
        if (p && typeof p === "object" && Array.isArray((p as { data?: unknown }).data)) {
          return (p as { data: CaseHistoryEntry[] }).data;
        }
        return [];
      },
    },
  );

  // GAP-CRM-GRIEVANCES-DETAIL-07 (also RTI): an outage must not be titled as a
  // missing record. Only a real 404 (or a successful empty body) is "not
  // found"; every other failure gets the status-aware retry/permission state.
  if (!r && source === "error" && result.status !== 404) {
    return (
      <>
        <PageHeader title={t("title")} back="/crm/rti" backLabel={t("backLabel")} />
        <LoadErrorState result={result} area="RTI request" backHref="/crm/rti" />
      </>
    );
  }

  if (!r) {
    return (
      <>
        <PageHeader title={t("notFoundTitle")} back="/crm/rti" backLabel={t("backLabel")} />
        <Card>
          <EmptyState
            icon="📭"
            title={t("notFoundTitle")}
            message={t("notFoundMessage")}
            action={<a className="btn" href="/crm/rti">{t("backToApplications")}</a>}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={r.referenceNo ?? t("title")}
        subtitle={r.subject}
        back="/crm/rti"
        backLabel={t("backLabel")}
        actions={
          <RtiActions
            id={r.id}
            status={r.status}
            canAct={canAct}
            canDecide={canDecide}
            firstAppealDueAt={r.firstAppealDueAt ?? null}
            firstAppealDecidedAt={r.firstAppealDecidedAt ?? null}
            disposedAt={r.disposedAt ?? null}
            receivedAt={r.receivedAt ?? r.createdAt ?? null}
          />
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <div className="detail-split">
        {/* Main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title={t("detailsCard")}>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: "10px 16px",
                fontSize: 14,
                margin: "12px 16px",
              }}
            >
              <dt style={{ color: "var(--ink2)" }}>{t("reference")}</dt>
              <dd><code style={{ fontSize: 13 }}>{r.referenceNo ?? "—"}</code></dd>
              <dt style={{ color: "var(--ink2)" }}>{t("section")}</dt>
              <dd>{localisedSectionLabel(tSection, r.section)}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("status")}</dt>
              <dd><StatusPill status={r.status} /></dd>
              <dt style={{ color: "var(--ink2)" }}>{t("department")}</dt>
              <dd>
                {r.departmentRef}
                {/* GAP-CRM-RTI-DETAIL-04: where a transferred request came from, and when. */}
                {r.previousDepartmentRef ? (
                  <span style={{ display: "block", fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>
                    {r.transferredAt
                      ? t("transferredFrom", { from: r.previousDepartmentRef, date: fmt(r.transferredAt) })
                      : t("transferredFromNoDate", { from: r.previousDepartmentRef })}
                  </span>
                ) : null}
              </dd>
              <dt style={{ color: "var(--ink2)" }}>{t("fee")}</dt>
              <dd>{feeDisplay(r, t)}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("modeOfReceipt")}</dt>
              <dd>{r.mode ? (MODE_KEY[r.mode] ? t(MODE_KEY[r.mode]) : r.mode) : "—"}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("received")}</dt>
              <dd>{fmt(r.receivedAt ?? r.createdAt)}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("responseDue")}</dt>
              <dd>{fmt(r.dueAt)}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("firstAppealDue")}</dt>
              <dd>{fmt(r.firstAppealDueAt)}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("lastUpdated")}</dt>
              <dd>{fmt(r.updatedAt)}</dd>
            </dl>
          </Card>

          <Card title={t("informationRequested")}>
            <p
              style={{
                margin: "12px 16px",
                fontSize: 14,
                color: "var(--ink)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {r.description}
            </p>
          </Card>

          {r.responseText && (
            <Card title={t("responseCard")}>
              <p
                style={{
                  margin: "12px 16px 4px",
                  fontSize: 14,
                  color: "var(--ink)",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {r.responseText}
              </p>
              {r.respondedAt && (
                <p style={{ margin: "0 16px 12px", fontSize: 12, color: "var(--ink2)" }}>
                  {t("responded", { date: fmt(r.respondedAt) })}
                </p>
              )}
            </Card>
          )}

          {/* GAP-CRM-RTI-DETAIL-01: the appeal chain as a statutory record. */}
          {(r.firstAppealDecidedAt || r.secondAppealAt || r.disposedAt) && (
            <Card title={t("appealDisposalTitle")}>
              <dl
                style={{
                  display: "grid",
                  gridTemplateColumns: "160px 1fr",
                  gap: "10px 16px",
                  fontSize: 14,
                  margin: "12px 16px",
                }}
              >
                {r.firstAppealDecidedAt && (
                  <>
                    <dt style={{ color: "var(--ink2)" }}>{t("faaDecision")}</dt>
                    <dd>
                      {FAA_OUTCOME_KEY[r.firstAppealOutcome ?? ""] ? t(FAA_OUTCOME_KEY[r.firstAppealOutcome ?? ""]) : (r.firstAppealOutcome ?? "—")} — {fmt(r.firstAppealDecidedAt)}
                    </dd>
                    <dt style={{ color: "var(--ink2)" }}>{t("appellateOrder")}</dt>
                    <dd style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{r.firstAppealOrder ?? "—"}</dd>
                  </>
                )}
                {r.secondAppealAt && (
                  <>
                    <dt style={{ color: "var(--ink2)" }}>{t("secondAppeal")}</dt>
                    <dd>
                      {t("secondAppealRecorded", { ref: r.secondAppealRef ?? "—", date: fmt(r.secondAppealAt) })}
                    </dd>
                  </>
                )}
                {r.disposedAt && (
                  <>
                    <dt style={{ color: "var(--ink2)" }}>{t("disposed")}</dt>
                    <dd>{fmt(r.disposedAt)}</dd>
                    <dt style={{ color: "var(--ink2)" }}>{t("disposalReason")}</dt>
                    <dd style={{ whiteSpace: "pre-wrap" }}>{r.disposalReason ?? "—"}</dd>
                  </>
                )}
              </dl>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title={t("applicantCard")}>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr",
                gap: "8px 12px",
                fontSize: 14,
                margin: "12px 16px",
              }}
            >
              <dt style={{ color: "var(--ink2)" }}>{t("name")}</dt>
              <dd style={{ fontWeight: 600 }}>
                <Masked
                  kind="name"
                  value={r.applicantName}
                  fallback="—"
                  ariaLabel={t("maskedAriaLabel", { label: t("revealNameLabel") })}
                  onReveal={{
                    canReveal: canRevealPii,
                    resourceType: "rti",
                    resourceId: r.id,
                    field: "applicantName",
                    label: t("revealNameLabel"),
                  }}
                />
              </dd>
              <dt style={{ color: "var(--ink2)" }}>{t("contact")}</dt>
              <dd style={{ wordBreak: "break-all" }}>
                <Masked
                  kind={r.applicantContact?.includes("@") ? "email" : "phone"}
                  value={r.applicantContact}
                  fallback="—"
                  ariaLabel={t("maskedAriaLabel", { label: t("revealContactLabel") })}
                  onReveal={{
                    canReveal: canRevealPii,
                    resourceType: "rti",
                    resourceId: r.id,
                    field: "applicantContact",
                    label: t("revealContactLabel"),
                  }}
                />
              </dd>
            </dl>
            {/* GAP-CRM-RTI-DETAIL-03 / F1-02+F1-06: DPDP notice. Only a PII-read
                role can reveal (reason + audit event); the notice says exactly
                that, and a role without access is told it cannot see the value. */}
            <p style={{ margin: "0 16px 12px", fontSize: 11, color: "var(--ink2)", lineHeight: 1.5 }}>
              {canRevealPii ? t("applicantDataNoticeLogged") : t("applicantDataNoticeMasked")}
            </p>
          </Card>
          {/* F6-01: status transition timeline. */}
          <CaseStatusTimeline entries={history} />
        </div>
      </div>
    </>
  );
}
