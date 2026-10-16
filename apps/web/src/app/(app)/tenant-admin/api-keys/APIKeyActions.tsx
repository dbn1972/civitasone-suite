"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Button, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

type KeyRow = { id: string; keyName: string; status: string };

// resource:action, e.g. finance:read, api-keys:read (resources may contain a hyphen).
const SCOPE_RE = /^(\*|[a-z][a-z0-9_-]*):(\*|[a-z][a-z0-9_-]*)$/;

// GAP-TENANT-ADMIN-API-KEYS-03 + 04: validate the create body with zod at the
// boundary and target the SAME service the list is read from. The list loader
// reads /api/v1/admin/api-keys (admin-service); writes must go there too, or a
// created key never appears in the list. admin-service's createBody is
// { keyName, scopes[], expiresAt? }.
const createKeySchema = z.object({
  keyName: z.string().min(1).max(120),
  scopes: z.array(z.string().regex(SCOPE_RE)).min(1).max(64),
  expiresAt: z.string().datetime().optional(),
});

// Expiry presets. "" => no expiry (sends no expiresAt). The identity backend
// takes an ISO datetime; we convert the chosen number of days here.
const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "365 days", days: 365 },
  { label: "No expiry", days: null },
];

export function APIKeyActions({ keys }: { keys: KeyRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  // GAP-TENANT-ADMIN-API-KEYS-04: default to empty (force an explicit scope
  // choice) rather than the over-broad "read:*".
  // GAP-TENANT-ADMIN-API-KEYS-04: scopes are chosen from the catalogue the server
  // says this caller may grant (GET /v1/admin/api-keys/scopes), never free text.
  const t = useTranslations("tenantAdminW2.apiKeys");
  const [catalogue, setCatalogue] = useState<string[] | null>(null);
  const [catalogueFailed, setCatalogueFailed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [expiryDays, setExpiryDays] = useState<number | null>(90);
  const [busy, setBusy] = useState(false);
  const [createdKey, setCreatedKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [nameError, setNameError] = useState("");
  const [scopeError, setScopeError] = useState("");
  const formError = useFormError("API key");

  // pending confirm: { kind: "revoke" | "rotate", id, label }
  const [pending, setPending] = useState<{ kind: "revoke" | "rotate"; id: string; label: string } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);

  const nameId = useId();
  const scopesId = useId();
  const expiryId = useId();
  const nameErrId = useId();
  const scopeErrId = useId();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/admin/api-keys/scopes");
        if (!res.ok) throw new Error("scopes");
        const body = (await res.json()) as { data?: unknown };
        const list = Array.isArray(body.data) ? body.data.filter((x): x is string => typeof x === "string") : [];
        if (live) setCatalogue(list);
      } catch {
        if (live) setCatalogueFailed(true);
      }
    })();
    return () => { live = false; };
  }, []);

  function parsedScopes(): string[] {
    return selected;
  }

  function toggleScope(scope: string, on: boolean) {
    setSelected((cur) => (on ? [...new Set([...cur, scope])] : cur.filter((x) => x !== scope)));
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
      setScopeError(t("scopeRequired"));
      ok = false;
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

    const body: z.infer<typeof createKeySchema> = {
      keyName: name.trim(),
      scopes: parsedScopes(),
      ...(expiryDays != null
        ? { expiresAt: new Date(Date.now() + expiryDays * 24 * 3600 * 1000).toISOString() }
        : {}),
    };
    const parsed = createKeySchema.safeParse(body);
    if (!parsed.success) {
      setMessage("Those values were not accepted. Please check the key name and scopes.");
      return;
    }

    setBusy(true);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      const resBody = (await res.json()) as { key?: string };
      setCreatedKey(resBody.key ?? "");
      setOkMessage("API key issued. Copy the secret now — it is shown only once.");
      setName("");
      setSelected([]);
      router.refresh();
    } catch (caught) {
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  async function runPending(reason?: string) {
    if (!pending) return;
    setDialogBusy(true);
    setDialogError(undefined);
    formError.clear();
    try {
      // GAP-TENANT-ADMIN-API-KEYS-03: rotate/revoke go to the same
      // admin-service store the list is read from (both are PATCH; revoke is
      // the /revoke subpath). The reason is kept in the request body for the
      // audit trail.
      const url = `/api/proxy/v1/admin/api-keys/${pending.id}/${pending.kind === "rotate" ? "rotate" : "revoke"}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) {
        setDialogError((await formError.fromResponse(res, "save")).message);
        return;
      }
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
    } catch (caught) {
      setDialogError(formError.fromException("save", caught).message);
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
        <label htmlFor={nameId} className="ta-lbl">Key name</label>
        <input
          id={nameId}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Reporting service"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? nameErrId : undefined}
          className="ta-input"
        />
        {nameError ? <p id={nameErrId} className="ta-field-err" role="alert">{nameError}</p> : null}

        <fieldset
          aria-describedby={scopeError ? scopeErrId : scopesId}
          aria-invalid={scopeError ? true : undefined}
          style={{ border: 0, padding: 0, margin: "0 0 8px" }}
        >
          <legend className="ta-lbl">{t("scopesLabel")}</legend>
          <p id={scopesId} style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 6px" }}>{t("scopesHint")}</p>
          {catalogueFailed ? (
            <p role="alert" className="ta-field-err">{t("scopesLoadFailed")}</p>
          ) : catalogue === null ? (
            <p role="status" style={{ fontSize: 12.5, color: "var(--mut)" }}>{t("scopesLoading")}</p>
          ) : catalogue.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--mut)" }}>{t("scopesNone")}</p>
          ) : (
            catalogue.map((scope) => (
              <label key={scope} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={selected.includes(scope)}
                  onChange={(e) => toggleScope(scope, e.target.checked)}
                />
                <span className="mono">{scope}</span>
              </label>
            ))
          )}
        </fieldset>
        {scopeError ? <p id={scopeErrId} className="ta-field-err" role="alert">{scopeError}</p> : null}

        {/* GAP-TENANT-ADMIN-API-KEYS-04: a required expiry (identity-service
            accepts an optional ISO expiresAt). Defaults to 90 days — a
            least-privilege default rather than a never-expiring key. */}
        <label htmlFor={expiryId} className="ta-lbl">Expiry</label>
        <select
          id={expiryId}
          value={expiryDays == null ? "" : String(expiryDays)}
          onChange={(e) => setExpiryDays(e.target.value === "" ? null : Number(e.target.value))}
          className="ta-input"
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.label} value={o.days == null ? "" : String(o.days)}>{o.label}</option>
          ))}
        </select>

        <Button type="submit" disabled={busy} aria-busy={busy}>
          {busy ? "Issuing…" : "Create API Key"}
        </Button>
      </form>

      {okMessage ? (
        <p role="status" aria-live="polite" className="ta-field-ok" style={{ fontSize: 12.5, padding: "0 16px 8px" }}>{okMessage}</p>
      ) : null}

      {createdKey ? (
        <div className="pad" style={{ paddingTop: 0 }}>
          <code style={{ display: "block", overflowWrap: "anywhere", background: "var(--surface-2)", padding: 10, borderRadius: 8, border: "1px solid var(--line)" }}>{createdKey}</code>
          <Button variant="ghost" size="sm" style={{ marginTop: 8 }} onClick={() => void copyKey()}>
            {copied ? "Copied ✓" : "Copy secret"}
          </Button>
        </div>
      ) : null}

      <div className="pad" style={{ paddingTop: createdKey ? 8 : 0 }}>
        {activeKeys.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--mut)", margin: 0 }}>No active keys to manage.</p>
        ) : (
          activeKeys.map((key) => (
            <div key={key.id} className="prefrow" style={prefRow}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{key.keyName}</span>
              <span style={{ display: "inline-flex", gap: 8 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || dialogBusy}
                  onClick={() => { setMessage(""); setDialogError(undefined); setPending({ kind: "rotate", id: key.id, label: key.keyName }); }}
                >
                  Rotate
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy || dialogBusy}
                  onClick={() => { setMessage(""); setDialogError(undefined); setPending({ kind: "revoke", id: key.id, label: key.keyName }); }}
                >
                  Revoke
                </Button>
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
            ? "The current secret is invalidated immediately — there is no overlap/grace window, so any service still using the old key will stop working the moment you rotate. Update the consuming service with the new secret right after."
            : "This permanently revokes the key. Any service using it will immediately lose access. This cannot be undone."
        }
        confirmLabel={pending?.kind === "rotate" ? "Rotate key" : "Revoke key"}
        // GAP-TENANT-ADMIN-API-KEYS-01: decision — keep immediate invalidation
        // (the safest default for a possibly-leaked key; a grace window would
        // widen the exposure of a compromised secret and the identity rotate
        // endpoint has no grace parameter today), and mark rotate as a danger
        // action too so its destructive, no-overlap nature is explicit.
        danger
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

const prefRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line2)" };
