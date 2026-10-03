"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Select } from "@/app/_components/ds";
import { loadGrantCandidates, requestOperatorChange, type GrantCandidate, type PlatformRole } from "@/lib/admin/operatorActions";

type Candidates = { state: "loading" } | { state: "error" } | { state: "ready"; list: GrantCandidate[] };

/**
 * GAP-ADMIN-OPERATORS-05: "Grant operator role" -- asks for a platform role to be given to someone who is not
 * an operator yet. It only SENDS A REQUEST (reason required); a second super admin approves it in the panel.
 */
export function OperatorGrantButton({ onSent }: { onSent: () => void }) {
  const t = useTranslations("adminOperators");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<Candidates>({ state: "loading" });
  const [userId, setUserId] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<PlatformRole>("platform_admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState(false);

  async function load(q: string) {
    setCands({ state: "loading" });
    const r = await loadGrantCandidates(q);
    setCands(r.ok ? { state: "ready", list: r.candidates } : { state: "error" });
  }
  // Searching asks the server (debounced); the first load, with an empty search, runs when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => void load(search), search === "" ? 0 : 300);
    return () => window.clearTimeout(id);
  }, [open, search]);

  async function confirm(reason: string | undefined) {
    if (!reason || !userId) return;
    setBusy(true);
    setError(undefined);
    const r = await requestOperatorChange(userId, { kind: "grant", reason, toRole: role });
    setBusy(false);
    if (!r.ok) { setError(t(`error.${r.code}`)); return; }
    setOpen(false);
    setUserId("");
    setNotice(true);
    onSent();
    window.setTimeout(() => router.refresh(), 1200);
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <Button size="sm" onClick={() => { setError(undefined); setNotice(false); setSearch(""); setUserId(""); setOpen(true); }}>{t("grantButton")}</Button>
      {notice && <p role="status" style={{ fontSize: 13, margin: "8px 0 0" }}>{t("sent")}</p>}
      <ConfirmDialog
        open={open}
        requireReason
        minReasonLength={3}
        maxReasonLength={500}
        reasonLabel={t("reasonLabel")}
        title={t("grantTitle")}
        description={t("grantImpact")}
        confirmLabel={t("requestConfirm")}
        confirmDisabled={userId === ""}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void confirm(reason)}
        onCancel={() => { if (!busy) setOpen(false); }}
      >
        <label style={{ display: "block", fontSize: 13, margin: "8px 0" }}>
          {t("grantSearch")}
          <input className="input" style={{ display: "block", width: "100%", marginTop: 4 }} type="search" value={search}
            placeholder={t("grantSearchPlaceholder")} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {cands.state === "loading" && <p role="status" aria-busy="true">{t("grantLoading")}</p>}
        {cands.state === "error" && (
          <div role="alert">
            <p style={{ margin: "0 0 8px" }}>{t("grantLoadFailed")}</p>
            <Button size="sm" onClick={() => void load(search)}>{t("retry")}</Button>
          </div>
        )}
        {cands.state === "ready" && cands.list.length === 0 && <p>{search.trim() === "" ? t("grantNoCandidates") : t("grantNoMatches")}</p>}
        {cands.state === "ready" && cands.list.length > 0 && (
          <>
            <label style={{ display: "block", fontSize: 13, margin: "8px 0" }}>
              {t("grantUser")}
              <Select aria-label={t("grantUser")} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">{t("grantUserPlaceholder")}</option>
                {cands.list.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email && c.email !== c.name ? ` (${c.email})` : ""}</option>)}
              </Select>
            </label>
            <label style={{ display: "block", fontSize: 13, margin: "8px 0" }}>
              {t("grantRole")}
              <Select aria-label={t("grantRole")} value={role} onChange={(e) => setRole(e.target.value as PlatformRole)}>
                <option value="platform_admin">{t("role.platform_admin")}</option>
                <option value="super_admin">{t("role.super_admin")}</option>
              </Select>
            </label>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
