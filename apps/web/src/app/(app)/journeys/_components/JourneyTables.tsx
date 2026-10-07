import { Card } from "@/app/_components/ds";
import { DataTable } from "@/app/_components/ds/DataTable";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import type { LoaderSource } from "@/app/_data/apiClient";
import type {
  JourneyDefinitionRow,
  JourneyExecutionRow,
  JourneyTriggerRow,
} from "../_data";

/**
 * GAP-JOURNEYS-ACTIVE-02 / ANALYTICS-02 / BUILDER-02 / TEMPLATES-02:
 * journey-specific tables with FIXED, meaningful columns and a styled
 * StatusPill (cellType "status") and formatted dates (cellType "date"),
 * replacing the shared ModuleListTable's generic ID/Name/Detail/Status/Meta
 * list where columns meant different things per row and status was raw text.
 *
 * These are Server Components: DataTable's `cellType` path is server-safe
 * (no `render` functions cross the RSC boundary). The shared ModuleListTable
 * is left untouched for every other module.
 */

function errorCard(area: string, source: LoaderSource) {
  if (source !== "error") return null;
  return (
    <Card title="Records">
      <RefreshErrorState error={toHumanError("load", { area })} source={{ area }} />
    </Card>
  );
}

export function JourneyDefinitionsTable({
  rows,
  source,
}: {
  rows: JourneyDefinitionRow[];
  source: LoaderSource;
}) {
  const err = errorCard("journey definitions", source);
  if (err) return err;
  return (
    <Card title="Journey definitions">
      <DataTable<JourneyDefinitionRow>
        caption="Journey definitions with status, step count and last update."
        columns={[
          { key: "name", label: "Journey" },
          { key: "status", label: "Status", cellType: "status" },
          { key: "stepCount", label: "Steps", align: "right" },
          { key: "updatedAt", label: "Updated", cellType: "date" },
        ]}
        rows={rows}
        emptyIcon="🧭"
        emptyTitle="No journeys yet"
        emptyMessage="No journey definitions have been created for this tenant."
      />
    </Card>
  );
}

export function ActiveJourneysTable({
  rows,
  source,
}: {
  rows: JourneyExecutionRow[];
  source: LoaderSource;
}) {
  const err = errorCard("journey executions", source);
  if (err) return err;
  // currentStepIndex is 0-based internally; show a 1-based step number, or "—".
  const display = rows.map((r) => ({
    ...r,
    stepLabel: r.currentStepIndex === null ? "—" : `Step ${r.currentStepIndex + 1}`,
    journeyLabel: r.journeyId ?? "—",
    profileLabel: r.profileId ?? "—",
  }));
  return (
    <Card title="Running executions">
      <DataTable<(typeof display)[number]>
        caption="Journey executions with the enrolled profile, current step and status."
        columns={[
          { key: "journeyLabel", label: "Journey" },
          { key: "profileLabel", label: "Profile" },
          { key: "stepLabel", label: "Current step" },
          { key: "status", label: "Status", cellType: "status" },
          { key: "enrolledAt", label: "Started", cellType: "date" },
        ]}
        rows={display}
        emptyIcon="🏃"
        emptyTitle="No executions yet"
        emptyMessage="No profiles are currently enrolled in a journey."
      />
    </Card>
  );
}

export function JourneyTriggersTable({
  rows,
  source,
}: {
  rows: JourneyTriggerRow[];
  source: LoaderSource;
}) {
  const err = errorCard("journey triggers", source);
  if (err) return err;
  const display = rows.map((r) => ({ ...r, journeyLabel: r.journeyId ?? "—" }));
  return (
    <Card title="Trigger rules">
      <DataTable<(typeof display)[number]>
        caption="Trigger rules that enroll profiles into journeys."
        columns={[
          { key: "triggerType", label: "Trigger type" },
          { key: "journeyLabel", label: "Journey" },
          { key: "status", label: "Status", cellType: "status" },
          { key: "updatedAt", label: "Updated", cellType: "date" },
        ]}
        rows={display}
        emptyIcon="⚡"
        emptyTitle="No triggers yet"
        emptyMessage="No trigger rules have been defined for this tenant."
      />
    </Card>
  );
}
