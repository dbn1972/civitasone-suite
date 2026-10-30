/**
 * visitor-service: recurring-pass reads.
 *
 * UAT W8-B: the revoke route used to publish without reading its target, so a random id got 202.
 * This is the tenant-scoped existence read it now does first. It selects the id only, so no
 * encrypted PII column is decrypted for a yes/no answer. scopedRead() sets the RLS tenant GUC.
 */
import { and, eq } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { recurringPasses } from "./schema.js";

export async function recurringPassExists(tenantId: string, id: string): Promise<boolean> {
  const rows = await scopedRead((tx) =>
    tx.select({ id: recurringPasses.id }).from(recurringPasses)
      .where(and(eq(recurringPasses.id, id), eq(recurringPasses.tenantId, tenantId)))
      .limit(1));
  return rows.length > 0;
}
