"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "../../../_components/ds";
import { SubmitPaymentForm } from "./SubmitPaymentForm";
import { PaymentStatusLookup } from "./PaymentStatusLookup";
import { SalaryBillForm } from "./SalaryBillForm";
import { PaymentAdviceForm } from "./PaymentAdviceForm";
import type { PfmsBill, PfmsDepartment, PfmsMode, PfmsPaymentRail } from "./types";

interface PaymentsPanelProps {
  departments?: PfmsDepartment[];
  /** Bills the payment-advice form can pick from (GAP-FINANCE-PFMS-07). */
  bills?: PfmsBill[];
  /**
   * State of the e-Kuber adapter behind Submit Payment / Payment Status
   * (GAP-FINANCE-PFMS-05). It has no sandbox: live or disabled. null = the
   * backend did not say, shown as unknown -- never assumed simulated.
   */
  paymentRail?: PfmsPaymentRail | null;
  /** Mode of the treasury client behind Salary Bill / Payment Advice (it does have a sandbox). */
  initialTreasuryMode?: PfmsMode | null;
}

/**
 * Two DIFFERENT integrations live in this panel and each form's banner and copy
 * follows the one it actually calls:
 *  - Submit Payment + Payment Status -> POST/GET /v1/finance/pfms/payments*
 *    (e-Kuber adapter, gated by PFMS_ENABLED...): live or disabled, never simulated.
 *  - Salary Bill + Payment Advice -> treasury client (PFMS_TREASURY_*): sandbox or live.
 *
 * Sub-tabs (GAP-FINANCE-PFMS-06): the four forms are kept MOUNTED and only
 * hidden, so a half-typed payment survives a tab switch.
 */
export function PaymentsPanel({
  departments = [],
  bills = [],
  paymentRail = null,
  initialTreasuryMode = null,
}: PaymentsPanelProps) {
  const t = useTranslations("pfmsPaymentsPanel");
  const [treasuryMode, setTreasuryMode] = useState<PfmsMode | null>(initialTreasuryMode);
  // The shared Tabs component uses the label string as the tab identity, so the
  // translated labels must be unique within this tab group.
  const TABS = [t("tabSubmit"), t("tabStatus"), t("tabSalaryBill"), t("tabAdvice")] as const;
  const [active, setActive] = useState<string>(TABS[0]);

  const railBanner =
    paymentRail === "live" ? (
      <div className="alert" role="status" aria-live="polite" data-pfms-rail="live">
        <strong>{t("railLiveTitle")}</strong>
        <p>{t("railLiveMessage")}</p>
      </div>
    ) : paymentRail === "disabled" ? (
      <div className="alert warn" role="status" aria-live="polite" data-pfms-rail="disabled">
        <strong>{t("railDisabledTitle")}</strong>
        <p>{t("railDisabledMessage")}</p>
      </div>
    ) : (
      <div className="alert warn" role="status" aria-live="polite" data-pfms-rail="unknown">
        <strong>{t("railUnknownTitle")}</strong>
        <p>{t("railUnknownMessage")}</p>
      </div>
    );

  const treasuryBanner =
    treasuryMode === "sandbox" ? (
      <div className="alert warn" role="status" aria-live="polite" data-pfms-mode="sandbox">
        <strong>{t("sandboxModeTitle")}</strong>
        <p>{t("sandboxModeMessage")}</p>
      </div>
    ) : treasuryMode === "live" ? (
      <div className="alert" role="status" aria-live="polite" data-pfms-mode="live">
        <strong>{t("liveModeTitle")}</strong>
        <p>{t("liveModeMessage")}</p>
      </div>
    ) : (
      <div className="alert warn" role="status" aria-live="polite" data-pfms-mode="unknown">
        <strong>{t("unknownModeTitle")}</strong>
        <p>{t("unknownModeMessage")}</p>
      </div>
    );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Tabs tabs={[...TABS]} active={active} onChange={setActive} />

      <div role="tabpanel" hidden={active !== TABS[0]} style={{ display: active === TABS[0] ? "grid" : "none", gap: 16 }}>
        {railBanner}
        <SubmitPaymentForm rail={paymentRail} />
      </div>
      <div role="tabpanel" hidden={active !== TABS[1]} style={{ display: active === TABS[1] ? "grid" : "none", gap: 16 }}>
        {railBanner}
        <PaymentStatusLookup />
      </div>
      <div role="tabpanel" hidden={active !== TABS[2]} style={{ display: active === TABS[2] ? "grid" : "none", gap: 16 }}>
        {treasuryBanner}
        <SalaryBillForm departments={departments} onModeObserved={setTreasuryMode} />
      </div>
      <div role="tabpanel" hidden={active !== TABS[3]} style={{ display: active === TABS[3] ? "grid" : "none", gap: 16 }}>
        {treasuryBanner}
        <PaymentAdviceForm bills={bills} onModeObserved={setTreasuryMode} />
      </div>
    </div>
  );
}
