"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Button, ConfirmDialog, Field, Input, Select } from "../../../_components/ds";
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

  const scopesId = useId();
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
        <Field label="Key name" required error={nameError || undefined}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Reporting service"
          />
        </Field>

        <fieldset
          aria-describedby={scopeError ? scopeErrId : scopesId}
          aria-invalid={scopeError ? true : undefined}
          className="ta-fieldset-bare"
        >
          <legend className="ta-lbl">{t("scopesLabel")}</legend>
          <p id={scopesId} className="ta-hint">{t("scopesHint")}</p>
          {catalogueFailed ? (
            <p role="alert" className="ta-field-err">{t("scopesLoadFailed")}</p>
          ) : catalogue === null ? (
            <p role="status" className="ta-muted-sm">{t("scopesLoading")}</p>
          ) : catalogue.length === 0 ? (
            <p className="ta-muted-sm">{t("scopesNone")}</p>
          ) : (
            catalogue.map((scope) => (
              <label key={scope} className="ta-scope-row">
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
        <Field label="Expiry">
          <Select
            value={expiryDays == null ? "" : String(expiryDays)}
            onChange={(e) => setExpiryDays(e.target.value === "" ? null : Number(e.target.value))}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.label} value={o.days == null ? "" : String(o.days)}>{o.label}</option>
            ))}
          </Select>
        </Field>

        <Button type="submit" disabled={busy} aria-busy={busy}>
          {busy ? "Issuing…" : "Create API Key"}
        </Button>
      </form>

      {okMessage ? (
        <p role="status" aria-live="polite" className="ta-field-ok">{okMessage}</p>
      ) : null}

      {createdKey ? (
        <div className="pad ta-key-section">
          <code className="ta-key-code">{createdKey}</code>
          <Button variant="ghost" size="sm" className="ta-key-copy-btn" onClick={() => void copyKey()}>
            {copied ? "Copied ✓" : "Copy secret"}
          </Button>
        </div>
      ) : null}

      <div className={"pad" + (createdKey ? " ta-key-section--gap" : "") }>
        {activeKeys.length === 0 ? (
          <p className="ta-muted-sm">No active keys to manage.</p>
        ) : (
          activeKeys.map((key) => (
            <div key={key.id} className="prefrow">
              <span className="ta-key-name">{key.keyName}</span>
              <span className="ta-action-row">
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

      {message ? <p role="alert" className="ta-msg-err">{message}</p> : null}

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

// prefRow inline style removed — .prefrow CSS class covers it (GAP-TENANT-ADMIN-API-KEYS-06).
