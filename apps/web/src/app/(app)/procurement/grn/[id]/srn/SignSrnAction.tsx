"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "@/app/_components/ds";

/**
 * Signs a draft Store Receipt Note. Signing is the GFR Rule 149 gate — once
 * signed, the three-way-match consumer will release payment for this GRN
 * (provided the match itself is clean). Irreversible, so it is confirmed.
 */
export function SignSrnAction({ srnId }: { srnId: string }) {
  const router = useRouter();

  async function sign(reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/inventory/srn/${srnId}/sign`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ remarks: reason || undefined }),
    });
    if (!res.ok) throw new Error((await res.text()) || "Could not sign the SRN.");
  }

  return (
    <ActionButton
      label="Sign & confirm receipt"
      confirmTitle="Sign this Store Receipt Note?"
      confirmDescription="This confirms physical acceptance of the goods into store. Once signed, it cannot be un-signed, and payment against this GRN can proceed."
      confirmLabel="Sign"
      onConfirm={sign}
      onSuccess={() => router.refresh()}
    />
  );
}
