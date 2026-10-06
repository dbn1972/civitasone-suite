"use client";

import { useCallback, useState } from "react";
import { Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

// GAP-AUDIT-EXPORTS-03: row-level integrity verification. Extracted so both the
// Current-job panel (ExportConsole) and the Recent-exports table can re-validate
// a completed artifact against its stored signature.
interface VerifyResult {
  verified: boolean;
  contentMatch: boolean;
  signatureMatch: boolean;
  signingKeyId?: string | null;
  reason?: string;
}

export function VerifyButton({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formError = useFormError("export");

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/proxy/v1/audit/exports/${jobId}/verify`, { cache: "no-store" });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "load");
        setError(resolved.message);
        return;
      }
      const body = (await res.json()) as { data: VerifyResult };
      setResult(body.data);
    } catch (caught) {
      setError(formError.fromException("load", caught).message);
    } finally {
      setBusy(false);
    }
    // formError.* are stable (useCallback'd on a fixed area string in useFormError).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Button size="sm" variant="ghost" onClick={() => void run()} disabled={busy}>
        {busy ? "Verifying…" : "Verify"}
      </Button>
      {result && (
        <span
          role="status"
          aria-live="polite"
          className={`pill ${result.verified ? "good" : "bad"}`}
          title={
            `content ${result.contentMatch ? "✓" : "✗"} · signature ${result.signatureMatch ? "✓" : "✗"}` +
            (result.signingKeyId ? ` · key ${result.signingKeyId}` : "")
          }
        >
          {result.verified ? "Verified" : "Mismatch"}
        </span>
      )}
      {error && <span style={{ fontSize: 12, color: "var(--bad)" }}>{error}</span>}
    </span>
  );
}
