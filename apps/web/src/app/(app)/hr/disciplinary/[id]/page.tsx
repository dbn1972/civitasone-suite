import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { LifecycleTimeline, type LifecycleEvent } from "../../_components/LifecycleTimeline";
import { getDisciplinaryCaseById, getDisciplinaryCaseEvents, getEmployeeById } from "@/app/_data/loaders";
import { RaiseEOfficeNote } from "@/app/_components/RaiseEOfficeNote";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { humanizeStatus } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";

/**
 * Must match the list page at disciplinary/page.tsx and the backend
 * VIGILANCE_ROLES guard on GET /v1/hrms/disciplinary-cases/:caseId.
 */
const DISCIPLINARY_ROLES = ["hr_admin", "hr_officer", "super_admin"];

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

export default async function DisciplinaryCaseDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("disciplinaryDetail");
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => DISCIPLINARY_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="disciplinary cases" requiredRoles={DISCIPLINARY_ROLES} />;
  }

  const { data: dcase, source, status, errorMessage } = await getDisciplinaryCaseById(params.id);

  // GAP-HR-DISCIPLINARY-DETAIL-02: a failed fetch (5xx, network error, a
  // 403 the backend itself returned) used to render "Case not found" --
  // the exact same screen a genuinely deleted/invalid id produces -- so an
  // outage told the officer the case was gone. Only a real 404 (or a
  // successful-but-empty response) gets the "not found" empty state now;
  // anything else gets a retry-capable error state that also distinguishes
  // 403 (LoadErrorState renders PermissionDenied for that status).
  if (!dcase) {
    if (source === "error" && status !== 404) {
      return (
        <div className="page-main wrap" aria-labelledby="page-heading">
          <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
            <Link href="/hr">{t("crumbHr")}</Link> <span aria-hidden="true">›</span>{" "}
            <Link href="/hr/disciplinary">{t("crumbDisciplinary")}</Link>
          </nav>
          <PageHeader title={t("notFoundTitle")} back="/hr/disciplinary" backLabel={t("backLabel")} />
          <LoadErrorState
            result={{ status, errorMessage }}
            area="disciplinary case"
            backHref="/hr/disciplinary"
            requiredRoles={DISCIPLINARY_ROLES}
          />
        </div>
      );
    }
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <Link href="/hr">{t("crumbHr")}</Link> <span aria-hidden="true">›</span>{" "}
          <Link href="/hr/disciplinary">{t("crumbDisciplinary")}</Link> <span aria-hidden="true">›</span> {t("crumbNotFound")}
        </nav>
        <PageHeader title={t("notFoundTitle")} back="/hr/disciplinary" backLabel={t("backLabel")} />
        <EmptyState icon="📁" title={t("notFoundEmptyTitle")} message={t("notFoundEmptyMessage")} />
      </div>
    );
  }

  // GAP-HR-DISCIPLINARY-DETAIL-03: the case page used to show only
  // caseNo/proceedingType/finding/penaltyType/status/allegation, even
  // though the list page shows employee/IO/filed date -- an officer had to
  // go back to the list to know whose case this even was. employeeId was
  // already in the payload; a name needs the same employee loader every
  // other HR page already uses. Both fetches are independent -- run them
  // together rather than one after the other.
  const [employeeResult, eventsResult] = await Promise.all([
    getEmployeeById(dcase.employeeId),
    getDisciplinaryCaseEvents(params.id),
  ]);
  const employeeName = employeeResult.data?.name ?? null;
  const employeeNo = employeeResult.data?.employeeId ?? null;

  const caseNo = field(dcase, "caseNo");
  const status_ = field(dcase, "status");
  const proceedingType = field(dcase, "proceedingType");
  const allegation = field(dcase, "allegation");
  const penaltyType = field(dcase, "penaltyType");
  const finding = field(dcase, "finding");
  const inquiryOfficerName = field(dcase, "inquiryOfficerName");
  const chargeMemoRef = field(dcase, "chargeMemoRef");
  const chargeMemoDate = field(dcase, "chargeMemoDate");
  // GAP-HR-DISCIPLINARY-DETAIL-04 (UUID): case_no is NOT NULL in the schema,
  // so this fallback is defensive rather than a normally-reached path -- but
  // when it IS reached (a malformed/legacy row), it must never leak the raw
  // UUID onto the page; the id stays in the URL only.
  const caseLabel = caseNo !== "—" ? caseNo : t("caseUnnumbered");

  // GAP-HR-DISCIPLINARY-DETAIL-04 (I18N): proceedingType/finding are closed,
  // small enums (schema.ts / disciplinary/routes.ts's z.enum) -- translated
  // explicitly. penaltyType is a much larger, CCS/CCA-rule-specific
  // vocabulary (state-machine.ts's MINOR_PENALTIES/MAJOR_PENALTIES) with no
  // existing translation set anywhere in the app; humanizeStatus (already
  // used for `status` below) gives an honest Title Case rendering instead
  // of a raw snake_case enum, without guessing a specific CCS/CCA English
  // gloss for a dozen-plus statutory penalty names.
  const proceedingTypeLabel = proceedingType === "—" ? "—"
    : proceedingType === "major" ? t("proceedingMajor") : proceedingType === "minor" ? t("proceedingMinor") : humanizeStatus(proceedingType);
  const findingLabel = finding === "—" ? "—"
    : finding === "guilty" ? t("findingGuilty")
    : finding === "not_guilty" ? t("findingNotGuilty")
    : finding === "partly_guilty" ? t("findingPartlyGuilty")
    : humanizeStatus(finding);
  const penaltyTypeLabel = penaltyType === "—" ? "—" : humanizeStatus(penaltyType);

  // GAP-HR-DISCIPLINARY-DETAIL-03: status-history timeline from the
  // existing (previously never called from the web app) events route.
  // LifecycleTimeline's `type` enum has no disciplinary-specific values, so
  // every entry uses "other" -- still gives a correctly-ordered, correctly-
  // labelled history; only the per-type icon/colour differentiation is
  // unavailable without extending that shared component, which is out of
  // scope for this fix.
  const timelineEvents: LifecycleEvent[] = (eventsResult.data ?? []).map((e) => ({
    id: e.id,
    type: "other",
    date: e.occurredAt,
    title: humanizeStatus(e.action),
    detail: e.notes ?? (e.fromStatus ? `${humanizeStatus(e.fromStatus)} → ${humanizeStatus(e.toStatus)}` : humanizeStatus(e.toStatus)),
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <Link href="/hr">{t("crumbHr")}</Link> <span aria-hidden="true">›</span>{" "}
        <Link href="/hr/disciplinary">{t("crumbDisciplinary")}</Link> <span aria-hidden="true">›</span>{" "}
        <span aria-current="page">{caseLabel}</span>
      </nav>

      <PageHeader
        title={t("title", { caseLabel })}
        subtitle={proceedingType !== "—" ? t("subtitleProceeding", { proceedingType: proceedingTypeLabel }) : undefined}
        back="/hr/disciplinary" backLabel={t("backLabel")}
        actions={<StatusPill status={status_} label={humanizeStatus(status_)} />}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />

      {/* GAP-HR-DISCIPLINARY-DETAIL-01 (PII/DPDP): purpose/confidentiality
          notice -- allegation text, finding and penalty for a named
          employee are now read-audited (disciplinary/routes.ts's GET
          handler) but were shown with no notice at all that access is
          logged. */}
      <div
        role="note"
        aria-labelledby="disciplinary-detail-confidential-heading"
        style={{
          marginTop: 12, marginBottom: 4,
          padding: "14px 16px", borderRadius: 8,
          border: "1px solid #d1a700", background: "#fffbea",
        }}
      >
        <p
          id="disciplinary-detail-confidential-heading"
          style={{ margin: "0 0 6px 0", fontWeight: 600, fontSize: "0.875rem", color: "#7a5200" }}
        >
          {t("confidentialBannerTitle")}
        </p>
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "#5c4000", lineHeight: 1.5 }}>
          {t("confidentialBannerBody")}
        </p>
      </div>

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #eff6ff)" label={t("statStatus")} value={humanizeStatus(status_)} />
        <StatCard icon="⚖️" iconBg="var(--primary-soft, #faf5ff)" label={t("statProceeding")} value={proceedingTypeLabel} />
        <StatCard icon="🔎" iconBg="var(--warnbg, #fff7ed)" label={t("statFinding")} value={findingLabel} />
        <StatCard icon="🚫" iconBg="var(--badbg, #fef2f2)" label={t("statPenalty")} value={penaltyTypeLabel} />
      </StatGrid>

      <Card title={t("cardTitle")} padding>
        <div className="fields">
          <div className="field"><span className="label">{t("fieldCaseNo")}</span><span className="mono">{caseNo}</span></div>
          {/* GAP-HR-DISCIPLINARY-DETAIL-03: "case against", IO, and charge
              memo ref/date -- present in the API response all along
              (DisciplinaryCaseDetailSchema), just never rendered here. */}
          <div className="field">
            <span className="label">{t("fieldEmployee")}</span>
            {employeeName ? (
              <Link href={`/hr/employees/${dcase.employeeId}`}>
                {employeeNo ? `${employeeName} (${employeeNo})` : employeeName}
              </Link>
            ) : <span>—</span>}
          </div>
          <div className="field"><span className="label">{t("fieldProceedingType")}</span><span>{proceedingTypeLabel}</span></div>
          <div className="field"><span className="label">{t("fieldInquiryOfficer")}</span><span>{inquiryOfficerName}</span></div>
          <div className="field"><span className="label">{t("fieldChargeMemoRef")}</span><span className="mono">{chargeMemoRef}</span></div>
          <div className="field"><span className="label">{t("fieldChargeMemoDate")}</span><span>{chargeMemoDate}</span></div>
          <div className="field"><span className="label">{t("fieldFinding")}</span><span>{findingLabel}</span></div>
          <div className="field"><span className="label">{t("fieldPenalty")}</span><span>{penaltyTypeLabel}</span></div>
          <div className="field"><span className="label">{t("fieldStatus")}</span><StatusPill status={status_} label={humanizeStatus(status_)} /></div>
          {allegation !== "—" && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">{t("fieldAllegation")}</span>
              <span style={{ whiteSpace: "pre-wrap" }}>{allegation}</span>
            </div>
          )}
        </div>
      </Card>

      {/* GAP-HR-DISCIPLINARY-DETAIL-03: status-history timeline. */}
      <Card title={t("statusHistoryTitle")} padding>
        {eventsResult.source === "error" ? (
          <p style={{ fontSize: "0.8125rem", color: "var(--mut)" }}>{t("statusHistoryErrorMessage")}</p>
        ) : (
          <LifecycleTimeline events={timelineEvents} />
        )}
      </Card>

      <RaiseEOfficeNote
        refType="hr_disciplinary"
        refId={params.id}
        subject={`Disciplinary case ${caseLabel}`}
        dept="HR"
        // GAP-HR-DISCIPLINARY-DETAIL-01: disciplinary data warrants a
        // higher classification than the component's generic "confidential"
        // default -- 'secret' is this fix's own suggested value pending
        // eOffice-owner sign-off (flagged for human review in the PR).
        classification="secret"
        defaultApprovalChain="file_noting"
        notifyPath={`/api/proxy/v1/hrms/disciplinary/${params.id}/submit-approval`}
      />
    </div>
  );
}
