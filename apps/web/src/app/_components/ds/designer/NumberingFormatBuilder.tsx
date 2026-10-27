"use client";

import { useRef, useState } from "react";
import { Button } from "../Button";
import { Segmented } from "../Segmented";
import {
  formatNumberingPreview,
  NUMBERING_RESET_OPTIONS,
  type NumberingResetPolicy,
  type NumberingToken,
} from "./issuanceTypes";

export interface NumberingFormatBuilderProps {
  tokens: NumberingToken[];
  onChange: (tokens: NumberingToken[]) => void;
  warning?: string | null;
  /** GAP-DESIGNER-DETAIL-B7-03: when the sequence restarts. Omit to hide the control. */
  resetPolicy?: NumberingResetPolicy | "";
  onResetPolicyChange?: (policy: NumberingResetPolicy | "") => void;
  /** Non-blocking advisories (duplicate Sequence, missing Office, policy/year mismatch). */
  advisories?: string[];
}

const TOKEN_OPTIONS = ["Prefix", "Ward", "Year", "FY", "Office", "Sequence"] as const;

function tokenKindFromLabel(label: string): NumberingToken["kind"] {
  switch (label) {
    case "Prefix":
      return "prefix";
    case "Ward":
      return "ward";
    case "Year":
      return "year";
    case "FY":
      return "fy";
    case "Office":
      return "office";
    default:
      return "seq";
  }
}

function labelFromKind(kind: NumberingToken["kind"]): string {
  switch (kind) {
    case "prefix":
      return "Prefix";
    case "ward":
      return "Ward";
    case "year":
      return "Year";
    case "fy":
      return "FY";
    case "office":
      return "Office";
    default:
      return "Sequence";
  }
}

export function NumberingFormatBuilder({
  tokens,
  onChange,
  warning,
  resetPolicy,
  onResetPolicyChange,
  advisories,
}: NumberingFormatBuilderProps) {
  const preview = formatNumberingPreview(tokens);

  // Stable per-row React key, independent of array position -- see
  // ElectFlexBenefitForm.tsx (apps/web/src/app/(app)/hr/payroll/flex-benefits)
  // for the full rationale. The previous key (`${token.kind}-${idx}`)
  // degenerated to plain index-keying whenever two tokens shared a kind
  // (nothing stops adding e.g. two Ward tokens), letting removal of an
  // earlier same-kind token shift a later, focused one into the removed
  // token's key. NumberingToken carries no id, so a parallel id list stands
  // in for one; moveToken swaps two ids in lockstep with the two tokens it
  // swaps, so a reorder keeps each token's own key attached to its own data.
  const nextTokenRowId = useRef(0);
  const [tokenRowIds, setTokenRowIds] = useState<number[]>(() => tokens.map(() => nextTokenRowId.current++));
  const tokenKeyFor = (idx: number) => tokenRowIds[idx] ?? idx;

  const addToken = (label: string) => {
    const kind = tokenKindFromLabel(label);
    const next: NumberingToken =
      kind === "prefix"
        ? { kind, value: "TL" }
        : kind === "office"
          ? { kind, value: "HO" }
          : kind === "seq"
            ? { kind, seqWidth: 5 }
            : { kind };
    onChange([...tokens, next]);
    setTokenRowIds((ids) => [...ids, nextTokenRowId.current++]);
  };

  const removeToken = (idx: number) => {
    onChange(tokens.filter((_, i) => i !== idx));
    setTokenRowIds((ids) => ids.filter((_, i) => i !== idx));
  };

  const moveToken = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= tokens.length) return;
    const next = [...tokens];
    const tmp = next[idx]!;
    next[idx] = next[target]!;
    next[target] = tmp;
    onChange(next);
    setTokenRowIds((ids) => {
      const swapped = [...ids];
      const tmpId = swapped[idx]!;
      swapped[idx] = swapped[target]!;
      swapped[target] = tmpId;
      return swapped;
    });
  };

  const updateToken = (idx: number, patch: Partial<NumberingToken>) => {
    onChange(tokens.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--mut)", marginTop: 0 }}>
        Compose how certificate or closure numbers are generated.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {TOKEN_OPTIONS.map((opt) => (
          <Button key={opt} type="button" variant="ghost" onClick={() => addToken(opt)}>
            + {opt}
          </Button>
        ))}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {tokens.map((token, idx) => (
          <li
            key={tokenKeyFor(idx)}
            data-testid={`numbering-token-${idx}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)",
              background: "var(--panel)",
              flexWrap: "wrap",
            }}
          >
            <Segmented
              options={[...TOKEN_OPTIONS]}
              value={labelFromKind(token.kind)}
              onChange={(v) => updateToken(idx, { kind: tokenKindFromLabel(v) })}
            />
            {token.kind === "prefix" || token.kind === "office" ? (
              <input
                aria-label={token.kind === "prefix" ? "Prefix value" : "Office code"}
                value={token.value ?? ""}
                onChange={(e) => updateToken(idx, { value: e.target.value })}
                placeholder={token.kind === "prefix" ? "TL" : "HO"}
                style={{ width: 80 }}
              />
            ) : null}
            {token.kind === "seq" ? (
              <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                Width
                <input
                  type="number"
                  min={3}
                  max={10}
                  aria-label="Sequence width"
                  value={token.seqWidth ?? 5}
                  onChange={(e) => updateToken(idx, { seqWidth: Number(e.target.value) || 5 })}
                  style={{ width: 56 }}
                />
              </label>
            ) : null}
            <div style={{ marginInlineStart: "auto", display: "flex", gap: 4 }}>
              <Button
                type="button"
                variant="ghost"
                aria-label="Move token up"
                disabled={idx === 0}
                onClick={() => moveToken(idx, -1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-label="Move token down"
                disabled={idx === tokens.length - 1}
                onClick={() => moveToken(idx, 1)}
              >
                ↓
              </Button>
              <Button type="button" variant="ghost" aria-label="Remove token" onClick={() => removeToken(idx)}>
                ×
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p style={{ marginTop: 16, fontSize: 14 }} data-testid="numbering-preview">
        Next number will look like: <strong>{preview || "—"}</strong>
      </p>
      {onResetPolicyChange ? (
        <div style={{ marginTop: 16 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Sequence restarts</span>
            <select
              aria-label="Sequence restarts"
              value={resetPolicy ?? ""}
              onChange={(e) => onResetPolicyChange(e.target.value as NumberingResetPolicy | "")}
              style={{ maxWidth: 320 }}
            >
              <option value="">Choose when it restarts…</option>
              {NUMBERING_RESET_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          {resetPolicy ? (
            <p data-testid="numbering-reset-help" style={{ margin: "6px 0 0", fontSize: 12, color: "var(--mut)" }}>
              {NUMBERING_RESET_OPTIONS.find((o) => o.id === resetPolicy)?.help} Saved with the design;
              numbers already issued are never renumbered.
            </p>
          ) : null}
        </div>
      ) : null}
      {advisories && advisories.length > 0 ? (
        <ul data-testid="numbering-advisories" style={{ margin: "8px 0 0", paddingInlineStart: 18, fontSize: 13, color: "var(--warn)" }}>
          {advisories.map((a) => (<li key={a}>{a}</li>))}
        </ul>
      ) : null}
      {warning ? (
        <p data-testid="numbering-warning" style={{ marginTop: 8, fontSize: 13, color: "var(--warn)" }}>
          {warning}
        </p>
      ) : null}
    </div>
  );
}
