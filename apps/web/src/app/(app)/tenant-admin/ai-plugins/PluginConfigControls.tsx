"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { z } from "zod";
import { Button, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * GAP-TENANT-ADMIN-AI-PLUGINS-01 (WIRING): the page subtitle promised
 * "Enable, configure" but there was no control at all — the backend PATCH
 * /v1/hrms/ai/plugins/:pluginId had no UI caller. This client component wires
 * a mode selector, an enable switch and a 0–100 confidence-threshold input to
 * that endpoint via the proxy.
 *
 * Safety:
 *  - Enabling `autoAction` (which lets a model act on its own prediction, e.g.
 *    auto-shortlist candidates) is behind a reason-required ConfirmDialog.
 *  - The threshold is validated 0–100 client-side (zod, matching the backend
 *    configUpdateSchema) before the request; a server 400 surfaces via
 *    useFormError, never raw.
 *  - The backend enforces tenant-admin role (GAP-...-03) and no longer 500s on
 *    a first-ever PATCH (GAP-...-01); this component is only rendered for
 *    tenant-admin roles by the page.
 */
const configSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["active", "shadow", "disabled"]).optional(),
  confidenceThreshold: z.number().min(0).max(100).optional(),
  autoAction: z.boolean().optional(),
});

const MODES = ["active", "shadow", "disabled"] as const;

export function PluginConfigControls({
  pluginId,
  pluginName,
  enabled,
  mode,
  confidenceThreshold,
  autoAction,
  requiresTraining,
}: {
  pluginId: string;
  pluginName: string;
  enabled: boolean;
  mode: string;
  confidenceThreshold: number;
  autoAction: boolean;
  requiresTraining: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [thresholdInput, setThresholdInput] = useState(String(confidenceThreshold));
  const [thresholdError, setThresholdError] = useState("");
  const [autoActionPending, setAutoActionPending] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const formError = useFormError("AI plugin");

  const modeId = useId();
  const thresholdId = useId();
  const thresholdErrId = useId();

  // Enabling a plugin that still needs training data is blocked (the backend
  // models this as a soft warning; we keep the control disabled to match).
  const enableBlocked = requiresTraining && !enabled;

  async function patch(body: z.infer<typeof configSchema>): Promise<boolean> {
    const parsed = configSchema.safeParse(body);
    if (!parsed.success) {
      setMessage("Those values were not accepted. Check the confidence threshold (0–100).");
      return false;
    }
    formError.clear();
    const res = await fetch(`/api/proxy/v1/hrms/ai/plugins/${encodeURIComponent(pluginId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    if (!res.ok) {
      setMessage((await formError.fromResponse(res, "save")).message);
      return false;
    }
    return true;
  }

  async function run(body: z.infer<typeof configSchema>, okText: string): Promise<void> {
    setBusy(true);
    setMessage("");
    setOkMessage("");
    try {
      if (await patch(body)) {
        setOkMessage(okText);
        router.refresh();
      }
    } catch (caught) {
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  function onThresholdCommit() {
    setThresholdError("");
    const n = Number(thresholdInput);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setThresholdError("Enter a number from 0 to 100.");
      return;
    }
    if (n === confidenceThreshold) return;
    void run({ confidenceThreshold: n }, `Confidence threshold for "${pluginName}" set to ${n}%.`);
  }

  async function runAutoAction(reason?: string): Promise<void> {
    setDialogBusy(true);
    setDialogError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/hrms/ai/plugins/${encodeURIComponent(pluginId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoAction: true, reason }),
      });
      if (!res.ok) {
        setDialogError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setAutoActionPending(false);
      setOkMessage(`Auto-action enabled for "${pluginName}".`);
      router.refresh();
    } catch (caught) {
      setDialogError(formError.fromException("save", caught).message);
    } finally {
      setDialogBusy(false);
    }
  }

  return (
    <div className="space-y-2 pt-2 border-t" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={modeId} className="text-xs font-semibold">Mode</label>
        <select
          id={modeId}
          value={mode}
          disabled={busy}
          onChange={(e) => void run({ mode: e.target.value as (typeof MODES)[number] }, `"${pluginName}" set to ${e.target.value}.`)}
          className="text-xs border rounded px-2 py-1"
          style={{ minHeight: 32 }}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">Enabled</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${pluginName} ${enabled ? "enabled" : "disabled"}`}
          disabled={busy || enableBlocked}
          title={enableBlocked ? "Requires training data before enabling" : undefined}
          onClick={() => void run({ enabled: !enabled }, `"${pluginName}" ${!enabled ? "enabled" : "disabled"}.`)}
          className={`pill ${enabled ? "good" : "mut"}`}
          style={{ cursor: busy || enableBlocked ? "default" : "pointer", border: "1px solid var(--line)" }}
        >
          {enabled ? "On" : "Off"}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label htmlFor={thresholdId} className="text-xs font-semibold">Confidence threshold</label>
        <input
          id={thresholdId}
          type="number"
          min={0}
          max={100}
          value={thresholdInput}
          disabled={busy}
          onChange={(e) => setThresholdInput(e.target.value)}
          onBlur={onThresholdCommit}
          aria-invalid={thresholdError ? true : undefined}
          aria-describedby={thresholdError ? thresholdErrId : undefined}
          className="text-xs border rounded px-2 py-1 w-20"
          style={{ minHeight: 32 }}
        />
      </div>
      {thresholdError ? <p id={thresholdErrId} role="alert" className="text-xs" style={{ color: "var(--bad)" }}>{thresholdError}</p> : null}

      {!autoAction && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setMessage(""); setDialogError(undefined); setAutoActionPending(true); }}>
          Enable auto-action
        </Button>
      )}

      {okMessage ? <p role="status" aria-live="polite" className="text-xs" style={{ color: "#067647" }}>{okMessage}</p> : null}
      {message ? <p role="alert" className="text-xs" style={{ color: "var(--bad)" }}>{message}</p> : null}

      <ConfirmDialog
        open={autoActionPending}
        title={`Enable auto-action for "${pluginName}"?`}
        description="Auto-action lets this model act on its own predictions without a human in the loop (for example, auto-shortlisting candidates). This changes behaviour tenant-wide."
        confirmLabel="Enable auto-action"
        danger
        requireReason
        reasonLabel="Reason (recorded in the audit log)"
        busy={dialogBusy}
        errorMessage={dialogError}
        onConfirm={(reason) => void runAutoAction(reason)}
        onCancel={() => { if (!dialogBusy) { setAutoActionPending(false); setDialogError(undefined); } }}
      />
    </div>
  );
}
