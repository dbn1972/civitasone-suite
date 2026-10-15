"use client";

/**
 * GAP-PROCUREMENT-VENDORS-DETAIL-02 - role-gated compliance actions on a vendor
 * profile: empanel, suspend and blacklist. The profile used to be a dead end for
 * a compliance record.
 *
 * The controls are shown only to procurement writers (`canManage`, resolved on
 * the server from the session roles), but the procurement-service routes are the
 * real control: they 403 every other role, blacklist and suspend require a
 * reason (min 5), and every change is audited. Each command is queued (202), so
 * the profile is refreshed and an honest "request accepted" note is shown rather
 * than claiming the status already changed.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton, ConfirmDialog } from "@/app/_components/ds";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";

const CATEGORIES = ["goods", "services", "works"] as const;

export function VendorActions({
  vendorId,
  empanelmentStatus,
  lapsed,
  canManage,
}: {
  vendorId: string;
  empanelmentStatus: "empanelled" | "provisional" | "blacklisted" | "not_empanelled";
  /** Every empanelment on file is past its date or no longer active. */
  lapsed?: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("procurement.w2.vendorActions");
  const router = useRouter();
  const [note, setNote] = useState("");
  const [empanelOpen, setEmpanelOpen] = useState(false);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("goods");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (!canManage) return null;
  if (empanelmentStatus === "blacklisted") {
    // A blacklisted vendor is reinstated through the dedicated blacklist register.
    return <p className="muted" style={{ fontSize: 12 }}>{t("blacklistedNote")}</p>;
  }

  const base = `/api/proxy/v1/procurement/vendors/${vendorId}`;
  const accepted = () => { setNote(t("accepted")); router.refresh(); };

  async function send(action: "suspend" | "blacklist", reason?: string): Promise<void> {
    const res = await fetch(`${base}/${action}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: (reason ?? "").trim() }),
    });
    if (res.status === 409) {
      const body = await res.clone().json().catch(() => null) as { code?: string } | null;
      if (body?.code === "VENDOR_NOT_EMPANELLED") throw new Error(t("notEmpanelled"));
    }
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save", "vendor");
  }

  async function empanel(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`${base}/empanel`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, ...(validUntil ? { validUntil } : {}) }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save", "vendor");
      setEmpanelOpen(false);
      accepted();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  const isEmpanelled = empanelmentStatus === "empanelled";

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="vendor-actions">
      {/* Empanel: a registered vendor, or an empanelled one whose empanelment lapsed / was suspended. */}
      {(!isEmpanelled || lapsed) && (
        <button type="button" className="btn primary" onClick={() => { setError(undefined); setEmpanelOpen(true); }}>
          {isEmpanelled ? t("reEmpanel") : t("empanel")}
        </button>
      )}
      {isEmpanelled && !lapsed && (
        <ActionButton
          className="btn ghost"
          label={t("suspend")}
          confirmTitle={t("suspendTitle")}
          confirmDescription={t("suspendBody")}
          confirmLabel={t("suspend")}
          requireReason
          minReasonLength={5}
          maxReasonLength={500}
          reasonLabel={t("reason")}
          onConfirm={(reason) => send("suspend", reason)}
          onSuccess={accepted}
        />
      )}
      <ActionButton
        danger
        label={t("blacklist")}
        confirmTitle={t("blacklistTitle")}
        confirmDescription={t("blacklistBody")}
        confirmLabel={t("blacklist")}
        requireReason
        minReasonLength={5}
        maxReasonLength={500}
        reasonLabel={t("reason")}
        onConfirm={(reason) => send("blacklist", reason)}
        onSuccess={accepted}
      />
      <ConfirmDialog
        open={empanelOpen}
        title={t("empanelTitle")}
        description={t("empanelBody")}
        confirmLabel={t("empanel")}
        busy={busy}
        errorMessage={error}
        onConfirm={() => void empanel()}
        onCancel={() => { if (!busy) setEmpanelOpen(false); }}
      >
        <label className="field" style={{ display: "block", marginBottom: 8 }}>
          <span className="label">{t("category")}</span>
          <select className="inp" value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
          </select>
        </label>
        <label className="field" style={{ display: "block" }}>
          <span className="label">{t("validUntil")}</span>
          <input className="inp" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </label>
      </ConfirmDialog>
      {note ? <span role="status" style={{ fontSize: 12 }}>{note}</span> : null}
    </div>
  );
}
