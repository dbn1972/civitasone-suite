"use client";

/**
 * GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04: cancel an issued cheque / DD from its
 * detail page. POST /v1/finance/instruments/:id/cancel -- finance-service
 * restricts it to finance_officer / finance_admin / super_admin and allows it
 * only from the "issued" state (409 otherwise), so the control is rendered for
 * issued instruments only. Idempotency is real but server-side: the guarded
 * UPDATE (WHERE status = issued) and the already-cancelled short-circuit make a
 * replay a no-op, and the cancel is audited exactly once. finance-service does
 * NOT deduplicate on x-idempotency-key for instruments; the header (the one the
 * BFF proxy and gateway forward) is sent for request tracing only.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export function InstrumentActions({ id, instrumentNo }: { id: string; instrumentNo: string }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const idemKey = useRef<string>(globalThis.crypto.randomUUID());
  return (
    <>
      <ActionButton
        label="Cancel cheque"
        className="btn ghost"
        danger
        confirmTitle={`Cancel cheque ${instrumentNo}?`}
        confirmDescription="The instrument is marked cancelled and can no longer be presented. This cannot be undone."
        confirmLabel="Yes, cancel cheque"
        onConfirm={async () => {
          const res = await browserFetch(`v1/finance/instruments/${id}/cancel`, {
            method: "POST",
            headers: { "x-idempotency-key": idemKey.current },
          });
          if (!res.ok) {
            // A failed attempt may be retried: use a fresh key next time.
            idemKey.current = globalThis.crypto.randomUUID();
            throw new Error(await errorMessageFromResponse(res, res.status === 409 ? "conflict" : "save", "cheque"));
          }
        }}
        onSuccess={() => {
          setNote("Cheque cancelled.");
          router.refresh();
        }}
      />
      {note ? <span role="status" style={{ fontSize: 12 }}>{note}</span> : null}
    </>
  );
}
