/**
 * ORG-07 — unit tests for the department template clone domain logic.
 *
 * The invariant under test: a clone MUST NOT carry a tenant-crossing reference,
 * and every removal must be reported by path so a silent strip is impossible.
 */
import { describe, it, expect } from "vitest";
import { HttpError } from "../src/shared/context.js";
import {
  sanitizeTemplateConfig,
  findForeignTenantRefs,
  assertVersionMatch,
  assertTemplateActive,
  assertConfigNotEmpty,
} from "../src/modules/dept-templates/domain.js";

function expectHttpError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    expect((err as HttpError).code).toBe(code);
    return;
  }
  throw new Error(`expected an HttpError ${status} ${code}, nothing was thrown`);
}

const OWN = "aaaa0000-0000-4000-8000-00000000aaaa";
const FOREIGN = "bbbb0000-0000-4000-8000-00000000bbbb";

describe("sanitizeTemplateConfig — what IS copied", () => {
  it("keeps ordinary scalar settings untouched", () => {
    const { config } = sanitizeTemplateConfig({ name: "Revenue", headcount: 12, active: true }, OWN);
    expect(config).toEqual({ name: "Revenue", headcount: 12, active: true });
  });

  it("keeps nested structure and array contents", () => {
    const { config } = sanitizeTemplateConfig({
      roles: ["clerk", "officer"],
      sla: { firstResponseHours: 4, escalation: { afterHours: 24 } },
    }, OWN);
    expect(config).toEqual({
      roles: ["clerk", "officer"],
      sla: { firstResponseHours: 4, escalation: { afterHours: 24 } },
    });
  });

  it("keeps null and empty values as configured", () => {
    const { config } = sanitizeTemplateConfig({ note: null, tags: [], nested: {} }, OWN);
    expect(config).toEqual({ note: null, tags: [], nested: {} });
  });

  it("does not mutate the caller's input", () => {
    const input = { id: "x", keep: 1 };
    sanitizeTemplateConfig(input, OWN);
    expect(input).toEqual({ id: "x", keep: 1 });
  });

  it("returns an empty config for an empty input", () => {
    const result = sanitizeTemplateConfig({}, OWN);
    expect(result.config).toEqual({});
    expect(result.droppedRefs).toEqual([]);
    expect(result.crossTenantRefs).toEqual([]);
  });
});

describe("sanitizeTemplateConfig — what is NOT copied", () => {
  it("drops the source primary key and audit columns", () => {
    const { config, droppedRefs } = sanitizeTemplateConfig({
      id: "dept-1", createdBy: "u1", updatedBy: "u2", version: 7, keep: "yes",
    }, OWN);
    expect(config).toEqual({ keep: "yes" });
    expect(droppedRefs.sort()).toEqual(["createdBy", "id", "updatedBy", "version"]);
  });

  it("drops snake_case audit columns too", () => {
    const { config } = sanitizeTemplateConfig({ created_by: "u", updated_by: "u", keep: 1 }, OWN);
    expect(config).toEqual({ keep: 1 });
  });

  it("drops department id references in both spellings", () => {
    const { config, droppedRefs } = sanitizeTemplateConfig({
      departmentId: "d1", department_id: "d2", sourceDepartmentId: "d3", source_department_id: "d4", keep: 1,
    }, OWN);
    expect(config).toEqual({ keep: 1 });
    expect(droppedRefs).toHaveLength(4);
  });

  it("drops a tenantId naming a DIFFERENT tenant and flags it as cross-tenant", () => {
    const { config, droppedRefs, crossTenantRefs } = sanitizeTemplateConfig({
      tenantId: FOREIGN, keep: 1,
    }, OWN);
    expect(config).toEqual({ keep: 1 });
    expect(droppedRefs).toEqual(["tenantId"]);
    expect(crossTenantRefs).toEqual(["tenantId"]);
  });

  it("drops a tenantId naming the OWN tenant but does NOT flag it as cross-tenant", () => {
    const { config, droppedRefs, crossTenantRefs } = sanitizeTemplateConfig({
      tenantId: OWN, keep: 1,
    }, OWN);
    expect(config).toEqual({ keep: 1 });
    expect(droppedRefs).toEqual(["tenantId"]);
    expect(crossTenantRefs).toEqual([]);
  });

  it("recognises every tenant-key spelling", () => {
    const { config, droppedRefs } = sanitizeTemplateConfig({
      tenantId: FOREIGN, tenant_id: FOREIGN, owningTenantId: FOREIGN, owning_tenant_id: FOREIGN, keep: 1,
    }, OWN);
    expect(config).toEqual({ keep: 1 });
    expect(droppedRefs).toHaveLength(4);
  });

  it("matches keys case-insensitively", () => {
    const { config } = sanitizeTemplateConfig({ TenantID: FOREIGN, ID: "x", Keep: 1 }, OWN);
    expect(config).toEqual({ Keep: 1 });
  });

  it("strips a nested cross-tenant reference and reports its full dot path", () => {
    const { config, crossTenantRefs } = sanitizeTemplateConfig({
      workflow: { approvals: { tenantId: FOREIGN, levels: 2 } },
    }, OWN);
    expect(config).toEqual({ workflow: { approvals: { levels: 2 } } });
    expect(crossTenantRefs).toEqual(["workflow.approvals.tenantId"]);
  });

  it("walks arrays element-wise and reports indexed paths", () => {
    const { config, crossTenantRefs } = sanitizeTemplateConfig({
      members: [{ tenantId: FOREIGN, role: "clerk" }, { role: "officer" }],
    }, OWN);
    expect(config).toEqual({ members: [{ role: "clerk" }, { role: "officer" }] });
    expect(crossTenantRefs).toEqual(["members.0.tenantId"]);
  });

  it("does not flag a non-string tenant value as cross-tenant, but still drops it", () => {
    const { config, droppedRefs, crossTenantRefs } = sanitizeTemplateConfig({ tenantId: 42, keep: 1 }, OWN);
    expect(config).toEqual({ keep: 1 });
    expect(droppedRefs).toEqual(["tenantId"]);
    expect(crossTenantRefs).toEqual([]);
  });

  it("is idempotent — sanitising a sanitised config changes nothing further", () => {
    const first = sanitizeTemplateConfig({ id: "x", tenantId: FOREIGN, keep: { a: 1 } }, OWN);
    const second = sanitizeTemplateConfig(first.config, OWN);
    expect(second.config).toEqual(first.config);
    expect(second.droppedRefs).toEqual([]);
  });

  it("can strip a config down to nothing", () => {
    const { config, droppedRefs } = sanitizeTemplateConfig({ id: "x", version: 1 }, OWN);
    expect(config).toEqual({});
    expect(droppedRefs).toHaveLength(2);
  });
});

