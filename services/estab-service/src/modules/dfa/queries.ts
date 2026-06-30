import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { isEditable } from "./domain.js";
import type { DfaRow } from "./schema.js";

export type DfaDto = {
  id: string;
  dfaNo: string;
  fileId: string | null;
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
};

function toDto(r: DfaRow): DfaDto {
  return {
    id: r.id,
    dfaNo: r.dfaNo,
    fileId: r.fileId,
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
  };
}

export async function getDfa(tenantId: string, id: string): Promise<DfaDto | null> {
  const row = await cache.getOrLoad<DfaRow>(
    cache.makeKey(tenantId, "dfa", id),
    () => repo.findDfaById(id, tenantId),
  );
  return row ? toDto(row) : null;
}

export async function listDfa(
  tenantId: string,
  filter: { status?: string | undefined; fileId?: string | undefined },
  limit: number,
): Promise<DfaDto[]> {
  const rows = await repo.listDfa(tenantId, filter, limit);
  return rows.map(toDto);
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
