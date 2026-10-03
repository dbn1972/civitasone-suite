/**
 * GAP-FINANCE-BUDGET-DEMAND-GRANTS-04 — head-wise lines of a demand for grants.
 * Schema (budget.finance_demand_lines, migration 0089), pure domain and repo for
 * the demand drill-down. A demand's lines are replaced as a set and must total
 * the demand amount exactly.
 */
import { pgSchema, uuid, text, bigint, timestamp } from "drizzle-orm/pg-core";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { financeDemands, financeHeads, type DemandRow } from "./schema.js";

const budgetNs = pgSchema("budget");

export const financeDemandLines = budgetNs.table("finance_demand_lines", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  demandId:    uuid("demand_id").notNull(),
  headId:      uuid("head_id"),
  headCode:    text("head_code").notNull(),
  headName:    text("head_name"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});
export type DemandLineRow = typeof financeDemandLines.$inferSelect;

export class DemandLinesError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DemandLinesError";
  }
}

/** Only a draft demand's head-wise split may be edited. */
export const DEMAND_LINES_EDITABLE_STATUSES: readonly string[] = ["draft"];

export type DemandLineInput = { headCode: string; amountMinor: bigint };

/**
 * Lines must be non-empty, each positive, with distinct head codes, and total
 * exactly the demand amount (so the drill-down always reconciles).
 */
export function assertDemandLinesValid(demandAmountMinor: bigint, lines: readonly DemandLineInput[]): void {
  if (lines.length === 0) throw new DemandLinesError("NO_LINES", "at least one head-wise line is required");
  const seen = new Set<string>();
  let total = 0n;
  for (const l of lines) {
    if (l.amountMinor <= 0n) throw new DemandLinesError("INVALID_LINE_AMOUNT", `line for head ${l.headCode} must be positive`);
    if (seen.has(l.headCode)) throw new DemandLinesError("DUPLICATE_HEAD", `head ${l.headCode} appears more than once`);
    seen.add(l.headCode);
    total += l.amountMinor;
  }
  if (total !== demandAmountMinor) {
    throw new DemandLinesError("LINES_TOTAL_MISMATCH", `lines total ${total} paise but the demand is ${demandAmountMinor} paise`);
  }
}

export function assertDemandEditable(status: string): void {
  if (!DEMAND_LINES_EDITABLE_STATUSES.includes(status)) {
    throw new DemandLinesError("DEMAND_NOT_EDITABLE", `head-wise lines can only be edited while the demand is draft (it is ${status})`);
  }
}

export async function findDemandForTenant(tenantId: string, id: string): Promise<DemandRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeDemands)
    .where(and(eq(financeDemands.tenantId, tenantId), eq(financeDemands.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listDemandLines(tenantId: string, demandId: string): Promise<DemandLineRow[]> {
  return scopedRead((tx) => tx.select().from(financeDemandLines)
    .where(and(eq(financeDemandLines.tenantId, tenantId), eq(financeDemandLines.demandId, demandId)))
    .orderBy(asc(financeDemandLines.headCode)));
}

/** Major (level 0) heads for these codes; used to validate and name each line. */
export async function findMajorHeadsByCode(tenantId: string, codes: string[], tx?: Pick<typeof db, "select">) {
  if (codes.length === 0) return [];
  const where = and(
    eq(financeHeads.tenantId, tenantId),
    eq(financeHeads.level, 0),
    sql`${financeHeads.code} IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`,
  );
  const cols = { id: financeHeads.id, code: financeHeads.code, name: financeHeads.name };
  return tx
    ? await tx.select(cols).from(financeHeads).where(where)
    : await scopedRead((t) => t.select(cols).from(financeHeads).where(where));
}

/**
 * Replace the demand's lines inside the caller's transaction. The demand row is
 * locked FOR UPDATE and re-checked (status + amount) so two concurrent edits, or
 * an edit racing a status change, cannot both apply.
 */
export async function replaceDemandLinesTx(
  tx: Pick<typeof db, "select" | "insert" | "delete" | "execute">,
  args: { tenantId: string; demandId: string; actorId: string; lines: DemandLineInput[] },
): Promise<{ count: number }> {
  const locked = (await tx.execute(sql`
    SELECT amount_minor::text AS amount_minor, status FROM budget.finance_demands
    WHERE id = ${args.demandId}::uuid AND tenant_id = ${args.tenantId}::uuid FOR UPDATE
  `)) as unknown as Array<{ amount_minor: string; status: string }>;
  const demand = locked[0];
  if (!demand) throw new DemandLinesError("NOT_FOUND", "demand not found");
  assertDemandEditable(demand.status);
  assertDemandLinesValid(BigInt(demand.amount_minor), args.lines);

  const heads = await findMajorHeadsByCode(args.tenantId, args.lines.map((l) => l.headCode), tx);
  const byCode = new Map(heads.map((h) => [h.code, h]));
  for (const l of args.lines) {
    if (!byCode.has(l.headCode)) throw new DemandLinesError("UNKNOWN_HEAD", `${l.headCode} is not a major head`);
  }
  await tx.delete(financeDemandLines).where(and(
    eq(financeDemandLines.tenantId, args.tenantId), eq(financeDemandLines.demandId, args.demandId),
  ));
  await tx.insert(financeDemandLines).values(args.lines.map((l) => ({
    tenantId: args.tenantId, demandId: args.demandId, headId: byCode.get(l.headCode)!.id,
    headCode: l.headCode, headName: byCode.get(l.headCode)!.name, amountMinor: l.amountMinor, createdBy: args.actorId,
  })));
  return { count: args.lines.length };
}
