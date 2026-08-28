/**
 * Fix — the noting/custody/dispatch "officer of record" display must resolve
 * to a real hrms-service employee name wherever the id genuinely is one,
 * instead of unconditionally truncating every id to 8 hex characters.
 *
 * Context: PR #729 (commit 4f2ac4ac) fixed officerId/currentWith to always be
 * a REAL, non-spoofable actor id (ctx.actorId, or an explicit hrms
 * employeeId picked from the operators directory) — a security fix. But
 * queries.ts's `officerLabel()` never actually tried to resolve any of those
 * ids to a name: `author`, `currentHolder` and `dispatchedBy` in the file
 * detail API always showed `id.slice(0, 8)`, even for ids that ARE real hrms
 * employeeIds (e.g. a file explicitly routed to a named colleague).
 *
 * Suite A (unit) — services/estab-service/src/shared/hrms-client.ts in
 * isolation: correct URL/headers/tenant-scoping, and safe degradation
 * (returns an empty map, never throws) when INTERNAL_SERVICE_SECRET is
 * unset, hrms-service is unreachable, or it responds non-2xx. Mirrors the
 * globalThis.fetch mocking convention used by
 * services/payroll-service/tests/shared-utils.test.ts for the analogous
 * hrms-client.ts on that side of the integration.
 *
 * Suite B (integration) — getFileDetail() against the real dev DB (mirroring
 * services/estab-service/tests/noting-actor-authority.test.ts's Suite B):
 * proves the resolved name actually reaches the file-detail response for an
 * id hrms-service reports, and that an id hrms-service does NOT report
 * (e.g. a self-authored ctx.actorId, which has no hrms employee counterpart
 * anywhere in this platform — see hrms-client.ts's doc comment) still
 * degrades to the same truncated-id fallback as before, rather than
 * throwing or showing something misleading.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles, estabNotings, estabDispatch } from "../src/modules/files/schema.js";

describe("shared/hrms-client — getEmployeeDisplayMap", () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.INTERNAL_SERVICE_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = originalSecret;
    // Deliberately NOT calling vi.resetModules() here: it would make a later
    // dynamic import() of anything depending on @civitasone/db (e.g. Suite
    // B's queries.js) re-evaluate that module fresh, creating a SECOND,
    // disconnected AsyncLocalStorage instance in tenant-context.ts — this
    // file's top-level `runWithTenant` import would then be setting tenant
    // context on a different instance than the one db.transaction() reads
    // from, so the GUC would silently never be set (RLS FORCE => zero rows).
    // Not needed anyway: hrms-client.ts reads process.env.INTERNAL_SERVICE_SECRET
    // at call time, not at module-load time, so env changes above already
    // take effect without a module reset.
  });

  it("returns an empty map without calling fetch when INTERNAL_SERVICE_SECRET is unset", async () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { getEmployeeDisplayMap } = await import("../src/shared/hrms-client.js");

    const map = await getEmployeeDisplayMap("11111111-1111-4111-8111-000000000a01");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });

  it("returns an empty map (never throws) when hrms-service is unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const { getEmployeeDisplayMap } = await import("../src/shared/hrms-client.js");

    const map = await getEmployeeDisplayMap("11111111-1111-4111-8111-000000000a02");

    expect(map.size).toBe(0);
  });

  it("returns an empty map (never throws) when hrms-service responds non-2xx", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    const { getEmployeeDisplayMap } = await import("../src/shared/hrms-client.js");

    const map = await getEmployeeDisplayMap("11111111-1111-4111-8111-000000000a03");

    expect(map.size).toBe(0);
  });

  it("calls the internal employee-summaries endpoint with the correct headers and returns a resolved map", async () => {
    const tenantId = "11111111-1111-4111-8111-000000000a04";
    const EMP_ID = "22222222-2222-4222-8222-000000000e01";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: EMP_ID, fullName: "Priya Sharma", departmentName: "Revenue" }],
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { getEmployeeDisplayMap } = await import("../src/shared/hrms-client.js");

    const map = await getEmployeeDisplayMap(tenantId);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/v1/hrms/internal/employee-summaries");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-internal"]).toBe("1");
    expect(headers["x-service-secret"]).toBe("test-internal-secret");
    expect(headers["x-tenant-id"]).toBe(tenantId);
    expect(map.get(EMP_ID)).toEqual({ fullName: "Priya Sharma", departmentName: "Revenue" });
  });

  it("caches the resolved map so a second call for the same tenant does not refetch", async () => {
    const tenantId = "11111111-1111-4111-8111-000000000a05";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "33333333-3333-4333-8333-000000000e02", fullName: "Rahul Verma", departmentName: "Works" }],
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { getEmployeeDisplayMap } = await import("../src/shared/hrms-client.js");

    await getEmployeeDisplayMap(tenantId);
    await getEmployeeDisplayMap(tenantId);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

const TENANT = "44444444-aaaa-4444-8444-0000000000f9";
// Distinct tenant for the "hrms unreachable" test below — getEmployeeDisplayMap
// caches per-tenant for 30s, so reusing TENANT would risk silently reading the
// first test's successful (cached) resolution instead of really exercising a
// fresh, failing fetch.
const TENANT_HRMS_DOWN = "44444444-aaaa-4444-8444-0000000000fa";
const KNOWN_EMPLOYEE_ID = "55555555-bbbb-4555-8555-0000000000e1"; // resolvable via (mocked) hrms
const SELF_ACTOR_ID = "66666666-cccc-4666-8666-0000000000a1"; // NOT an hrms employee — must fall back
const FILE_ID = "77777777-dddd-4777-8777-0000000000f1";
const NOTE_ID = "88888888-eeee-4888-8888-0000000000f2";
const DISPATCH_ID = "99999999-ffff-4999-8999-0000000000f3";
// Separate file id for the hrms-down test — getFileDetail also caches the
// file row itself (default TTL), so reusing FILE_ID could read a cached row
// from the earlier test rather than proving anything about this one.
const FILE_ID_HRMS_DOWN = "77777777-dddd-4777-8777-0000000000f4";

async function clean(): Promise<void> {
  for (const tenantId of [TENANT, TENANT_HRMS_DOWN]) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await tx.delete(estabDispatch).where(eq(estabDispatch.tenantId, tenantId));
        await tx.delete(estabNotings).where(eq(estabNotings.tenantId, tenantId));
        await tx.delete(estabFiles).where(eq(estabFiles.tenantId, tenantId));
      }),
    );
  }
}

describe("getFileDetail — officer labels resolve via hrms-service where the id is real (integration)", () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.INTERNAL_SERVICE_SECRET;

  beforeEach(async () => {
    process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: KNOWN_EMPLOYEE_ID, fullName: "Anita Desai", departmentName: "Estates" }],
    }) as unknown as typeof fetch;
    await clean();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = originalSecret;
  });

  afterAll(async () => {
    await clean();
    await sqlClient.end();
  });

  it("resolves currentHolder and dispatchedBy to the real hrms name, and falls back for an id hrms doesn't know", async () => {
    await runWithTenant(TENANT, () =>
      db.transaction(async (tx) => {
        await tx.insert(estabFiles).values({
          id: FILE_ID, tenantId: TENANT, fileNo: "EST/2026/OD1", subject: "Officer display test",
          dept: "ADMIN", currentWith: KNOWN_EMPLOYEE_ID, // routed to a real colleague
          createdBy: SELF_ACTOR_ID, updatedBy: SELF_ACTOR_ID,
        });
        await tx.insert(estabNotings).values({
          id: NOTE_ID, tenantId: TENANT, fileId: FILE_ID, seq: 1,
          officerId: SELF_ACTOR_ID, // self-authored — no hrms employee counterpart
          body: "Opening note", createdBy: SELF_ACTOR_ID, updatedBy: SELF_ACTOR_ID,
        });
        await tx.insert(estabDispatch).values({
          id: DISPATCH_ID, tenantId: TENANT, dispatchNo: "DIS/2026/OD1", fileId: FILE_ID,
          toAddress: "someone@example.gov.in", subject: "Officer display test",
          createdBy: KNOWN_EMPLOYEE_ID, updatedBy: KNOWN_EMPLOYEE_ID,
        });
      }),
    );

    const { getFileDetail } = await import("../src/modules/files/queries.js");
    // Production reaches getFileDetail from inside app.ts's per-request
    // onRequest hook (createTenantTxHook), which is what actually establishes
    // the AsyncLocalStorage tenant context db.transaction() reads to inject
    // the app.tenant_id GUC (see packages/db/src/tenant-db.ts). Calling
    // getFileDetail directly, as this test does, bypasses that hook, so it
    // must be replicated here or every read silently sees zero rows (RLS
    // FORCE fails closed with no GUC set) — not a bug in the fix under test.
    const detail = await runWithTenant(TENANT, () => getFileDetail(TENANT, FILE_ID));

    expect(detail).not.toBeNull();
    // Real hrms lookup now actually happens and resolves a known employeeId...
    expect(detail!.currentHolder).toBe("Anita Desai");
    expect(detail!.dispatchHistory[0]?.dispatchedBy).toBe("Anita Desai");
    // ...while an id hrms-service genuinely has no record of (the common
    // self-authored case) still degrades safely to the pre-existing
    // truncated-id fallback, exactly as before — not a regression, not a
    // crash, not a misleading label.
    expect(detail!.noteSheets[0]?.author).toBe(SELF_ACTOR_ID.slice(0, 8));
  });

  it("degrades every label to truncated ids (not an error) when hrms-service is unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    await runWithTenant(TENANT_HRMS_DOWN, () =>
      db.transaction(async (tx) => {
        await tx.insert(estabFiles).values({
          id: FILE_ID_HRMS_DOWN, tenantId: TENANT_HRMS_DOWN, fileNo: "EST/2026/OD2", subject: "hrms-down test",
          dept: "ADMIN", currentWith: KNOWN_EMPLOYEE_ID,
          createdBy: SELF_ACTOR_ID, updatedBy: SELF_ACTOR_ID,
        });
      }),
    );

    const { getFileDetail } = await import("../src/modules/files/queries.js");
    const detail = await runWithTenant(TENANT_HRMS_DOWN, () => getFileDetail(TENANT_HRMS_DOWN, FILE_ID_HRMS_DOWN));

    expect(detail).not.toBeNull();
    expect(detail!.currentHolder).toBe(KNOWN_EMPLOYEE_ID.slice(0, 8));
  });
});
