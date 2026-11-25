"use client";

/**
 * POST /v1/procurement/vendors/:vendorId/scorecard/recompute (procurement writers,
 * scorecard-routes.ts) with an empty body: recomputes from the recorded
 * performance events. Async (202) - the page is refreshed and an honest
 * "request accepted" note is shown; the figures update when the worker finishes.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { isNetworkFailure } from "@/lib/userFacingError";

export function RecomputeScorecard({ vendorId }: { vendorId: string }) {
  const t = useTranslations("procurement.w2.showCause");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function run(): Promise<void> {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch(`/api/proxy/v1/procurement/vendors/${vendorId}/scorecard/recompute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save", "vendor scorecard");
      setNote(t("recomputeAccepted"));
      router.refresh();
    } catch (e) {
      setError(!isNetworkFailure(e) && e instanceof Error ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button type="button" className="btn ghost" onClick={() => void run()} disabled={busy}>
        {busy ? t("recomputing") : t("recompute")}
      </button>
      {note ? <span role="status" style={{ fontSize: 12 }}>{note}</span> : null}
      {error ? <span role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>{error}</span> : null}
    </span>
  );
}
