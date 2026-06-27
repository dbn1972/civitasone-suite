"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, ActionButton, EmptyState } from "../../../_components/ds";

type Row = { id: string; label: string; status?: string };

type FieldError = { field: string; message: string };
type ErrorEnvelope = {
  code?: string;
  message?: string;
  fieldErrors?: FieldError[];
};

const LOCATION_TYPES = [
  { value: "state", label: "State" },
  { value: "district", label: "District" },
  { value: "block", label: "Block" },
  { value: "ward", label: "Ward" },
  { value: "office", label: "Office" },
  { value: "facility", label: "Facility" },
  { value: "branch", label: "Branch" },
] as const;

const inputStyle = {
  width: "100%",
  minHeight: 44,
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
} as const;

const fieldCol = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 4,
  marginBottom: 12,
};

const fieldErrorStyle = {
  fontSize: 12,
  color: "var(--danger, #b91c1c)",
} as const;

/** Parse the standard backend error envelope; fall back to raw text. */
async function parseError(res: Response): Promise<ErrorEnvelope> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as ErrorEnvelope;
    if (body && (body.message || body.code || body.fieldErrors)) return body;
  } catch {
    // not JSON
  }
  return { message: text || "Failed to add branch office. Please try again." };
}

export function LocationActions({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("office");
  const [lgdCode, setLgdCode] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const parentOptions = rows.filter((r) => r.status !== "archived");

  function fieldErr(field: string): string | undefined {
    return fieldErrors[field];
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    setFieldErrors({});
    try {
      const res = await fetch("/api/proxy/v1/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          lgdCode: lgdCode || undefined,
          parentId: parentId || undefined,
        }),
      });
      if (!res.ok) {
        const env = await parseError(res);
        if (env.fieldErrors?.length) {
          setFieldErrors(
            Object.fromEntries(env.fieldErrors.map((f) => [f.field, f.message]))
          );
        }
        setError(env.message ?? "Failed to add branch office. Please try again.");
        return;
      }
      setName("");
      setLgdCode("");
      setParentId("");
      setType("office");
      setSuccess("Branch office added");
      router.refresh();
    } catch {
      setError("Network error — could not reach the locations service. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string, reason?: string) {
    const res = await fetch(`/api/proxy/v1/locations/${id}/archive`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason || undefined }),
    });
    if (!res.ok) throw new Error(await res.text());
    router.refresh();
  }

  const active = rows.filter((r) => r.status !== "archived").slice(0, 8);

  const nameErr = fieldErr("name");
  const typeErr = fieldErr("type");
  const lgdErr = fieldErr("lgdCode");
  const parentErr = fieldErr("parentId");

  return (
    <div className="grid g-2" style={{ marginBottom: 18 }}>
      <Card title="Create Branch Office">
        <form className="pad" onSubmit={create}>
          <div style={fieldCol}>
            <label className="l" htmlFor="loc-name">Branch office name</label>
            <input
              id="loc-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              aria-invalid={nameErr ? true : undefined}
              aria-describedby={nameErr ? "loc-name-err" : undefined}
            />
            {nameErr ? (
              <span id="loc-name-err" role="alert" style={fieldErrorStyle}>{nameErr}</span>
            ) : null}
          </div>

          <div style={fieldCol}>
            <label className="l" htmlFor="loc-type">Location type</label>
            <select
              id="loc-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={inputStyle}
              aria-invalid={typeErr ? true : undefined}
              aria-describedby={typeErr ? "loc-type-err" : undefined}
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            {typeErr ? (
              <span id="loc-type-err" role="alert" style={fieldErrorStyle}>{typeErr}</span>
            ) : null}
          </div>

          <div style={fieldCol}>
            <label className="l" htmlFor="loc-parent">Parent office (optional)</label>
            <select
              id="loc-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              style={inputStyle}
              aria-invalid={parentErr ? true : undefined}
              aria-describedby={parentErr ? "loc-parent-err" : undefined}
            >
              <option value="">— None (top-level office) —</option>
              {parentOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            {parentErr ? (
              <span id="loc-parent-err" role="alert" style={fieldErrorStyle}>{parentErr}</span>
            ) : null}
          </div>

          <div style={fieldCol}>
            <label className="l" htmlFor="loc-lgd">LGD code (optional)</label>
            <input
              id="loc-lgd"
              value={lgdCode}
              inputMode="numeric"
              onChange={(e) => setLgdCode(e.target.value)}
              style={inputStyle}
              aria-invalid={lgdErr ? true : undefined}
              aria-describedby={lgdErr ? "loc-lgd-err" : undefined}
            />
            {lgdErr ? (
              <span id="loc-lgd-err" role="alert" style={fieldErrorStyle}>{lgdErr}</span>
            ) : null}
          </div>

          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            {busy ? "Saving…" : "Add branch office"}
          </button>

          {error ? (
            <p
              role="alert"
              aria-live="assertive"
              style={{ minHeight: 18, marginTop: 8, fontSize: 12, color: "var(--danger, #b91c1c)" }}
            >
              {error}
            </p>
          ) : (
            <p
              role="status"
              aria-live="polite"
              style={{ minHeight: 18, marginTop: 8, fontSize: 12, color: "var(--ok, #15803d)" }}
            >
              {success}
            </p>
          )}
        </form>
      </Card>
      <Card title="Operational Controls">
        <div className="pad">
          {active.length === 0 ? (
            <EmptyState
              icon="🏢"
              title="No active locations"
              message="Locations you create will appear here for operational control."
            />
          ) : (
            active.map((row) => (
              <div key={row.id} className="prefrow">
                <span>{row.label}</span>
                <ActionButton
                  label="Archive"
                  className="btn ghost"
                  danger
                  requireReason
                  reasonLabel="Reason for archiving"
                  confirmTitle="Archive this location?"
                  confirmDescription={`This will archive “${row.label}”. Archived locations are hidden from active operations and cannot be selected for new records.`}
                  confirmLabel="Archive location"
                  onConfirm={(reason) => archive(row.id, reason)}
                  onSuccess={() => router.refresh()}
                />
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
