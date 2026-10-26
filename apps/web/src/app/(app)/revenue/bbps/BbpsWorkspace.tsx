"use client";

import { useState } from "react";
import { FetchBillForm, type AssesseeOption } from "./FetchBillForm";
import { PayBillForm, type IssuedBill } from "./PayBillForm";

/**
 * Owner decision #7: fetch and pay share one piece of state — the bill the
 * server issued. Payment is only possible against that bill.
 */
export function BbpsWorkspace({ assessees = [] }: { assessees?: ReadonlyArray<AssesseeOption> }) {
  const [bill, setBill] = useState<IssuedBill | null>(null);
  return (
    <>
      <FetchBillForm assessees={assessees} onBillReady={setBill} />
      <PayBillForm bill={bill} />
    </>
  );
}
