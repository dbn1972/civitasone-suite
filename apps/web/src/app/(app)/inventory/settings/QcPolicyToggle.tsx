"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * Turns the goods-return QC maker-checker rule on or off for the tenant. When on
 * (the default), the person who recorded a goods return cannot record its QC verdict.
 * The change is queued (202) and audited by the service.
 */
export function QcPolicyToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const formError = useFormError("inventory policy");
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function change(next: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/inventory/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qcMakerChecker: next }),
      });
      if (!res.ok) {
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setEnabled(next);
      toast.success("Policy saved.");
      router.refresh();
    } catch (caught) {
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card pad" style={{ maxWidth: 560 }} aria-label="QC maker-checker policy">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <input
          id="qc-maker-checker"
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => void change(e.target.checked)}
          aria-describedby="qc-maker-checker-help"
          style={{ marginTop: 4 }}
        />
        <div>
          <label htmlFor="qc-maker-checker">
            <strong>Require a different person to record the QC verdict on a goods return</strong>
          </label>
          <p id="qc-maker-checker-help" style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "#475569" }}>
            When on, the user who recorded a goods return cannot inspect it. Turn this off only for stores
            where a single person handles both steps. Every change is recorded in the audit log.
          </p>
        </div>
      </div>
      <div role="status" aria-live="polite">
        {message ? <p role="alert" style={{ marginTop: 12, fontSize: "0.875rem", color: "#b91c1c" }}>{message}</p> : null}
      </div>
    </section>
  );
}
