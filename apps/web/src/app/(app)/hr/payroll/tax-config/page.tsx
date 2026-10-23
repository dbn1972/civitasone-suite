import Link from "next/link";
import { PageHeader, Card, RefreshErrorState, Button } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { toHumanError } from "@/lib/messages";
import { currentFinancialYear, recentFinancialYears, isValidFinancialYearLabel } from "@/lib/fiscalYear";
import { getTranslations } from "next-intl/server";

/**
 * GAP2-PAYROLL-TAX-CONFIG-01: the Tax Configuration screen used to render the
 * income-tax slabs, Chapter VI-A deduction limits and surcharge bands as
 * hard-coded JSX literals, telling the user they were "applied automatically"
 * while the TDS engine actually reads a per-tenant, per-FY configurable table
 * (payroll.tax_slab_config). A tenant whose configured slabs differ — or any
 * FY other than the hard-coded one — was shown rates that contradict what the
 * engine applies, presented as authoritative.
 *
 * This now fetches the tenant's EFFECTIVE config for the selected FY from
 * GET /v1/payroll/tax/slab-config (the same tenant-override-then-platform-
 * default rows getTaxConfig resolves), renders the fetched slabs/limits/
 * surcharge bands via formatMoney, offers an FY selector, and shows a proper
 * error/empty state when config is missing — no hard-coded ₹ slab literals.
 *
 * GAP2-PAYROLL-TAX-CONFIG-02: amounts are formatted via formatMoney and the
 * card grid collapses to one column on phones (grid-cols-auto, see below).
 *
 * GAP-PAYROLL-TAX-CONFIG-03: the surcharge card shows BOTH regimes' bands side by
 * side (it used to render only the new regime's, which dropped the old regime's
 * top band), plus the engine's own behaviour as notes: the highest rate configured
 * for the new regime (its cap) and marginal relief at every threshold
 * (tax/engine.ts computeTax). Every rate shown is read from the fetched config.
 * [HUMAN REVIEW: the wording of these two notes needs tax-owner sign-off.]
 *
 * GAP-PAYROLL-TAX-CONFIG-04: this screen is a READ-ONLY reference (no form, no
 * mutation, no endpoint to change a slab), so it is named a reference and says so;
 * nothing on it or on the HR hub tile reads as an editable configuration.
 */

type Slab = { from: number; to: number | null; ratePct: number };
type SurchargeBand = { above: number; ratePct: number };
type RegimeConfig = {
  regime: "new" | "old";
  slabs: Slab[];
  stdDeduction: number;
  rebateIncomeCap: number;
  rebateMax: number;
  surchargeBands: SurchargeBand[];
};
type SlabConfigResponse = { fy: string; new: RegimeConfig | null; old: RegimeConfig | null };

async function getConfig(fy: string): Promise<LoaderResult<SlabConfigResponse | null>> {
  return fetchJson<unknown, SlabConfigResponse | null>(
    `/api/v1/payroll/tax/slab-config?fy=${encodeURIComponent(fy)}`,
    null,
    {
      telemetryKey: "payroll.tax-slab-config",
      mapResponse: (p) => {
        const o = p as SlabConfigResponse | undefined;
        return o && typeof o === "object" && "fy" in o ? o : null;
      },
    },
  );
}

/**
 * The slab-config API sends WHOLE-RUPEE thresholds (the TDS engine's slab
 * from/to). Convert exactly to paise (decimal string, no float rounding of the
 * value itself) and render with formatMoney; a non-finite value shows "—".
 */
function rupees(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return formatMoney(rupeesToMinorString(n.toFixed(2), { allowZero: true }));
}

function slabLabel(s: Slab, t: (k: string, v?: Record<string, string>) => string): string {
  if (s.to == null) return t("slabAbove", { from: rupees(s.from) });
  // Lower bound of a mid-slab is one rupee above the previous slab's top.
  return `${rupees(s.from + (s.from > 0 ? 1 : 0))} – ${rupees(s.to)}`;
}

/**
 * GAP-PAYROLL-TAX-CONFIG-03: the surcharge rate (%) that applies to income above
 * `threshold` under a regime's configured bands (the engine takes the highest band
 * whose threshold the income exceeds; below the first band it is nil). null = the
 * regime has no configuration for this FY, so there is nothing to show.
 */
function surchargeRateAbove(bands: SurchargeBand[] | undefined, threshold: number): number | null {
  if (!bands) return null;
  let rate = 0;
  for (const b of [...bands].sort((x, y) => x.above - y.above)) {
    if (b.above <= threshold) rate = b.ratePct;
  }
  return rate;
}

