"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

export interface AuditActionField {
  /** JSON body key sent to the audit-service route. */
  name: string;
  label: string;
  kind: "text" | "textarea" | "select";
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Minimum trimmed length (text/textarea) or non-empty selection. Defaults to 1; 0 makes the field optional. */
  minLength?: number;
  maxLength?: number;
}

export interface AuditActionDialogProps {
  triggerLabel: string;
  title: string;
  /** e.g. /v1/audit/plans/:id/defer — sent through /api/proxy. */
  endpoint: string;
  fields: ReadonlyArray<AuditActionField>;
  /** Constant body keys merged in (e.g. { status: "closed" }). */
  staticBody?: Record<string, unknown>;
  submitLabel: string;
  /** Human noun for error copy. */
  area: string;
  /** Optional explanatory line above the fields. */
  description?: string;
  variant?: "primary" | "ghost";
}

/**
 * One audit mutation behind a modal: collects the required fields (reason, outcome, assignee ...),
 * PATCHes the audit-service route and refreshes the page. Validation here mirrors, never replaces,
 * the server validators (the server stays the authority and answers 400/403/404/409).
 */
export function AuditActionDialog(props: AuditActionDialogProps) {
  const { triggerLabel, title, endpoint, fields, staticBody, submitLabel, area, description, variant = "ghost" } = props;
  const router = useRouter();
  const formError = useFormError(area);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const close = useCallback(() => { if (!busy) { setOpen(false); setError(null); } }, [busy]);

  const submit = useCallback(async () => {
    setError(null);
    for (const f of fields) {
      const v = (values[f.name] ?? "").trim();
      if (v.length < (f.minLength ?? 1)) { setError(`${f.label} is required.`); return; }
    }
    const body: Record<string, unknown> = { ...(staticBody ?? {}) };
    for (const f of fields) {
      const v = (values[f.name] ?? "").trim();
      if (v) body[f.name] = v;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy${endpoint}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { setError((await formError.fromResponse(res, "save")).message); return; }
      setOpen(false);
      setValues({});
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- formError helpers are stable; the wrapper object is not read.
  }, [fields, values, staticBody, endpoint, router]);

  const id = `aad-${endpoint.replace(/[^a-z0-9]+/gi, "-")}`;
  return (
    <>
      <Button variant={variant} onClick={() => { setError(null); setOpen(true); }}>{triggerLabel}</Button>
      <Modal open={open} onClose={close} title={title} size="lg" closeOnOverlayClick={false}>
        <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {description ? <p style={{ marginTop: 0 }}>{description}</p> : null}
          {fields.map((f) => (
            <div key={f.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label className="lbl" htmlFor={`${id}-${f.name}`}>{f.label}</label>
              {f.kind === "select" ? (
                <select id={`${id}-${f.name}`} className="inp" value={values[f.name] ?? ""} onChange={(e) => setValues((p) => ({ ...p, [f.name]: e.target.value }))}>
                  <option value="">Select…</option>
                  {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.kind === "textarea" ? (
                <textarea id={`${id}-${f.name}`} className="inp" rows={3} maxLength={f.maxLength ?? 2000} value={values[f.name] ?? ""} onChange={(e) => setValues((p) => ({ ...p, [f.name]: e.target.value }))} />
              ) : (
                <input id={`${id}-${f.name}`} className="inp" maxLength={f.maxLength ?? 128} value={values[f.name] ?? ""} onChange={(e) => setValues((p) => ({ ...p, [f.name]: e.target.value }))} />
              )}
            </div>
          ))}
          {error && <div role="alert" style={{ color: "var(--bad)", fontSize: 13, marginTop: 4 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
