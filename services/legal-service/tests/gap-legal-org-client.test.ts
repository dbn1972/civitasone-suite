/** Owner decisions #10/#11/#13: the org-hierarchy client reads HRMS departments with internal auth and hides upstream errors. */
import { describe, it, expect } from "vitest";
import { createHttpOrgClient, OrgServiceError } from "../src/shared/org-client.js";

const CTX = { tenantId: "11111111-aaaa-4000-8000-0000000d1201", correlationId: "c1" };
const mk = (res: () => Response | Promise<Response>) => {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as Record<string, string> }); return res(); }) as unknown as typeof fetch;
  return { seen, fetchImpl };
};

describe("org client", () => {
  it("maps departments (id, name, code), sends internal auth, and caches per tenant", async () => {
    const { seen, fetchImpl } = mk(() => new Response(JSON.stringify({ data: [{ id: "d1", name: "Revenue", code: "REV", employeeCount: 3 }, { id: 5 }] }), { status: 200 }));
    const c = createHttpOrgClient({ baseUrl: "http://hrms:3012/", secret: "s", fetchImpl });
    expect(await c.listDepartments(CTX)).toEqual([{ id: "d1", name: "Revenue", code: "REV" }]);
    await c.listDepartments(CTX);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("http://hrms:3012/v1/hrms/departments");
    expect(seen[0]!.headers["x-internal"]).toBe("1");
    expect(seen[0]!.headers["x-tenant-id"]).toBe(CTX.tenantId);
    expect(seen[0]!.headers["x-service-secret"]).toBe("s");
  });

  it("is not_configured without a secret and unavailable on errors, never leaking upstream text", async () => {
    const none = createHttpOrgClient({ baseUrl: "http://h", secret: "", fetchImpl: mk(() => new Response("{}")).fetchImpl });
    await expect(none.listDepartments(CTX)).rejects.toMatchObject({ kind: "not_configured" });
    const five = createHttpOrgClient({ baseUrl: "http://h", secret: "s", fetchImpl: mk(() => new Response("boom", { status: 500 })).fetchImpl });
    await expect(five.listDepartments(CTX)).rejects.toBeInstanceOf(OrgServiceError);
    const boom = createHttpOrgClient({ baseUrl: "http://h", secret: "s", fetchImpl: mk(() => { throw new Error("ECONNREFUSED 10.9.9.9"); }).fetchImpl });
    const err = await boom.listDepartments(CTX).catch((e) => e);
    expect(err).toBeInstanceOf(OrgServiceError);
    expect(String(err.message)).not.toContain("10.9.9.9");
  });
});
