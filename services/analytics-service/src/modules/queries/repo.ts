import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { queryRuns, type QueryRunRow, type QueryRunInsert, type QueryRunView } from "./schema.js";
export function toView(r: QueryRunRow): QueryRunView {
  return { id: r.id, tenantId: r.tenantId, dashboardId: r.dashboardId, queryName: r.queryName, status: r.status, resultRows: r.resultRows, version: r.version };
}
export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export async function insert(tx: Writer, row: QueryRunInsert): Promise<void> {
  await tx.insert(queryRuns).values(row);
}
export async function complete(tx: Writer, id: string, resultRows: number, actorId: string): Promise<void> {
  await tx.update(queryRuns).set({ status: "completed", resultRows, updatedBy: actorId, updatedAt: new Date() }).where(eq(queryRuns.id, id));
}
