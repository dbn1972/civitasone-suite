/**
 * R10 — conditional / partial approval on DFA (CSMOP "levels of disposal").
 * Verifies the modality vocabulary (pure) and that the modality + conditions
 * persist on the DFA record, tenant-scoped.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabDfa, estabDfaVersion } from "../src/modules/dfa/schema.js";
import { insertDfa, updateDfa, findDfaById } from "../src/modules/dfa/repo.js";
import { isApprovalModality, APPROVAL_MODALITIES } from "../src/modules/dfa/domain.js";
import { formatDfaNo } from "../src/modules/dfa/domain.js";

const TENANT_A = "61111111-aaaa-4000-8000-0000000000a1";
const TENANT_B = "61111111-aaaa-4000-8000-0000000000b2";
const DRAFTER  = "00000000-eeee-4000-8000-0000000000c1";
const APPROVER = "00000000-eeee-4000-8000-0000000000c2";

async function clean() {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(estabDfaVersion).where(eq(estabDfaVersion.tenantId, t));
        await tx.delete(estabDfa).where(eq(estabDfa.tenantId, t));
      }),
    );
  }
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("R10 approval modality vocabulary", () => {
  it("accepts the three CSMOP disposal modalities", () => {
    expect(APPROVAL_MODALITIES).toEqual(["approved", "approved_with_conditions", "partially_approved"]);
    expect(isApprovalModality("approved_with_conditions")).toBe(true);
    expect(isApprovalModality("partially_approved")).toBe(true);
    expect(isApprovalModality("rejected")).toBe(false);
    expect(isApprovalModality("")).toBe(false);
  });
});

describe("R10 conditional approval persistence", () => {
  async function seedPending(tenantId: string, id: string) {
    await runWithTenant(tenantId, () =>
      db.transaction((tx) =>
        insertDfa(tx, {
          id, tenantId, dfaNo: formatDfaNo("order", 2026, 1),
          fileId: null, communicationType: "order", templateCode: null,
          subject: "Sanction proposal", body: "Proposed sanction of expenditure",
          recipientEmployeeId: null, recipientName: null, recipientAddress: null,
          status: "pending_approval", createdBy: DRAFTER, updatedBy: DRAFTER,
        }),
      ),
    );
  }

  it("defaults to plain 'approved' modality with no conditions", async () => {
    const id = randomUUID();
    await seedPending(TENANT_A, id);
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => updateDfa(tx, id, { status: "approved", approvedBy: APPROVER, decisionModality: "approved" })),
    );
    const row = await runWithTenant(TENANT_A, () => findDfaById(id, TENANT_A));
    expect(row?.decisionModality).toBe("approved");
    expect(row?.decisionConditions).toBeNull();
  });

  it("records 'approved_with_conditions' and the condition text", async () => {
    const id = randomUUID();
    await seedPending(TENANT_A, id);
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => updateDfa(tx, id, {
        status: "approved", approvedBy: APPROVER,
        decisionModality: "approved_with_conditions",
        decisionConditions: "Subject to availability of budget under HoA 2052",
      })),
    );
    const row = await runWithTenant(TENANT_A, () => findDfaById(id, TENANT_A));
    expect(row?.status).toBe("approved");
    expect(row?.decisionModality).toBe("approved_with_conditions");
    expect(row?.decisionConditions).toContain("HoA 2052");
  });

  it("records a 'partially_approved' disposal", async () => {
    const id = randomUUID();
    await seedPending(TENANT_A, id);
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => updateDfa(tx, id, {
        status: "approved", approvedBy: APPROVER,
        decisionModality: "partially_approved",
        decisionConditions: "Approved for 3 of 5 items",
      })),
    );
    const row = await runWithTenant(TENANT_A, () => findDfaById(id, TENANT_A));
    expect(row?.decisionModality).toBe("partially_approved");
  });
});
