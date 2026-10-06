"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, HelpTip } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { ORG_TYPES, ORG_TYPE_LABELS, FLAG_HELP, getTerminology, type OrgType } from "@/lib/orgConfig";

// GAP-TENANT-ADMIN-ORG-TYPE-01: a real radiogroup selector. Current type is
// marked, choosing another opens a confirm dialog (changing org type alters
// terminology, pay and leave rules tenant-wide), and confirming PATCHes the
// tenant settings — MERGING orgType into the existing settings object so other
// settings are not wiped. The server validates the enum + audits (ORG-TYPE-05).
export function OrgTypeSelector({
  currentType,
  tenantId,
  settings,
}: {
  currentType: string | null;
  tenantId: string | null;
  settings: Record<string, unknown>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<OrgType | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("organisation type");

  function choose(type: OrgType) {
    if (type === currentType) return;
    setSelected(type);
    setConfirmOpen(true);
  }

  async function confirm() {
    if (!selected || !tenantId) {
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`/api/proxy/v1/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // Merge, never replace: keep every other setting the tenant has.
        body: JSON.stringify({ settings: { ...settings, orgType: selected } }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setConfirmOpen(false);
      setStatus(`Organisation type changed to ${ORG_TYPE_LABELS[selected]}.`);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Organisation type" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {ORG_TYPES.map((type) => {
          const t = getTerminology(type);
          const isCurrent = type === currentType;
          return (
            <div
              key={type}
              role="radio"
              aria-checked={isCurrent}
              aria-disabled={busy || !tenantId ? true : undefined}
              tabIndex={busy || !tenantId ? -1 : 0}
              onClick={() => { if (!busy && tenantId) choose(type); }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !busy && tenantId) {
                  e.preventDefault();
                  choose(type);
                }
              }}
              // GAP-TENANT-ADMIN-ORG-TYPE-03: theme tokens, not hard-coded hex,
              // so cards follow dark mode. Current card gets an accent border.
              // A <div role="radio"> (not <button>) so the per-flag HelpTip
              // buttons are not invalid nested interactive elements.
              style={{
                textAlign: "left", padding: "16px 18px", borderRadius: 12,
                border: isCurrent ? "2px solid var(--accent, #2563eb)" : "1px solid var(--line)",
                background: "var(--surface)", color: "var(--ink)", cursor: busy || !tenantId ? "default" : "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                {ORG_TYPE_LABELS[type]}
                {isCurrent && <span className="pill good" style={{ fontSize: 11 }}>Current</span>}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--mut)", lineHeight: 1.5 }}>
                <div>You are: <strong>{t.orgUnit}</strong></div>
                <div>Branches called: <strong>{t.branch}</strong></div>
                <div>Head: <strong>{t.orgHead}</strong></div>
                <div>Finance authority: <strong>{t.financeHead}</strong></div>
                <div>Salary called: <strong>{t.salary}</strong></div>
                {/* GAP-TENANT-ADMIN-ORG-TYPE-04: every flag shown on/off with a
                    HelpTip explaining what it switches on. */}
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(["govtTerms", "cpcPayMatrix", "ccsLeaveRules"] as const).map((flag) => (
                    <span key={flag} className={`pill ${t[flag] ? "info" : "mut"}`} style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 3 }}>
                      {FLAG_HELP[flag].label}: {t[flag] ? "On" : "Off"}
                      <HelpTip term={FLAG_HELP[flag].label}>{FLAG_HELP[flag].help}</HelpTip>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!tenantId && (
        <p style={{ fontSize: 13, color: "var(--mut)", marginTop: 12 }}>
          Organisation type can&apos;t be changed right now — the tenant could not be loaded.
        </p>
      )}

      <div role="status" aria-live="polite" style={{ fontSize: 13, color: "#067647", marginTop: 10 }}>{status}</div>

      <ConfirmDialog
        open={confirmOpen}
        danger
        title="Change organisation type?"
        description={
          selected
            ? `Switching to ${ORG_TYPE_LABELS[selected]} changes terminology, default pay rules and leave rules for everyone in this organisation. This is recorded in the audit trail.`
            : ""
        }
        confirmLabel="Change type"
        busy={busy}
        errorMessage={error}
        onConfirm={() => void confirm()}
        onCancel={() => { setConfirmOpen(false); setSelected(null); }}
      />
    </div>
  );
}
