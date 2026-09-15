/**
 * authz-tenant-scanner.mjs — fixture-based unit tests (SEC-014).
 *
 * Exercises the exported `findAuthzViolations()` directly against in-memory
 * route-file-shaped source strings, mirroring
 * tests/architecture/tenant-table-rls-guard.test.ts's shape.
 *
 * Run: pnpm exec vitest run tests/architecture/authz-tenant-scanner.test.ts
 */
import { describe, it, expect } from "vitest";
import { findAuthzViolations, AUTHZ_HELPER_NAMES } from "../../scripts/ci/authz-tenant-scanner.mjs";

describe("authz-tenant-scanner: findAuthzViolations()", () => {
  it("flags a mutating handler with no recognized authorization helper call (the SEC-014 exemplar defect shape)", () => {
    const src = `
      app.post("/v1/hrms/announcements", async (req, reply) => {
        const ctx = resolveContext(req);
        const body = announcementCreateSchema.parse(req.body);
        await withTenantGuc(ctx.tenantId, (pool) => pool.query("INSERT INTO x VALUES ($1)", [body.title]));
        return reply.code(201).send({ status: "created" });
      });
    `;
    const violations = findAuthzViolations(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method: "POST", path: "/v1/hrms/announcements" });
  });

  it("passes a handler that calls requireRole before touching the database", () => {
    const src = `
      app.post("/v1/hrms/announcements", async (req, reply) => {
        const ctx = resolveContext(req);
        requireRole(ctx, ["hr_admin", "super_admin"]);
        await withTenantGuc(ctx.tenantId, (pool) => pool.query("INSERT INTO x VALUES ($1)", [ctx.actorId]));
        return reply.code(201).send({ status: "created" });
      });
    `;
    expect(findAuthzViolations(src)).toHaveLength(0);
  });

  it("does not flag a sibling handler's compliance onto a handler that is actually missing the check (skill 19's core rule: the handler ITSELF must call it)", () => {
    const src = `
      app.patch("/v1/hrms/travel-requests/:id/approve", async (req, reply) => {
        const ctx = resolveContext(req);
        requireRole(ctx, ["manager", "hr_admin"]);
        await approve(ctx, req.params.id);
        return reply.send({ ok: true });
      });

      app.post("/v1/hrms/announcements", async (req, reply) => {
        const ctx = resolveContext(req);
        await createAnnouncement(ctx, req.body);
        return reply.code(201).send({ status: "created" });
      });
    `;
    const violations = findAuthzViolations(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method: "POST", path: "/v1/hrms/announcements" });
  });

  it("does not flag a route marked with the fleet's `config: { public: true }` escape hatch, even with no helper call", () => {
    const src = `
      app.post("/v1/telephony/webhooks/twilio/inbound", { config: { public: true } }, async (req, reply) => {
        await recordInboundCall(req.body);
        return reply.send({ ok: true });
      });
    `;
    expect(findAuthzViolations(src)).toHaveLength(0);
  });

  it("still parses through a non-public options object (rate limit config) to correctly flag a missing check", () => {
    const src = `
      app.post("/v1/finance/journals", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
        const ctx = resolveContext(req);
        await postJournal(ctx, req.body);
        return reply.code(201).send({ ok: true });
      });
    `;
    const violations = findAuthzViolations(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method: "POST", path: "/v1/finance/journals" });
  });

  it("still parses through a non-public options object (rate limit config) to correctly PASS a compliant handler", () => {
    const src = `
      app.post("/v1/finance/journals", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
        const ctx = resolveContext(req);
        requireRole(ctx, ["finance_admin"]);
        await postJournal(ctx, req.body);
        return reply.code(201).send({ ok: true });
      });
    `;
    expect(findAuthzViolations(src)).toHaveLength(0);
  });

  it("flags a preHandler-gated route with no recognized helper call (documented limitation: preHandler names are not modeled by this scanner)", () => {
    const src = `
      app.post("/v1/visitor/scans/upload", { preHandler: [deviceAuth] }, async (req, reply) => {
        await storeScan(req.body);
        return reply.send({ ok: true });
      });
    `;
    const violations = findAuthzViolations(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method: "POST", path: "/v1/visitor/scans/upload" });
  });

  it("does not flag GET handlers (read routes are out of scope, matching skill 19's own rule)", () => {
    const src = `
      app.get("/v1/hrms/announcements", async (req, reply) => {
        const ctx = resolveContext(req);
        const rows = await withTenantGuc(ctx.tenantId, (pool) => pool.query("SELECT 1"));
        return reply.send({ data: rows });
      });
    `;
    expect(findAuthzViolations(src)).toHaveLength(0);
  });

  it("ignores a helper name that only appears in a comment (doc-comments must not count as a real call)", () => {
    const src = `
      // TODO: this needs requireRole(ctx, ["hr_admin"]) before launch
      app.post("/v1/hrms/announcements", async (req, reply) => {
        const ctx = resolveContext(req);
        await createAnnouncement(ctx, req.body);
        return reply.code(201).send({ ok: true });
      });
    `;
    const violations = findAuthzViolations(src);
    expect(violations).toHaveLength(1);
  });

  it("handles the typed handler signature `async (req: FastifyRequest, reply: FastifyReply) => {}`", () => {
    const src = `
      app.post("/v1/x/y", async (req: FastifyRequest, reply: FastifyReply) => {
        const ctx = resolveContext(req);
        requireSuperAdmin(ctx);
        await doThing(ctx);
        return reply.send({ ok: true });
      });
    `;
    expect(findAuthzViolations(src)).toHaveLength(0);
  });

  it("correctly walks nested braces in the handler body (try/catch, template literals) without truncating early", () => {
    const src = `
      app.post("/v1/x/y", async (req, reply) => {
        const ctx = resolveContext(req);
        try {
          if (ctx.roles.length > 0) {
            const label = \`user \${ctx.actorId} in { special } group\`;
            assertOwnership(ctx, req.body.ownerId);
          }
        } catch (err) {
          req.log.warn({ err }, "failed");
        }
        return reply.send({ ok: true });
      });
    `;
    expect(findAuthzViolations(src)).toHaveLength(0);
  });

  it("detects PUT and DELETE as mutating methods, same as POST/PATCH", () => {
    const src = `
      app.put("/v1/x/:id", async (req, reply) => {
        await doThing(req.body);
        return reply.send({ ok: true });
      });
      app.delete("/v1/x/:id", async (req, reply) => {
        await deleteThing(req.params.id);
        return reply.send({ ok: true });
      });
    `;
    const violations = findAuthzViolations(src);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.method).sort()).toEqual(["DELETE", "PUT"]);
  });

  it("reports one violation per non-compliant handler when a file has several", () => {
    const src = `
      app.post("/v1/a", async (req, reply) => {
        const ctx = resolveContext(req);
        requireRole(ctx, ["admin"]);
        await doA(ctx);
        return reply.send({ ok: true });
      });
      app.post("/v1/b", async (req, reply) => {
        await doB(req.body);
        return reply.send({ ok: true });
      });
      app.post("/v1/c", async (req, reply) => {
        await doC(req.body);
        return reply.send({ ok: true });
      });
    `;
    const violations = findAuthzViolations(src);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.path).sort()).toEqual(["/v1/b", "/v1/c"]);
  });

  // One representative case per recognized helper name beyond requireRole,
  // since skill 19's own lesson is that a scanner which only recognizes one
  // name produces false negatives on the others -- these guard against this
  // scanner regressing to that same blind spot.
  const otherHelperExamples = [
    ["requireSuperAdmin", "requireSuperAdmin(ctx);"],
    ["assertOwnership", "assertOwnership(ctx, req.body.ownerId);"],
    ["requirePermissionKey", 'await requirePermissionKey(ctx, "hrms.announcements.create");'],
    ["requirePermission", 'await requirePermission(ctx, "hrms.announcements.create");'],
    ["requireInternalOrRoles", 'requireInternalOrRoles(ctx, ["platform_admin"]);'],
    ["checkPermission", 'const r = await checkPermission(ctx, "x"); if (r.decision !== "allow") throw new Error("no");'],
    ["assertGatewayRequest", "assertGatewayRequest(req);"],
    ["enforceEmployeeOwnership", "enforceEmployeeOwnership(ctx, req.body.employeeId);"],
    ["isSelfServiceEmployee", 'if (!isSelfServiceEmployee(ctx)) { throw new Error("no"); }'],
    ["isOfficer", 'if (!isOfficer(ctx)) { throw new Error("no"); }'],
  ] as const;

  for (const [name, callLine] of otherHelperExamples) {
    it(`recognizes ${name}() as a valid authorization call`, () => {
      const src = `
        app.post("/v1/x/y", async (req, reply) => {
          const ctx = resolveContext(req);
          ${callLine}
          await doThing(ctx);
          return reply.send({ ok: true });
        });
      `;
      expect(findAuthzViolations(src)).toHaveLength(0);
    });
  }

  it("AUTHZ_HELPER_NAMES exports at least the four helpers skill 19 names explicitly, plus more found by grepping the real fleet", () => {
    for (const name of ["requireRole", "requireSuperAdmin", "assertOwnership", "requirePermissionKey"]) {
      expect(AUTHZ_HELPER_NAMES).toContain(name);
    }
    expect(AUTHZ_HELPER_NAMES.length).toBeGreaterThan(4);
  });
});
