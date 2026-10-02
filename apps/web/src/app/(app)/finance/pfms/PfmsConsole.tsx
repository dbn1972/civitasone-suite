"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Tabs } from "../../../_components/ds";
import { BatchesPanel } from "./BatchesPanel";
import { ConfigPanel } from "./ConfigPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import type { PfmsBatchRow, PfmsBill, PfmsConfig, PfmsDepartment } from "./types";

interface PfmsConsoleProps {
  batches: PfmsBatchRow[];
  config: PfmsConfig | null;
  departments?: PfmsDepartment[];
  /** Bills the payment-advice form can pick from (GAP-FINANCE-PFMS-07). */
  bills?: PfmsBill[];
  /** Whether the session may download a batch bank file (GAP-FINANCE-PFMS-03). Defaults to true; the server is still the authority. */
  canDownloadBankFile?: boolean;
}

export function PfmsConsole({ batches, config, departments = [], bills = [], canDownloadBankFile = true }: PfmsConsoleProps) {
  const t = useTranslations("pfmsConsole");
  // The shared Tabs design-system component uses each tab string as both its
  // display label and its identity (selection compares by ===, and it doubles
  // as the React key) -- there's no separate value/label pair, fleet-wide, so
  // the translated labels themselves have to double as the tab identity, same
  // as the original hardcoded strings did. Built inside the component (not
  // module scope) because t() is a hook result.
  const TABS = [t("tabBatches"), t("tabConfig"), t("tabPayments")] as const;
  type Tab = (typeof TABS)[number];
  const [active, setActive] = useState<Tab>(TABS[0]);

  return (
    <Card title={t("title")}>
      <Tabs tabs={[...TABS]} active={active} onChange={(tab) => setActive(tab as Tab)} />

      {active === TABS[0] && <BatchesPanel batches={batches} canDownloadBankFile={canDownloadBankFile} />}
      {active === TABS[1] && <ConfigPanel config={config} />}
      {active === TABS[2] && <PaymentsPanel
          departments={departments}
          bills={bills}
          paymentRail={config?.paymentRail ?? null}
          initialTreasuryMode={config?.treasuryMode ?? null}
        />}
    </Card>
  );
}
