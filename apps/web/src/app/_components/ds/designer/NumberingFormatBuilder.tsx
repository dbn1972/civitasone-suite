"use client";

import { Segmented } from "../Segmented";
import {
  formatNumberingPreview,
  type NumberingToken,
} from "./issuanceTypes";

export interface NumberingFormatBuilderProps {
  tokens: NumberingToken[];
  onChange: (tokens: NumberingToken[]) => void;
  warning?: string | null;
}

const TOKEN_OPTIONS = ["Prefix", "Ward", "Year", "Office", "Sequence"] as const;

function tokenKindFromLabel(label: string): NumberingToken["kind"] {
  switch (label) {
    case "Prefix":
      return "prefix";
    case "Ward":
      return "ward";
    case "Year":
      return "year";
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
    case "office":
      return "Office";
    default:
      return "Sequence";
  }
}

export function NumberingFormatBuilder({ tokens, onChange, warning }: NumberingFormatBuilderProps) {
  const preview = formatNumberingPreview(tokens);

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
  };

  const removeToken = (idx: number) => {
    onChange(tokens.filter((_, i) => i !== idx));
  };

  const moveToken = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= tokens.length) return;
    const next = [...tokens];
    const tmp = next[idx]!;
    next[idx] = next[target]!;
    next[target] = tmp;
    onChange(next);
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
          <button key={opt} type="button" className="btn ghost" onClick={() => addToken(opt)}>
            + {opt}
          </button>
        ))}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {tokens.map((token, idx) => (
          <li
            key={`${token.kind}-${idx}`}
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
            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              <button
                type="button"
                className="btn ghost"
                aria-label="Move token up"
                disabled={idx === 0}
                onClick={() => moveToken(idx, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn ghost"
                aria-label="Move token down"
                disabled={idx === tokens.length - 1}
                onClick={() => moveToken(idx, 1)}
              >
                ↓
              </button>
              <button type="button" className="btn ghost" aria-label="Remove token" onClick={() => removeToken(idx)}>
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p style={{ marginTop: 16, fontSize: 14 }} data-testid="numbering-preview">
        Next number will look like: <strong>{preview || "—"}</strong>
      </p>
      {warning ? (
        <p data-testid="numbering-warning" style={{ marginTop: 8, fontSize: 13, color: "var(--warn-fg)" }}>
          {warning}
        </p>
      ) : null}
    </div>
  );
}
