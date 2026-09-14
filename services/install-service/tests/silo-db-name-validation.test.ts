/**
 * SEC-013 — install-service silo provisioning: unvalidated tenantId reaching
 * a raw `CREATE DATABASE` DDL statement.
 *
 * `siloDbName(tenantId)` (consumer.ts) builds the dedicated database name for
 * a silo tenant (`civitas_tenant_<16 lowercase-hex chars>`), which
 * actuator.ts's `provisionSiloDatabase` later interpolates directly into an
 * unparameterized `CREATE DATABASE ${dbName}` statement over a *privileged*
 * (CREATEDB) connection — Postgres cannot parameterize identifiers, so this
 * is the actual point of use. Before this fix, the only transformation
 * applied to `tenantId` was `.replace(/-/g, "")` + `.slice(0, 16)` — dashes
 * stripped and the result truncated, but no character-class validation at
 * all. `tenantId` itself was never runtime-checked: the sole caller
 * (`registerProvisioningConsumers`'s `tenant.tenant.isolation_changed`
 * handler) only does `const p = msg.payload as IsolationChanged` — a
 * compile-time-only type assertion — before passing `p.tenantId` straight
 * through. A malformed or adversarial tenantId containing characters other
 * than hyphens (quotes, semicolons, spaces, backticks, …) would have
 * survived the dash-strip/truncate and reached the raw DDL statement
 * unescaped. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md SEC-013.
 *
 * Fixed by asserting `tenantId` is a real UUID at this single choke point
 * (matching the `UUID_RE` convention already used the same way in
 * finance-service/src/shared/context.ts, gateway-service's catalogue
 * context.ts, and several other services), so a malformed tenantId throws
 * here — loudly, before any DB I/O — instead of silently reaching the DDL.
 * actuator.ts separately re-validates the resulting dbName immediately
 * before the `CREATE DATABASE` statement itself, as defense-in-depth for
 * callers that don't go through this function (see its own
 * SAFE_PG_IDENTIFIER_RE doc-comment) — not re-tested here, see
 * actuator.basic.test.ts for that layer.
 */
import { describe, it, expect } from "vitest";
import { siloDbName } from "../src/modules/provisioning/consumer.js";

const VALID_UUID = "aabbccdd-1122-4a1b-8c2d-334455667788";

describe("SEC-013 — siloDbName asserts a real UUID before building a DB name", () => {
  it("returns the expected civitas_tenant_<hex> name for a valid UUID", () => {
    expect(siloDbName(VALID_UUID)).toBe("civitas_tenant_aabbccdd11224a1b");
  });

  it("accepts uppercase hex (UUID_RE's /i flag) and normalizes the output to lowercase", () => {
    expect(siloDbName(VALID_UUID.toUpperCase())).toBe("civitas_tenant_aabbccdd11224a1b");
  });

  // REGRESSION: these are exactly the shapes that used to survive
  // `.replace(/-/g, "")` + `.slice(0, 16)` unchanged (or nearly unchanged)
  // and reach the raw `CREATE DATABASE ${dbName}` statement.
  it.each([
    ["a single quote", `1' OR '1'='1`],
    ["a semicolon + trailing statement", "abc; DROP DATABASE civitas_install;"],
    ["a double quote", `civitas"; SELECT 1;--`],
    ["a space", "not a uuid at all"],
    ["too short", "1234"],
    ["empty string", ""],
    ["valid-looking but wrong grouping", "11111111-2222-4333-8444-55555555555"], // 11 not 12
    ["extra characters after a real UUID", `${VALID_UUID}; DROP DATABASE x;`],
  ])("REGRESSION: throws INVALID_TENANT_ID for %s (%j)", (_label, badTenantId) => {
    expect(() => siloDbName(badTenantId)).toThrow(/INVALID_TENANT_ID/);
  });
});
