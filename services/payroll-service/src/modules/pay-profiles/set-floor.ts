/**
 * PAY-PROFILES: the explicit, reviewed operations step that switches on the
 * 7th CPC HRA minimum floor (nothing is seeded by migration 0054).
 *
 * Writes one effective-dated allowance-rule row -- for the PLATFORM default
 * (sentinel tenant, every tenant inherits it) or for one tenant -- with an
 * explicit effective month, and audits it. Refuses:
 *  - an effective month that is not strictly AFTER the current month in IST
 *    (the current month may already be in a payroll run; a past one may be paid);
 *  - for a tenant, a month at or before its last locked (approved/disbursed)
 *    payroll month;
 *  - a second row for the same scope and month.
 * The platform default cannot see per-tenant locks (RLS), so its effective
 * month must be chosen after reviewing report:hra-floor-impact per tenant.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { audit } from "../payroll/consumer.js";
import { PLATFORM_TENANT_ID } from "./allowance-rules.js";
import { lockedThroughMonth } from "./rules-api.js";

export interface SetHraFloorInput {
  /** null == platform default. */
  tenantId: string | null;
  effectiveMonth: string;   // YYYY-MM
  xMinor: bigint;
  yMinor: bigint;
  zMinor: bigint;
  reason: string;
  actorId: string;
  /** Current calendar month in IST (YYYY-MM) -- see currentMonthIst(); injectable for tests. */
  currentMonth: string;
}

/** The calendar month (YYYY-MM) in India Standard Time (UTC+05:30) at `now`. */
export function currentMonthIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 7);
}

export class SetHraFloorError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "SetHraFloorError";
  }
}

export async function setHraFloor(i: SetHraFloorInput): Promise<{ id: string; scope: "platform" | "tenant"; effectiveFrom: string }> {
  if (!/^\d{4}-\d{2}$/.test(i.effectiveMonth)) throw new SetHraFloorError("INVALID_MONTH", "effective month must be YYYY-MM");
  if (i.effectiveMonth <= i.currentMonth) {
    throw new SetHraFloorError("MONTH_NOT_IN_FUTURE", `effective month ${i.effectiveMonth} must be after the current month ${i.currentMonth} (IST)`);
  }
  for (const v of [i.xMinor, i.yMinor, i.zMinor]) {
    if (v < 0n || v > 100_000_000n) throw new SetHraFloorError("INVALID_AMOUNT", "floors must be between 0 and 10,00,000 rupees (paise)");
  }
  if (i.reason.trim().length < 10) throw new SetHraFloorError("REASON_REQUIRED", "a change reason of at least 10 characters is required");
  const scopeTenant = i.tenantId ?? PLATFORM_TENANT_ID;
  const effectiveFrom = `${i.effectiveMonth}-01`;
  const id = randomUUID();
  await runWithTenant(scopeTenant, () => db.transaction(async (tx) => {
    if (i.tenantId) {
      const locked = await lockedThroughMonth(tx, i.tenantId);
      if (locked && i.effectiveMonth <= locked) throw new SetHraFloorError("PERIOD_LOCKED", `payroll is locked through ${locked}`);
    }
    const inserted = (await tx.execute(sql`
      INSERT INTO statutory.allowance_rule_config
        (id, tenant_id, effective_from, hra_floor_x_minor, hra_floor_y_minor, hra_floor_z_minor, change_reason, created_by)
      VALUES (${id}::uuid, ${scopeTenant}::uuid, ${effectiveFrom}::date,
              ${i.xMinor.toString()}::bigint, ${i.yMinor.toString()}::bigint, ${i.zMinor.toString()}::bigint,
              ${i.reason}, ${i.actorId}::uuid)
      ON CONFLICT (tenant_id, effective_from) DO NOTHING
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    if (inserted.length === 0) throw new SetHraFloorError("RULES_EXIST_FOR_DATE", `an allowance-rule row already takes effect on ${effectiveFrom} for this scope`);
    await audit(tx, { tenantId: scopeTenant, actorId: i.actorId, correlationId: `set-hra-floor:${id}` }, "create", "allowance_rule_config", id, {
      scope: i.tenantId ? "tenant" : "platform", effectiveFrom, changeReason: i.reason,
      after: { hraFloorMinor: { X: i.xMinor.toString(), Y: i.yMinor.toString(), Z: i.zMinor.toString() } },
    });
  }));
  return { id, scope: i.tenantId ? "tenant" : "platform", effectiveFrom };
}
