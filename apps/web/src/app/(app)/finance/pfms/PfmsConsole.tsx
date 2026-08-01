"use client";

import { useState } from "react";
import { Card, Tabs } from "../../../_components/ds";
import { BatchesPanel } from "./BatchesPanel";
import { ConfigPanel } from "./ConfigPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import type { PfmsBatchRow, PfmsConfig } from "./types";

const TABS = ["Batches", "Config", "Payments"] as const;
type Tab = (typeof TABS)[number];

interface PfmsConsoleProps {
  batches: PfmsBatchRow[];
  config: PfmsConfig | null;
}

export function PfmsConsole({ batches, config }: PfmsConsoleProps) {
  const [active, setActive] = useState<Tab>("Batches");

  return (
    <Card title="PFMS Operations">
      <Tabs tabs={[...TABS]} active={active} onChange={(t) => setActive(t as Tab)} />

      {active === "Batches" && <BatchesPanel batches={batches} />}
      {active === "Config" && <ConfigPanel config={config} />}
      {active === "Payments" && <PaymentsPanel />}
    </Card>
  );
}
