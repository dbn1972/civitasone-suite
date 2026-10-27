"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

export interface PendingConsent {
  id: string;
  label: string;
}

type Kind = "grant" | "deny";

/**
 * OWNER DECISION #19 (TENANT-CONSENT-EXCHANGE-01): the consent officer (DPO) may
 * approve or reject a consent request on behalf of the data principal, with a
 * mandatory reason that is recorded in the audit log. The page only renders this
 * panel for a session that holds the consent_officer role; tenant_admin sees the
 * read-only list. tenant-service enforces the role, the reason and the
 * segregation of duties server-side.
 */
export function ConsentDecisionPanel({ pending }: { pending: PendingConsent[] }) {
  const t = useTranslations("tenantW3.consent");
  const router = useRouter();
  const formError = useFormError("consent request");
  const [target, setTarget] = useState<{ row: PendingConsent; kind: Kind } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<string | undefined>(undefined);

  async function decide(reason?: string) {
    if (!target || busy) return;
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/tenant/consent/${target.row.id}/${target.kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDone(target.kind === "grant" ? t("approved") : t("rejected"));
      setTarget(null);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="consent-decisions-h" className="card" style={{ marginBottom: 16, padding: 16 }}>
      <h2 id="consent-decisions-h" style={{ fontSize: 16, margin: 0 }}>{t("pendingTitle")}</h2>
      <p style={{ fontSize: 13, color: "var(--ink2)" }}>{t("pendingHint")}</p>
      {done ? <p role="status" style={{ fontSize: 13 }}>{done}</p> : null}
      {pending.length === 0 ? (
        <p style={{ fontSize: 13 }}>{t("none")}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {pending.map((row) => (
            <li key={row.id} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <span>{row.label}</span>
              <span style={{ display: "flex", gap: 8 }}>
                <Button
                  disabled={busy}
                  aria-label={`${t("approve")}: ${row.label}`}
                  style={{ minHeight: 44, minWidth: 44 }}
                  onClick={() => { setError(undefined); setDone(undefined); setTarget({ row, kind: "grant" }); }}
                >
                  {t("approve")}
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  aria-label={`${t("reject")}: ${row.label}`}
                  style={{ minHeight: 44, minWidth: 44 }}
                  onClick={() => { setError(undefined); setDone(undefined); setTarget({ row, kind: "deny" }); }}
                >
                  {t("reject")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        title={target?.kind === "grant" ? t("approveTitle") : t("rejectTitle")}
        description={target ? <><b>{target.row.label}</b>. {target.kind === "grant" ? t("approveBody") : t("rejectBody")}</> : undefined}
        confirmLabel={target?.kind === "grant" ? t("approve") : t("reject")}
        danger={target?.kind === "deny"}
        requireReason
        minReasonLength={3}
        maxReasonLength={2000}
        reasonLabel={t("reasonLabel")}
        busy={busy}
        {...(error ? { errorMessage: error } : {})}
        onConfirm={(reason) => void decide(reason)}
        onCancel={() => { if (!busy) { setTarget(null); setError(undefined); } }}
      />
    </section>
  );
}
