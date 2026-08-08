"use client";

import { Segmented } from "../Segmented";
import {
  formatNumberingPreview,
  type NumberingToken,
} from "./issuanceTypes";

export interface NumberingFormatBuilderProps {
  tokens: NumberingToken[];
  onChange: (tokens: NumberingToken[]) => void;
}

const TOKEN_OPTIONS = ["Prefix", "Ward", "Year", "Sequence"] as const;

function tokenKindFromLabel(label: string): NumberingToken["kind"] {
  switch (label) {
    case "Prefix": return "prefix";
    case "Ward": return "ward";
    case "Year": return "year";
    default: return "seq";
  }
}

function labelFromKind(kind: NumberingToken["kind"]): string {
  switch (kind) {
    case "prefix": return "Prefix";
    case "ward": return "Ward";
    case "year": return "Year";
    default: return "Sequence";
  }
}

export function NumberingFormatBuilder({ tokens, onChange }: NumberingFormatBuilderProps) {
  const preview = formatNumberingPreview(tokens);

  const addToken = (label: string) => {
    const kind = tokenKindFromLabel(label);
    const next: NumberingToken = kind === "prefix"
      ? { kind, value: "TL" }
      : kind === "seq"
        ? { kind, seqWidth: 5 }
        : { kind };
    onChange([...tokens, next]);
  };

  const removeToken = (idx: number) => {
    onChange(tokens.filter((_, i) => i !== idx));
  };

  const updateToken = (idx: number, patch: Partial<NumberingToken>) => {
    onChange(tokens.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--mut)", marginTop: 0 }}>
        Compose how certificate numbers are generated.
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
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)",
              background: "var(--panel)",
            }}
          >
            <Segmented
              options={[...TOKEN_OPTIONS]}
              value={labelFromKind(token.kind)}
              onChange={(v) => updateToken(idx, { kind: tokenKindFromLabel(v) })}
            />
            {token.kind === "prefix" ? (
              <input
                aria-label="Prefix value"
                value={token.value ?? ""}
                onChange={(e) => updateToken(idx, { value: e.target.value })}
                placeholder="TL"
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
            <button type="button" className="btn ghost" aria-label="Remove token" onClick={() => removeToken(idx)}>×</button>
          </li>
        ))}
      </ul>
      <p style={{ marginTop: 16, fontSize: 14 }}>
        Next number will look like: <strong>{preview || "—"}</strong>
      </p>
    </div>
  );
}
