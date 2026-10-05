"use client";

import type { CRMAccountSummary } from "@civitasone/types";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { browserFetch, errorMessageFromResponse, UserFacingError } from "@/lib/api/browserClient";
import { referenceFromHeaders } from "@/lib/errorCatalogue";
import { Button } from "@/app/_components/ds";
import { validateNewAccount } from "./newAccountSchema";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

type FormState = { name: string; industry: string; website: string; parentId: string };
const EMPTY_FORM: FormState = { name: "", industry: "", website: "", parentId: "" };

/**
 * Outcome of a create attempt. The parent link is a second write (PATCH after
 * the 202 POST), so "created" success and "the account exists but the parent
 * could not be set" are visually distinct states (GAP-CRM-ACCOUNTS-03): the
 * success is green role=status, the parent problems are an amber role=alert
 * with a Retry that re-sends ONLY the PATCH (never a second POST).
 */
type Outcome =
  | { kind: "none" }
  | { kind: "created" }
  | { kind: "parent-failed"; accountId: string; parentId: string }
  | { kind: "parent-skipped" };

/**
 * Creates an account, then optionally attaches it under a parent. The create
 * command is queue-backed (202 Accepted), so the parent is set in a follow-up
 * PATCH once the id is known.
 */
export function NewAccountForm({ accounts }: { accounts: CRMAccountSummary[] }) {
  const router = useRouter();
  const t = useTranslations("crmNewAccountForm");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const [error, setError] = useState("");
  const formError = useFormError("account");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // GAP-CRM-ACCOUNTS-04: one idempotency key per form-open. The create route is
  // queue-backed; sending the same key means an accidental re-submit of the
  // same open form coalesces server-side instead of creating a duplicate. The
  // key is rotated when the form is opened fresh (openForm) or after a
  // confirmed clean success.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  function openForm() {
    idempotencyKey.current = crypto.randomUUID();
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setError("");
    setOutcome({ kind: "none" });
    setOpen(true);
  }

  const trimmedName = form.name.trim().toLowerCase();
  const duplicateName =
    trimmedName.length > 0 && accounts.some((a) => a.name.trim().toLowerCase() === trimmedName);

  /** Re-send ONLY the parent PATCH for an already-created account. */
  async function retryParent(accountId: string, parentId: string) {
    setBusy(true);
    setError("");
    try {
      const link = await browserFetch(`v1/crm/accounts/${accountId}/parent`, {
        method: "PATCH",
        body: JSON.stringify({ parentId }),
      });
      if (!link.ok) throw new UserFacingError(await errorMessageFromResponse(link, "save", t("parentAreaRetry")), referenceFromHeaders(link.headers));
      setOutcome({ kind: "created" });
      router.refresh();
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const validated = validateNewAccount(form, (key) => t(key));
    if (!validated.ok) {
      setFieldErrors(validated.errors);
      return;
    }
    const { name, industry, website, parentId } = validated.value;

    setBusy(true);
    setOutcome({ kind: "none" });
    try {
      const res = await browserFetch("v1/crm/accounts", {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey.current },
        body: JSON.stringify({ name, industry: industry || undefined, website: website || undefined }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res, "save", t("accountArea")));
      const body = (await res.json().catch(() => ({}))) as { id?: string };

      // The account was created. Reset the form and close it on EVERY created
      // path so reopening cannot re-create the same account (GAP-CRM-ACCOUNTS-03).
      setForm(EMPTY_FORM);
      setFieldErrors({});
      setOpen(false);
      idempotencyKey.current = crypto.randomUUID();

      if (parentId) {
        if (!body.id) {
          // 202 with no id: we cannot run the parent step. Say so plainly
          // rather than claiming a plain success (GAP-CRM-ACCOUNTS-03 step 4).
          setOutcome({ kind: "parent-skipped" });
          router.refresh();
          return;
        }
        const link = await browserFetch(`v1/crm/accounts/${body.id}/parent`, {
          method: "PATCH",
          body: JSON.stringify({ parentId }),
        });
        if (!link.ok) {
          setOutcome({ kind: "parent-failed", accountId: body.id, parentId });
          router.refresh();
          return;
        }
      }

      setOutcome({ kind: "created" });
      router.refresh();
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={openForm} style={{ minHeight: 44 }}>
        New Account
      </Button>
      {open ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={submit} className="pad" style={{ maxWidth: 560 }}>
            <h4 style={{ marginTop: 0 }}>New account</h4>
            <label htmlFor="account-name" style={labelStyle}>Account name</label>
            <input
              id="account-name"
              required
              aria-invalid={fieldErrors.name ? true : undefined}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Directorate of Industries"
              style={inputStyle}
            />
            {fieldErrors.name ? (
              <p role="alert" style={{ fontSize: 12, color: "#b42318", marginTop: 4 }}>{fieldErrors.name}</p>
            ) : null}
            {!fieldErrors.name && duplicateName ? (
              <p role="status" style={{ fontSize: 12, color: "#b45309", marginTop: 4 }}>
                {t("duplicateName")}
              </p>
            ) : null}
            <label htmlFor="account-industry" style={{ ...labelStyle, marginTop: 12 }}>Industry</label>
            <input
              id="account-industry"
              aria-invalid={fieldErrors.industry ? true : undefined}
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
              placeholder="Government, Manufacturing…"
              style={inputStyle}
            />
            {fieldErrors.industry ? (
              <p role="alert" style={{ fontSize: 12, color: "#b42318", marginTop: 4 }}>{fieldErrors.industry}</p>
            ) : null}
            <label htmlFor="account-website" style={{ ...labelStyle, marginTop: 12 }}>Website</label>
            <input
              id="account-website"
              aria-invalid={fieldErrors.website ? true : undefined}
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="https://example.gov.in"
              style={inputStyle}
            />
            {fieldErrors.website ? (
              <p role="alert" style={{ fontSize: 12, color: "#b42318", marginTop: 4 }}>{fieldErrors.website}</p>
            ) : null}
            <label htmlFor="account-parent" style={{ ...labelStyle, marginTop: 12 }}>Reports to</label>
            <select
              id="account-parent"
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              style={inputStyle}
            >
              <option value="">Top level (no parent)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <Button type="submit" disabled={busy} loading={busy} style={{ marginTop: 16, minHeight: 44 }}>
              {busy ? "Creating…" : "Create account"}
            </Button>
            <Button type="button" variant="ghost" style={{ marginLeft: 8, marginTop: 16, minHeight: 44 }} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </form>
        </div>
      ) : null}
      {outcome.kind === "created" ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", marginTop: 8 }}>
          {t("created")}
        </p>
      ) : null}
      {outcome.kind === "parent-failed" ? (
        <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b45309", marginTop: 8 }}>
          <p style={{ margin: 0 }}>
            {t("parentFailed")}
          </p>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            loading={busy}
            style={{ marginTop: 8, minHeight: 44 }}
            onClick={() => retryParent(outcome.accountId, outcome.parentId)}
          >
            {t("retryParent")}
          </Button>
        </div>
      ) : null}
      {outcome.kind === "parent-skipped" ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b45309", marginTop: 8 }}>
          {t.rich("parentSkipped", { link: (chunks) => <a href="/crm/accounts">{chunks}</a> })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{error}</p>
      ) : null}
    </>
  );
}