describe("findForeignTenantRefs", () => {
  it("finds nothing in a clean config", () => {
    expect(findForeignTenantRefs({ a: 1, b: { c: 2 } }, OWN)).toEqual([]);
  });

  it("finds a top-level foreign tenant reference", () => {
    expect(findForeignTenantRefs({ tenantId: FOREIGN }, OWN)).toEqual(["tenantId"]);
  });

  it("ignores a reference to the own tenant", () => {
    expect(findForeignTenantRefs({ tenantId: OWN }, OWN)).toEqual([]);
  });

  it("finds nested and array-indexed references", () => {
    const refs = findForeignTenantRefs({
      a: { tenant_id: FOREIGN },
      list: [{ owningTenantId: FOREIGN }],
    }, OWN);
    expect(refs.sort()).toEqual(["a.tenant_id", "list.0.owningTenantId"]);
  });

  it("finds several references in one document", () => {
    const refs = findForeignTenantRefs({ tenantId: FOREIGN, deep: { tenant_id: FOREIGN } }, OWN);
    expect(refs).toHaveLength(2);
  });

  it("returns nothing for scalars, null and arrays of scalars", () => {
    expect(findForeignTenantRefs(null, OWN)).toEqual([]);
    expect(findForeignTenantRefs("x", OWN)).toEqual([]);
    expect(findForeignTenantRefs([1, 2, 3], OWN)).toEqual([]);
  });

  it("does not descend into a tenant key's own value", () => {
    // The tenant key is consumed; nothing beneath it is walked further.
    expect(findForeignTenantRefs({ tenantId: { nested: FOREIGN } }, OWN)).toEqual([]);
  });
});

describe("ORG-07 guards", () => {
  it("optimistic lock: absent expectation passes, match passes, mismatch is 409", () => {
    expect(() => assertVersionMatch(3, undefined)).not.toThrow();
    expect(() => assertVersionMatch(3, 3)).not.toThrow();
    expectHttpError(() => assertVersionMatch(3, 2), 409, "VERSION_CONFLICT");
  });

  it("only an active template can be instantiated", () => {
    expect(() => assertTemplateActive("active")).not.toThrow();
    expectHttpError(() => assertTemplateActive("archived"), 422, "TEMPLATE_NOT_ACTIVE");
  });

  it("422 EMPTY_TEMPLATE when sanitisation left nothing to clone", () => {
    expectHttpError(() => assertConfigNotEmpty({}), 422, "EMPTY_TEMPLATE");
  });

  it("accepts a config with at least one surviving key", () => {
    expect(() => assertConfigNotEmpty({ a: 1 })).not.toThrow();
  });
});
