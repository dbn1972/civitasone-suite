import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { handleGlobalSearchEvent } from "../src/modules/search/global-consumer.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const E = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function port() {
  return { initialize: vi.fn().mockResolvedValue(undefined), upsert: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) };
}
const ready = async () => undefined;
const ev = (over: Record<string, unknown> = {}, tenantId = A) => ({
  tenantId, messageId: randomUUID(),
  payload: { id: E, tenantId: A, module: "finance", name: "Acme Traders", refNumber: "V-1", description: null, status: "active", action: "upsert", entityType: "finance.vendor", ...over },
});

describe("global search consumer", () => {
  const saved = { ...process.env };
  beforeEach(() => { process.env.GLOBAL_SEARCH_TENANTS = A; });
  afterEach(() => { process.env = { ...saved }; });

  it("indexes an upsert for a flagged tenant, stamped with that tenant", async () => {
    const p = port();
    expect(await handleGlobalSearchEvent(ev(), p, ready)).toBe("upserted");
    const doc = p.upsert.mock.calls[0]![0][0];
    expect(doc).toMatchObject({ tenantId: A, entityType: "finance.vendor", entityId: E, title: "Acme Traders", refNumber: "V-1", status: "active", module: "finance" });
  });
  it("a status change is just another upsert of the same document id", async () => {
    const p = port();
    await handleGlobalSearchEvent(ev(), p, ready);
    await handleGlobalSearchEvent(ev({ status: "inactive" }), p, ready);
    expect(p.upsert.mock.calls[0]![0][0].id).toBe(p.upsert.mock.calls[1]![0][0].id);
    expect(p.upsert.mock.calls[1]![0][0].status).toBe("inactive");
  });
  it("a delete removes the document of the envelope tenant", async () => {
    const p = port();
    expect(await handleGlobalSearchEvent(ev({ action: "delete" }), p, ready)).toBe("removed");
    expect(p.remove).toHaveBeenCalledWith(A, "finance.vendor", E);
    expect(p.upsert).not.toHaveBeenCalled();
  });
  it("flag off (or other tenant flagged): ignored, engine untouched", async () => {
    const p = port();
    delete process.env.GLOBAL_SEARCH_TENANTS;
    expect(await handleGlobalSearchEvent(ev(), p, ready)).toBe("ignored-flag-off");
    process.env.GLOBAL_SEARCH_TENANTS = B;
    expect(await handleGlobalSearchEvent(ev(), p, ready)).toBe("ignored-flag-off");
    expect(p.initialize).not.toHaveBeenCalled();
    expect(p.upsert).not.toHaveBeenCalled();
    expect(p.remove).not.toHaveBeenCalled();
  });
  it("legacy events (no entityType) and unknown entity types are ignored", async () => {
    const p = port();
    expect(await handleGlobalSearchEvent(ev({ entityType: undefined }), p, ready)).toBe("ignored-legacy");
    expect(await handleGlobalSearchEvent(ev({ entityType: "hrms.salary" }), p, ready)).toBe("ignored-legacy");
    expect(p.upsert).not.toHaveBeenCalled();
  });
  it("an event whose payload names another tenant, or a mismatching module, is dropped (no cross-tenant write or delete)", async () => {
    const p = port();
    expect(await handleGlobalSearchEvent(ev({ tenantId: B }), p, ready)).toBe("dropped-invalid");
    expect(await handleGlobalSearchEvent(ev({ tenantId: B, action: "delete" }), p, ready)).toBe("dropped-invalid");
    expect(await handleGlobalSearchEvent(ev({ module: "hrms" }), p, ready)).toBe("dropped-invalid");
    expect(p.upsert).not.toHaveBeenCalled();
    expect(p.remove).not.toHaveBeenCalled();
  });
  it("malformed events are dropped, not retried; engine failures are rethrown for retry", async () => {
    const p = port();
    expect(await handleGlobalSearchEvent(ev({ id: "nope" }), p, ready)).toBe("dropped-invalid");
    expect(await handleGlobalSearchEvent(ev({ name: "" }), p, ready)).toBe("dropped-invalid");
    expect(await handleGlobalSearchEvent(ev({ action: "explode" }), p, ready)).toBe("dropped-invalid");
    p.upsert.mockRejectedValueOnce(new Error("engine down"));
    await expect(handleGlobalSearchEvent(ev(), p, ready)).rejects.toThrow("engine down");
  });
  it("personal data that slips into a field is redacted before the engine sees it", async () => {
    const p = port();
    await handleGlobalSearchEvent(ev({ name: "Acme ABCDE1234F", description: "call 9876543210" }), p, ready);
    expect(JSON.stringify(p.upsert.mock.calls[0]![0])).not.toMatch(/ABCDE1234F|9876543210/);
  });
});
