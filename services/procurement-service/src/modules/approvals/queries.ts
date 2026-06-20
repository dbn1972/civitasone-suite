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

function mapIndentApproval(row: IndentRow): ApprovalSummary {
  return {
    id: row.id,
    referenceId: row.indentNo,
    owner: row.department,
    dueDisplay: formatDueDisplay(row.requiredBy),
  };
}

function mapPoApproval(row: PoRow): ApprovalSummary {
  return {
    id: row.id,
    referenceId: row.poNo,
    owner: `Vendor ${row.vendorId.slice(0, 8)}`,
    dueDisplay: formatDueDisplay(row.deliveryDate),
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
