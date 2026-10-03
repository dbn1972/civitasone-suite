"use client";

/**
 * fp-finance-01: the per-tenant switches behind the maker-checker rules.
 * Defaults are conservative (second approver on, open periods block fiscal-year
 * activation, new years created as drafts). Changing any of them needs a stated
 * reason and is audited with the before/after values.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { FinanceSettings } from "@civitasone/types";
import { Card, ConfirmDialog, Button } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

type Flag = "makerCheckerEnabled" | "blockFyActivationOpenPeriods" | "requireOpeningBalancesForActivation" | "fyCreateAsDraft";
const FLAGS: Flag[] = ["makerCheckerEnabled", "blockFyActivationOpenPeriods", "requireOpeningBalancesForActivation", "fyCreateAsDraft"];

/** The flags whose value differs from what the server last reported. */
export function changedFlags(current: Pick<FinanceSettings, Flag>, draft: Pick<FinanceSettings, Flag>): Partial<Record<Flag, boolean>> {
  const out: Partial<Record<Flag, boolean>> = {};
  for (const f of FLAGS) if (current[f] !== draft[f]) out[f] = draft[f];
  return out;
}

type HeadField = "debtLoanLiabilityHeadId" | "debtInterestExpenseHeadId" | "debtBankHeadId";
const HEAD_FIELDS: Array<{ key: HeadField; type: "liability" | "expense" | "asset" }> = [
  { key: "debtLoanLiabilityHeadId", type: "liability" },
  { key: "debtInterestExpenseHeadId", type: "expense" },
  { key: "debtBankHeadId", type: "asset" },
];
/** A chart-of-accounts head offered for the debt GL selects. */
export type HeadOption = { id: string; code: string; name: string; type: string };

/** True when `changes` switches a protective control from on to off (the server then holds it for a second admin). */
export function relaxesControl(current: Pick<FinanceSettings, Flag>, changes: Partial<Record<Flag, boolean>>): boolean {
  return (["makerCheckerEnabled", "blockFyActivationOpenPeriods", "requireOpeningBalancesForActivation"] as const)
    .some((k) => current[k] === true && changes[k] === false);
}

/**
 * `heads`: chart-of-accounts heads for the debt GL selects (null = the chart failed to load: the selects are
 * disabled with a message, never silently empty). The three heads must be set together; there are no defaults.
 */
export function FinanceSettingsPanel({ settings, heads }: { settings: FinanceSettings; heads: HeadOption[] | null }) {
  const t = useTranslations("financeSettings");
  const router = useRouter();
  const baseId = useId();
  const [draft, setDraft] = useState<Pick<FinanceSettings, Flag>>({
    makerCheckerEnabled: settings.makerCheckerEnabled,
    blockFyActivationOpenPeriods: settings.blockFyActivationOpenPeriods,
    requireOpeningBalancesForActivation: settings.requireOpeningBalancesForActivation,
    fyCreateAsDraft: settings.fyCreateAsDraft,
  });
  const [headDraft, setHeadDraft] = useState<Record<HeadField, string>>({
    debtLoanLiabilityHeadId: settings.debtLoanLiabilityHeadId ?? "",
    debtInterestExpenseHeadId: settings.debtInterestExpenseHeadId ?? "",
    debtBankHeadId: settings.debtBankHeadId ?? "",
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const flagChanges = changedFlags(settings, draft);
  const headChanged = HEAD_FIELDS.some((h) => headDraft[h.key] !== (settings[h.key] ?? ""));
  const headsComplete = HEAD_FIELDS.every((h) => headDraft[h.key] !== "");
  const headsPartial = !headsComplete && HEAD_FIELDS.some((h) => headDraft[h.key] !== "");
  const changes: Record<string, unknown> = { ...flagChanges };
  if (headChanged && headsComplete) for (const h of HEAD_FIELDS) changes[h.key] = headDraft[h.key];
  const relaxing = relaxesControl(settings, flagChanges);
  const dirty = Object.keys(changes).length > 0 && !headsPartial;

  async function save(reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch("v1/finance/settings", { method: "PUT", body: JSON.stringify({ ...changes, reason: reason ?? "" }) });
      if (!res.ok) { setError(await errorMessageFromResponse(res, "save", t("area"))); return; }
      const body = (await res.json().catch(() => null)) as { status?: string } | null;
      setOpen(false);
      setMessage(body?.status === "pending_approval" ? t("savedPending") : t("saved"));
      router.refresh();
    } catch {
      setError(t("network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("title")}>
      <div className="pad" style={{ display: "grid", gap: 12 }}>
        <p style={{ margin: 0, color: "var(--mut)", fontSize: 13.5 }}>{t("intro")}</p>
        {FLAGS.map((f) => {
          // Plain identifiers (not t() calls inline) so the label's accessible text is statically visible to jsx-a11y.
          const flagLabel = t(`flag.${f}.label`);
          const flagHelp = t(`flag.${f}.help`);
          const inputId = `${baseId}-${f}`;
          const helpId = `${inputId}-help`;
          return (
            <div key={f} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14 }}>
              <input
                id={inputId}
                type="checkbox"
                checked={draft[f]}
                aria-describedby={helpId}
                onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.checked }))}
                style={{ marginTop: 3 }}
              />
              <div>
                <label htmlFor={inputId} style={{ fontWeight: 600 }}>{flagLabel}</label>
                <div id={helpId} style={{ color: "var(--mut)", fontSize: 13 }}>{flagHelp}</div>
              </div>
            </div>
          );
        })}
        <div style={{ display: "grid", gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{t("glTitle")}</strong>
          <span style={{ color: "var(--mut)", fontSize: 13 }}>{t("glHelp")}</span>
          {heads === null ? <p role="alert" style={{ margin: 0, fontSize: 13 }}>{t("glLoadFailed")}</p> : null}
          {HEAD_FIELDS.map((h) => {
            const selId = `${baseId}-${h.key}`;
            const selLabel = t(`gl.${h.key}`);
            return (
              <div key={h.key} style={{ display: "grid", gap: 4 }}>
                <label htmlFor={selId} style={{ fontSize: 13, fontWeight: 600 }}>{selLabel}</label>
                <select
                  id={selId}
                  disabled={heads === null}
                  value={headDraft[h.key]}
                  onChange={(e) => setHeadDraft((d) => ({ ...d, [h.key]: e.target.value }))}
                  style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}
                >
                  <option value="">{t("glNotSet")}</option>
                  {(heads ?? []).filter((o) => o.type === h.type).map((o) => (
                    <option key={o.id} value={o.id}>{o.code} · {o.name}</option>
                  ))}
                </select>
              </div>
            );
          })}
          {headsPartial ? <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad, #c0392b)" }}>{t("glIncomplete")}</p> : null}
        </div>
        <div>
          <Button type="button" disabled={!dirty || busy} onClick={() => { setError(undefined); setOpen(true); }}>{t("save")}</Button>
        </div>
        {message ? <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p> : null}
      </div>
      <ConfirmDialog
        open={open}
        title={t("confirmTitle")}
        confirmLabel={t("save")}
        danger={relaxing}
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={10}
        maxReasonLength={500}
        busy={busy}
        errorMessage={error}
        description={relaxing ? t("confirmRelax") : t("confirmDescription")}
        onConfirm={(reason) => void save(reason)}
        onCancel={() => !busy && setOpen(false)}
      />
    </Card>
  );
}
