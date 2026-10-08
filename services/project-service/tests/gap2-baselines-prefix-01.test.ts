/**
 * GAP2-PROJECTS-DB-BASELINES-PREFIX-01 — exactly one baseline table, prefixed.
 *
 * After migration 0026 the project schema must contain exactly ONE baseline
 * table and it must carry the mandatory `project_` prefix (CLAUDE.md §3.2):
 * the unprefixed `project.baselines` is gone (renamed) and the legacy
 * `project.project_baselines` (0005) is dropped — consolidated into one.
 */
import { describe, it, expect, afterAll } from "vitest";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });

describe("GAP2-PROJECTS-DB-BASELINES-PREFIX-01", () => {
  it("has exactly one baseline table and it is prefixed project_baselines", async () => {
    const rows = await sqlClient<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'project' AND table_name LIKE '%baselines%'
      ORDER BY table_name
    `;
    const names = rows.map((r) => r.table_name);
    expect(names).toContain("project_baselines");
    // The unprefixed table must no longer exist.
    expect(names).not.toContain("baselines");
    // Exactly one baseline table overall.
    expect(names.length).toBe(1);
  });

  it("the surviving table has the active (label/snapshot_data) shape", async () => {
    const cols = await sqlClient<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'project' AND table_name = 'project_baselines'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("label");
    expect(names).toContain("snapshot_data");
  });
});
