import { getTranslations } from "next-intl/server";
import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getFeeSchedules } from "../../../_data/citizenGaps";
import { PaymentPanel } from "./PaymentPanel";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatMoney } from "@/lib/formatters";
import { requireAnyRole, CITIZEN_OFFICER_ROLES } from "@/lib/auth/roleGuard";

/** SVC-085 — Service fee & payment handling. */
export default async function PaymentsPage() {
  // GAP2-CITIZEN-AUTHZ-ROLEGATE-01: this screen records offline/counter
  // payments and raises payment intents — officer paths (fee-payment/routes.ts
  // offline/intent are OFFICER_ROLES). Gate the web page so a citizen-role user
  // is redirected rather than shown a staff tool that 403s on every action.
  requireAnyRole(CITIZEN_OFFICER_ROLES, "/citizen");
  const t = await getTranslations("citizenPayments");
  const result = await getFeeSchedules();
  const { data: schedules } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />

      <PaymentPanel
        schedules={schedules.map((s) => ({ id: s.id, name: s.name, baseAmount: s.baseAmount, currency: s.currency }))}
        loadFailed={errored}
      />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="pad" style={{ borderBottom: "1px solid var(--line)" }}><strong>{errored ? t("listTitle") : t("listTitleCount", { count: schedules.length })}</strong></div>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "fee schedules" })} />
          </div>
        ) : schedules.length === 0 ? (
          <div className="pad" style={{ color: "var(--muted)" }}>{t("empty")}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                  <th scope="col" style={{ padding: 8 }}>{t("colName")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colBaseAmount")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colExemptions")}</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: 8 }}>{s.name}</td>
                    <td style={{ padding: 8 }}>
                      {/* GAP-CITIZEN-PAYMENTS-01: baseAmount is paise (bigint)
                          — render as ₹ with en-IN grouping, never raw. The
                          currency code is only shown when it is not INR, so
                          the common case has no redundant "INR" column. */}
                      {s.currency && s.currency !== "INR"
                        ? `${s.currency} ${s.baseAmount}`
                        : formatMoney(s.baseAmount)}
                    </td>
                    <td style={{ padding: 8 }}>{s.exemptionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
