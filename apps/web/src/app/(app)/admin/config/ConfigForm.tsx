"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, PageHeader } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import {
  buildConfigPatch,
  toFormValues,
  CACHE_TTL_BOUNDS,
  LOG_LEVELS,
  type ConfigErrors,
  type ConfigFormValues,
  type PlatformControllable,
} from "./configDiff";

const inputStyle = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 14 } as const;
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 4 } as const;
const fieldErrorStyle = { display: "block", fontSize: 12, color: "var(--bad)", marginTop: 4 } as const;

function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} style={labelStyle}>{label}</label>
      {children}
      {error && <span role="alert" style={fieldErrorStyle}>{error}</span>}
    </div>
  );
}

/**
 * Editor for admin-service's controllable platform parameters. The initial
 * state is the live GET response (never literals), Save is disabled until
 * something changed, and only the changed fields are PATCHed
 * (GAP-ADMIN-CONFIG-01), after an explicit confirmation (GAP-ADMIN-CONFIG-03).
 */
export function ConfigForm({ initial }: { initial: PlatformControllable }) {
  const id = useId();
  const router = useRouter();
  const baseline = useMemo(() => toFormValues(initial), [initial]);
  const [saved, setSaved] = useState<ConfigFormValues>(baseline);
  const [form, setForm] = useState<ConfigFormValues>(baseline);
  const [errors, setErrors] = useState<ConfigErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formError = useFormError("platform configuration");

  const preview = buildConfigPatch(saved, form);
  const hasChanges = preview.ok ? Object.keys(preview.patch).length > 0 : true;

  function set(patch: Partial<ConfigFormValues>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setErrors({});
    setSuccess(null);
  }

  function requestSave(e: React.FormEvent) {
    e.preventDefault();
    const result = buildConfigPatch(saved, form);
    if (!result.ok) { setErrors(result.errors); return; }
    if (Object.keys(result.patch).length === 0) return;
    setConfirmOpen(true);
  }

  async function doSave() {
    const result = buildConfigPatch(saved, form);
    if (!result.ok || Object.keys(result.patch).length === 0) { setConfirmOpen(false); return; }
    setSaving(true);
    setError(null);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/admin/platform-config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result.patch),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      // GAP-ADMIN-CONFIG-04: "saved" is only claimed for a synchronous 200, where the
      // response carries the applied values and the form is re-seeded from them. A 202
      // means the change was accepted, not yet applied, and must not read as saved.
      if (res.status === 202) {
        setSaved(form);
        setSuccess("Change submitted — it may take a minute to apply.");
        router.refresh();
      } else {
        const applied = await readApplied(res);
        const next = applied ? toFormValues(applied) : form;
        setSaved(next);
        setForm(next);
        setSuccess("Platform configuration saved.");
      }
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  const changedSummary = preview.ok ? Object.entries(flatten(preview.patch)) : [];

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Platform Configuration"
        subtitle="Tunable platform parameters — log level, rate limits, cache lifetimes and notification senders."
        back="/admin"
      />

      {error && (
        <div role="alert" aria-live="polite" style={{ background: "var(--badbg)", color: "var(--bad)", border: "1px solid var(--badbd)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}
      {success && (
        <div role="status" aria-live="polite" style={{ background: "var(--goodbg)", color: "var(--good)", border: "1px solid var(--goodbd)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
          {success} Every change is recorded in the <Link href="/admin/audit-log">audit log</Link>.
        </div>
      )}

      <form onSubmit={requestSave}>
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-h"><h3>Logging and rate limits</h3></div>
          <div style={{ padding: 20, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <Field label="Log level" htmlFor={`${id}-log`} error={errors.logLevel}>
              <select id={`${id}-log`} value={form.logLevel} onChange={(e) => set({ logLevel: e.target.value })} style={inputStyle}>
                {!(LOG_LEVELS as readonly string[]).includes(form.logLevel) && <option value={form.logLevel}>{form.logLevel}</option>}
                {LOG_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Requests per minute (min 10)" htmlFor={`${id}-pm`} error={errors.perMinute}>
              <input id={`${id}-pm`} type="number" inputMode="numeric" value={form.perMinute} onChange={(e) => set({ perMinute: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Burst maximum (min 5)" htmlFor={`${id}-bm`} error={errors.burstMax}>
              <input id={`${id}-bm`} type="number" inputMode="numeric" value={form.burstMax} onChange={(e) => set({ burstMax: e.target.value })} style={inputStyle} />
            </Field>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-h"><h3>Cache lifetime (seconds)</h3></div>
          <div style={{ padding: 20, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            {Object.keys(form.cacheTtl).map((mod) => (
              <Field key={mod} label={`${mod} (${CACHE_TTL_BOUNDS.min}-${CACHE_TTL_BOUNDS.max})`} htmlFor={`${id}-ttl-${mod}`} error={errors[`cacheTtl.${mod}`]}>
                <input
                  id={`${id}-ttl-${mod}`}
                  type="number"
                  inputMode="numeric"
                  value={form.cacheTtl[mod]}
                  onChange={(e) => set({ cacheTtl: { ...form.cacheTtl, [mod]: e.target.value } })}
                  style={inputStyle}
                />
              </Field>
            ))}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-h"><h3>Notification senders</h3></div>
          <div style={{ padding: 20, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <Field label="Email provider" htmlFor={`${id}-ep`} error={errors.emailProvider}>
              <input id={`${id}-ep`} value={form.emailProvider} onChange={(e) => set({ emailProvider: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Email from address" htmlFor={`${id}-ef`} error={errors.emailFrom}>
              <input id={`${id}-ef`} type="email" value={form.emailFrom} onChange={(e) => set({ emailFrom: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="SMS provider" htmlFor={`${id}-sp`} error={errors.smsProvider}>
              <input id={`${id}-sp`} value={form.smsProvider} onChange={(e) => set({ smsProvider: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="SMS sender id" htmlFor={`${id}-sf`} error={errors.smsFrom}>
              <input id={`${id}-sf`} value={form.smsFrom} onChange={(e) => set({ smsFrom: e.target.value })} style={inputStyle} />
            </Field>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 32 }}>
          <Button type="submit" disabled={saving || !hasChanges} loading={saving}>
            {saving ? "Saving…" : "Save Configuration"}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        danger
        title="Apply platform configuration changes?"
        description={
          <div>
            <p style={{ margin: "0 0 8px" }}>These settings apply platform-wide, not just to one office:</p>
            <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
              {changedSummary.map(([k, v]) => <li key={k}><code>{k}</code> → {String(v)}</li>)}
            </ul>
            <p style={{ margin: 0 }}>The change is attributed to you in the audit trail.</p>
          </div>
        }
        confirmLabel="Apply changes"
        busy={saving}
        onConfirm={() => void doSave()}
        onCancel={() => { if (!saving) setConfirmOpen(false); }}
      />
    </div>
  );
}

/** The applied `controllable` block from a 200 response, or null when the body is empty / not that shape. */
async function readApplied(res: Response): Promise<PlatformControllable | null> {
  try {
    const body = (await res.json()) as { controllable?: PlatformControllable } | null;
    const c = body?.controllable;
    return c && typeof c === "object" && c.rateLimits && c.notifications && c.cacheTtl ? c : null;
  } catch {
    return null;
  }
}

function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}
