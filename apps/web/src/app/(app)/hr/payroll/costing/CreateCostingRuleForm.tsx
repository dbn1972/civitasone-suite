"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { percentToBps } from "@/lib/money";
import { formatSplitPct, projectedGroupTotal, type CostCenterOption, type CostingRule } from "./costingShared";

type Props = {
  /** Active finance cost centres (GET /v1/finance/cost-centers). */
  costCenters: CostCenterOption[];
  /** False when the cost-centre master could not be loaded. */
  costCentersAvailable: boolean;
  /** Existing rules, for the per-group running total. */
  rules: CostingRule[];
};

/** 0 < split <= 100 with at most 2 decimals (payroll.costing_rules.split_pct is NUMERIC(5,2)). */
export function parseSplitPct(raw: string): number | null {
  const bps = percentToBps(raw);
  if (bps === null || bps <= 0 || bps > 10000) return null;
  return bps / 100;
}

export function CreateCostingRuleForm({ costCenters, costCentersAvailable, rules }: Props) {
  const t = useTranslations("createCostingRuleForm");
  const router = useRouter();
  const [employeeGroup, setEmployeeGroup] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [splitPct, setSplitPct] = useState("100");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [groupInvalid, setGroupInvalid] = useState(false);
  const [centerInvalid, setCenterInvalid] = useState(false);
  const [splitInvalid, setSplitInvalid] = useState(false);

  const groupField = useId();
  const centerField = useId();
  const splitField = useId();
  const totalId = useId();
  const errId = useId();
  const groupRef = useRef<HTMLInputElement>(null);
  const centerRef = useRef<HTMLSelectElement>(null);
  const splitRef = useRef<HTMLInputElement>(null);

  const center = costCenters.find((c) => c.id === costCenterId);
  const centerLabel = center ? `${center.code} — ${center.name}` : "";
  const split = parseSplitPct(splitPct);
  const group = employeeGroup.trim();
  // GAP-PAYROLL-COSTING-02: running total for the group after this save.
  // Rules are saved one at a time, so a total other than 100% is a warning
  // (the group is still being built up), not a hard block.
  const projected = group && costCenterId && split !== null ? projectedGroupTotal(rules, group, costCenterId, split) : null;
  const disabled = busy || !costCentersAvailable || costCenters.length === 0;

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const groupMissing = !group;
    const centerMissing = !center;
    const splitBad = split === null;
    setGroupInvalid(groupMissing);
    setCenterInvalid(centerMissing);
    setSplitInvalid(splitBad);
    if (groupMissing || centerMissing) {
      setError(t("groupCenterRequiredError"));
      if (groupMissing) groupRef.current?.focus();
      else centerRef.current?.focus();
      return;
    }
    if (splitBad) {
      setError(t("splitRangeError"));
      splitRef.current?.focus();
      return;
    }
    setConfirmOpen(true);
  }

  async function save() {
    if (split === null || !center) return;
    setBusy(true);
    setError(undefined);
    try {
      // The POST is async (202 + command id); it does not echo the rule
      // back, so the confirmation uses what was submitted.
      const res = await browserFetch("v1/payroll/costing/rules", {
        method: "POST",
        body: JSON.stringify({ employeeGroup: group, costCenterId: center.id, splitPct: split }),
      });
      if (!res.ok) {
        // GAP-PAYROLL-COSTING-02: the server refuses a save that would take the group above 100%.
        const code = await errorCodeFromResponse(res);
        if (code === "COSTING_SPLIT_EXCEEDS_100") throw new Error(t("serverOver100Error", { group }));
        throw new Error(await errorMessageFromResponse(res));
      }
      setConfirmOpen(false);
      setMessage(t("savedMessage", { group, pct: split }));
      setEmployeeGroup("");
      setCostCenterId("");
      setSplitPct("100");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

  return (
    <form onSubmit={openConfirm} noValidate style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        {(!costCentersAvailable || costCenters.length === 0) && (
          <p role="alert" className="pill warn" style={{ width: "fit-content", marginTop: 0 }}>
            {costCentersAvailable ? t("noCostCentersMessage") : t("costCentersUnavailableMessage")}
          </p>
        )}
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={groupField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("employeeGroupLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={groupField}
              ref={groupRef}
              value={employeeGroup}
              onChange={(e) => { setEmployeeGroup(e.target.value); setGroupInvalid(false); }}
              maxLength={64}
              aria-required="true"
              aria-invalid={groupInvalid || undefined}
              aria-describedby={groupInvalid ? errId : undefined}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={centerField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("costCenterLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            {/* GAP-PAYROLL-COSTING-02: pick from the finance cost-centre master
                instead of typing a raw UUID. */}
            <select
              id={centerField}
              ref={centerRef}
              value={costCenterId}
              onChange={(e) => { setCostCenterId(e.target.value); setCenterInvalid(false); }}
              disabled={!costCentersAvailable || costCenters.length === 0}
              aria-required="true"
              aria-invalid={centerInvalid || undefined}
              aria-describedby={centerInvalid ? errId : undefined}
              style={{ ...inputStyle, background: "var(--panel, #fff)" }}
            >
              <option value="">{t("costCenterPlaceholder")}</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>{`${c.code} — ${c.name}`}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={splitField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("splitPctLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={splitField}
              ref={splitRef}
              type="number"
              inputMode="decimal"
              min={0.01}
              max={100}
              step={0.01}
              value={splitPct}
              onChange={(e) => { setSplitPct(e.target.value); setSplitInvalid(false); }}
              aria-required="true"
              aria-invalid={splitInvalid || undefined}
              aria-describedby={[splitInvalid ? errId : "", projected !== null ? totalId : ""].filter(Boolean).join(" ") || undefined}
              style={inputStyle}
            />
          </div>
        </div>
        {projected !== null && (
          <p
            id={totalId}
            aria-live="polite"
            className={`pill ${projected === 100 ? "good" : "warn"}`}
            style={{ marginTop: 10, width: "fit-content" }}
          >
            {projected === 100
              ? t("groupTotalOk", { group, total: formatSplitPct(projected) })
              : t("groupTotalWarning", { group, total: formatSplitPct(projected) })}
          </p>
        )}
        <div style={{ marginTop: 14 }}>
          <Button type="submit" style={{ minHeight: 44 }} disabled={disabled}>
            {t("saveRuleBtn")}
          </Button>
        </div>
        {error && !confirmOpen && (
          <p id={errId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>{error}</p>
        )}
        {message && (
          <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>{message}</p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t.rich("confirmDescription", {
          pct: split ?? splitPct,
          group,
          center: centerLabel,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void save()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
