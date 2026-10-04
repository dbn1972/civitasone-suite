"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, ConfirmDialog, Drawer } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import {
  TENANT_API,
  buildSaveBody,
  canRequestProduction,
  editTouchesSensitive,
  initialValues,
  missingForEnv,
  newIdempotencyKey,
  pollUntil,
  type FormValues,
  type SwitchRequest,
  type TenantCatalogueProvider,
  type TenantRecord,
} from "@/lib/admin/platformIntegrations";
import { EnvBadge, HealthCard, ProviderStatusPill, formatWhen } from "./badges";
import { SchemaForm } from "./SchemaForm";

type Dialog = null | "request" | "revert" | "remove" | "sensitive";
type TestOutcome = { kind: "ok" | "fail" | "notYet" | "error"; message?: string; mock?: boolean };

const JSON_HEADERS = { "content-type": "application/json" };

async function readRecord(providerKey: string): Promise<TenantRecord | null> {
  try {
    const res = await fetch(`${TENANT_API}/records/${providerKey}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { data: TenantRecord }).data;
  } catch {
    return null;
  }
}

/**
 * Configure one provider: the schema-driven form, test connection + health,
 * and the production switch. Every write is a 202 that a consumer applies, so
 * each action polls the read until the change is visible before claiming success.
 */
export function IntegrationConfigDrawer({
  provider,
  record,
  approvalRequired,
  onClose,
  onChanged,
}: {
  provider: TenantCatalogueProvider;
  record: TenantRecord | undefined;
  approvalRequired: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("platformIntegrations");
  const locale = useLocale();
  const formError = useFormError("integration settings");

  const fields = provider.fields;
  const [values, setValues] = useState<FormValues>(() => initialValues(fields, record?.config));
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [clearing, setClearing] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<boolean>(record?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogKey, setDialogKey] = useState<string>(() => newIdempotencyKey());
  const [test, setTest] = useState<TestOutcome | null>(null);
  const [testing, setTesting] = useState(false);

  const storedKeys = useMemo(() => (record?.secrets ?? []).filter((s) => s.set).map((s) => s.key), [record]);
  const prodMissing = useMemo(
    () => missingForEnv(fields, "production", values, storedKeys, secretInputs, clearing),
    [fields, values, storedKeys, secretInputs, clearing],
  );
  const labelOf = (k: string) => fields.find((f) => f.key === k)?.label ?? k;

  const dirty = useMemo(() => {
    const base = initialValues(fields, record?.config);
    return JSON.stringify(base) !== JSON.stringify(values)
      || Object.values(secretInputs).some((v) => v !== "")
      || clearing.length > 0
      || enabled !== (record?.enabled ?? true);
  }, [fields, record, values, secretInputs, clearing, enabled]);

  // A sensitive edit (secret, endpoint, account...) of a LIVE production record sends it back to sandbox.
  const revertsOnSave = record?.environment === "production" && dirty && editTouchesSensitive(fields, record.config, values, secretInputs, clearing);

  const openDialog = (d: Exclude<Dialog, null>) => { setDialogKey(newIdempotencyKey()); formError.clear(); setDialog(d); };

  const save = useCallback(async () => {
    setBusy(true); setNotice(null); formError.clear();
    try {
      const body = buildSaveBody({ fields, values, secretInputs, clearSecrets: clearing, enabled, expectedVersion: record?.version });
      const res = await fetch(`${TENANT_API}/records/${provider.key}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, "x-idempotency-key": newIdempotencyKey() },
        body: JSON.stringify(body),
      });
      if (!res.ok) { await formError.fromResponse(res, "save"); return; }
      const before = record?.version ?? 0;
      const { value, settled } = await pollUntil(() => readRecord(provider.key), (r) => r.version > before);
      if (value && settled) { setValues(initialValues(fields, value.config)); setEnabled(value.enabled); }
      setSecretInputs({}); setClearing([]);
      setNotice(settled ? t("tenant.drawer.saved") : t("tenant.drawer.stillApplying"));
      await onChanged();
    } catch {
      formError.fromException("save");
    } finally {
      setBusy(false);
    }
  }, [fields, values, secretInputs, clearing, enabled, record, provider.key, formError, onChanged, t]);

  async function runTest() {
    setTesting(true); setTest(null);
    try {
      const res = await fetch(`${TENANT_API}/records/${provider.key}/test`, { method: "POST", headers: { ...JSON_HEADERS, "x-idempotency-key": newIdempotencyKey() }, body: "{}" });
      if (res.status === 501) { setTest({ kind: "notYet" }); return; }
      if (!res.ok) { setTest({ kind: "error" }); return; }
      const out = ((await res.json()) as { data: { ok: boolean; message: string; mock: boolean } }).data;
      setTest({ kind: out.ok ? "ok" : "fail", message: out.message, mock: out.mock });
      // The health card is persisted by the consumer; re-read it.
      await pollUntil(() => readRecord(provider.key), (r) => r.health.status !== "untested", { tries: 5, delayMs: 400 });
      await onChanged();
    } catch {
      setTest({ kind: "error" });
    } finally {
      setTesting(false);
    }
  }

  async function post(path: string, body: Record<string, unknown>): Promise<Response | null> {
    try {
      return await fetch(`${TENANT_API}${path}`, { method: "POST", headers: { ...JSON_HEADERS, "x-idempotency-key": dialogKey }, body: JSON.stringify(body) });
    } catch {
      formError.fromException("save");
      return null;
    }
  }

  async function requestSwitch(reason?: string) {
    if (!record) return;
    setBusy(true); formError.clear();
    const res = await post(`/records/${provider.key}/production-switch`, { reason: reason ?? "" });
    if (res && !res.ok) await formError.fromResponse(res, "save");
    if (res?.ok) {
      const direct = ((await res.json()) as { mode?: string }).mode === "direct";
      await pollUntil(() => readRecord(provider.key), (r) => (direct ? r.environment === "production" : r.pendingSwitch != null));
      setNotice(direct ? t("tenant.drawer.switched") : t("tenant.drawer.requested"));
      setDialog(null);
      await onChanged();
    }
    setBusy(false);
  }

  async function revert(reason?: string) {
    if (!record) return;
    setBusy(true); formError.clear();
    const res = await post(`/records/${provider.key}/revert-sandbox`, { reason: reason ?? "", expectedVersion: record.version });
    if (res && !res.ok) await formError.fromResponse(res, "save");
    if (res?.ok) {
      await pollUntil(() => readRecord(provider.key), (r) => r.environment === "sandbox");
      setNotice(t("tenant.drawer.reverted"));
      setDialog(null);
      await onChanged();
    }
    setBusy(false);
  }

  async function remove() {
    if (!record) return;
    setBusy(true); formError.clear();
    try {
      const res = await fetch(`${TENANT_API}/records/${provider.key}?expectedVersion=${record.version}`, { method: "DELETE", headers: { "x-idempotency-key": dialogKey } });
      if (!res.ok) { await formError.fromResponse(res, "save"); return; }
      await pollUntil(() => readRecord(provider.key), () => false, { tries: 3, delayMs: 300 });
      setDialog(null);
      await onChanged();
      onClose();
    } catch {
      formError.fromException("save");
    } finally {
      setBusy(false);
    }
  }

  const pending: SwitchRequest | null | undefined = record?.pendingSwitch;
  const canRequest = record ? canRequestProduction(record) && prodMissing.length === 0 && !dirty : false;

  return (
    <>
      <Drawer
        title={<span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{t("tenant.drawer.title", { name: provider.name })} {record && <EnvBadge env={record.environment} />}</span>}
        onClose={onClose}
        busy={busy}
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.close")}</Button>
            <Button variant="primary" onClick={() => { if (revertsOnSave) openDialog("sensitive"); else void save(); }} loading={busy} disabled={busy || (record != null && !dirty) || provider.status === "disabled"}>
              {busy ? t("common.saving") : record ? t("tenant.drawer.saveUpdate") : t("tenant.drawer.saveCreate")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <ProviderStatusPill status={provider.status} />
          <span className="muted" style={{ fontSize: 13 }}>{provider.description}</span>
        </div>

        {revertsOnSave && <div className="alert warn" role="alert"><p>{t("tenant.drawer.sensitiveWarning")}</p></div>}
        {notice && <div className="alert" role="status">{notice}</div>}
        {formError.message && (
          <div className="alert bad" role="alert">
            <p>{formError.message}</p>
          </div>
        )}
        {Object.keys(formError.fieldErrors).length > 0 && <div className="alert warn" role="alert"><p>{t("tenant.drawer.formErrors")}</p></div>}

        <section aria-labelledby="pi-config-h">
          <h3 id="pi-config-h" style={{ fontSize: 14, margin: "0 0 10px" }}>{t("tenant.drawer.configuration")}</h3>
          <SchemaForm
            fields={fields}
            values={values}
            onValue={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
            secretInputs={secretInputs}
            onSecretInput={(k, v) => setSecretInputs((prev) => ({ ...prev, [k]: v }))}
            storedSecrets={record?.secrets ?? []}
            clearing={clearing}
            onToggleClear={(k) => setClearing((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))}
            fieldErrors={formError.fieldErrors}
            disabled={busy || provider.status === "disabled"}
          />
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
            <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => setEnabled(e.target.checked)} />
            <span>{t("tenant.drawer.enabledLabel")}</span>
          </label>
        </section>

        {record ? (
          <>
            <section aria-labelledby="pi-conn-h" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              <h3 id="pi-conn-h" style={{ fontSize: 14, margin: "0 0 8px" }}>{t("tenant.drawer.connection")}</h3>
              <HealthCard health={record.health} />
              <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Button size="sm" variant="secondary" onClick={() => { void runTest(); }} loading={testing} disabled={testing || busy || dirty || provider.status === "disabled"}>
                  {testing ? t("tenant.list.testing") : t("tenant.list.testConnection")}
                </Button>
                {dirty && <span className="muted" style={{ fontSize: 12 }}>{t("tenant.drawer.testHint")}</span>}
              </div>
              <div role="status" aria-live="polite" style={{ marginTop: 8, fontSize: 13 }}>
                {test?.kind === "notYet" && <span>{t("tenant.drawer.notYetAvailable")}</span>}
                {test?.kind === "ok" && <span>{t("tenant.drawer.testOk", { message: test.message ?? "" })}</span>}
                {test?.kind === "fail" && <span>{t("tenant.drawer.testFail", { message: test.message ?? "" })}</span>}
                {test?.kind === "error" && <span>{t("tenant.drawer.testError")}</span>}
              </div>
            </section>

            <section aria-labelledby="pi-prod-h" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              <h3 id="pi-prod-h" style={{ fontSize: 14, margin: "0 0 8px" }}>{t("tenant.drawer.productionSection")}</h3>
              {record.environment === "production" ? (
                <>
                  <p style={{ margin: "0 0 10px" }}>{t("tenant.drawer.prodIs")}</p>
                  <Button size="sm" variant="secondary" onClick={() => openDialog("revert")} disabled={busy}>{t("tenant.drawer.revert")}</Button>
                </>
              ) : (
                <>
                  <p style={{ margin: "0 0 8px" }}>{t("tenant.drawer.sandboxIs")}</p>
                  {provider.status === "beta" && <p className="muted" style={{ margin: "0 0 8px" }}>{t("tenant.drawer.betaBlock")}</p>}
                  {provider.status === "disabled" && <p className="muted" style={{ margin: "0 0 8px" }}>{t("tenant.drawer.disabledBlock")}</p>}
                  {provider.status === "available" && (
                    prodMissing.length > 0
                      ? <p style={{ margin: "0 0 8px" }}>{t("tenant.drawer.missing", { fields: prodMissing.map(labelOf).join(", ") })}</p>
                      : <p className="muted" style={{ margin: "0 0 8px" }}>{t("tenant.drawer.ready")}</p>
                  )}
                  {pending ? (
                    <p style={{ margin: 0 }}>{t("tenant.drawer.pendingFor", { date: formatWhen(pending.requestedAt, locale) })}</p>
                  ) : (
                    <>
                      <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>{approvalRequired ? t("tenant.drawer.needsApprover") : t("tenant.drawer.appliesDirect")}</p>
                      <Button size="sm" variant="primary" onClick={() => openDialog("request")} disabled={busy || !canRequest}>
                        {approvalRequired ? t("tenant.drawer.requestSwitch") : t("tenant.drawer.directSwitch")}
                      </Button>
                    </>
                  )}
                </>
              )}
            </section>

            <section style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              <Button size="sm" variant="danger" onClick={() => openDialog("remove")} disabled={busy}>{t("tenant.drawer.remove")}</Button>
            </section>
          </>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={dialog === "sensitive"}
        title={t("tenant.drawer.sensitiveTitle")}
        description={t("tenant.drawer.sensitiveWarning")}
        confirmLabel={t("tenant.drawer.sensitiveConfirm")}
        cancelLabel={t("common.cancel")}
        danger
        busy={busy}
        {...(formError.message ? { errorMessage: formError.message } : {})}
        onConfirm={() => { setDialog(null); void save(); }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "request"}
        title={t("tenant.drawer.requestTitle", { name: provider.name })}
        description={<>{t("tenant.drawer.requestBody")} {approvalRequired ? t("tenant.drawer.needsApprover") : t("tenant.drawer.appliesDirect")}</>}
        confirmLabel={approvalRequired ? t("tenant.drawer.requestSwitch") : t("tenant.drawer.directSwitch")}
        cancelLabel={t("common.cancel")}
        requireReason
        minReasonLength={5}
        maxReasonLength={1000}
        reasonLabel={t("tenant.drawer.reasonLabel")}
        busy={busy}
        {...(formError.message ? { errorMessage: formError.message } : {})}
        onConfirm={(reason) => { void requestSwitch(reason); }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "revert"}
        title={t("tenant.drawer.revertTitle")}
        description={t("tenant.drawer.revertBody")}
        confirmLabel={t("tenant.drawer.revert")}
        cancelLabel={t("common.cancel")}
        requireReason
        minReasonLength={5}
        maxReasonLength={1000}
        reasonLabel={t("tenant.drawer.revertReasonLabel")}
        busy={busy}
        {...(formError.message ? { errorMessage: formError.message } : {})}
        onConfirm={(reason) => { void revert(reason); }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "remove"}
        title={t("tenant.drawer.removeTitle")}
        description={t("tenant.drawer.removeBody")}
        confirmLabel={t("tenant.drawer.removeConfirm")}
        cancelLabel={t("common.cancel")}
        danger
        busy={busy}
        {...(formError.message ? { errorMessage: formError.message } : {})}
        onConfirm={() => { void remove(); }}
        onCancel={() => setDialog(null)}
      />
    </>
  );
}
