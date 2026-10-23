"use client";

import { useId, useState } from "react";
import { Button } from "../../../_components/ds";
import { useEstabT } from "@/lib/estab/useEstabT";
import { labelForRole } from "./bands";

/**
 * GAP-ESTAB-APPROVAL-MATRIX-03: the ordered approver chain, built only from the
 * roles the office has declared (the `catalogue`). There is no free text, so an
 * unknown role cannot be entered at all; estab-service refuses one as well.
 * Order is the approval order. It is changed with the Earlier / Later buttons
 * (keyboard and screen-reader friendly) rather than by dragging.
 */
export function ApproverChainPicker({
  catalogue,
  value,
  onChange,
}: {
  catalogue: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useEstabT("estabApprovalMatrix");
  const labelId = useId();
  const [pick, setPick] = useState("");
  const remaining = catalogue.filter((r) => !value.includes(r));

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(target, 0, item);
    onChange(next);
  };

  return (
    <div role="group" aria-labelledby={labelId} style={{ display: "grid", gap: 8, fontSize: "0.8125rem" }}>
      <span id={labelId}>{t("rolesPickerLabel")}</span>
      {value.length === 0 ? (
        <p className="mut" style={{ margin: 0 }}>{t("rolesPickerEmpty")}</p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {value.map((role, i) => (
            <li
              key={role}
              style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: "4px 8px" }}
            >
              <span className="mono mut" style={{ minWidth: 20 }}>{i + 1}.</span>
              <span style={{ flex: 1 }}>{labelForRole(role)}</span>
              <Button
                type="button" variant="ghost" size="sm" disabled={i === 0}
                aria-label={t("roleMoveEarlier", { role: labelForRole(role) })}
                onClick={() => move(i, -1)}
              >
                {t("roleEarlier")}
              </Button>
              <Button
                type="button" variant="ghost" size="sm" disabled={i === value.length - 1}
                aria-label={t("roleMoveLater", { role: labelForRole(role) })}
                onClick={() => move(i, 1)}
              >
                {t("roleLater")}
              </Button>
              <Button
                type="button" variant="ghost" size="sm"
                aria-label={t("roleRemove", { role: labelForRole(role) })}
                onClick={() => onChange(value.filter((r) => r !== role))}
              >
                {t("roleRemoveBtn")}
              </Button>
            </li>
          ))}
        </ol>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select aria-label={t("roleAddSelect")} value={pick} disabled={remaining.length === 0} onChange={(e) => setPick(e.target.value)}>
          <option value="">{remaining.length === 0 ? t("roleAllAdded") : t("roleAddPlaceholder")}</option>
          {remaining.map((r) => <option key={r} value={r}>{labelForRole(r)}</option>)}
        </select>
        <Button
          type="button" variant="secondary" size="sm" disabled={!pick}
          onClick={() => {
            if (!pick || !catalogue.includes(pick) || value.includes(pick)) return;
            onChange([...value, pick]);
            setPick("");
          }}
        >
          {t("roleAddBtn")}
        </Button>
      </div>
    </div>
  );
}
