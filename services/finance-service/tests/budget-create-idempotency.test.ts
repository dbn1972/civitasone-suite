import { describe, it, expect, vi, beforeEach } from "vitest";

const publish = vi.fn(async () => undefined);
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: unknown[]) => publish(...(a as [])) },
  cache: { invalidateResource: vi.fn(async () => undefined), invalidate: vi.fn(), makeKey: vi.fn() },
}));
vi.mock("../src/shared/db.js", () => ({ db: {} }));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));
vi.mock("../src/modules/budget/repo.js", () => ({ findHeadByIdAndTenant: vi.fn(async () => ({ id: "h", code: "3054", classification: "expense" })) }));
vi.mock("../src/modules/budget/domain.js", async (orig) => ({ ...(await orig<object>()), assertBudgetableHead: () => undefined }));

import { createBudget } from "../src/modules/budget/commands.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ctx = (key?: string) => ({ tenantId: TENANT, actorId: "a", correlationId: "c", roles: [], ...(key ? { idempotencyKey: key } : {}) }) as never;
const body = { headId: "22222222-2222-4222-8222-222222222222", fy: "2026-27", beMinor: "1000" };
const publishedId = () => (publish.mock.calls.at(-1) as unknown as [string, { messageId: string }])[1].messageId;

describe("createBudget idempotency", () => {
  beforeEach(() => publish.mockClear());

  it("same key + same proposal -> same messageId (a retry dedupes)", async () => {
    await createBudget(ctx("k1"), body);
    const first = publishedId();
    await createBudget(ctx("k1"), body);
    expect(publishedId()).toBe(first);
  });

  it("same key but a different head/FY/amount is a NEW command", async () => {
    await createBudget(ctx("k1"), body);
    const first = publishedId();
    await createBudget(ctx("k1"), { ...body, beMinor: "2000" });
    expect(publishedId()).not.toBe(first);
    await createBudget(ctx("k1"), { ...body, fy: "2027-28" });
    expect(publishedId()).not.toBe(first);
  });

  it("different keys differ; no key is a fresh random id each time", async () => {
    await createBudget(ctx("k1"), body); const a = publishedId();
    await createBudget(ctx("k2"), body); expect(publishedId()).not.toBe(a);
    await createBudget(ctx(), body); const r1 = publishedId();
    await createBudget(ctx(), body); expect(publishedId()).not.toBe(r1);
  });

  it("the returned id equals the published messageId", async () => {
    const res = await createBudget(ctx("k1"), body);
    expect(res.id).toBe(publishedId());
  });
});