function RegimeTable({ cfg, title, note, t }: {
  cfg: RegimeConfig | null;
  title: string;
  note: string;
  t: (k: string, v?: Record<string, string>) => string;
}) {
  return (
    <Card title={title} padding>
      {cfg == null ? (
        <p style={{ fontSize: 13, color: "var(--mut)" }}>{t("regimeNotConfigured")}</p>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ fontSize: 13 }}>
              <thead><tr><th>{t("thSlabAnnual")}</th><th>{t("thRate")}</th></tr></thead>
              <tbody>
                {cfg.slabs.map((s, i) => (
                  <tr key={`${s.from}-${i}`}>
                    <td>{slabLabel(s, t)}</td>
                    <td>{s.ratePct === 0 ? t("nil") : `${s.ratePct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: 8, fontSize: 12, color: "var(--mut)" }}>
            {note} {t("stdDeductionNote", { amount: rupees(cfg.stdDeduction) })}{" "}
            {cfg.rebateMax > 0 && t("rebateNote", { max: rupees(cfg.rebateMax), cap: rupees(cfg.rebateIncomeCap) })}
          </p>
        </>
      )}
    </Card>
  );
}

export default async function TaxConfigPage(props: { searchParams?: Promise<{ fy?: string }> }) {
  const searchParams = await props.searchParams;
  const t = await getTranslations("payrollTaxConfig");

  const defaultFy = currentFinancialYear();
  const requestedFy = searchParams?.fy?.trim();
  const fy = requestedFy && isValidFinancialYearLabel(requestedFy) ? requestedFy : defaultFy;
  const fyOptions = Array.from(new Set([...recentFinancialYears(5), fy])).sort().reverse();

  const { data, source } = await getConfig(fy);
  const errored = source === "error";
  const newRegime = data?.new ?? null;
  const oldRegime = data?.old ?? null;
  // GAP-PAYROLL-TAX-CONFIG-03: one row per distinct threshold across both regimes.
  const surchargeThresholds = Array.from(
    new Set([...(newRegime?.surchargeBands ?? []), ...(oldRegime?.surchargeBands ?? [])].map((b) => b.above)),
  ).sort((a, b) => a - b);
  const newRegimeTopSurcharge = newRegime && newRegime.surchargeBands.length > 0
    ? Math.max(...newRegime.surchargeBands.map((b) => b.ratePct))
    : null;
  const rateCell = (rate: number | null) => (rate === null ? "—" : `${rate}%`);

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel={t("backLabel")} />

      <Card title={t("fyCardTitle")} padding>
        <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="tax-config-fy" style={{ fontSize: 13, fontWeight: 600 }}>{t("fyLabel")}</label>
            <select
              id="tax-config-fy"
              name="fy"
              defaultValue={fy}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "var(--panel)" }}
            >
              {fyOptions.map((opt) => (
                <option key={opt} value={opt}>{t("fyOption", { fy: opt })}</option>
              ))}
            </select>
          </div>
          <Button type="submit" style={{ minHeight: 44 }}>{t("applyFy")}</Button>
        </form>
      </Card>

      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      {errored ? (
        <Card title={t("title")}>
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "tax configuration" })} backHref="/hr/payroll" />
          </div>
        </Card>
      ) : (
        <>
          {/* GAP2-PAYROLL-TAX-CONFIG-02: a responsive auto-fit grid collapses to
              one column below ~340px minimum card width, instead of a fixed
              two-column `.g-2` that squeezes the slab tables on phones. */}
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
            <RegimeTable cfg={newRegime} title={t("cardNewRegime", { fy })} note={t("newRegimeIntro")} t={t} />
            <RegimeTable cfg={oldRegime} title={t("cardOldRegime", { fy })} note={t("oldRegimeIntro")} t={t} />

            <Card title={t("cardSurchargeCess")} padding>
              {surchargeThresholds.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--mut)" }}>{t("regimeNotConfigured")}</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="tbl" style={{ fontSize: 13 }}>
                    <thead><tr><th>{t("thIncome")}</th><th>{t("thNewRegime")}</th><th>{t("thOldRegime")}</th></tr></thead>
                    <tbody>
                      {surchargeThresholds.map((above) => (
                        <tr key={above}>
                          <td>{t("surchargeAbove", { amount: rupees(above) })}</td>
                          <td>{rateCell(surchargeRateAbove(newRegime?.surchargeBands, above))}</td>
                          <td>{rateCell(surchargeRateAbove(oldRegime?.surchargeBands, above))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {newRegimeTopSurcharge !== null && (
                <p style={{ marginTop: 8, fontSize: 12, color: "var(--mut)" }}>{t("surchargeCapNote", { rate: String(newRegimeTopSurcharge) })}</p>
              )}
              {surchargeThresholds.length > 0 && (
                <p style={{ marginTop: 8, fontSize: 12, color: "var(--mut)" }}>{t("marginalReliefNote")}</p>
              )}
              <p style={{ marginTop: 8, fontSize: 12, color: "var(--mut)" }}>{t("cessNote")}</p>
            </Card>
          </div>

          <p style={{ marginTop: 16, color: "var(--mut)", fontSize: 13 }}>
            {t("footerNote")} {t("readOnlyNote")}{" "}
            <Link href="/hr/payroll/income-tax">{t("footerLink")}</Link>
          </p>
        </>
      )}
    </div>
  );
}
