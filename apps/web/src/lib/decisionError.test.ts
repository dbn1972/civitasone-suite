import { describe, it, expect } from "vitest";
import { decisionFailure } from "./decisionError";

const res = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("decisionFailure (GAP-INVENTORY-CYCLE-COUNTS-DETAIL-04)", () => {
  it("409 gives a friendly stale message, no JSON, and asks for a refresh", async () => {
    const f = await decisionFailure(res(409, { code: "VERSION_CONFLICT", message: "raw server text" }), "cycle count");
    expect(f.message).toBe("Someone else already decided this cycle count. Refresh to see the latest.");
    expect(f.message).not.toMatch(/VERSION_CONFLICT|raw server|[{]/);
    expect(f.stale).toBe(true);
  });
  it("403 maker-checker explains the rule", async () => {
    const f = await decisionFailure(res(403, { code: "MAKER_CHECKER" }), "cycle count");
    expect(f.message).toMatch(/different approver/);
    expect(f.stale).toBe(false);
  });
  it("other 403 gives permission copy", async () => {
    const f = await decisionFailure(res(403, { code: "FORBIDDEN" }), "cycle count");
    expect(f.message).toMatch(/permission/i);
  });
  it("500 with a non-JSON body gives a generic message and never echoes the body", async () => {
    const f = await decisionFailure(res(500, "<html>stack trace</html>"), "cycle count");
    expect(f.message).toMatch(/save/i);
    expect(f.message).not.toMatch(/stack|html/i);
    expect(f.stale).toBe(false);
  });
});
