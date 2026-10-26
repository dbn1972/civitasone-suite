"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ConfirmDialog, StatusPill } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatMoney } from "@/lib/formatters";
import { paymentModesForEdition, type PaymentMode } from "@/lib/billing/paymentModes";
import { InvoiceList, type InvoiceRow } from "../subscription/InvoiceList";
import type { PlansData, DowngradeRequestSummary } from "@/app/_data/loaders";

const ALL_MODULES = ["finance", "hrms", "payroll", "procurement", "contract", "asset", "helpdesk", "knowledge", "projects", "inventory", "grant", "citizen", "legal", "crm", "estab"];

type UsageDetail = { resource: string; used: number; limit: number };

export function PlansClient({ plansData, source, downgradeRequests = [] }: { plansData: PlansData; source: "api" | "error"; downgradeRequests?: DowngradeRequestSummary[] }) {
  const tInvoices = useTranslations("tenantAdminW2.billingInvoices");
  const { data, provenance, offline, cachedAt } = useSeededResource("admin.plans", plansData, source, (d) => d.plans.length === 0);
  const t = useTranslations("tenantW3.plans");
  const router = useRouter();
  const formError = useFormError("plan change");
  // OWNER DECISION #24: a downgrade is a REQUEST with a reason that platform billing
  // approves. Nothing changes on this screen until it is approved; while one is
  // open, another cannot be raised.
  const [submitting, setSubmitting] = useState(false);
  const [downgradeError, setDowngradeError] = useState<string | undefined>(undefined);
  const [blocked, setBlocked] = useState<UsageDetail[] | null>(null);
  const [justRequested, setJustRequested] = useState<string | null>(null);
  const openRequest = downgradeRequests.find((r) => r.status === "pending") ?? null;
  const decided = downgradeRequests.find((r) => r.status !== "pending") ?? null;
  // GAP-TENANT-ADMIN-PLANS-03: single source of truth — the current plan is
  // derived from the loader data, never a locally-mutated copy that could
  // drift from the header StatCards after a (previously fake) change.
  const currentPlanId = data.currentPlanId;
  const [changeTarget, setChangeTarget] = useState<string | null>(null);
  const [showInvoices, setShowInvoices] = useState(false);

  // GAP-TENANT-ADMIN-PLANS-05: sort by price so Upgrade/Downgrade is computed
  // from rank, not array order (an unsorted API response used to mislabel it).
  const plans = [...data.plans].sort((a, b) => a.pricePerMonth - b.pricePerMonth);
  const invoices = data.invoices;
  const trialDaysLeft = data.trialDaysLeft;
  const currentPlan = plans.find((p) => p.id === currentPlanId);
  const currentPrice = currentPlan?.pricePerMonth ?? -1;
  const targetPlan = plans.find((p) => p.id === changeTarget);
  const isUpgrade = targetPlan ? targetPlan.pricePerMonth > currentPrice : false;
  const pendingTarget = openRequest ? plans.find((p) => p.id === openRequest.targetPlanId) : undefined;

  async function requestDowngrade(reason?: string) {
    if (!targetPlan || submitting) return;
    setSubmitting(true);
    setDowngradeError(undefined);
    setBlocked(null);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/tenant/subscription/downgrade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetPlanId: targetPlan.id, acknowledgement: true, reason }),
      });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; details?: UsageDetail[] };
        if (body.code === "USAGE_EXCEEDS_TARGET_PLAN" && Array.isArray(body.details)) { setBlocked(body.details); return; }
        if (body.code === "REQUEST_ALREADY_PENDING") { setDowngradeError(t("alreadyPending")); return; }
      }
      if (!res.ok) { setDowngradeError((await formError.fromResponse(res, "save")).message); return; }
      setJustRequested(targetPlan.name);
      setChangeTarget(null);
      router.refresh();
    } catch (caught) {
      setDowngradeError(formError.fromException("save", caught).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (plans.length === 0) {
    return (
      <div className="card" style={{ marginTop: 18 }}>
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        <EmptyState icon="📋" title="No plans available" message="Plans will appear here once configured by the platform admin." />
      </div>
    );
  }

  // Owner decision #26: how this tenant pays, by edition (government: PO/GeM, treasury
  // e-challan, online; everyone else: online). Wording only, no gateway is named.
  const paymentModes = paymentModesForEdition(data.edition);
  const MODE_KEYS: Record<PaymentMode, { label: string; hint: string }> = {
    po_gem: { label: "payPoGem", hint: "payPoGemHint" },
    treasury_challan: { label: "payTreasury", hint: "payTreasuryHint" },
    online: { label: "payOnline", hint: "payOnlineHint" },
  };
  const invoiceRows: InvoiceRow[] = invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber ?? null,
    issuedAt: inv.date,
    status: inv.status,
    totalMinor: String(inv.amount),
    supplierGstin: inv.supplierGstin ?? null,
    recipientGstin: inv.recipientGstin ?? null,
    placeOfSupply: inv.placeOfSupply ?? null,
    cgstMinor: String(inv.cgstMinor ?? 0),
    sgstMinor: String(inv.sgstMinor ?? 0),
    igstMinor: String(inv.igstMinor ?? 0),
  }));

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {trialDaysLeft !== null && (
        <div style={{ background: "var(--warnbg)", border: "1px solid var(--warnbd)", borderRadius: 8, padding: "12px 16px", marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }} role="alert">
          <span><span aria-hidden="true">⚠️ </span><strong>{trialDaysLeft} days left</strong> in your trial. Contact your administrator to choose a plan.</span>
        </div>
      )}

      {openRequest || justRequested ? (
        <div role="status" style={{ background: "var(--infobg)", border: "1px solid var(--infobd)", borderRadius: 8, padding: "12px 16px", marginTop: 18 }}>
          <strong>{t("pendingTitle")}</strong>{" "}
          {t("pendingBody", { plan: pendingTarget?.name ?? justRequested ?? "" })}
        </div>
      ) : decided ? (
        <div role="status" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "12px 16px", marginTop: 18 }}>
          {decided.status === "approved" ? t("lastApproved") : t("lastRejected", { reason: decided.decisionReason === "USAGE_EXCEEDS_TARGET_PLAN" || decided.decisionReason === "PLAN_OR_SUBSCRIPTION_CHANGED" ? t(`rejectReason.${decided.decisionReason}`) : decided.decisionReason ?? "" })}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginTop: 18 }}>
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          const planIsUpgrade = plan.pricePerMonth > currentPrice;
          return (
            <div key={plan.id} className="card" style={{ border: isCurrent ? "2px solid var(--primary)" : "1px solid var(--line)", position: "relative" }}>
              {isCurrent && (
                <span style={{ position: "absolute", top: -10, left: 16, background: "var(--primary)", color: "var(--on-primary)", padding: "2px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Current Plan</span>
              )}
              <h3 style={{ marginTop: isCurrent ? 8 : 0 }}>{plan.name}</h3>
              <p style={{ fontSize: 28, fontWeight: 700, margin: "8px 0" }}>{formatMoney(plan.pricePerMonth)}<small style={{ fontSize: 14, fontWeight: 400, color: "var(--mut)" }}>/month</small></p>
              <ul style={{ listStyle: "none", padding: 0, margin: "12px 0" }}>
                <li style={{ padding: "4px 0" }}>Up to <strong>{plan.maxUsers.toLocaleString("en-IN")}</strong> users</li>
                <li style={{ padding: "4px 0" }}><strong>{plan.storageGb} GB</strong> storage</li>
                <li style={{ padding: "4px 0" }}><strong>{plan.maxApiCalls.toLocaleString("en-IN")}</strong> API calls/month</li>
              </ul>
              <h4 style={{ marginTop: 12, marginBottom: 8 }}>Modules</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {ALL_MODULES.map((mod) => (
                  <div key={mod} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <StatusPill status={plan.modules.includes(mod) ? "active" : "inactive"} label={plan.modules.includes(mod) ? "Included" : "Not included"} />
                    <span>{mod}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16 }}>
                {isCurrent ? (
                  <Button variant="ghost" disabled style={{ width: "100%" }}>Current Plan</Button>
                ) : (
                  <Button
                    variant={planIsUpgrade ? "primary" : "ghost"}
                    style={{ width: "100%" }}
                    disabled={!planIsUpgrade && (openRequest !== null || justRequested !== null)}
                    onClick={() => { setBlocked(null); setDowngradeError(undefined); setChangeTarget(plan.id); }}
                  >
                    {planIsUpgrade ? "Request upgrade" : "Request downgrade"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <section className="card" style={{ marginTop: 18 }} aria-label={tInvoices("payHeading")}>
        <div className="card-h"><h3>{tInvoices("payHeading")}</h3></div>
        <ul style={{ listStyle: "none", padding: "0 16px 12px", margin: 0 }}>
          {paymentModes.map((mode) => (
            <li key={mode} style={{ padding: "6px 0" }}>
              <strong>{tInvoices(MODE_KEYS[mode].label)}</strong>
              <div style={{ fontSize: 13, color: "var(--mut)" }}>{tInvoices(MODE_KEYS[mode].hint)}</div>
            </li>
          ))}
        </ul>
      </section>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Invoice History</h3>
          <Button size="sm" onClick={() => setShowInvoices(!showInvoices)}>{showInvoices ? "Hide" : "Show"}</Button>
        </div>
        {showInvoices && <InvoiceList invoices={invoiceRows} />}
        {/* GAP-TENANT-ADMIN-PLANS-04 / owner decision #26: GST invoice columns (number,
            supplier + recipient GSTIN, place of supply, CGST/SGST/IGST) come from InvoiceList;
            the dead "PDF" button stays gone. */}
      </div>

      {/* GAP-TENANT-ADMIN-PLANS-01/-02/-05: no fake "payment"/"success". Plan
          changes are handled by the platform administrator (self-serve billing
          is super-admin-only in billing-service), so confirming records intent
          and tells the truth — it never shows success without a real 2xx. */}
      {/* OWNER DECISION #24: the downgrade REQUEST dialog. A reason is required; the
          server blocks the request when usage exceeds the target plan's limits and the
          blocking message below names exactly which limits. */}
      <ConfirmDialog
        open={changeTarget !== null && targetPlan !== undefined && currentPlan !== undefined && !isUpgrade}
        title={t("dialogTitle", { plan: targetPlan?.name ?? "" })}
        danger
        requireReason
        minReasonLength={10}
        maxReasonLength={1000}
        reasonLabel={t("reasonLabel")}
        confirmLabel={t("submit")}
        busy={submitting}
        blockConfirm={blocked !== null}
        {...(downgradeError ? { errorMessage: downgradeError } : {})}
        description={
          targetPlan && currentPlan ? (
            <div>
              <p style={{ margin: "0 0 10px" }}>{t("dialogIntro", { from: currentPlan.name, to: targetPlan.name })}</p>
              <ul style={{ paddingInlineStart: 20, margin: "0 0 10px" }}>
                <li>Users: {currentPlan.maxUsers.toLocaleString("en-IN")} → {targetPlan.maxUsers.toLocaleString("en-IN")}</li>
                <li>Storage: {currentPlan.storageGb} GB → {targetPlan.storageGb} GB</li>
                <li>Price: {formatMoney(currentPlan.pricePerMonth)} → {formatMoney(targetPlan.pricePerMonth)}/month</li>
              </ul>
              {currentPlan.modules.filter((m) => !targetPlan.modules.includes(m)).length > 0 && (
                <div style={{ background: "var(--warnbg)", border: "1px solid var(--warnbd)", borderRadius: 6, padding: 10, margin: "0 0 10px" }}>
                  <strong>These modules will be disabled:</strong>
                  <ul style={{ paddingInlineStart: 20, margin: "4px 0 0" }}>
                    {currentPlan.modules.filter((m) => !targetPlan.modules.includes(m)).map((m) => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}
              {blocked ? (
                <div role="alert" style={{ background: "var(--badbg)", border: "1px solid var(--badbd)", borderRadius: 6, padding: 10, margin: "0 0 10px" }}>
                  <strong>{t("blockedTitle")}</strong>
                  <ul style={{ paddingInlineStart: 20, margin: "4px 0 0" }}>
                    {blocked.map((b) => <li key={b.resource}>{t("blockedLine", { resource: t(`resource.${b.resource}`), used: b.used, limit: b.limit })}</li>)}
                  </ul>
                </div>
              ) : null}
              <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("approvalNote")}</p>
            </div>
          ) : null
        }
        onConfirm={(reason) => void requestDowngrade(reason)}
        onCancel={() => { if (!submitting) { setChangeTarget(null); setBlocked(null); setDowngradeError(undefined); } }}
      />

      <ConfirmDialog
        open={changeTarget !== null && targetPlan !== undefined && currentPlan !== undefined && isUpgrade}
        title={isUpgrade ? `Request upgrade to ${targetPlan?.name ?? ""}` : `Request downgrade to ${targetPlan?.name ?? ""}`}
        danger={!isUpgrade}
        description={
          targetPlan && currentPlan ? (
            <div>
              <p style={{ margin: "0 0 10px" }}>
                {isUpgrade ? "You are requesting an upgrade." : "You are requesting a downgrade."} Changes to {currentPlan.name} → {targetPlan.name}:
              </p>
              <ul style={{ paddingLeft: 20, margin: "0 0 10px" }}>
                <li>Users: {currentPlan.maxUsers.toLocaleString("en-IN")} → {targetPlan.maxUsers.toLocaleString("en-IN")}</li>
                <li>Storage: {currentPlan.storageGb} GB → {targetPlan.storageGb} GB</li>
                <li>Price: {formatMoney(currentPlan.pricePerMonth)} → {formatMoney(targetPlan.pricePerMonth)}/month</li>
              </ul>
              {!isUpgrade && currentPlan.modules.filter((m) => !targetPlan.modules.includes(m)).length > 0 && (
                <div style={{ background: "var(--warnbg)", border: "1px solid var(--warnbd)", borderRadius: 6, padding: 10, margin: "0 0 10px" }}>
                  <strong>These modules will be disabled:</strong>
                  <ul style={{ paddingLeft: 20, margin: "4px 0 0" }}>
                    {currentPlan.modules.filter((m) => !targetPlan.modules.includes(m)).map((m) => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}
              <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
                Plan changes are applied by your platform administrator. Nothing is recorded or changed here — contact your platform administrator to request this plan change. You will not be charged here.
              </p>
            </div>
          ) : null
        }
        confirmLabel="Contact administrator"
        onConfirm={() => setChangeTarget(null)}
        onCancel={() => setChangeTarget(null)}
      />
    </>
  );
}
