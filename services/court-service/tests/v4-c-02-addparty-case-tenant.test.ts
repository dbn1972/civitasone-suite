/**
 * V4-C-02: addParty must verify the URL case id exists in the caller tenant
 * BEFORE publishing; otherwise a registrar can attach a PII party row to
 * another tenant case id (FK checks bypass RLS) and probe case-id existence.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const publishSpy = vi.fn(async () => {});
vi.mock("../src/shared/infra.js", () => ({ queue: { publish: (...a: unknown[]) => publishSpy(...a) } }));

let caseRows: unknown[] = [];
const whereSpy = vi.fn();
function chain(): unknown {
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.select = self; b.from = self; b.limit = self; b.orderBy = self;
  b.where = (...a: unknown[]) => { whereSpy(...a); return b; };
  b.then = (res: (v: unknown) => void, rej?: (e: unknown) => void) => Promise.resolve(caseRows).then(res, rej);
  return b;
}
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(chain()) },
  sqlClient: {},
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn(chain()),
}));

const ctx = () => ({ tenantId: randomUUID(), actorId: randomUUID(), correlationId: randomUUID() }) as never;

describe("V4-C-02 addParty case pre-check", () => {
  beforeEach(() => { publishSpy.mockClear(); whereSpy.mockClear(); });

  it("rejects CASE_NOT_FOUND and does not publish when the case is not in the caller tenant", async () => {
    caseRows = [];
    const { addParty } = await import("../src/modules/party/commands.js");
    await expect(addParty(ctx(), randomUUID(), { partyRole: "petitioner", name: "A. Rao" }))
      .rejects.toMatchObject({ code: "CASE_NOT_FOUND" });
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("publishes when the case exists in the caller tenant", async () => {
    caseRows = [{ status: "registered", version: 1 }];
    const { addParty } = await import("../src/modules/party/commands.js");
    const r = await addParty(ctx(), randomUUID(), { partyRole: "petitioner", name: "A. Rao" });
    expect(r.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});
