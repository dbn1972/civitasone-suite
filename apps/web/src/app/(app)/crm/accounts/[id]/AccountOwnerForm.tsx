"use client";

/**
 * F5-01 — change an account's owner from the account detail page.
 *
 * Picks the new owner by NAME via the shared OwnerPicker (CRM agent directory),
 * never a hand-typed UUID, and PATCHes /v1/crm/accounts/:id. The server applies
 * the change asynchronously (202) and writes an update_account audit event in
 * the same transaction, so the confirmation copy is honest about the async
 * apply ("takes effect shortly") rather than claiming an immediate change.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { Button } from "@/app/_components/ds";
import { OwnerPicker, type Owner } from "@/app/_components/crm/OwnerPicker";

export function AccountOwnerForm({
  accountId,
  currentOwnerId,
  currentOwnerName,
}: {
  accountId: string;
  currentOwnerId: string | null;
  currentOwnerName: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("crmOwner");
  const initial: Owner | null = currentOwnerId
    ? { id: currentOwnerId, name: currentOwnerName ?? t("unknownUser") }
    : null;
  const [owner, setOwner] = useState<Owner | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const dirty = (owner?.id ?? null) !== (currentOwnerId ?? null);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const res = await browserFetch(`v1/crm/accounts/${accountId}`, {
        method: "PATCH",
        body: JSON.stringify({ ownerId: owner?.id ?? null }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res, "save", "the account owner"));
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pad" style={{ maxWidth: 460 }}>
      <label htmlFor="account-owner-change" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>
        {t("label")}
      </label>
      <OwnerPicker
        id="account-owner-change"
        value={owner}
        onChange={(next) => {
          setOwner(next);
          setSaved(false);
        }}
        aria-label={t("ariaLabel")}
        placeholder={t("placeholder")}
      />
      <Button
        onClick={save}
        disabled={busy || !dirty}
        loading={busy}
        style={{ marginTop: 12, minHeight: 44 }}
      >
        {busy ? t("saving") : t("change")}
      </Button>
      {saved ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", marginTop: 8 }}>
          {t("submitted")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
