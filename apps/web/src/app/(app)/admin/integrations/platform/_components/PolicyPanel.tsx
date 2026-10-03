"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { TENANT_API, newIdempotencyKey, personLabel, pollUntil, type PolicySettings } from "@/lib/admin/platformIntegrations";
import { formatWhen } from "./badges";

type Dialog = null | "requestOff" | "turnOn" | "approve" | "reject" | "cancel";

async function readSettings(): Promise<PolicySettings | null> {
  try {
    const res = await fetch(`${TENANT_API}/settings`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { data: PolicySettings }).data;
  } catch {
    return null;
  }
}

/**
 * The production-approval policy. Turning it ON is immediate; turning it OFF files a
 * request that a DIFFERENT administrator must approve (the server enforces it).
 */
export function PolicyPanel({
  settings, names, actorId, canEditPolicy, onChanged,
}: {
  settings: PolicySettings;
  names: Record<string, string>;
  actorId: string | null;
  canEditPolicy: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("platformIntegrations");
  const locale = useLocale();
  const formError = useFormError("approval setting");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [key, setKey] = useState(() => newIdempotencyKey());

  const on = settings.requireProductionApproval;
  const pending = settings.pendingPolicyChange;
  const own = pending != null && pending.requestedBy === actorId;
  const open = (d: Exclude<Dialog, null>) => { setKey(newIdempotencyKey()); formError.clear(); setNotice(null); setDialog(d); };

  async function send(path: string, method: "PUT" | "POST", body: Record<string, unknown>, done: (s: PolicySettings) => boolean, okNotice: string) {
    setBusy(true); formError.clear();
    try {
      const res = await fetch(`${TENANT_API}${path}`, { method, headers: { "content-type": "application/json", "x-idempotency-key": key }, body: JSON.stringify(body) });
      if (!res.ok) { await formError.fromResponse(res, "save"); return; }
      const { settled } = await pollUntil(readSettings, done);
      setNotice(settled ? okNotice : t("tenant.policy.stillApplying"));
      setDialog(null);
      await onChanged();
    } catch (caught) {
      formError.fromException("save", caught);
    } finally {
      setBusy(false);
    }
  }

  const err = formError.message ? { errorMessage: formError.message } : {};

  return (
    <section className="card" aria-labelledby="pi-policy-h" style={{ marginTop: 20 }}>
      <div className="card-h"><h2 id="pi-policy-h" style={{ fontSize: 15, margin: 0 }}>{t("tenant.policy.title")}</h2></div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {notice && <div className="alert" role="status">{notice}</div>}
        <p style={{ margin: 0 }}>{on ? t("tenant.policy.on") : t("tenant.policy.off")}</p>

        {pending && (
          <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <strong>{t("tenant.policy.pendingTitle")}</strong>
            <span style={{ fontSize: 13 }}>{t("tenant.policy.pendingBody", { name: personLabel(pending.requestedBy, actorId, names, t("people.you"), t("people.another")), date: formatWhen(pending.requestedAt, locale) })}</span>
            <span style={{ fontSize: 13 }}>{t("tenant.pending.reason", { reason: pending.reason })}</span>
            {own && <span className="muted" style={{ fontSize: 12 }}>{t("tenant.pending.ownRequest")}</span>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {own ? (
                <Button size="sm" variant="secondary" onClick={() => open("cancel")} disabled={busy}>{t("tenant.pending.cancel")}</Button>
              ) : (
                canEditPolicy && (
                  <>
                    <Button size="sm" variant="primary" onClick={() => open("approve")} disabled={busy}>{t("tenant.pending.approve")}</Button>
                    <Button size="sm" variant="danger" onClick={() => open("reject")} disabled={busy}>{t("tenant.pending.reject")}</Button>
                  </>
                )
              )}
            </div>
          </div>
        )}

        {canEditPolicy ? (
          (on ? !pending : true) && (
            <div>
              <Button size="sm" variant={on ? "secondary" : "primary"} onClick={() => open(on ? "requestOff" : "turnOn")} disabled={busy}>
                {on ? t("tenant.policy.turnOff") : t("tenant.policy.turnOn")}
              </Button>
            </div>
          )
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>{t("tenant.policy.tenantAdminOnly")}</span>
        )}
      </div>

      <ConfirmDialog
        open={dialog === "requestOff"}
        title={t("tenant.policy.confirmOffTitle")}
        description={t("tenant.policy.confirmOffBody")}
        confirmLabel={t("tenant.policy.turnOff")}
        cancelLabel={t("common.cancel")}
        danger requireReason minReasonLength={5} maxReasonLength={1000}
        reasonLabel={t("tenant.policy.reasonLabel")}
        busy={busy} {...err}
        onConfirm={(reason) => { void send("/settings", "PUT", { requireProductionApproval: false, reason: reason ?? "" }, (s) => s.pendingPolicyChange != null, t("tenant.policy.requested")); }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "turnOn"}
        title={t("tenant.policy.confirmOnTitle")}
        description={t("tenant.policy.confirmOnBody")}
        confirmLabel={t("tenant.policy.turnOn")}
        cancelLabel={t("common.cancel")}
        busy={busy} {...err}
        onConfirm={() => { void send("/settings", "PUT", { requireProductionApproval: true, ...(settings.version !== null ? { expectedVersion: settings.version } : {}) }, (s) => s.requireProductionApproval, t("tenant.policy.updated")); }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "approve" && pending != null}
        title={t("tenant.policy.approveTitle")}
        description={t("tenant.policy.approveBody")}
        confirmLabel={t("tenant.pending.approve")}
        cancelLabel={t("common.cancel")}
        optionalReason reasonLabel={t("tenant.pending.noteLabel")} maxReasonLength={1000}
        busy={busy} {...err}
        onConfirm={(note) => { if (pending) void send(`/policy-changes/${pending.id}/approve`, "POST", note ? { note } : {}, (s) => s.pendingPolicyChange == null && !s.requireProductionApproval, t("tenant.policy.approved")); }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "reject" && pending != null}
        title={t("tenant.policy.rejectTitle")}
        description={t("tenant.policy.rejectBody")}
        confirmLabel={t("tenant.pending.reject")}
        cancelLabel={t("common.cancel")}
        danger requireReason reasonLabel={t("tenant.pending.rejectReasonLabel")} maxReasonLength={1000}
        busy={busy} {...err}
        onConfirm={(note) => { if (pending) void send(`/policy-changes/${pending.id}/reject`, "POST", note ? { note } : {}, (s) => s.pendingPolicyChange == null, t("tenant.pending.rejected")); }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "cancel" && pending != null}
        title={t("tenant.pending.cancelTitle")}
        description={t("tenant.policy.cancelBody")}
        confirmLabel={t("tenant.pending.cancelConfirm")}
        cancelLabel={t("common.close")}
        busy={busy} {...err}
        onConfirm={() => { if (pending) void send(`/policy-changes/${pending.id}/cancel`, "POST", {}, (s) => s.pendingPolicyChange == null, t("tenant.pending.cancelled")); }}
        onCancel={() => setDialog(null)}
      />
    </section>
  );
}
