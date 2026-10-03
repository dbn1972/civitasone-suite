import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader, Card, StatusPill, LoadErrorState } from "../../../../../_components/ds";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { fetchJson } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { RevealValue } from "./RevealValue";
import { PensionerStatusActions } from "./PensionerStatusActions";

type PensionerDetail = {
  id: string;
  ppoNo: string;
  fullName: string;
  dateOfBirth: string;
  basicPensionMinor: number;
  commutedPensionMinor: number;
  commutationDate: string | null;
  medicalAllowanceMinor: number;
  ddoCode: string | null;
  taxRegime: string;
  status: string;
  bankAccountMasked: string | null;
  bankIfsc: string | null;
  panMasked: string | null;
  statusReason: string | null;
  dateOfDeath: string | null;
};

// GET /v1/payroll/pensioners/:id is READER_ROLES; status changes and the
// audited reveal are PAYROLL_ROLES (payroll-service fin03-routes.ts).
const VIEW_ROLES = [...PAYROLL_READER_ROLES];
const MANAGE_ROLES = [...PAYROLL_ADMIN_ROLES];

export default async function PensionerDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("pensionerDetail");
  const roles = getSessionRoles();
  if (!roles.some((r) => VIEW_ROLES.includes(r))) {
    return <PermissionDenied module="pensioners" requiredRoles={VIEW_ROLES} backHref="/hr/payroll/pensioners" backLabel={t("backLabel")} />;
  }
  const canManage = roles.some((r) => MANAGE_ROLES.includes(r));

  const result = await fetchJson<PensionerDetail, PensionerDetail | null>(
    `/api/v1/payroll/pensioners/${encodeURIComponent(params.id)}`,
    null,
    { telemetryKey: "payroll.pensioner.detail", mapResponse: (p) => (p && typeof p === "object" ? p : null) },
  );
  if (result.status === 404) notFound();
  const p = result.data;
  if (result.source === "error" || !p) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("titleFallback")} back="/hr/payroll/pensioners" backLabel={t("backLabel")} />
        <LoadErrorState result={result} area={t("area")} backHref="/hr/payroll/pensioners" backLabel={t("backLabel")} />
      </div>
    );
  }

  // Server-side "today" (IST) for the date-of-death upper bound.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const none = t("notRecorded");
  const revealPath = `v1/payroll/pensioners/${p.id}/reveal`;
  const revealCopy = {
    revealBtn: t("revealBtn"),
    hideBtn: t("hideBtn"),
    revealTitle: t("revealTitle"),
    revealDescription: t("revealDescription"),
    reasonLabel: t("reasonLabel"),
    forbiddenError: t("revealForbidden"),
    networkError: t("networkError"),
  };

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: t("ppoNo"),
      value: canManage
        ? <RevealValue path={revealPath} field="ppoNo" masked={p.ppoNo} copy={revealCopy} area={t("revealArea")} />
        : <span style={{ fontFamily: "monospace" }}>{p.ppoNo}</span>,
    },
    { label: t("dateOfBirth"), value: formatIndianDate(p.dateOfBirth) },
    { label: t("ddoCode"), value: p.ddoCode ?? none },
    { label: t("taxRegime"), value: p.taxRegime === "old" ? t("regimeOld") : t("regimeNew") },
    { label: t("basicPension"), value: formatMoney(p.basicPensionMinor) },
    { label: t("commutedPension"), value: formatMoney(p.commutedPensionMinor) },
    { label: t("commutationDate"), value: p.commutationDate ? formatIndianDate(p.commutationDate) : none },
    { label: t("medicalAllowance"), value: formatMoney(p.medicalAllowanceMinor) },
    {
      label: t("bankAccount"),
      value: !p.bankAccountMasked ? none : canManage
        ? <RevealValue path={revealPath} field="bankAccountNo" masked={p.bankAccountMasked} copy={revealCopy} area={t("revealArea")} />
        : <span style={{ fontFamily: "monospace" }}>{p.bankAccountMasked}</span>,
    },
    { label: t("bankIfsc"), value: p.bankIfsc ?? none },
    {
      label: t("pan"),
      value: !p.panMasked ? none : canManage
        ? <RevealValue path={revealPath} field="pan" masked={p.panMasked} copy={revealCopy} area={t("revealArea")} />
        : <span style={{ fontFamily: "monospace" }}>{p.panMasked}</span>,
    },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={p.fullName} subtitle={t("subtitle")} back="/hr/payroll/pensioners" backLabel={t("backLabel")} />
      <p role="note" className="sub" style={{ margin: "0 0 12px", fontSize: 12, color: "var(--mut)" }}>{t("maskedNote")}</p>

      <Card title={t("detailsTitle")} padding>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "12px 24px", margin: 0 }}>
          <div>
            <dt style={{ fontSize: 12, color: "var(--mut)" }}>{t("status")}</dt>
            <dd style={{ margin: "4px 0 0" }}><StatusPill status={p.status} label={t(`status_${p.status}` as "status_active")} /></dd>
          </div>
          {rows.map((r) => (
            <div key={r.label}>
              <dt style={{ fontSize: 12, color: "var(--mut)" }}>{r.label}</dt>
              <dd style={{ margin: "4px 0 0", fontSize: 14 }}>{r.value}</dd>
            </div>
          ))}
          {p.dateOfDeath && (
            <div>
              <dt style={{ fontSize: 12, color: "var(--mut)" }}>{t("dateOfDeath")}</dt>
              <dd style={{ margin: "4px 0 0", fontSize: 14 }}>{formatIndianDate(p.dateOfDeath)}</dd>
            </div>
          )}
          {p.statusReason && (
            <div>
              <dt style={{ fontSize: 12, color: "var(--mut)" }}>{t("statusReason")}</dt>
              <dd style={{ margin: "4px 0 0", fontSize: 14 }}>{p.statusReason}</dd>
            </div>
          )}
        </dl>
      </Card>

      {canManage && (p.status === "active" || p.status === "stopped") && (
        <Card title={t("statusCardTitle")} padding>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--mut)" }}>{t("statusCardNote")}</p>
          <PensionerStatusActions
            id={p.id}
            status={p.status}
            today={today}
            copy={{
              stopBtn: t("stopBtn"),
              deceasedBtn: t("deceasedBtn"),
              stopTitle: t("stopTitle"),
              deceasedTitle: t("deceasedTitle"),
              stopDescription: t("stopDescription"),
              deceasedDescription: t("deceasedDescription"),
              reasonLabel: t("reasonLabel"),
              dateOfDeathLabel: t("dateOfDeathLabel"),
              stoppedMessage: t("stoppedMessage"),
              deceasedMessage: t("deceasedMessage"),
              invalidStateError: t("invalidStateError"),
              networkError: t("networkError"),
            }}
          />
        </Card>
      )}
    </div>
  );
}
