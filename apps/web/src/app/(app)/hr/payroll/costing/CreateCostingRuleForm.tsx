"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type RuleResponse = { data: { id: string; employeeGroup: string; costCenterId: string; splitPct: number } };

export function CreateCostingRuleForm() {
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

  const groupField = useId();
  const centerField = useId();
  const splitField = useId();
  const errId = useId();
  const groupRef = useRef<HTMLInputElement>(null);
  const centerRef = useRef<HTMLInputElement>(null);

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const groupMissing = !employeeGroup.trim();
    const centerMissing = !costCenterId.trim();
    setGroupInvalid(groupMissing);
    setCenterInvalid(centerMissing);
    if (groupMissing || centerMissing) {
      setError(t("groupCenterRequiredError"));
      if (groupMissing) {
        groupRef.current?.focus();
      } else {
        centerRef.current?.focus();
      }
      return;
    }
    setConfirmOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserJson<RuleResponse>("v1/payroll/costing/rules", {
        method: "POST",
        body: JSON.stringify({
          employeeGroup: employeeGroup.trim(),
          costCenterId: costCenterId.trim(),
          splitPct: Number(splitPct),
        }),
      });
      setConfirmOpen(false);
      setMessage(t("savedMessage", { group: res.data.employeeGroup, pct: res.data.splitPct }));
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

  return (
    <form onSubmit={openConfirm} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
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
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={centerField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("costCenterIdLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={centerField}
              ref={centerRef}
              value={costCenterId}
              onChange={(e) => { setCostCenterId(e.target.value); setCenterInvalid(false); }}
              aria-required="true"
              aria-invalid={centerInvalid || undefined}
              aria-describedby={centerInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={splitField} style={{ fontSize: 13, fontWeight: 600 }}>{t("splitPctLabel")}</label>
            <input id={splitField} type="number" min={0} max={100} value={splitPct} onChange={(e) => setSplitPct(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
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
          pct: splitPct,
          group: employeeGroup,
          center: costCenterId,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void save()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
