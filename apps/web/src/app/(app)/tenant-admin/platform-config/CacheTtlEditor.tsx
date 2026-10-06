"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

// GAP-TENANT-ADMIN-PLATFORM-CONFIG-01: real editor for cache TTL per module.
// Matches admin-service's PATCH /v1/admin/platform-config contract:
// cacheTtl is Record<string, number> with each value an int in [5, 3600].
const TTL_MIN = 5;
const TTL_MAX = 3600;

const MODULE_LABELS: Record<string, string> = {
  finance: "Finance",
  procurement: "Procurement",
  hrms: "HRMS",
  payroll: "Payroll",
  reports: "Reports",
  analytics: "Analytics",
  default: "Default",
};

export function moduleLabel(key: string): string {
  return MODULE_LABELS[key] ?? key.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CacheTtlEditor({ cacheTtl }: { cacheTtl: Record<string, number> }) {
  const router = useRouter();
  const formError = useFormError("platform configuration");
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(cacheTtl).map(([k, v]) => [k, String(v)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);

  const entries = Object.entries(values);
  const invalid = entries.filter(([, v]) => {
    const n = Number(v);
    return !Number.isInteger(n) || n < TTL_MIN || n > TTL_MAX;
  });

  async function save() {
    setError(undefined);
    setSaved(false);
    if (invalid.length > 0) {
      setError(`Each TTL must be a whole number between ${TTL_MIN} and ${TTL_MAX} seconds.`);
      return;
    }
    setBusy(true);
    formError.clear();
    try {
      const cacheTtl = Object.fromEntries(entries.map(([k, v]) => [k, Number(v)]));
      const res = await fetch("/api/proxy/v1/admin/platform-config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cacheTtl }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <table className="tbl" style={{ fontSize: 13, width: "100%" }}>
        <thead><tr><th scope="col">Module</th><th scope="col" style={{ textAlign: "end" }}>TTL (s)</th></tr></thead>
        <tbody>
          {entries.map(([mod, v]) => {
            const n = Number(v);
            const bad = !Number.isInteger(n) || n < TTL_MIN || n > TTL_MAX;
            return (
              <tr key={mod}>
                <td>{moduleLabel(mod)}</td>
                <td style={{ textAlign: "end" }}>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={TTL_MIN}
                    max={TTL_MAX}
                    step={1}
                    value={v}
                    aria-invalid={bad || undefined}
                    aria-label={`${moduleLabel(mod)} cache TTL in seconds`}
                    onChange={(e) => { setValues((prev) => ({ ...prev, [mod]: e.target.value })); setSaved(false); }}
                    style={{ width: 90, padding: "6px 8px", borderRadius: 6, border: `1px solid ${bad ? "var(--bad)" : "var(--line)"}`, textAlign: "end" }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p role="alert" style={{ color: "var(--bad)", fontSize: 12.5, margin: "8px 0 0" }}>{error}</p>}
      {saved && <p role="status" style={{ color: "var(--good)", fontSize: 12.5, margin: "8px 0 0" }}>Cache TTL updated.</p>}
      <div style={{ marginTop: 10 }}>
        <Button size="sm" disabled={busy || invalid.length > 0} onClick={() => void save()}>
          {busy ? "Saving…" : "Save TTL changes"}
        </Button>
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--mut)" }}>
        Lower = fresher data, higher = faster reads. {TTL_MIN}–{TTL_MAX} seconds. Changes are audited.
      </p>
    </div>
  );
}
