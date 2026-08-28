import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  wizardDefinitions,
  stepDefinitions,
  stepExecutions,
  type WizardRow,
  type StepDefRow,
  type StepExecRow,
  type WizardInsert,
  type StepDefInsert,
  type StepExecInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// --- Wizard ---

export async function getWizard(wizardId: string, tenantId: string): Promise<WizardRow | null> {
  // TENANT-SCOPING FIX (deep-verification, 2026-08-27): wrapWithTenantGuc only
  // auto-injects SELECT set_config('app.tenant_id', ...) around db.transaction()
  // calls -- a plain db.select() never gets it, even with an active
  // AsyncLocalStorage tenant context (set here by the onRequest hook,
  // createTenantTxHook, in app.ts). Every RLS-protected read in this module
  // was failing with "unrecognized configuration parameter \"app.tenant_id\""
  // (live-reproduced) because none of them went through db.transaction().
  const rows = await db.transaction(async (tx) => {
    return tx
      .select()
      .from(wizardDefinitions)
      .where(and(eq(wizardDefinitions.id, wizardId), eq(wizardDefinitions.tenantId, tenantId)))
      .limit(1);
  });
  return rows[0] ?? null;
}

export async function listWizards(tenantId: string, limit: number, offset: number): Promise<WizardRow[]> {
  // See TENANT-SCOPING FIX note on getWizard() above -- same root cause.
  return db.transaction(async (tx) => {
    return tx
      .select()
      .from(wizardDefinitions)
      .where(eq(wizardDefinitions.tenantId, tenantId))
      .limit(limit)
      .offset(offset);
  });
}

export async function insertWizard(tx: Writer, row: WizardInsert): Promise<void> {
  await tx.insert(wizardDefinitions).values(row);
}

// --- Step Definitions ---

export async function getStepDefinitions(wizardId: string, tenantId: string): Promise<StepDefRow[]> {
  // See TENANT-SCOPING FIX note on getWizard() above -- same root cause.
  return db.transaction(async (tx) => {
    return tx
      .select()
      .from(stepDefinitions)
      .where(and(eq(stepDefinitions.wizardId, wizardId), eq(stepDefinitions.tenantId, tenantId)));
  });
}

export async function insertStepDefinitions(tx: Writer, rows: StepDefInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(stepDefinitions).values(rows);
}

// --- Step Executions ---

export async function getStepExecutions(wizardId: string, tenantId: string): Promise<StepExecRow[]> {
  // See TENANT-SCOPING FIX note on getWizard() above -- same root cause.
  return db.transaction(async (tx) => {
    return tx
      .select()
      .from(stepExecutions)
      .where(and(eq(stepExecutions.wizardId, wizardId), eq(stepExecutions.tenantId, tenantId)));
  });
}

export async function insertStepExecutions(tx: Writer, rows: StepExecInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(stepExecutions).values(rows);
}

export async function upsertStepExecution(
  tx: Writer,
  tenantId: string,
  wizardId: string,
  stepKey: string,
  status: string,
  extra?: { output?: Record<string, unknown>; startedAt?: Date; completedAt?: Date; errorMessage?: string },
): Promise<void> {
  const existing = await (tx as typeof db)
    .select()
    .from(stepExecutions)
    .where(
      and(
        eq(stepExecutions.wizardId, wizardId),
        eq(stepExecutions.stepKey, stepKey),
        eq(stepExecutions.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await (tx as typeof db)
      .update(stepExecutions)
      .set({
        status,
        updatedAt: new Date(),
        ...(extra?.output !== undefined ? { output: extra.output } : {}),
        ...(extra?.startedAt !== undefined ? { startedAt: extra.startedAt } : {}),
        ...(extra?.completedAt !== undefined ? { completedAt: extra.completedAt } : {}),
        ...(extra?.errorMessage !== undefined ? { errorMessage: extra.errorMessage } : {}),
      })
      .where(
        and(
          eq(stepExecutions.wizardId, wizardId),
          eq(stepExecutions.stepKey, stepKey),
          eq(stepExecutions.tenantId, tenantId),
        ),
      );
  } else {
    await tx.insert(stepExecutions).values({
      tenantId,
      wizardId,
      stepKey,
      status,
      output: extra?.output ?? {},
      startedAt: extra?.startedAt ?? null,
      completedAt: extra?.completedAt ?? null,
      errorMessage: extra?.errorMessage ?? null,
      createdBy: "00000000-0000-0000-0000-000000000000",
      updatedBy: "00000000-0000-0000-0000-000000000000",
    });
  }
}

export async function updateStepExecutionStatus(
  tx: Writer,
  tenantId: string,
  wizardId: string,
  stepKey: string,
  status: string,
): Promise<void> {
  await (tx as typeof db)
    .update(stepExecutions)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(stepExecutions.wizardId, wizardId),
        eq(stepExecutions.stepKey, stepKey),
        eq(stepExecutions.tenantId, tenantId),
      ),
    );
}
