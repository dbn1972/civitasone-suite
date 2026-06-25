"use client";

import { useMemo } from "react";
import { DataTable, EmptyState } from "@/app/_components/ds";
import type { ThemeTokenSummary } from "@civitasone/types";

type TokenRow = ThemeTokenSummary & Record<string, unknown>;

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isColor(value: string): boolean {
  return HEX.test(value.trim());
}

/**
 * Accessible, sortable, filterable view of tenant theme tokens.
 * Color-valued tokens render a labelled swatch (never colour-only):
 * the hex value is shown as text alongside the swatch, and the swatch
 * carries an aria-label so assistive tech announces the colour.
 */
export function ThemeTokenTable({ tokens }: { tokens: ThemeTokenSummary[] }) {
  const rows = useMemo<TokenRow[]>(
    () => tokens.map((t) => ({ ...t })),
    [tokens],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="🎨"
        title="No theme tokens"
        message="This tenant has no branding tokens configured yet. Publish a theme revision to seed the palette."
      />
    );
  }

  return (
    <DataTable<TokenRow>
      sortable
      filterable
      filterPlaceholder="Filter tokens…"
      pageSize={12}
      columns={[
        {
          key: "key",
          label: "Token",
          render: (row) => (
            <span style={{ fontFamily: "var(--mono, ui-monospace, monospace)", fontSize: 13 }}>
              {row.key}
            </span>
          ),
        },
        {
          key: "value",
          label: "Value",
          render: (row) => {
            const value = String(row.value ?? "");
            if (isColor(value)) {
              return (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span
                    role="img"
                    aria-label={`Colour swatch ${value}`}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      background: value,
                      border: "1px solid var(--line, #e2e8f0)",
                      flex: "0 0 auto",
                    }}
                  />
                  <span style={{ fontFamily: "var(--mono, ui-monospace, monospace)", fontSize: 13 }}>
                    {value}
                  </span>
                </span>
              );
            }
            return <span>{value}</span>;
          },
        },
      ]}
      rows={rows}
    />
  );
}
