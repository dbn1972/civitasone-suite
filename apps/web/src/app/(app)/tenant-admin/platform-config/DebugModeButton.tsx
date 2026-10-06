"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

// GAP-TENANT-ADMIN-PLATFORM-CONFIG-01: enable time-limited debug logging via the
// real admin-service route POST /v1/admin/platform-config/debug-mode. The
// backend clamps durationMinutes to [5, 60] and auto-reverts; we offer the
// 15/30/60 options from the fix step and confirm with a required reason.
const DURATIONS = [15, 30, 60] as const;

export function DebugModeButton({ debugModeUntil }: { debugModeUntil: string | null }) {
  const router = useRouter();
  const formError = useFormError("debug mode");
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<number>(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const active = debugModeUntil !== null && new Date(debugModeUntil) > new Date();

  async function enable(reason?: string) {
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/admin/platform-config/debug-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ durationMinutes: minutes, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      {active && (
        <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, background: "#fef3c7", color: "#92400e", fontWeight: 600, marginInlineEnd: 8 }}>
          Debug until {new Date(debugModeUntil!).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST
        </span>
      )}
      <Button size="sm" variant="ghost" onClick={() => { setError(undefined); setOpen(true); }}>
        {active ? "Extend debug mode" : "Enable debug mode"}
      </Button>

      <ConfirmDialog
        open={open}
        title="Enable time-limited debug logging?"
        description={
          <div>
            <p style={{ margin: "0 0 10px" }}>Debug logging increases log volume platform-wide and auto-reverts when the window ends.</p>
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <legend style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 6 }}>Duration</legend>
              <div style={{ display: "flex", gap: 8 }}>
                {DURATIONS.map((d) => (
                  <label key={d} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                    <input type="radio" name="debug-duration" checked={minutes === d} onChange={() => setMinutes(d)} />
                    {d} min
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        }
        confirmLabel="Enable debug mode"
        requireReason
        reasonLabel="Reason (audited)"
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void enable(reason)}
        onCancel={() => { if (!busy) { setOpen(false); setError(undefined); } }}
      />
    </div>
  );
}
