import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { isEditable } from "./domain.js";
import { getEmployeeDisplayMap, type EmployeeDisplay } from "../../shared/hrms-client.js";
import type { DfaRow } from "./schema.js";

export type DfaDto = {
  id: string;
  dfaNo: string;
  fileId: string | null;
  /** Number of the linked eOffice file (GAP-ESTAB-DFA-04); null when unlinked or not found. */
  fileNo: string | null;
  communicationType: string;
  templateCode: string | null;
  subject: string;
  body: string;
  recipientEmployeeId: string | null;
  recipientName: string | null;
  recipientAddress: string | null;
  status: string;
  editable: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  decisionModality: string;
  decisionConditions: string | null;
  returnedReason: string | null;
  signedBy: string | null;
  signedAt: string | null;
  signatureRef: string | null;
  dispatchId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Drafter (JWT sub). Lets the UI hide Approve/Sign for the maker (GAP-ESTAB-DFA-02). */
  createdBy: string;
  /** Drafter's display name (GAP-ESTAB-DFA-04). Null when unresolvable; the web shows "Unknown employee", never the id. */
  createdByName: string | null;
};

function toDto(r: DfaRow, employees: Map<string, EmployeeDisplay> = new Map(), fileNos: Map<string, string> = new Map()): DfaDto {
  return {
    id: r.id,
    dfaNo: r.dfaNo,
    fileId: r.fileId,
    fileNo: r.fileId ? (fileNos.get(r.fileId) ?? null) : null,
    communicationType: r.communicationType,
    templateCode: r.templateCode,
    subject: r.subject,
    body: r.body,
    recipientEmployeeId: r.recipientEmployeeId,
    recipientName: r.recipientName,
    recipientAddress: r.recipientAddress,
    status: r.status,
    editable: isEditable(r.status),
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    decisionModality: r.decisionModality,
    decisionConditions: r.decisionConditions,
    returnedReason: r.returnedReason,
    signedBy: r.signedBy,
    signedAt: r.signedAt?.toISOString() ?? null,
    signatureRef: r.signatureRef,
    dispatchId: r.dispatchId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: r.createdBy,
    createdByName: employees.get(r.createdBy)?.fullName ?? null,
  };
}

/** `withNames` adds the drafter's display name (one hrms lookup); the maker-checker guard doesn't need it. */
export async function getDfa(tenantId: string, id: string, opts: { withNames?: boolean } = {}): Promise<DfaDto | null> {
  const row = await cache.getOrLoad<DfaRow>(
    cache.makeKey(tenantId, "dfa", id),
    () => repo.findDfaById(id, tenantId),
  );
  if (!row) return null;
  return toDto(
    row,
    opts.withNames ? await getEmployeeDisplayMap(tenantId, [row.createdBy]) : undefined,
    opts.withNames && row.fileId ? await repo.fileNosByIds(tenantId, [row.fileId]) : undefined,
  );
}

export async function listDfa(
  tenantId: string,
  filter: { status?: string | undefined; fileId?: string | undefined },
  limit: number,
): Promise<DfaDto[]> {
  const rows = await repo.listDfa(tenantId, filter, limit);
  // GAP-ESTAB-DFA-04: "Drafted by" shows a name; one batched, tenant-scoped lookup per page.
  const employees = await getEmployeeDisplayMap(tenantId, rows.map((r) => r.createdBy));
  const fileNos = await repo.fileNosByIds(tenantId, rows.flatMap((r) => (r.fileId ? [r.fileId] : [])));
  return rows.map((r) => toDto(r, employees, fileNos));
}

export type DfaVersionDto = {
  revNo: number;
  subject: string;
  body: string;
  comment: string | null;
  createdAt: string;
  createdBy: string;
};

export async function listDfaVersions(tenantId: string, dfaId: string): Promise<DfaVersionDto[]> {
  const rows = await repo.listDfaVersions(dfaId, tenantId);
  return rows.map((r) => ({
    revNo: r.revNo, subject: r.subject, body: r.body, comment: r.comment,
    createdAt: r.createdAt.toISOString(), createdBy: r.createdBy,
  }));
}
