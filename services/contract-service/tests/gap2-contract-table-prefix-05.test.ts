/**
 * GAP2-CONTRACT-TABLE-PREFIX-05 — CLAUDE.md architecture rule 2: every table a
 * service owns must carry the `{service}_` prefix (here `contract_`). Six tables
 * had drifted (approvals.approval_levels, clauses.clause_library,
 * esign.esign_routes, obligations.obligation_reminders,
 * templates.template_clauses, versions.redlines). 0021_contract_table_prefix.sql
 * renames them.
 *
 * This test asserts, against the live civitas_contract DB, that NO table in the
 * contract-service's own domain schemas lacks the `contract_` prefix. It fails
 * on the old code (the six unprefixed tables were present) and passes once the
 * migration has run. Also asserts the renamed tables exist and the old names
 * are gone, so the rename is complete (not merely additive).
 */
import { describe, it, expect, afterAll } from "vitest";
import { sqlClient } from "../src/shared/db.js";

// The contract-service's own domain schemas (the ones holding its business
// tables). Shared infra schemas (_outbox, public, drizzle) are out of scope for
// the one-service-one-prefix rule and intentionally excluded.
const DOMAIN_SCHEMAS = [
  "contracts", "rate", "renewals", "clauses", "versions",
  "obligations", "approvals", "esign", "templates",
];

afterAll(async () => { await sqlClient.end(); });

describe("contract-service table-prefix compliance (GAP2-CONTRACT-TABLE-PREFIX-05)", () => {
  it("every table in a contract-service domain schema carries the contract_ prefix", async () => {
    const rows = await sqlClient<{ schemaname: string; tablename: string }[]>`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname = ANY(${DOMAIN_SCHEMAS})
        AND tablename NOT LIKE 'contract\\_%'
      ORDER BY schemaname, tablename
    `;
    const offenders = rows.map((r) => `${r.schemaname}.${r.tablename}`);
    expect(offenders).toEqual([]);
  });

  it("the six renamed tables exist under their prefixed names and the old names are gone", async () => {
    const expected = [
      ["approvals", "contract_approval_levels", "approval_levels"],
      ["clauses", "contract_clause_library", "clause_library"],
      ["esign", "contract_esign_routes", "esign_routes"],
      ["obligations", "contract_obligation_reminders", "obligation_reminders"],
      ["templates", "contract_template_clauses", "template_clauses"],
      ["versions", "contract_redlines", "redlines"],
    ] as const;
    for (const [sch, newName, oldName] of expected) {
      const present = await sqlClient<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_tables
        WHERE schemaname = ${sch} AND tablename = ${newName}`;
      expect({ table: `${sch}.${newName}`, count: present[0].n }).toEqual({ table: `${sch}.${newName}`, count: 1 });

      const gone = await sqlClient<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_tables
        WHERE schemaname = ${sch} AND tablename = ${oldName}`;
      expect({ table: `${sch}.${oldName}`, count: gone[0].n }).toEqual({ table: `${sch}.${oldName}`, count: 0 });
    }
  });
});
