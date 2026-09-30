"use client";
/**
 * RetirementCaseWorkspace — binds the "Retiring in Next 6 Months" dashboard
 * to the processing wizard below it.
 *
 * Owns the "which retiree is active" selection, defaults it to the
 * soonest-retiring employee, and remounts the wizard (via `key`) on every
 * switch so one retiree's checklist state can never bleed into another's.
 * GAP-HR-RETIREMENT-01: the wizard is now backed by a real separationId
 * (row.id) rather than being purely client-side.
 */
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/app/_components/ds";
import { isUpcoming, sortByDateAsc } from "@/lib/retirement";
import { RetirementDashboard, type RetirementRow } from "./RetirementDashboard";
import { RetirementProcessWizard } from "./RetirementProcessWizard";

interface Props {
  rows: RetirementRow[];
}

export function RetirementCaseWorkspace({ rows }: Props) {
  const t = useTranslations("retirementWorkspace");
  const upcoming = useMemo(() => sortByDateAsc(rows.filter((r) => isUpcoming(r))), [rows]);

  const [selectedId, setSelectedId] = useState<string | undefined>(upcoming[0]?.id);
  const selected = upcoming.find((r) => r.id === selectedId);

  return (
    <>
      <Card title={t("cardTitleUpcoming")}>
        <div style={{ padding: "16px" }}>
          <RetirementDashboard rows={rows} selectedId={selectedId} onSelect={(row) => setSelectedId(row.id)} />
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title={t("cardTitleWizard")}>
          <div style={{ padding: 16 }}>
            <RetirementProcessWizard key={selectedId ?? "none"} employeeName={selected?.employee} separationId={selected?.id} />
          </div>
        </Card>
      </div>
    </>
  );
}
