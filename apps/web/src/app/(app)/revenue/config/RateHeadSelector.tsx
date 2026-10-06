"use client";

import { useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RateHeadRow } from "./types";

interface RateHeadSelectorProps {
  rateHeads: RateHeadRow[];
  selectedId: string | null;
}

/**
 * Rate slabs / penalty rules / rebate rules are all scoped to a single rate
 * head (the GET routes require `rateHeadId`). This selector drives that scope
 * via the URL, matching the ?period= pattern used by finance/gst.
 */
export function RateHeadSelector({ rateHeads, selectedId }: RateHeadSelectorProps) {
  const router = useRouter();
  const id = useId();
  const [, startTransition] = useTransition();

  if (rateHeads.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: 6, marginBottom: 16, maxWidth: 360 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
        Rate head <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
      </label>
      <select
        id={id}
        value={selectedId ?? ""}
        aria-required="true"
        onChange={(e) => {
          const next = e.target.value;
          // GAP-REVENUE-CONFIG-05: router.replace (not push) + scroll:false, in
          // a transition — switching the selected head must not spam the back
          // history nor jump the scroll position back to the top.
          startTransition(() => {
            router.replace(`/revenue/config?rateHeadId=${encodeURIComponent(next)}`, { scroll: false });
          });
        }}
        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
      >
        {rateHeads.map((rh) => (
          <option key={rh.id} value={rh.id}>
            {rh.code} — {rh.name}
          </option>
        ))}
      </select>
    </div>
  );
}
