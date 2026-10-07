import type { ApprovalSummary } from "@civitasone/types";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { IndentRow } from "../indent/schema.js";
import type { PoRow } from "../po/schema.js";

function formatDueDisplay(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// GAP-PROCUREMENT-APPROVALS-04: emit an ISO due timestamp alongside the
// display string so the web can compute overdue/due-today by date rather than
// substring-matching localised copy. Returns undefined when the row has no
// usable due date (so the schema's optional field is simply omitted).
function toDueAt(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function mapIndentApproval(row: IndentRow): ApprovalSummary {
  const dueAt = toDueAt(row.requiredBy);
  return {
    id: row.id,
    referenceId: row.indentNo,
    owner: row.department,
    dueDisplay: formatDueDisplay(row.requiredBy),
    ...(dueAt ? { dueAt } : {}),
  };
}

function mapPoApproval(row: PoRow): ApprovalSummary {
  const dueAt = toDueAt(row.deliveryDate);
  return {
    id: row.id,
    referenceId: row.poNo,
    owner: `Vendor ${row.vendorId.slice(0, 8)}`,
    dueDisplay: formatDueDisplay(row.deliveryDate),
    ...(dueAt ? { dueAt } : {}),
  };
}

export async function listApprovals(tenantId: string): Promise<{ data: ApprovalSummary[] }> {
  const rows = await cache.getOrLoad<{ data: ApprovalSummary[] }>(
    cache.makeKey(tenantId, "approvals", "list"),
    async () => {
      const [indents, pos] = await Promise.all([
        repo.findPendingIndentsByTenant(tenantId),
        repo.findDraftPosByTenant(tenantId),
      ]);
      return {
        data: [...indents.map(mapIndentApproval), ...pos.map(mapPoApproval)],
      };
    },
  );
  return rows ?? { data: [] };
}
