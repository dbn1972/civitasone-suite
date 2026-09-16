"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Tabs } from "../../../_components/ds";
import { BatchesPanel } from "./BatchesPanel";
import { ConfigPanel } from "./ConfigPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import type { PfmsBatchRow, PfmsConfig, PfmsDepartment } from "./types";

interface PfmsConsoleProps {
  batches: PfmsBatchRow[];
  config: PfmsConfig | null;
  departments?: PfmsDepartment[];
}

export function PfmsConsole({ batches, config, departments = [] }: PfmsConsoleProps) {
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

      {active === TABS[0] && <BatchesPanel batches={batches} />}
      {active === TABS[1] && <ConfigPanel config={config} />}
      {active === TABS[2] && <PaymentsPanel departments={departments} />}
    </Card>
  );
}
