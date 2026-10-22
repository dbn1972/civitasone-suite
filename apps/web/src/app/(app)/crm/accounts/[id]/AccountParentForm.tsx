"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { Button, ConfirmDialog, EntityPicker, Field, type EntityOption } from "@/app/_components/ds";
import { resolveCrmAccounts, searchCrmAccounts } from "@/lib/entityAdapters/crmAccount";

type Props = {
  accountId: string;
  accountName: string;
  currentParentId: string | null;
  /** The current parent's name (when known), so the picker opens labelled instead of resolving it. */
  currentParentName?: string | null;
  /** Number of sub-accounts that move with this account (GAP-CRM-ACCOUNTS-DETAIL-03). */
  subtreeSize?: number;
};

/**
 * Re-parents an account. The service rejects cycles with 422 CYCLE_DETECTED,
 * which is surfaced with a specific, hand-written friendly message -- kept as
 * a special case (the `fieldErrors`-equivalent: a real, backend-driven signal
 * shown as-is because it was written to be human-safe), the same way
 * `useFormError`'s own `fieldErrors` are trusted verbatim. Every other
 * failure routes through `useFormError`, so no raw backend `message` ever
 * reaches the user (UX-023: this component used to fall back to a bare
 * `body.message || "..."`, echoing the backend's raw text for any code other
 * than CYCLE_DETECTED).
 */
export function AccountParentForm({ accountId, accountName, currentParentId, currentParentName, subtreeSize = 0 }: Props) {
  const router = useRouter();
  const t = useTranslations("crmAccountParentForm");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [parentId, setParentId] = useState(currentParentId ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formError = useFormError("parent account");
  // GAP-CRM-ACCOUNTS-DETAIL-01: the parent is chosen through a server-side search
  // (this account and its whole subtree are excluded by the server, so a move that
  // would create a cycle can't be selected) rather than from the capped accounts
  // list. The labels the picker has seen are remembered for the confirm dialog.
  const labels = useRef(new Map<string, string>());
  if (currentParentId && currentParentName) labels.current.set(currentParentId, currentParentName);
  const searchAccounts = useCallback(
    async (query: string, signal: AbortSignal): Promise<EntityOption[]> => {
      const found = await searchCrmAccounts(query, signal, { excludeSubtreeOf: accountId, strict: true });
      for (const o of found) labels.current.set(o.id, o.label);
      return found;
    },
    [accountId],
  );
  const resolveAccounts = useCallback(async (ids: string[]): Promise<EntityOption[]> => {
    const found = await resolveCrmAccounts(ids);
    for (const o of found) labels.current.set(o.id, o.label);
    return found;
  }, []);

  // GAP-CRM-ACCOUNTS-DETAIL-03: re-parenting moves the whole subtree, so a
  // submit opens a confirmation first rather than firing the PATCH directly.
  function requestConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setConfirmOpen(true);
  }

  async function performMove() {
    setBusy(true);
    setMessage("");
    setError("");
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/crm/accounts/${accountId}/parent`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: parentId || null }),
      });
      if (!res.ok) {
        // Peek at `code` from a clone so the CYCLE_DETECTED special case can
        // still be detected -- `formError.fromResponse` below independently
        // re-reads the (unconsumed) original response for everything else.
        const peeked = (await res.clone().json().catch(() => ({}))) as { code?: string };
        if (peeked.code === "CYCLE_DETECTED") {
          setError("That move would make the account its own ancestor. Pick a different parent.");
        } else {
          const resolved = await formError.fromResponse(res, "save");
          setError(resolved.message);
        }
        setConfirmOpen(false);
        return;
      }
      setMessage("Hierarchy updated. The change appears once processing completes.");
      setConfirmOpen(false);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const targetName = parentId ? labels.current.get(parentId) ?? t("anotherAccount") : t("topLevel");
  const subtreeClause = subtreeSize > 0 ? t("subtreeClause", { count: subtreeSize }) : "";

  return (
    <>
      <Button onClick={() => setOpen(true)} style={{ minHeight: 44 }}>
        Change Parent
      </Button>
      {open ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={requestConfirm} className="pad" style={{ maxWidth: 520 }}>
            <h4 style={{ marginTop: 0 }}>Move {accountName}</h4>
            <Field label={t("reportsTo")}>
              <EntityPicker
                value={parentId || null}
                onChange={(next) => setParentId(typeof next === "string" ? next : "")}
                search={searchAccounts}
                resolve={resolveAccounts}
                {...(currentParentId && currentParentName
                  ? { initialOptions: [{ id: currentParentId, label: currentParentName }] }
                  : {})}
                placeholder={t("searchPlaceholder")}
                noResultsText={t("noMatches")}
                searchingText={t("searching")}
                searchErrorText={t("searchError")}
              />
            </Field>
            {/* The picker has no "no parent" entry, so top level is an explicit action. */}
            {parentId ? (
              <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => setParentId("")}>
                {t("makeTopLevel")}
              </Button>
            ) : (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>{t("topLevel")}</p>
            )}
            <Button type="submit" disabled={busy} loading={busy} style={{ marginTop: 16, minHeight: 44 }}>
              {busy ? "Saving…" : "Save hierarchy"}
            </Button>
            <Button type="button" variant="ghost" style={{ marginLeft: 8, marginTop: 16, minHeight: 44 }} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </form>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        description={
          <p style={{ margin: 0 }}>
            {t.rich("confirmDescription", {
              name: accountName,
              subtree: subtreeClause,
              target: targetName,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        }
        confirmLabel={t("confirmLabel")}
        busy={busy}
        onConfirm={() => void performMove()}
        onCancel={() => setConfirmOpen(false)}
      />
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", marginTop: 8 }}>{message}</p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--bad)", marginTop: 8 }}>{error}</p>
      ) : null}
    </>
  );
}
