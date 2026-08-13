"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ConfirmDialog } from "../../../_components/ds";

type KeyRow = { id: string; keyName: string; status: string };

const SCOPE_RE = /^(\*|[a-z][a-z0-9_]*):(\*|[a-z][a-z0-9_]*)$/;

export function APIKeyActions({ keys }: { keys: KeyRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("read:*");
  const [busy, setBusy] = useState(false);
  const [createdKey, setCreatedKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [nameError, setNameError] = useState("");
  const [scopeError, setScopeError] = useState("");

  // pending confirm: { kind: "revoke" | "rotate", id, label }
  const [pending, setPending] = useState<{ kind: "revoke" | "rotate"; id: string; label: string } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);

  const nameId = useId();
  const scopesId = useId();
  const nameErrId = useId();
  const scopeErrId = useId();

  function parsedScopes(): string[] {
    return scopes.split(",").map((s) => s.trim()).filter(Boolean);
  }

  function validate(): boolean {
    let ok = true;
    setNameError("");
    setScopeError("");
    if (name.trim().length === 0) {
      setNameError("Key name is required.");
      ok = false;
    }
    const list = parsedScopes();
    if (list.length === 0) {
      setScopeError("At least one scope is required (e.g. read:*).");
      ok = false;
    } else {
      const bad = list.filter((s) => !SCOPE_RE.test(s));
      if (bad.length > 0) {
        setScopeError(`Invalid scope${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}. Use resource:action (e.g. finance:read).`);
        ok = false;
      }
    }
    return ok;
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setOkMessage("");
    setCreatedKey("");
    setCopied(false);
    if (!validate()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/identity/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes: parsedScopes() }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { key?: string };
      setCreatedKey(body.key ?? "");
      setOkMessage("API key issued. Copy the secret now — it is shown only once.");
      setName("");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setBusy(false);
    }
  }

  async function runPending(reason?: string) {
    if (!pending) return;
    setDialogBusy(true);
    setDialogError(undefined);
    try {
      const url = `/api/proxy/identity/api-keys/${pending.id}${pending.kind === "rotate" ? "/rotate" : ""}`;
      const res = await fetch(url, {
        method: pending.kind === "rotate" ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) throw new Error(await readError(res));
      if (pending.kind === "rotate") {
        const body = (await res.json()) as { key?: string };
        setCreatedKey(body.key ?? "");
        setCopied(false);
        setOkMessage(`Key "${pending.label}" rotated. Copy the new secret now — it is shown only once.`);
      } else {
        setOkMessage(`Key "${pending.label}" revoked.`);
      }
      setPending(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Action failed. Please try again.");
    } finally {
      setDialogBusy(false);
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const activeKeys = keys.filter((k) => k.status === "active");

  return (
    <div className="card">
      <div className="card-h"><h3>Key Operations</h3></div>
      <form className="pad" onSubmit={createKey} noValidate>
        <label htmlFor={nameId} style={lbl}>Key name</label>
        <input
          id={nameId}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Reporting service"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? nameErrId : undefined}
          style={inp}
        />
        {nameError ? <p id={nameErrId} style={fieldErr} role="alert">{nameError}</p> : null}

        <label htmlFor={scopesId} style={lbl}>Scopes <span style={{ fontWeight: 400, color: "#98a2b3" }}>(resource:action, comma separated)</span></label>
        <input
          id={scopesId}
          value={scopes}
          onChange={(e) => setScopes(e.target.value)}
          placeholder="finance:read, audit:*"
          aria-invalid={scopeError ? true : undefined}
          aria-describedby={scopeError ? scopeErrId : undefined}
          style={inp}
        />
        {scopeError ? <p id={scopeErrId} style={fieldErr} role="alert">{scopeError}</p> : null}

        <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
          {busy ? "Issuing…" : "Create API Key"}
        </button>
      </form>

      {okMessage ? (
        <p role="status" aria-live="polite" style={{ color: "#067647", fontSize: 12.5, padding: "0 16px 8px" }}>{okMessage}</p>
      ) : null}

      {createdKey ? (
        <div className="pad" style={{ paddingTop: 0 }}>
          <code style={{ display: "block", overflowWrap: "anywhere", background: "#f8fafc", padding: 10, borderRadius: 8, border: "1px solid var(--line)" }}>{createdKey}</code>
          <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => void copyKey()}>
            {copied ? "Copied ✓" : "Copy secret"}
          </button>
        </div>
      ) : null}

      <div className="pad" style={{ paddingTop: createdKey ? 8 : 0 }}>
        {activeKeys.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "#98a2b3", margin: 0 }}>No active keys to manage.</p>
        ) : (
          activeKeys.map((key) => (
            <div key={key.id} className="prefrow" style={prefRow}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{key.keyName}</span>
              <span style={{ display: "inline-flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy || dialogBusy}
                  onClick={() => { setMessage(""); setDialogError(undefined); setPending({ kind: "rotate", id: key.id, label: key.keyName }); }}
                >
                  Rotate
                </button>
                <button
                  type="button"
                  className="btn danger sm"
                  disabled={busy || dialogBusy}
                  onClick={() => { setMessage(""); setDialogError(undefined); setPending({ kind: "revoke", id: key.id, label: key.keyName }); }}
                >
                  Revoke
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {message ? <p role="alert" style={{ color: "var(--bad)", fontSize: 12, padding: "0 16px 16px" }}>{message}</p> : null}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === "rotate" ? `Rotate key "${pending?.label}"?` : `Revoke key "${pending?.label}"?`}
        description={
          pending?.kind === "rotate"
            ? "The current secret is invalidated immediately and a new secret is issued. Any service using the old key will stop working until updated."
            : "This permanently revokes the key. Any service using it will immediately lose access. This cannot be undone."
        }
        confirmLabel={pending?.kind === "rotate" ? "Rotate key" : "Revoke key"}
        danger={pending?.kind === "revoke"}
        requireReason
        reasonLabel="Reason (recorded in the audit log)"
        busy={dialogBusy}
        errorMessage={dialogError}
        onConfirm={(reason) => void runPending(reason)}
        onCancel={() => { if (!dialogBusy) { setPending(null); setDialogError(undefined); } }}
      />
    </div>
  );
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { message?: string; fieldErrors?: Array<{ field: string; message: string }> };
      if (j.fieldErrors?.length) return j.fieldErrors.map((f) => `${f.field}: ${f.message}`).join("; ");
      if (j.message) return j.message;
    } catch { /* not json */ }
    return text || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", marginBottom: 6 };
const inp: React.CSSProperties = { width: "100%", padding: 9, marginBottom: 12, borderRadius: 8, border: "1px solid var(--line)", fontSize: 13.5, fontFamily: "inherit" };
const fieldErr: React.CSSProperties = { color: "#b42318", fontSize: 12, margin: "-8px 0 12px" };
const prefRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line2)" };
