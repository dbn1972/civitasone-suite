import { StatCard, StatGrid, RefreshErrorState } from "@/app/_components/ds";
import { ModuleHub } from "@/app/_components/ModuleHub";
import {
  getInspectionsList,
  getInspectionAssignmentsList,
  getInspectionCapasList,
  type ListResult,
} from "./_data/loaders";
import { toHumanError } from "@/lib/messages";
import type { LoaderResult } from "@/app/_data/apiClient";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/inspection/inspections", label: "Inspections", note: "Execution records and history." },
  { href: "/inspection/assignments", label: "Assignments", note: "Inspector assignments and tour plans." },
  { href: "/inspection/capa", label: "CAPA", note: "Corrective and preventive actions." },
];

/**
 * GAP-INSPECTION-HOME-01/02: a card's value is "—" (not a reassuring 0) when
 * that loader failed, the real `meta.total` when the service sent one, and
 * "N+" when only a page-capped row count is known (total unknown but the page
 * is full). StatCard already renders null/undefined as "—".
 */
function cardValue(result: LoaderResult<ListResult>): string | undefined {
  if (result.source === "error") return undefined;
  const { rows, total } = result.data;
  if (total !== null) return String(total);
  // No total from the service: a full page means "at least this many".
  return rows.length >= 50 ? "50+" : String(rows.length);
}

export default async function InspectionHubPage() {
  const [inspections, assignments, capas] = await Promise.all([
    getInspectionsList(),
    getInspectionAssignmentsList(),
    getInspectionCapasList(),
  ]);
  const anyErrored =
    inspections.source === "error" || assignments.source === "error" || capas.source === "error";

  return (
    <ModuleHub
      title="Inspection"
      description="Plans, assignments, inspections and corrective actions."
      links={LINKS}
      help="inspection"
    >
      {anyErrored && (
        <RefreshErrorState
          error={toHumanError("load", { area: "inspection summary" })}
          backHref="/dashboard"
        />
      )}
      <StatGrid>
        <StatCard icon="🔎" tone="info" label="Inspections" value={cardValue(inspections)} />
        <StatCard icon="👷" tone="good" label="Assignments" value={cardValue(assignments)} />
        <StatCard icon="🛠️" tone="warn" label="CAPA" value={cardValue(capas)} />
      </StatGrid>
    </ModuleHub>
  );
}
