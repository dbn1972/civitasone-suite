"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

/**
 * Signs a draft Store Receipt Note. Signing is the GFR Rule 149 gate — once
 * signed, the three-way-match consumer will release payment for this GRN
 * (provided the match itself is clean). Irreversible, so it is confirmed.
 *
 * GAP-PROCUREMENT-GRN-DETAIL-SRN-03 — the confirm dialog now names the GRN,
 * vendor and received date so the signer sees what they are certifying, and
 * the sign PATCH carries receivedAt (the SRN's own received date, or today's
 * ISO date if a draft never had one) so a draft signed later is not left with
 * an unset/server-default receipt date — mirroring the create+sign flow.
 */
export function SignSrnAction({
  srnId,
  grnNo,
  vendor,
  receivedAt,
}: {
  srnId: string;
  grnNo?: string;
  vendor?: string;
  receivedAt?: string | null;
}) {
  const router = useRouter();
  const effectiveReceivedAt = receivedAt ?? new Date().toISOString().slice(0, 10);

  async function sign(reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/inventory/srn/${srnId}/sign`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        receivedAt: new Date(effectiveReceivedAt).toISOString(),
        // Only send remarks when the signer actually typed something, so an
        // empty box does not overwrite remarks captured at create time.
        remarks: reason?.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const human = toHumanError("save", { area: "Store Receipt Note" });
      throw new Error(`${human.what} ${human.next}`);
    }
  }

  return (
    <ActionButton
      label="Sign & confirm receipt"
      confirmTitle="Sign this Store Receipt Note?"
      confirmDescription={
        <>
          You are confirming physical acceptance into store of{" "}
          <strong>{grnNo ?? "this GRN"}</strong>
          {vendor ? <> from <strong>{vendor}</strong></> : null}, received on{" "}
          <strong>{formatIndianDate(effectiveReceivedAt)}</strong>. Once signed, it cannot be
          un-signed, and payment against this GRN can proceed (GFR Rule 149).
        </>
      }
      confirmLabel="Sign"
      optionalReason
      reasonLabel="Signing remarks (optional)"
      onConfirm={sign}
      onSuccess={() => router.refresh()}
    />
  );
}
