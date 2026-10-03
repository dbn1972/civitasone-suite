import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles, PAYROLL_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { daysUntilIST } from "@/lib/formatters";
import { BankFileWizard, type DscStatus } from "./BankFileWizard";
import { eligibleBankFileRuns, type RunRow } from "./eligibility";
import { NachMandateForm } from "./NachMandateForm";
import { NachReturnForm } from "./NachReturnForm";
import { SponsorBankConfigForm } from "./SponsorBankConfigForm";
import { DscConfigForm } from "./DscConfigForm";
import { DisbursementTransferTable } from "./DisbursementTransferTable";
import { BankFileSigningForm } from "./BankFileSigningForm";
import { IssuedBankFilesTable } from "./IssuedBankFilesTable";
import { hasItems, mapIssuedFiles, mapSigningSettings, type IssuedFile, type SigningSettings } from "./signingState";
// Plain (non-"use client") module: these are CALLED here on the server.
import { toClientTransferRow, isCreditedTransfer, isFailedTransfer, type RawTransferRow } from "./transferRows";

/**
 * GAP-PAYROLL-DISBURSEMENT-04: roles that may change the sponsor bank
 * account, the DSC signing key, or upload a NACH return file. Mirrors
 * payroll-service's ADMIN_ROLES on dsc-config, sponsor-config and
 * nach-return routes exactly (payroll_officer is NOT admitted server-side).
 */
const PAYROLL_CONFIG_ROLES = ["payroll_admin", "super_admin"];

type SponsorConfig = {
  tenantId: string;
  sponsorCode: string;
  sponsorIfsc: string;
  sponsorAccount: string;
  settlementOffsetDays: number;
  nachEnabled: boolean;
  apbsEnabled: boolean;
} & Record<string, unknown>;

type RawDscConfig = {
  subjectCn: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  sha256Fingerprint: string;
} & Record<string, unknown>;

async function getRuns(): Promise<LoaderResult<RunRow[]>> {
  return fetchJson<unknown, RunRow[]>("/api/v1/payroll/runs", [], {
    telemetryKey: "payroll.disbursement.runs",
    mapResponse: (p) => (Array.isArray(p) ? (p as RunRow[]) : null),
  });
}

async function getSponsorConfig(): Promise<LoaderResult<SponsorConfig | null>> {
  return fetchJson<unknown, SponsorConfig | null>("/api/v1/payroll/sponsor-bank-config", null, {
    telemetryKey: "payroll.disbursement.sponsorConfig",
    mapResponse: (p) => {
      if (p == null) return null;
      const obj = p as Record<string, unknown>;
      if (typeof obj.sponsorCode !== "string") return null;
      return obj as SponsorConfig;
    },
  });
}

async function getDscConfig(): Promise<LoaderResult<RawDscConfig | null>> {
  return fetchJson<unknown, RawDscConfig | null>("/api/v1/payroll/dsc-config", null, {
    telemetryKey: "payroll.disbursement.dscConfig",
    mapResponse: (p) => {
      if (p == null) return null;
      const arr = (p as { data?: RawDscConfig })?.data;
      return arr ?? null;
    },
  });
}

async function getTransfers(): Promise<LoaderResult<RawTransferRow[]>> {
  // Current attempt per payment (the API hides rows superseded by a retry);
  // 500 is the API's page-size cap.
  return fetchJson<unknown, RawTransferRow[]>("/api/v1/payroll/disbursement/transfers?limit=500", [], {
    telemetryKey: "payroll.disbursement.transfers",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RawTransferRow[] })?.data;
      return Array.isArray(arr) ? (arr as RawTransferRow[]) : null;
    },
  });
}

// GAP-PAYROLL-DISBURSEMENT-03: issued bank files with their signing state
// (any payroll operator), and the signing policy + key status (admin only).
async function getIssuedFiles(): Promise<LoaderResult<IssuedFile[]>> {
  return fetchJson<unknown, IssuedFile[]>("/api/v1/payroll/disbursement/files?limit=50", [], {
    telemetryKey: "payroll.disbursement.files",
    mapResponse: mapIssuedFiles,
  });
}

async function getSigningSettings(): Promise<LoaderResult<SigningSettings | null>> {
  return fetchJson<unknown, SigningSettings | null>("/api/v1/payroll/bank-file-signing", null, {
    telemetryKey: "payroll.disbursement.signing",
    mapResponse: mapSigningSettings,
  });
}

const notFetched = <T,>(data: T): Promise<LoaderResult<T>> => Promise.resolve({ data, source: "api" });

const SECTION_STYLE = { scrollMarginTop: 80 } as const;

