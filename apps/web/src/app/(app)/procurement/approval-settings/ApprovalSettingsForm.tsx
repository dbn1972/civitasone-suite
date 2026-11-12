"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Select } from "@/app/_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { minorToRupeesInput, rupeesToMinorString } from "@/lib/money";

export type MatrixRow = { upToMinor: string | null; approverRoles: string[] };
export type ApprovalSettings = {
  mode: "finance_sanction" | "local";
  source: "override" | "derived";
  override: "finance_sanction" | "local" | null;
  matrix: MatrixRow[];
  isDefaultMatrix: boolean;
  /** A super admin's request to force local approval, awaiting a second super admin. */
  pendingOverride?: { mode: "local"; requestedBy: string; requestedAt: string } | null;
};

const ROLES = ["procurement_officer", "procurement_admin", "super_admin"] as const;
type Draft = { limit: string; roles: string[] };

const toDraft = (m: MatrixRow[]): Draft[] => m.map((b) => ({ limit: b.upToMinor === null ? "" : minorToRupeesInput(b.upToMinor), roles: [...b.approverRoles] }));

/** Draft bands to the wire form, or a message key when a limit is not a rupee amount. */
export function draftToMatrix(rows: Draft[]): { matrix: MatrixRow[] } | { errorKey: "limitInvalid" | "lastLimit" | "rolesRequired" } {
  const out: MatrixRow[] = [];
  for (const [i, r] of rows.entries()) {
    const last = i === rows.length - 1;
    if (r.roles.length === 0) return { errorKey: "rolesRequired" };
    if (last) { out.push({ upToMinor: null, approverRoles: r.roles }); continue; }
    const minor = rupeesToMinorString(r.limit);
    if (!minor) return { errorKey: "limitInvalid" };
    out.push({ upToMinor: minor, approverRoles: r.roles });
  }
  return { matrix: out };
}

export function ApprovalSettingsForm({ initial, canEdit }: { initial: ApprovalSettings; canEdit: boolean }) {
  const t = useTranslations("poApprovalSettings");
  const router = useRouter();
  const [override, setOverride] = useState<string>(initial.override ?? "");
  const [rows, setRows] = useState<Draft[]>(toDraft(initial.matrix));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const overrideId = useId();
  const roleLabel: Record<string, string> = { procurement_officer: t("roleOfficer"), procurement_admin: t("roleAdmin"), super_admin: t("roleSuper") };

  function setRow(i: number, patch: Partial<Draft>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function toggleRole(i: number, role: string) {
    const cur = rows[i]!.roles;
    setRow(i, { roles: cur.includes(role) ? cur.filter((x) => x !== role) : [...cur, role] });
  }
  function addBand() {
    // A new band goes before the last (unbounded) one.
    setRows((rs) => [...rs.slice(0, -1), { limit: "", roles: ["procurement_admin"] }, rs[rs.length - 1]!]);
  }
  function removeBand(i: number) {
    setRows((rs) => rs.filter((_, j) => j !== i));
  }

  async function save() {
    setMsg(null);
    const parsed = draftToMatrix(rows);
    if ("errorKey" in parsed) { setMsg({ ok: false, text: t(parsed.errorKey) }); return; }
    setBusy(true);
    try {
      const res = await browserFetch("v1/procurement/po-approval-settings", {
        method: "PUT",
        body: JSON.stringify({ matrix: parsed.matrix, modeOverride: override === "" ? null : override }),
      });
      if (!res.ok) {
        let text = t("saveError");
        try { text = ((await res.json()) as { message?: string }).message ?? text; } catch { /* generic */ }
        setMsg({ ok: false, text });
        return;
      }
      setMsg({ ok: true, text: t("savedMessage") });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: t("saveError") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section style={{ display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{t("modeHeading")}</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
          {initial.mode === "local"
            ? (initial.source === "override" ? t("modeLocalOverride") : t("modeLocalDerived"))
            : (initial.source === "override" ? t("modeSanctionOverride") : t("modeSanctionDerived"))}
        </p>
        {initial.pendingOverride && <p role="note" className="pill warn" style={{ margin: 0, width: "fit-content" }}>{t("pendingNote")}</p>}
        <Field id={overrideId} label={t("overrideLabel")} style={{ display: "grid", gap: 6, maxWidth: 360 }} disabled={!canEdit}>
          <Select value={override} onChange={(e) => setOverride(e.target.value)} disabled={!canEdit}>
            <option value="">{t("overrideDerived")}</option>
            <option value="finance_sanction">{t("overrideSanction")}</option>
            <option value="local">{t("overrideLocal")}</option>
          </Select>
        </Field>
      </section>

      <section style={{ display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{t("bandsHeading")}</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>{t("bandsHelp")}</p>
        {initial.isDefaultMatrix && <p role="note" style={{ margin: 0, fontSize: 13 }}>{t("defaultNote")}</p>}
        {rows.map((r, i) => {
          const last = i === rows.length - 1;
          return (
            <fieldset key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, display: "grid", gap: 10 }}>
              <legend style={{ fontWeight: 600, fontSize: 14 }}>{t("bandN", { n: i + 1 })}</legend>
              {last ? (
                <p style={{ margin: 0, fontSize: 13 }}>{t("noLimit")}</p>
              ) : (
                <Field id={`band-${i}-limit`} label={t("upToLabel")} style={{ display: "grid", gap: 6, maxWidth: 240 }} disabled={!canEdit}>
                  <Input inputMode="decimal" value={r.limit} onChange={(e) => setRow(i, { limit: e.target.value })} disabled={!canEdit} />
                </Field>
              )}
              <div role="group" aria-label={t("rolesLabel")} style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {ROLES.map((role) => (
                  <label key={role} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                    <input type="checkbox" checked={r.roles.includes(role)} onChange={() => toggleRole(i, role)} disabled={!canEdit} />
                    {roleLabel[role]}
                  </label>
                ))}
              </div>
              {canEdit && !last && rows.length > 1 && (
                <div><Button type="button" variant="secondary" onClick={() => removeBand(i)}>{t("removeBand")}</Button></div>
              )}
            </fieldset>
          );
        })}
        {canEdit && rows.length < 10 && <div><Button type="button" variant="secondary" onClick={addBand}>{t("addBand")}</Button></div>}
      </section>

      {canEdit ? (
        <div>
          <Button type="button" style={{ minHeight: 44 }} disabled={busy} onClick={() => void save()}>{t("saveBtn")}</Button>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13 }}>{t("adminOnly")}</p>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`pill ${msg.ok ? "good" : "bad"}`} style={{ margin: 0, width: "fit-content" }}>{msg.text}</p>}
    </div>
  );
}
