"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/app/_components/ds";
import { SubmitReturnPanel } from "./SubmitReturnPanel";
import { ReturnStatusPanel } from "./ReturnStatusPanel";
import { VerifyGstinPanel } from "./VerifyGstinPanel";

const TABS = ["Submit Return", "Return Status", "Verify GSTIN"] as const;
type Tab = (typeof TABS)[number];

const TAB_SLUGS: Record<Tab, string> = {
  "Submit Return": "submit",
  "Return Status": "status",
  "Verify GSTIN": "verify",
};
const SLUG_TABS: Record<string, Tab> = {
  submit: "Submit Return",
  status: "Return Status",
  verify: "Verify GSTIN",
};

export function GstnConsole({ gstnEnabled = true }: { gstnEnabled?: boolean } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // GAP-BILLING-GSTN-06: tab is deep-linkable via ?tab=submit|status|verify.
  const initialTab = SLUG_TABS[searchParams.get("tab") ?? ""] ?? "Submit Return";
  const [active, setActive] = useState<Tab>(initialTab);
  // GAP-BILLING-GSTN-04: carry the reference id from a successful submit to the
  // Return Status tab so the officer doesn't copy a uuid by hand.
  const [lastReferenceId, setLastReferenceId] = useState<string>("");

  const changeTab = useCallback(
    (t: Tab) => {
      setActive(t);
      // Sync to the URL without a full navigation.
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.set("tab", TAB_SLUGS[t]);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const onSubmitted = useCallback((referenceId: string) => {
    setLastReferenceId(referenceId);
  }, []);

  const goCheckStatus = useCallback(
    (referenceId: string) => {
      setLastReferenceId(referenceId);
      changeTab("Return Status");
    },
    [changeTab],
  );

  return (
    <div>
      <Tabs tabs={[...TABS]} active={active} onChange={(t) => changeTab(t as Tab)} />
      {/* GAP-BILLING-GSTN-04: all panels stay mounted; inactive ones are hidden
          with the `hidden` attribute so a half-typed return isn't lost on a tab
          switch. */}
      <div style={{ marginTop: 16 }}>
        <div hidden={active !== "Submit Return"}>
          <SubmitReturnPanel onSubmitted={onSubmitted} onCheckStatus={goCheckStatus} disabled={!gstnEnabled} />
        </div>
        <div hidden={active !== "Return Status"}>
          <ReturnStatusPanel initialRef={lastReferenceId} />
        </div>
        <div hidden={active !== "Verify GSTIN"}>
          <VerifyGstinPanel disabled={!gstnEnabled} />
        </div>
      </div>
    </div>
  );
}
