"use client";
/**
 * RetirementCaseWorkspace — binds the "Retiring in Next 6 Months" dashboard
 * to the processing wizard below it.
 *
 * Before this component existed, page.tsx rendered RetirementDashboard and
 * RetirementProcessWizard as two independent widgets: the wizard always
 * called `<RetirementProcessWizard />` with no `employeeName`, so it never
 * indicated which retiree (of potentially several shown above it) it was
 * for. An HR officer processing multiple retirements had exactly one
 * generic, un-attributed checklist with no way to switch between cases.
 *
 * This wrapper owns the "which retiree is active" selection, defaults it to
 * the soonest-retiring employee, and remounts the wizard (via `key`) on
 * every switch so one retiree's ticked boxes can never bleed into another's
 * (the wizard still has no backend persistence at all -- see the
 * disclaimer inside RetirementProcessWizard -- but at least the checklist
 * is never carried over to the wrong person).
 */
import { useMemo, useState } from "react";
import { Card } from "@/app/_components/ds";
import { RetirementDashboard, type RetirementRow } from "./RetirementDashboard";
import { RetirementProcessWizard } from "./RetirementProcessWizard";

interface Props {
  rows: RetirementRow[];
}

export function RetirementCaseWorkspace({ rows }: Props) {
  const upcoming = useMemo(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() + 6);
    return rows
      .filter((r) => {
        if (!r.superannuationDate) return false;
        const d = new Date(r.superannuationDate);
        return d >= new Date() && d <= cutoff;
      })
      .sort((a, b) => new Date(a.superannuationDate).getTime() - new Date(b.superannuationDate).getTime());
  }, [rows]);

  const [selectedId, setSelectedId] = useState<string | undefined>(upcoming[0]?.id);
  const selected = upcoming.find((r) => r.id === selectedId);

  return (
    <>
      <Card title="Retiring in Next 6 Months">
        <div style={{ padding: "16px" }}>
          <RetirementDashboard rows={rows} selectedId={selectedId} onSelect={(row) => setSelectedId(row.id)} />
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title="Retirement Processing Wizard — 5-Step Checklist">
          <div style={{ padding: 16 }}>
            <RetirementProcessWizard key={selectedId ?? "none"} employeeName={selected?.employee} />
          </div>
        </Card>
      </div>
    </>
  );
}
