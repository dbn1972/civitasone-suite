"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, DataTable } from "@/app/_components/ds";

type Line = {
  id: string;
  recoveryType: string;
  amountMinor: string;
  computedAmountMinor: string | null;
  rateBps: number | null;
  adjusted: boolean;
};
type Row = { id: string; head: string; rate: string; computed: string; charged: string; note: string };
type State = { status: "idle" | "loading" | "error" } | { status: "ready"; lines: Line[] };

/**
 * D4c #37: the checkers view of a bills statutory deduction lines (what the maker charged beside what the division
 * rates computed). Lines are fetched when a bill is opened, so a work with many bills loads nothing up front.
 */
export function BillDeductions({ bills }: { bills: Array<{ id: string; billNo: string }> }) {
  const t = useTranslations("works.billDeductions");
  const heads = useTranslations("works.billsNew.deductionHeads");
  const [state, setState] = useState<Record<string, State>>({});

  if (bills.length === 0) return null;

  async function load(id: string) {
    if (state[id] && state[id].status !== "error") return;
    setState((prev) => ({ ...prev, [id]: { status: "loading" } }));
    try {
      const res = await fetch(`/api/proxy/v1/works/billing/bills/${id}/recoveries`);
      if (!res.ok) {
        setState((prev) => ({ ...prev, [id]: { status: "error" } }));
        return;
      }
      const body = (await res.json()) as { data?: unknown };
      const lines = Array.isArray(body.data) ? (body.data as Line[]) : [];
      setState((prev) => ({ ...prev, [id]: { status: "ready", lines } }));
    } catch {
      setState((prev) => ({ ...prev, [id]: { status: "error" } }));
    }
  }

  return (
    <Card title={t("title")}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
        {bills.map((b) => {
          const s = state[b.id];
          return (
            <details key={b.id} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void load(b.id); }}>
              <summary style={{ cursor: "pointer", minHeight: 32 }}>{t("bill", { billNo: b.billNo })}</summary>
              {s?.status === "loading" ? <p style={{ fontSize: 12, color: "var(--muted)" }}>{t("loading")}</p> : null}
              {s?.status === "error" ? <p role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>{t("loadError")}</p> : null}
              {s?.status === "ready" && s.lines.length === 0 ? <p style={{ fontSize: 12, color: "var(--muted)" }}>{t("empty")}</p> : null}
              {s?.status === "ready" && s.lines.length > 0 ? (
                <DataTable<Row>
                  columns={[
                    { key: "head", label: t("colHead") },
                    { key: "rate", label: t("colRate"), align: "right" },
                    { key: "computed", label: t("colComputed"), cellType: "amount", align: "right" },
                    { key: "charged", label: t("colCharged"), cellType: "amount", align: "right" },
                    { key: "note", label: t("colNote") },
                  ]}
                  rows={s.lines.map((l) => ({
                    id: l.id,
                    head: heads.has(l.recoveryType) ? heads(l.recoveryType) : l.recoveryType,
                    rate: l.rateBps === null ? "—" : `${l.rateBps / 100}%`,
                    computed: l.computedAmountMinor ?? "",
                    charged: l.amountMinor,
                    note: l.adjusted ? t("adjusted") : "",
                  }))}
                />
              ) : null}
            </details>
          );
        })}
      </div>
    </Card>
  );
}
