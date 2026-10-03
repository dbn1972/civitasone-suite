"use client";

/**
 * GAP-FINANCE-TREASURY-CHEQUES-03: bank-outcome actions on the cheque / DD detail page: mark
 * presented, mark cleared, mark bounced. (Cancel lives in InstrumentActions.)
 * finance-service restricts every transition to finance_officer / finance_admin /
 * super_admin and to legal source states (409 otherwise), so each control is
 * rendered only for the states where it is legal (see lifecycleUi.availableLifecycleActions).
 * Clearing or bouncing an instrument is maker-checker: the officer who issued it
 * is refused with 403 MAKER_CHECKER_VIOLATION (server-enforced), shown here as a
 * plain-language message. Idempotency is real but server-side: each transition is a
 * guarded UPDATE, so a replay is a no-op and is audited once. finance-service does
 * NOT deduplicate on x-idempotency-key for instruments; the header (the one the BFF
 * proxy and gateway forward) is sent for request tracing only.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { availableLifecycleActions, type LifecycleAction } from "./lifecycleUi";

const MAKER_CHECKER_COPY = "The officer who issued this instrument cannot also record its clearance or dishonour. Ask a different finance officer to do it.";

const DONE: Record<LifecycleAction, string> = {
  present: "Cheque marked as presented.",
  clear: "Cheque marked as cleared.",
  bounce: "Cheque marked as bounced.",
};

export function InstrumentLifecycleActions({ id, instrumentNo, status = "issued" }: { id: string; instrumentNo: string; status?: string }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [bounceOpen, setBounceOpen] = useState(false);
  const [bounceBusy, setBounceBusy] = useState(false);
  const [bounceError, setBounceError] = useState<string | undefined>();
  const idemKey = useRef<string>(globalThis.crypto.randomUUID());

  async function failure(res: Response): Promise<string> {
    // A failed attempt may be retried: use a fresh key next time.
    idemKey.current = globalThis.crypto.randomUUID();
    try {
      const body = (await res.clone().json()) as { code?: string };
      if (body?.code === "MAKER_CHECKER_VIOLATION") return MAKER_CHECKER_COPY;
    } catch {
      /* not JSON: fall through to the catalogued message */
    }
    return errorMessageFromResponse(res, res.status === 409 ? "conflict" : "save", "cheque");
  }

  async function post(action: LifecycleAction, body?: unknown): Promise<Response> {
    return browserFetch(`v1/finance/instruments/${id}/${action}`, {
      method: "POST",
      headers: { "x-idempotency-key": idemKey.current },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  function done(action: LifecycleAction) {
    setNote(DONE[action]);
    router.refresh();
  }

  const actions = availableLifecycleActions(status);
  return (
    <>
      {actions.includes("present") ? (
        <ActionButton
          label="Mark presented"
          className="btn ghost"
          confirmTitle={`Mark cheque ${instrumentNo} as presented?`}
          confirmDescription="Records that the instrument has been presented at the bank."
          confirmLabel="Yes, mark presented"
          onConfirm={async () => {
            const res = await post("present");
            if (!res.ok) throw new Error(await failure(res));
          }}
          onSuccess={() => done("present")}
        />
      ) : null}
      {actions.includes("clear") ? (
        <ActionButton
          label="Mark cleared"
          className="btn ghost"
          confirmTitle={`Mark cheque ${instrumentNo} as cleared?`}
          confirmDescription="Records that the bank has cleared the instrument. A different officer from the one who issued it must do this."
          confirmLabel="Yes, mark cleared"
          onConfirm={async () => {
            const res = await post("clear");
            if (!res.ok) throw new Error(await failure(res));
          }}
          onSuccess={() => done("clear")}
        />
      ) : null}
      {actions.includes("bounce") ? (
        <button type="button" className="btn ghost" onClick={() => { setBounceError(undefined); setBounceOpen(true); }}>
          Mark bounced
        </button>
      ) : null}
      <ConfirmDialog
        open={bounceOpen}
        title={`Mark cheque ${instrumentNo} as bounced?`}
        description="Records that the bank dishonoured the instrument. A different officer from the one who issued it must do this."
        confirmLabel="Mark bounced"
        danger
        requireReason
        reasonLabel="Reason for dishonour"
        minReasonLength={3}
        maxReasonLength={500}
        busy={bounceBusy}
        errorMessage={bounceError}
        onConfirm={(reason) => {
          void (async () => {
            setBounceBusy(true);
            setBounceError(undefined);
            try {
              const res = await post("bounce", { reason });
              if (!res.ok) { setBounceError(await failure(res)); return; }
              setBounceOpen(false);
              done("bounce");
            } catch {
              setBounceError("Could not record the dishonour. Please try again.");
            } finally {
              setBounceBusy(false);
            }
          })();
        }}
        onCancel={() => !bounceBusy && setBounceOpen(false)}
      />
      {note ? <span role="status" style={{ fontSize: 12 }}>{note}</span> : null}
    </>
  );
}
