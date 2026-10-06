/**
 * GAP-REVENUE-ASSESSEES-03: the assessee register must reject a duplicate
 * identifier within a tenant. This is enforced by the unique index added in
 * migrations/0011_assessee_identifier_unique.sql; the assesseeCreate consumer
 * already classifies the resulting Postgres class-23 violation as a
 * non-retryable error (so the client sees a 4xx, not an endless retry).
 *
 * DB-backed: connects to the test Postgres named by DATABASE_URL and proves the
 * constraint directly. Fails on the pre-migration schema (no unique index).
 */
import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const URL = process.env.DATABASE_URL;
const sql = postgres(URL!, { max: 1 });

const TENANT = "0000aaaa-0000-0000-0000-0000000003aa";
const ACTOR = "0000bbbb-0000-0000-0000-0000000003bb";
const IDENT = `GAP03-UNIQ-${Date.now()}`;

afterAll(async () => {
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM assessee.assessees WHERE tenant_id = ${TENANT}`;
  });
  await sql.end();
});

describe("assessee identifier uniqueness (GAP-REVENUE-ASSESSEES-03)", () => {
  it("rejects a second assessee with the same (tenant, identifier)", async () => {
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`
        INSERT INTO assessee.assessees (tenant_id, assessee_type, identifier_no, owner_name, address, created_by, updated_by)
        VALUES (${TENANT}, 'property', ${IDENT}, 'First Owner', 'Addr 1', ${ACTOR}, ${ACTOR})
      `;
    });

    let code: string | undefined;
    let constraint: string | undefined;
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
        await tx`
          INSERT INTO assessee.assessees (tenant_id, assessee_type, identifier_no, owner_name, address, created_by, updated_by)
          VALUES (${TENANT}, 'property', ${IDENT}, 'Second Owner', 'Addr 2', ${ACTOR}, ${ACTOR})
        `;
      });
    } catch (err) {
      code = (err as { code?: string }).code;
      constraint = (err as { constraint_name?: string }).constraint_name;
    }

    // Postgres 23505 = unique_violation; class 23 is what the consumer treats
    // as a non-retryable constraint violation.
    expect(code).toBe("23505");
    expect(code?.startsWith("23")).toBe(true);
    expect(constraint).toBe("uq_assessees_tenant_identifier");
  });

  it("allows the same identifier under a DIFFERENT tenant (scoped, not global)", async () => {
    const OTHER_TENANT = "0000cccc-0000-0000-0000-0000000003cc";
    // Succeeds because the unique index is on (tenant_id, identifier_no), not
    // identifier_no alone. Counting is done inside the same tenant's GUC scope.
    const n = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${OTHER_TENANT}, true)`;
      await tx`
        INSERT INTO assessee.assessees (tenant_id, assessee_type, identifier_no, owner_name, address, created_by, updated_by)
        VALUES (${OTHER_TENANT}, 'property', ${IDENT}, 'Other Tenant Owner', 'Addr 3', ${ACTOR}, ${ACTOR})
      `;
      const rows = await tx`
        SELECT count(*)::int AS n FROM assessee.assessees WHERE identifier_no = ${IDENT}
      `;
      await tx`DELETE FROM assessee.assessees WHERE tenant_id = ${OTHER_TENANT}`;
      return rows[0].n as number;
    });
    // Under OTHER_TENANT's RLS scope, exactly its own one row is visible.
    expect(n).toBe(1);
  });
});
