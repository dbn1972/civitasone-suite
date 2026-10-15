import type { ApprovalSummary } from "@civitasone/types";
import { cache } from "../../shared/infra.js";
import { fetchUserSummaries } from "../../shared/identity-client.js";
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
    refType: "procurement_indent",
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
    refType: "procurement_po",
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

export const APPROVAL_REF_TYPES = ["procurement_indent", "procurement_po", "procurement_po_amendment"] as const;
export type ApprovalRefType = (typeof APPROVAL_REF_TYPES)[number];

export type ApprovalRefSummary = {
  refType: ApprovalRefType;
  refId: string;
  /** Human reference: indent no, PO no, or "PO-123 / Amendment 2". */
  label: string;
  /** Money in bigint minor units, as a decimal string. */
  amountMinor: string;
  /** Display name of the person who raised the document; absent when unresolved. */
  requestedBy?: string;
  /** Parent PO id for an amendment task, so the queue can link to the PO. */
  poId?: string;
};

/**
 * GAP-PROCUREMENT-APPROVALS-05/07: the workflow task carries only a name and a
 * ref id. This resolves each ref to what an approver needs BEFORE deciding -
 * the document value (never fabricated: absent refs are simply omitted) and
 * requester, plus the parent PO for an amendment. Tenant-scoped; an id from
 * another tenant resolves to nothing.
 */
export async function resolveApprovalRefs(
  tenantId: string,
  refs: Array<{ refType: ApprovalRefType; refId: string }>,
): Promise<ApprovalRefSummary[]> {
  const idsOf = (t: ApprovalRefType) => [...new Set(refs.filter((r) => r.refType === t).map((r) => r.refId))];
  const [indents, pos, amendments] = await Promise.all([
    repo.findIndentsByIds(tenantId, idsOf("procurement_indent")),
    repo.findPosByIds(tenantId, idsOf("procurement_po")),
    repo.findAmendmentsByIds(tenantId, idsOf("procurement_po_amendment")),
  ]);
  const parentPos = await repo.findPosByIds(tenantId, [...new Set(amendments.map((a) => a.poId))]);
  const poById = new Map([...pos, ...parentPos].map((p) => [p.id, p]));
  const userIds = [...indents.map((i) => i.createdBy), ...pos.map((p) => p.createdBy), ...amendments.map((a) => a.requestedBy)];
  const users = userIds.length > 0 ? await fetchUserSummaries(tenantId) : new Map<string, { name: string }>();
  const name = (id: string) => users.get(id)?.name;

  const out: ApprovalRefSummary[] = [];
  for (const i of indents) {
    const requestedBy = name(i.createdBy);
    out.push({ refType: "procurement_indent", refId: i.id, label: i.indentNo, amountMinor: String(i.totalMinor), ...(requestedBy ? { requestedBy } : {}) });
  }
  for (const p of pos) {
    const requestedBy = name(p.createdBy);
    out.push({ refType: "procurement_po", refId: p.id, label: p.poNo, amountMinor: String(p.totalMinor), ...(requestedBy ? { requestedBy } : {}) });
  }
  for (const a of amendments) {
    const requestedBy = name(a.requestedBy);
    const po = poById.get(a.poId);
    out.push({
      refType: "procurement_po_amendment", refId: a.id,
      label: `${po?.poNo ?? "PO"} / Amendment ${a.amendmentNo}`,
      // The value an approver is deciding on is the CHANGE (delta), signed.
      amountMinor: String(a.deltaMinor),
      poId: a.poId,
      ...(requestedBy ? { requestedBy } : {}),
    });
  }
  return out;
}
