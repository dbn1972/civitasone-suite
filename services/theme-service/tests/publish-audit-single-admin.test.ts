/**
 * GAP-THEMES-TOKENS-02 / owner decision #34 (2026-10-26): for UAT a single
 * theme admin may publish (no second approver), but every publish MUST emit an
 * audit event carrying the actor, the mandatory reason and the version, in the
 * SAME transaction as the revision insert. A second approver before production
 * is a recorded follow-up (docs/gap-ledger/themes.md), deliberately not built.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({ enqueue: vi.fn(), selects: [] as unknown[][], inserted: [] as unknown[] }));

vi.mock("@civitasone/db", () => ({ setTenantGuc: vi.fn(async () => {}) }));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: (...a: unknown[]) => H.enqueue(...a) }));
vi.mock("../src/shared/db.js", () => {
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy", "limit", "values"]) c[k] = () => c;
    c.returning = async () => result();
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return c;
  };
  const tx = {
    execute: async () => [],
    select: () => chain(() => H.selects.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        H.inserted.push(v);
        return chain(() => [{ ...v, id: "11111111-1111-4111-8111-111111111111", publishedAt: new Date("2026-10-26T00:00:00Z"), createdAt: new Date(), updatedAt: new Date() }]);
      },
    }),
  };
  return { db: { transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx) }, sqlClient: { end: async () => {} } };
});

import { publish } from "../src/modules/tokens/revision-repo.js";

const TENANT = "aaaaaaaa-9999-4000-8000-000000000777";
const ADMIN = "aaaaaaaa-9999-4000-8000-00000000aaaa";

beforeEach(() => {
  H.enqueue.mockReset();
  H.inserted.length = 0;
  H.selects.length = 0;
});

describe("single-admin publish with audit (decision #34)", () => {
  it("one admin publishes with no second approver and the audit event carries actor + reason + version", async () => {
    H.selects.push([], [{ name: "color.primary", value: "#0a5" }]); // latest version (none), token snapshot
    const rev = await publish({ tenantId: TENANT, actorId: ADMIN, correlationId: "c-1", name: "UAT theme", reason: "UAT release look" });
    expect(rev.version).toBe(1);
    expect(H.enqueue).toHaveBeenCalledTimes(1);
    const evt = H.enqueue.mock.calls[0]![1] as Record<string, any>;
    expect(evt.actorId).toBe(ADMIN);
    expect(evt.tenantId).toBe(TENANT);
    expect(evt.payload).toMatchObject({ service: "themes", action: "publish", resourceType: "revision", outcome: "success", reason: "UAT release look", version: 1, tokenCount: 1 });
  });

  it("the same admin can publish again (no maker-checker gate for UAT)", async () => {
    H.selects.push([{ version: 1 }], []);
    const rev = await publish({ tenantId: TENANT, actorId: ADMIN, correlationId: "c-2", name: "UAT theme v2", reason: "tweak" });
    expect(rev.version).toBe(2);
    expect(H.enqueue).toHaveBeenCalledTimes(1);
  });
});
