"use client";

import { useState } from "react";
import { Tabs } from "@/app/_components/ds";
import { SubmitReturnPanel } from "./SubmitReturnPanel";
import { ReturnStatusPanel } from "./ReturnStatusPanel";
import { VerifyGstinPanel } from "./VerifyGstinPanel";

const TABS = ["Submit Return", "Return Status", "Verify GSTIN"] as const;
type Tab = (typeof TABS)[number];

export function GstnConsole() {
  const [active, setActive] = useState<Tab>("Submit Return");

  return (
    <div>
      <Tabs tabs={[...TABS]} active={active} onChange={(t) => setActive(t as Tab)} />
      <div style={{ marginTop: 16 }}>
        {active === "Submit Return" && <SubmitReturnPanel />}
        {active === "Return Status" && <ReturnStatusPanel />}
        {active === "Verify GSTIN" && <VerifyGstinPanel />}
      </div>
    </div>
  );
}
