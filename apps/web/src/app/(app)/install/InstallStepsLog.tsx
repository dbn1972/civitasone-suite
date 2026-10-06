"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Card, DataTable, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { InstallStepSummary } from "@civitasone/types";

/**
 * GAP-INSTALL-STEPS-04: /install/steps used to pipe install-service steps
 * through the generic ModuleListPage, which flattens every step to the
 * ModuleRowSummary {id,label,sublabel,status,meta} shape — dropping stepNo,
 * isRequired and errorMessage. A failed step therefore showed only the word
 * "failed", in no particular order, with no way to see WHY it failed or to
 * act on it.
 *
 * Decision (recorded): keep /install/steps as a read-only LOG view (not a
 * redirect), but make it honest — the typed getInstallSteps loader
 * (InstallStepSummary) carries stepNo/isRequired/errorMessage, so this view:
 *   - orders rows by stepNo,
 *   - marks required steps,
 *   - renders the real errorMessage for a failed step, and
 *   - links to /install for the single place that runs/retries/skips steps
 *     (InstallStepActions is NOT duplicated here — one place for mutations).
 */

type StepRow = InstallStepSummary & Record<string, unknown>;

type StepCol = {
  key: keyof InstallStepSummary & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InstallStepSummary) => ReactNode;
  sortable?: boolean;
};

const COLUMNS: StepCol[] = [
  { key: "stepNo", label: "#", align: "right" },
  { key: "title", label: "Step" },
  {
    key: "isRequired",
    label: "Required",
    render: (row) => (row.isRequired ? "Required" : "Optional"),
  },
  {
    key: "status",
    label: "Status",
    render: (row) => <StatusPill status={row.status.replace(/_/g, " ")} />,
  },
  {
    key: "errorMessage",
    label: "Detail",
    // A failed step surfaces its real errorMessage; a completed step shows when;
    // otherwise "—". This is the lossy-duplicate fix: the status word alone is
    // no longer all a failed step shows.
    render: (row) =>
      row.errorMessage ? (
        <span role="alert" className="text-red-600">
          {row.errorMessage}
        </span>
      ) : row.completedAt ? (
        `Completed ${formatIndianDate(row.completedAt)}`
      ) : (
        "—"
      ),
  },
];

export function InstallStepsLog({
  steps,
  source,
}: {
  steps: InstallStepSummary[];
  source: "api" | "error";
}) {
  if (source === "error") {
    return (
      <Card title="Installer steps">
        <RefreshErrorState
          error={toHumanError("load", { area: "install steps" })}
          source={{ area: "install steps" }}
          backHref="/install/console"
        />
      </Card>
    );
  }

  // Order by stepNo (the backend order is not guaranteed), stable on ties.
  const ordered = [...steps].sort((a, b) => a.stepNo - b.stepNo) as StepRow[];

  return (
    <Card title="Installer steps">
      {ordered.length === 0 ? (
        <EmptyState
          icon="🧩"
          title="No installation steps"
          message="There are no setup steps recorded for this tenant yet."
        />
      ) : (
        <>
          <DataTable<StepRow>
            columns={COLUMNS}
            rows={ordered}
            sortable
            filterable
            filterPlaceholder="Filter steps…"
            pageSize={15}
          />
          <p className="back" style={{ marginTop: 16 }}>
            {/* Read-only log: run/retry/skip lives only in the installer
                wizard, so a failed step links there rather than duplicating
                InstallStepActions on a log screen. */}
            <Link href="/install">Run or retry steps in the installer wizard →</Link>
          </p>
        </>
      )}
    </Card>
  );
}
