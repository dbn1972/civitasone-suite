"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { TENANT_API, isEmptyList, newIdempotencyKey, personLabel, pollUntil, type SwitchRequest } from "@/lib/admin/platformIntegrations";
import { formatWhen } from "./badges";

type Decision = "approve" | "reject" | "cancel";
type Active = { request: SwitchRequest; decision: Decision } | null;

async function stillPending(): Promise<SwitchRequest[] | null> {
  try {
    const res = await fetch(`${TENANT_API}/production-switches?status=pending`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { data: SwitchRequest[] }).data;
  } catch {
    return null;
  }
}

/** Pending production-switch requests. Maker != checker is also enforced by the server; the UI just doesn't offer what will be refused. */
export function SwitchApprovals({
  requests,
  providerNames,
  names,
  actorId,
  onChanged,
}: {
  requests: readonly SwitchRequest[];
  providerNames: Record<string, string>;
  names: Record<string, string>;
  actorId: string | null;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("platformIntegrations");
  const locale = useLocale();
  const formError = useFormError("production switch decision");
  const [active, setActive] = useState<Active>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [key, setKey] = useState(() => newIdempotencyKey());

  const open = (request: SwitchRequest, decision: Decision) => { setKey(newIdempotencyKey()); formError.clear(); setNotice(null); setActive({ request, decision }); };
  const providerOf = (r: SwitchRequest) => providerNames[r.providerKey] ?? r.providerKey;
  const who = (id: string) => personLabel(id, actorId, names, t("people.you"), t("people.another"));

  async function decide(note?: string) {
    if (!active) return;
    const { request, decision } = active;
    setBusy(true); formError.clear();
    try {
      const res = await fetch(`${TENANT_API}/production-switches/${request.id}/${decision}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": key },
        body: JSON.stringify(note ? { note } : {}),
      });
      if (!res.ok) { await formError.fromResponse(res, "save"); return; }
      const { settled } = await pollUntil(() => stillPending(), (rows) => !rows.some((r) => r.id === request.id));
      setNotice(!settled ? t("tenant.pending.stillApplying")
        : decision === "approve" ? t("tenant.pending.approved", { provider: providerOf(request) })
        : decision === "reject" ? t("tenant.pending.rejected") : t("tenant.pending.cancelled"));
      setActive(null);
      await onChanged();
    } catch {
      formError.fromException("save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="pi-pending-h" style={{ marginTop: 20 }}>
      <div className="card-h"><h2 id="pi-pending-h" style={{ fontSize: 15, margin: 0 }}>{t("tenant.pending.title")}</h2></div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {notice && <div className="alert" role="status">{notice}</div>}
        {isEmptyList(requests) ? (
          <p className="muted" style={{ margin: 0 }}>{t("tenant.pending.empty")}</p>
        ) : requests.map((r) => {
          const own = r.requestedBy === actorId;
          return (
            <div key={r.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <strong>{providerOf(r)}</strong>
              <span style={{ fontSize: 13 }}>{t("tenant.pending.requestedBy", { name: who(r.requestedBy), date: formatWhen(r.requestedAt, locale) })}</span>
              <span style={{ fontSize: 13 }}>{t("tenant.pending.reason", { reason: r.reason })}</span>
              {own && <span className="muted" style={{ fontSize: 12 }}>{t("tenant.pending.ownRequest")}</span>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {own ? (
                  <Button size="sm" variant="secondary" onClick={() => open(r, "cancel")} disabled={busy}>{t("tenant.pending.cancel")}</Button>
                ) : (
                  <>
                    <Button size="sm" variant="primary" onClick={() => open(r, "approve")} disabled={busy}>{t("tenant.pending.approve")}</Button>
                    <Button size="sm" variant="danger" onClick={() => open(r, "reject")} disabled={busy}>{t("tenant.pending.reject")}</Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={active?.decision === "approve"}
        title={t("tenant.pending.approveTitle")}
        description={active ? t("tenant.pending.approveBody", { provider: providerOf(active.request) }) : ""}
        confirmLabel={t("tenant.pending.approve")}
        cancelLabel={t("common.cancel")}
        optionalReason
        reasonLabel={t("tenant.pending.noteLabel")}
        maxReasonLength={1000}
        busy={busy}
        {...(formError.message ? { errorMessage: formError.message } : {})}
        onConfirm={(note) => { void decide(note); }}
        onCancel={() => setActive(null)}
      />
      <ConfirmDialog
        open={active?.decision === "reject"}
        title={t("tenant.pending.rejectTitle")}
        description={active ? t("tenant.pending.rejectBody", { provider: providerOf(active.request) }) : ""}
        confirmLabel={t("tenant.pending.reject")}
        cancelLabel={t("common.cancel")}
        danger
        requireReason
        reasonLabel={t("tenant.pending.rejectReasonLabel")}
        maxReasonLength={1000}
        busy={busy}
        {...(formError.message ? { errorMessage: formError.message } : {})}
        onConfirm={(note) => { void decide(note); }}
        onCancel={() => setActive(null)}
      />
      <ConfirmDialog
        open={active?.decision === "cancel"}
        title={t("tenant.pending.cancelTitle")}
        description={active ? t("tenant.pending.cancelBody", { provider: providerOf(active.request) }) : ""}
        confirmLabel={t("tenant.pending.cancelConfirm")}
        cancelLabel={t("common.close")}
        busy={busy}
        {...(formError.message ? { errorMessage: formError.message } : {})}
        onConfirm={() => { void decide(); }}
        onCancel={() => setActive(null)}
      />
    </section>
  );
}
