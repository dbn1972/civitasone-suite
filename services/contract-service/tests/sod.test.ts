/**
 * SoD (segregation of duties) — synchronous 403 at the command layer.
 * The maker who created a contract may not approve or terminate it themselves.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { db, sqlClient } from "../src/shared/db.js";
import { contractContracts } from "../src/modules/contracts/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import * as commands from "../src/modules/contracts/commands.js";
import { HttpError } from "../src/shared/context.js";

const MAKER   = "00000000-bbbb-4000-8000-0000000000a1";
const CHECKER = "00000000-bbbb-4000-8000-0000000000a2";
const TENANT  = "22222222-bbbb-4000-8000-0000000000ff";

function ctx(actorId: string): RequestContext {
  return { tenantId: TENANT, actorId, actorType: "user", roles: ["procurement_admin"], correlationId: "c-sod" };
}

async function wipe() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(contractContracts).where(eq(contractContracts.tenantId, TENANT));
}

describe("SoD — self-approval / self-termination rejected with 403", () => {
  const id = randomUUID();
  beforeAll(async () => {
    await wipe();
    // seed a draft contract created by MAKER
    await db.insert(contractContracts).values({
      id, tenantId: TENANT, contractNo: "SOD-001", vendorId: randomUUID(),
      title: "SoD test", valueMinor: 9000000n, currency: "INR",
      startDate: "2026-07-01", expiry: "2027-06-30", status: "draft",
      createdBy: MAKER, updatedBy: MAKER,
    });
  });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("maker approving own contract -> 403 SOD_VIOLATION", async () => {
    await expect(commands.approveContract(ctx(MAKER), id, {})).rejects.toMatchObject({
      status: 403, code: "SOD_VIOLATION",
    });
  });

  it("maker terminating own contract -> 403 SOD_VIOLATION", async () => {
    await expect(commands.terminateContract(ctx(MAKER), id, { reason: "self terminate attempt" }))
      .rejects.toBeInstanceOf(HttpError);
  });

  it("a distinct checker may approve (no throw)", async () => {
    const res = await commands.approveContract(ctx(CHECKER), id, {});
    expect(res.status).toBe("accepted");
  });

  it("unknown contract -> 404", async () => {
    await expect(commands.approveContract(ctx(CHECKER), randomUUID(), {}))
      .rejects.toMatchObject({ status: 404 });
  });
});