export default async function DisbursementPage() {
  const t = await getTranslations("disbursement");

  // GAP-PAYROLL-DISBURSEMENT-01/04: hr/layout admits manager/employee/
  // hr_officer to every /hr route; this page holds salary bank details and
  // payment-file generation, so only payroll operators get past here.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied
          module={t("permissionModule")}
          requiredRoles={PAYROLL_ADMIN_ROLES}
          backHref="/hr/payroll"
          backLabel={t("errorBackLabel")}
        />
      </div>
    );
  }
  const canConfigure = roles.some((r) => PAYROLL_CONFIG_ROLES.includes(r));

  // Sponsor/DSC config are admin-only APIs: don't call them for an officer
  // (that only produced a guaranteed 403 and a misleading error badge).
  const [runsResult, sponsorResult, dscResult, transfersResult, filesResult, signingResult] = await Promise.all([
    getRuns(),
    canConfigure ? getSponsorConfig() : notFetched<SponsorConfig | null>(null),
    canConfigure ? getDscConfig() : notFetched<RawDscConfig | null>(null),
    getTransfers(),
    getIssuedFiles(),
    canConfigure ? getSigningSettings() : notFetched<SigningSettings | null>(null),
  ]);
  const filesErrored = filesResult.source === "error";
  const signingErrored = signingResult.source === "error";
  const signingSettings = signingResult.data;

  // Both config endpoints answer 404 when nothing is configured yet -- that
  // is "not configured", not an outage.
  const sponsorMissing = sponsorResult.source === "error" && sponsorResult.status === 404;
  const dscMissing = dscResult.source === "error" && dscResult.status === 404;
  const sponsorErrored = sponsorResult.source === "error" && !sponsorMissing;
  const dscErrored = dscResult.source === "error" && !dscMissing;

  const eligibleRuns = eligibleBankFileRuns(runsResult.data);
  const sponsorConfig = sponsorResult.data;
  const rawDsc = dscResult.data;

  const dsc: DscStatus = !canConfigure
    ? { kind: "restricted" }
    : dscErrored
      ? { kind: "unavailable" }
      : rawDsc
        ? { kind: "configured", subjectCn: rawDsc.subjectCn, notAfter: rawDsc.notAfter, sha256Fingerprint: rawDsc.sha256Fingerprint }
        : { kind: "none" };

  // UX-013: each stat/section below is gated on the specific loader it
  // actually depends on (not one page-wide flag) — a DSC-config outage must
  // not blank out the runs/transfers numbers that loaded fine, and vice
  // versa. `anyError` is kept only for the summary badge.
  const runsErrored = runsResult.source === "error";
  const transfersErrored = transfersResult.source === "error";
  const anyError = runsErrored || sponsorErrored || dscErrored || transfersErrored || filesErrored || signingErrored;

  // GAP-PAYROLL-DISBURSEMENT-01: reduce every row to last-4 on the SERVER --
  // the full account number never reaches the client component's props.
  const transfers = transfersResult.data.map(toClientTransferRow);

  // UX-017: callback params are `tx`, not `t`, to avoid shadowing the
  // translation function.
  const credited = transfersErrored ? null : transfers.filter((tx) => isCreditedTransfer(tx.status)).length;
  const failed = transfersErrored ? null : transfers.filter((tx) => isFailedTransfer(tx.status)).length;

  const dscDaysLeft = dsc.kind === "configured" ? daysUntilIST(dsc.notAfter) : null;
  const dscStatValue =
    dsc.kind === "restricted" ? t("dscAdminOnly")
      : dsc.kind === "unavailable" ? "—"
        : dsc.kind === "none" ? t("dscNotConfigured")
          : dscDaysLeft !== null && dscDaysLeft < 0 ? t("dscExpired")
            : t("dscActive");

  const sections = [
    { id: "transfers", label: t("navTransfers") },
    { id: "bank-file", label: t("navBankFile") },
    { id: "nach", label: t("navNach") },
    { id: "configuration", label: t("navConfiguration") },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      {anyError && <DataSourceBadge source="error" message={t("loadErrorMessage")} />}

      <StatGrid>
        <StatCard icon="🏦" iconBg="var(--infobg)" label={t("statRunsReady")} value={runsErrored ? "—" : eligibleRuns.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statTransfersCredited")} value={credited ?? "—"} />
        <StatCard icon="⚠️" iconBg={failed && failed > 0 ? "var(--badbg)" : "var(--line2)"} label={t("statTransfersFailed")} value={failed ?? "—"} />
        <StatCard icon="🔐" iconBg="var(--warnbg)" label={t("statDscStatus")} value={dscStatValue} />
      </StatGrid>

      {/* GAP-PAYROLL-DISBURSEMENT-09: in-page section jump links */}
      <nav aria-label={t("sectionNavAriaLabel")} style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="pill">{s.label}</a>
        ))}
      </nav>

      {/* Employee bank transfer dashboard */}
      <section id="transfers" style={SECTION_STYLE}>
        <Card title={t("transfersCardTitle")}>
          {transfersErrored ? (
            // GAP-PAYROLL-DISBURSEMENT-07: an outage is not "No transfers yet".
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "bank transfers" })} backHref="/hr/payroll" />
            </div>
          ) : (
            <DisbursementTransferTable transfers={transfers} canReveal />
          )}
        </Card>
      </section>

      {/* Bank file generation wizard */}
      <section id="bank-file" style={SECTION_STYLE}>
        <Card title={t("bankFileCardTitle")}>
          {runsErrored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "payroll runs" })} backHref="/hr/payroll" />
            </div>
          ) : (
            <BankFileWizard
              runs={eligibleRuns}
              dsc={dsc}
              availability={{ nachEnabled: canConfigure && !sponsorErrored ? (sponsorConfig?.nachEnabled ?? false) : null }}
            />
          )}
        </Card>
      </section>

      {/* GAP-PAYROLL-DISBURSEMENT-03: issued files + signed/unsigned state */}
      <section id="issued-files" style={SECTION_STYLE}>
        <Card title={t("issuedFilesCardTitle")}>
          {filesErrored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "issued bank files" })} backHref="/hr/payroll" />
            </div>
          ) : hasItems(filesResult.data) ? (
            <IssuedBankFilesTable files={filesResult.data} />
          ) : (
            <EmptyState icon="🗂️" title={t("issuedFilesEmptyTitle")} message={t("issuedFilesEmptyMessage")} />
          )}
        </Card>
      </section>

      <section id="nach" style={SECTION_STYLE}>
        <Card title={t("nachMandatesCardTitle")}>
          <NachMandateForm />
          <EmptyState
            icon="📋"
            title={t("mandateEmptyTitle")}
            message={t("mandateEmptyMessage")}
          />
        </Card>

        <Card title={t("nachReturnCardTitle")}>
          {!canConfigure ? (
            <p className="pad" style={{ fontSize: 13, color: "var(--ink2)" }}>{t("adminOnlyMessage")}</p>
          ) : runsErrored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "payroll runs" })} backHref="/hr/payroll" />
            </div>
          ) : eligibleRuns.length === 0 ? (
            <EmptyState
              icon="↩️"
              title={t("nachReturnEmptyTitle")}
              message={t("nachReturnEmptyMessage")}
            />
          ) : (
            <NachReturnForm runs={eligibleRuns.map((r) => ({ id: r.id, payPeriod: r.payPeriod }))} />
          )}
        </Card>
      </section>

      {/* GAP-PAYROLL-DISBURSEMENT-04: configuration last, admin-only */}
      <section id="configuration" style={SECTION_STYLE}>
        {canConfigure ? (
          <>
            <Card title={t("sponsorConfigCardTitle")}>
              {sponsorErrored ? (
                <div className="pad">
                  <RefreshErrorState error={toHumanError("load", { area: "sponsor bank configuration" })} backHref="/hr/payroll" />
                </div>
              ) : (
                <SponsorBankConfigForm initial={sponsorConfig} />
              )}
            </Card>

            <div id="bank-file-signing" style={SECTION_STYLE}>
              <Card title={t("signingCardTitle")}>
                {signingErrored || !signingSettings ? (
                  <div className="pad">
                    <RefreshErrorState error={toHumanError("load", { area: "bank file signing settings" })} backHref="/hr/payroll" />
                  </div>
                ) : (
                  <div className="pad">
                    <BankFileSigningForm settings={signingSettings} />
                  </div>
                )}
              </Card>
            </div>

            <div id="dsc-config" style={SECTION_STYLE}>
              <Card title={t("dscCardTitle")}>
                {dscErrored ? (
                  <div className="pad">
                    <RefreshErrorState error={toHumanError("load", { area: "DSC configuration" })} backHref="/hr/payroll" />
                  </div>
                ) : (
                  <DscConfigForm initial={rawDsc} />
                )}
              </Card>
            </div>
          </>
        ) : (
          <Card title={t("configurationCardTitle")}>
            <p className="pad" style={{ fontSize: 13, color: "var(--ink2)" }}>{t("adminOnlyMessage")}</p>
          </Card>
        )}
      </section>
    </div>
  );
}
