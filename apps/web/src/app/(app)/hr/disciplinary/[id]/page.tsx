import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState } from "@/app/_components/ds";
import { getDisciplinaryCaseById } from "@/app/_data/loaders";
import { RaiseEOfficeNote } from "@/app/_components/RaiseEOfficeNote";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { getTranslations } from "next-intl/server";

/**
 * Must match the list page at disciplinary/page.tsx and the backend
 * HR_ROLES guard on GET /v1/hrms/disciplinary-cases.
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

  const { data: dcase, source } = await getDisciplinaryCaseById(params.id);

  if (!dcase) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <a href="/hr">HR</a> <span aria-hidden="true">›</span>{" "}
          <a href="/hr/disciplinary">Disciplinary</a> <span aria-hidden="true">›</span> Not found
        </nav>
        <PageHeader title={t("notFoundTitle")} back="/hr/disciplinary" backLabel="Back to Disciplinary" />
        <EmptyState icon="📁" title={t("notFoundEmptyTitle")} message={t("notFoundEmptyMessage")} />
      </main>
    );
  }

  const caseNo = field(dcase, "caseNo", "case_no");
  const status = field(dcase, "status");
  const proceedingType = field(dcase, "proceedingType", "proceeding_type");
  const allegation = field(dcase, "allegation");
  const penaltyType = field(dcase, "penaltyType", "penalty_type");
  const finding = field(dcase, "finding");
  const caseLabel = caseNo !== "—" ? caseNo : params.id;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <a href="/hr">HR</a> <span aria-hidden="true">›</span>{" "}
        <a href="/hr/disciplinary">Disciplinary</a> <span aria-hidden="true">›</span>{" "}
        <span aria-current="page">{caseLabel}</span>
      </nav>

      <PageHeader
        title={t("title", { caseLabel })}
        subtitle={proceedingType !== "—" ? `${proceedingType} proceeding` : undefined}
        back="/hr/disciplinary" backLabel="Back to Disciplinary"
        actions={<StatusPill status={status} />}
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      <StatGrid>
<StatCard icon="📋" iconBg="var(--infobg, #eff6ff)" label={t("statStatus")} value={status.replace(/_/g, " ")} />
        <StatCard icon="⚖️" iconBg="var(--primary-soft, #faf5ff)" label={t("statProceeding")} value={proceedingType} />
        <StatCard icon="🔎" iconBg="var(--warnbg, #fff7ed)" label={t("statFinding")} value={finding} />
        <StatCard icon="🚫" iconBg="var(--badbg, #fef2f2)" label={t("statPenalty")} value={penaltyType} />
      </StatGrid>

      <Card title={t("cardTitle")} padding>
        <div className="fields">
          <div className="field"><span className="label">{t("fieldCaseNo")}</span><span className="mono">{caseNo}</span></div>
          <div className="field"><span className="label">{t("fieldProceedingType")}</span><span>{proceedingType}</span></div>
          <div className="field"><span className="label">{t("fieldFinding")}</span><span>{finding}</span></div>
          <div className="field"><span className="label">{t("fieldPenalty")}</span><span>{penaltyType}</span></div>
          <div className="field"><span className="label">{t("fieldStatus")}</span><StatusPill status={status} /></div>
          {allegation !== "—" && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">{t("fieldAllegation")}</span>
              <span style={{ whiteSpace: "pre-wrap" }}>{allegation}</span>
            </div>
          )}
        </div>
      </Card>

      <RaiseEOfficeNote
        refType="hr_disciplinary"
        refId={params.id}
        subject={`Disciplinary case ${caseLabel}`}
        dept="HR"
        defaultApprovalChain="file_noting"
        notifyPath={`/api/proxy/v1/hrms/disciplinary/${params.id}/submit-approval`}
      />
    </main>
  );
}
