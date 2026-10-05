import { fetchJson } from "../../../../_data/apiClient";
import { PageHeader, StatusPill, Card, LoadErrorState, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { RtiActions } from "./RtiActions";
import { formatMoney } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";

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
        ? Math.round(r.feeAmount * 100)
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
  return new Date(dt).toLocaleString("en-IN", {
    dateStyle: "medium", timeStyle: "short",
  });
}

const SECTION_KEY: Record<string, string> = {
  "s.6": "section6",
  "s.11": "section11",
};

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
 * GAP-CRM-RTI-DETAIL-03: partially mask the applicant's contact (DPDP). A
 * phone shows only its last 4 digits; an email shows the first char and its
 * domain. Shown in clear only to a user with a CRM role (who legitimately
 * needs it to reply) — never to an unprivileged viewer. An audited
 * reveal-with-reason for the masked case is a backend-dependent follow-up
 * (GAP-CRM-RTI-04): there is no read-access-log endpoint to call yet, and a
 * reveal with no real audit behind it is worse than none.
 */
function maskContact(value: string): string {
  const v = value.trim();
  if (v.includes("@")) {
    const [local, domain] = v.split("@");
    const head = local ? local[0] : "";
    return `${head}•••@${domain ?? ""}`;
  }
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 4) return `•••• ${digits.slice(-4)}`;
  return "••••";
}

export default async function RtiDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const t = await getTranslations("crmRtiDetail");
  const roles = getSessionRoles();
  const canAct = roles.some((role) => CRM_RTI_ROLES.includes(role));
  const canDecide = roles.some((role) => RTI_APPELLATE_ROLES.includes(role));
  const result = await fetchJson<unknown, RtiDetail | null>(
    `/api/v1/crm/rti/${params.id}`,
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
              <dd>{SECTION_KEY[r.section] ? t(SECTION_KEY[r.section]) : r.section}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("status")}</dt>
              <dd><StatusPill status={r.status} /></dd>
              <dt style={{ color: "var(--ink2)" }}>{t("department")}</dt>
              <dd>{r.departmentRef}</dd>
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
              <dd style={{ fontWeight: 600 }}>{r.applicantName}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("contact")}</dt>
              <dd style={{ wordBreak: "break-all" }}>
                {r.applicantContact
                  ? canAct
                    ? r.applicantContact
                    : maskContact(r.applicantContact)
                  : "—"}
              </dd>
            </dl>
            {/* GAP-CRM-RTI-DETAIL-03: DPDP notice. Contact is shown in clear
                only to CRM staff who need it to reply; others see a masked
                value. */}
            <p style={{ margin: "0 16px 12px", fontSize: 11, color: "var(--ink2)", lineHeight: 1.5 }}>
              {canAct ? t("applicantDataNoticeLogged") : t("applicantDataNoticeMasked")}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
