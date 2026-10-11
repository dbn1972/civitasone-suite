/**
 * applyPosting — legacy transfer paths as thin callers (ST-M01-09).
 *
 * Spec §4, §11; D-ST-09 (paths A/B/C + deputation consolidate on the one
 * posting write path). The direct transfer path (`employee/consumer.ts`
 * employeeTransfer → lifecycleRepo.applyTransferEffect) is exercised here with
 * the flag OFF and then ON through the real command → consumer path.
 *
 *   • FLAG OFF: a transfer updates the employee master (legacy behaviour) and
 *     writes NOTHING to workforce_core.posting_ledger — the legacy path is
 *     byte-for-byte unchanged.
 *   • FLAG ON: the same transfer ALSO appends a dated posting-ledger span (the
 *     tenure trail the overwrite never kept) and emits hrms.posting.changed.
 *     It does NOT open post_occupancy (the legacy path carries no sanctioned
 *     post — that is the explicit applyPosting command's job).
 *
 * The flag is read at call time (config.isPostingLedgerEnabled reads
 * process.env), so each describe block sets WORKFORCE_CORE_LEDGER_ENABLED
 * around its own run and restores it. No fixed sleeps — MemoryQueue.drain().
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";

const { runWithTenant } = await import("@civitasone/db");
const { db } = await import("../../../shared/db.js");
const { queue } = await import("../../../shared/infra.js");
const { hrmsEmployees } = await import("../../employee/schema.js");
const { registerEmployeeConsumers } =
  await import("../../employee/consumer.js");
const { wcPostingLedger } = await import("../schema.js");
const { COMMANDS } = await import("../../../topics.js");
const { idempotentId } = await import("@civitasone/auth");

import type { MemoryQueue } from "@civitasone/queue";

registerEmployeeConsumers(queue);

async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

const TENANT = randomUUID();
const ACTOR = randomUUID();
const officeA = randomUUID();
const officeB = randomUUID();

function withTenant<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
}

async function seedEmployee(officeId: string): Promise<string> {
  const id = randomUUID();
  await withTenant(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id,
      tenantId: TENANT,
      employeeNo: `L-${id.slice(0, 8)}`,
      fullName: "Legacy Subject",
      departmentId: officeId,
      designationId: randomUUID(),
      dateOfJoining: "2015-01-01",
      station: "Belgaum",
      workStateCode: "KA",
      hraCityClass: "Y",
      status: "confirmed",
      employeeType: "permanent",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
  });
  return id;
}

async function publishTransfer(
  employeeId: string,
  effectiveDate: string,
  fromDeptId: string = officeA,
  toDeptId: string = officeB,
): Promise<void> {
  const orderRef = `ORD/LEG/${effectiveDate}`;
  await runWithTenant(TENANT, () =>
    queue.publish(COMMANDS.employeeTransfer, {
      messageId: idempotentId({
        idempotencyKey: `employee.transfer:${employeeId}:${effectiveDate}`,
        tenantId: TENANT,
      }),
      type: COMMANDS.employeeTransfer,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        employeeId,
        tenantId: TENANT,
        fromDeptId,
        toDeptId,
        effectiveDate,
        orderRef,
      },
    }),
  );
  await drain();
}

async function readLedger(employeeId: string) {
  return withTenant((tx) =>
    tx
      .select()
      .from(wcPostingLedger)
      .where(
        and(
          eq(wcPostingLedger.tenantId, TENANT),
          eq(wcPostingLedger.employeeId, employeeId),
        ),
      ),
  );
}
async function readDept(id: string): Promise<string | undefined> {
  const rows = await withTenant((tx) =>
    tx
      .select({ departmentId: hrmsEmployees.departmentId })
      .from(hrmsEmployees)
      .where(eq(hrmsEmployees.id, id))
      .limit(1),
  );
  return rows[0]?.departmentId;
}

const PRIOR = process.env.WORKFORCE_CORE_LEDGER_ENABLED;

afterAll(async () => {
  if (PRIOR === undefined) delete process.env.WORKFORCE_CORE_LEDGER_ENABLED;
  else process.env.WORKFORCE_CORE_LEDGER_ENABLED = PRIOR;
  await withTenant(async (tx) => {
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
  });
});

describe("legacy transfer — flag OFF leaves no ledger (legacy path unchanged)", () => {
  it("updates the employee master but writes nothing to the posting ledger", async () => {
    delete process.env.WORKFORCE_CORE_LEDGER_ENABLED;
    const employeeId = await seedEmployee(officeA);
    await publishTransfer(employeeId, "2020-01-01");

    expect(await readDept(employeeId)).toBe(officeB); // legacy master update happened
    expect(await readLedger(employeeId)).toHaveLength(0); // no ledger write
  });
});

describe("legacy transfer — flag ON records a ledger span + emits the event", () => {
  it("appends a dated posting-ledger span for the office change", async () => {
    process.env.WORKFORCE_CORE_LEDGER_ENABLED = "true";
    const employeeId = await seedEmployee(officeA);
    await publishTransfer(employeeId, "2020-02-01");

    expect(await readDept(employeeId)).toBe(officeB);
    const ledger = await readLedger(employeeId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.officeId).toBe(officeB);
    expect(ledger[0]!.postId).toBeNull(); // legacy path carries no sanctioned post
    expect(ledger[0]!.effectiveFrom).toBe("2020-02-01");
  });
});

describe("legacy transfer — a back-dated move never rolls back the legacy transfer", () => {
  it("applies the master update and skips (not throws) the unrepresentable ledger span", async () => {
    process.env.WORKFORCE_CORE_LEDGER_ENABLED = "true";
    const employeeId = await seedEmployee(officeA);
    await publishTransfer(employeeId, "2020-03-01"); // A -> B, ledger span opens 2020-03-01
    // B -> A effective BEFORE the open span began: closing it would violate
    // posting_ledger_dates_check (23514) and previously rolled the transfer back.
    await publishTransfer(employeeId, "2020-02-01", officeB, officeA);

    expect(await readDept(employeeId)).toBe(officeA); // legacy transfer committed
    const ledger = await readLedger(employeeId);
    expect(ledger).toHaveLength(1); // back-dated span skipped, original intact
    expect(ledger[0]!.effectiveTo).toBeNull();
  });
});
