import { randomUUID } from "node:crypto";
import type { Writer } from "./repo.js";
import * as repo from "./repo.js";

/** Auto-register DAK from RTI, meetings, compliance — integrated eOffice sections. */
export async function autoRegisterDak(
  tx: Writer,
  msg: { tenantId: string; actorId: string; correlationId: string },
  params: {
    dakNo: string;
    fromAddress: string;
    subject: string;
    sourceSection: "rti" | "meeting" | "compliance" | "legal";
    assignedTo?: string;
  },
): Promise<string> {
  const id = randomUUID();
  const barcode = `DAK-${params.dakNo.replace(/\//g, "-")}`;
  await repo.insertInward(tx, {
    id,
    tenantId: msg.tenantId,
    dakNo: params.dakNo,
    fromAddress: params.fromAddress,
    subject: params.subject,
    assignedTo: params.assignedTo ?? null,
    fileRef: null,
    fileId: null,
    barcode,
    sourceSection: params.sourceSection,
    status: "received",
    createdBy: msg.actorId,
    updatedBy: msg.actorId,
  });
  return id;
}

export function generateDakNo(prefix: string): string {
  const year = new Date().getFullYear();
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `${prefix}/${year}/${seq}`;
}
