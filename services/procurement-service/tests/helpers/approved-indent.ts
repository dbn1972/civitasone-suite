/**
 * UAT T-EDGE bundle 21 (TE-04 P08): PO create now refuses, synchronously, a PO whose indent does
 * not exist, is not approved, or has no headroom (422 INDENT_NOT_FOUND / INDENT_NOT_APPROVED /
 * INDENT_BUDGET_EXCEEDED). Tests that exercise OTHER PO rules and expect a 202 cite a real
 * approved indent created with this helper (idempotent per id).
 */
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../src/shared/db.js";
import { procurementIndents } from "../../src/modules/indent/schema.js";

/** Insert (or keep) an approved indent with ample headroom; returns its `procurement_indent:<id>` ref. */
export async function seedApprovedIndent(tenantId: string, id: string = randomUUID(), totalMinor = 1_000_000_000_000n): Promise<string> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(procurementIndents).values({
      id, tenantId, indentNo: `IND/TEST/${id.slice(0, 8)}`, department: "Stores", purpose: "test indent (approved)",
      totalMinor, committedMinor: 0n, status: "approved", createdBy: id, updatedBy: id,
    }).onConflictDoNothing();
  }));
  return `procurement_indent:${id}`;
}
