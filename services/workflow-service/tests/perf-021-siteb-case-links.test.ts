/**
 * PERF-021 (Site B) regression tests -- workflow-service case-links.
 *
 * Site B of PERF-021 (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md) was
 * createLinkChecked() (case-links/repo.ts) fetching EVERY case_links row for
 * the tenant on every link-creation write, solely so validateLink() could
 * walk it in JS to compute DUPLICATE_LINK / DUPLICATE_OF_A_DUPLICATE /
 * CYCLE_DETECTED. The fix replaces that fetch with two indexed EXISTS()
 * checks (the two duplicate checks) and a recursive CTE restricted to the
 * containment subgraph (the cycle check), the CTE only run when the link
 * type actually participates in containment.
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring / addQueryDebugListener -- wraps postgres-js's own
 * `debug` hook), active only when DB_QUERY_DEBUG=true is set at test-run time
 * (packages/db/src/pool.ts) -- mirrors PERF-005/PERF-019's
 * *-n-plus-one.test.ts files.
 *
 * NOTE on what "query count" does and doesn't prove here: unlike PERF-005/
 * PERF-019 (genuine N+1 -- one query PER ROW in a loop), the old case-links
 * code issued a FIXED number of queries (lock + one full fetch) regardless of
 * the tenant's link volume -- its defect was the SIZE of that one fetch
 * (every column of every row for the tenant), not the query COUNT. A
 * query-count-only assertion would therefore also pass on the unfixed code,
 * which would make it a non-discriminating regression test. So this file
 * asserts BOTH:
 *   (a) query count stays flat for a small vs. a large pre-existing link
 *       volume (the property requested, and a true, useful invariant of the
 *       new code), AND
 *   (b) no query captured during the call is an unscoped
 *       "SELECT ... FROM case_links WHERE tenant_id = $1"-shaped fetch -- the
 *       actual fingerprint of the removed defect, and what makes the
 *       sabotage check below meaningful (reverting to the old fetch makes
 *       (b) fail; (a) alone would not have).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring, addQueryDebugListener, removeQueryDebugListener } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { cases } from "../src/modules/case-registry/schema.js";
import { caseLinks } from "../src/modules/case-links/schema.js";
import { createLinkChecked } from "../src/modules/case-links/repo.js";
import { assembleLinkGuardResult } from "../src/modules/case-links/domain.js";
import type { LinkType } from "../src/modules/case-links/domain.js";

const ACTOR = "90000000-aaaa-4000-8000-000000000001";
const SMALL_N = 3;
const LARGE_N = 200;

function newLinkRow(tenantId: string, fromCaseId: string, toCaseId: string, linkType: LinkType) {
  return { id: randomUUID(), tenantId, fromCaseId, toCaseId, linkType, createdBy: ACTOR };
}

/** Create `n` bare case rows for `tenantId` in one batch insert. */
async function seedCases(tenantId: string, n: number): Promise<string[]> {
  const ids = Array.from({ length: n }, () => randomUUID());
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.insert(cases).values(ids.map((id, i) => ({
        id, tenantId, caseNumber: `P021-${id.slice(0, 8)}`, title: `Case ${i}`,
        caseType: "generic", sourceService: "test", sourceRefId: randomUUID(),
        createdBy: ACTOR,
      }))),
    ),
  );
  return ids;
}

/** Insert one case_links row directly, bypassing createLinkChecked's guard entirely. */
async function insertLink(tenantId: string, fromCaseId: string, toCaseId: string, linkType: LinkType): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.insert(caseLinks).values(newLinkRow(tenantId, fromCaseId, toCaseId, linkType))),
  );
}

/** Seed `n` pre-existing, mutually unrelated parent_child links (2 fresh cases each). */
async function seedUnrelatedLinks(tenantId: string, n: number): Promise<void> {
  const caseIds = await seedCases(tenantId, n * 2);
  const rows = Array.from({ length: n }, (_, i) =>
    newLinkRow(tenantId, caseIds[i * 2]!, caseIds[i * 2 + 1]!, "parent_child"));
  await runWithTenant(tenantId, () => db.transaction((tx) => tx.insert(caseLinks).values(rows)));
}

async function countLinks(tenantId: string): Promise<number> {
  const rows = await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(caseLinks).where(eq(caseLinks.tenantId, tenantId))));
  return rows.length;
}

async function wipe(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.delete(caseLinks).where(eq(caseLinks.tenantId, tenantId));
      await tx.delete(cases).where(eq(cases.tenantId, tenantId));
    }));
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-021 (Site B) -- assembleLinkGuardResult (domain.ts)", () => {
  const A = "aaaaaaaa-0000-4000-8000-000000000001";
  const B = "bbbbbbbb-0000-4000-8000-000000000002";

  it("collects every flagged violation, never short-circuits", () => {
    const r = assembleLinkGuardResult({
      fromCaseId: A, toCaseId: A, type: "duplicate_of",
      isDuplicate: true, targetIsAlreadyADuplicate: true, wouldCreateCycle: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.errors).toEqual(["SELF_LINK", "DUPLICATE_LINK", "DUPLICATE_OF_A_DUPLICATE", "CYCLE_DETECTED"]);
  });

  it("ignores targetIsAlreadyADuplicate unless type is duplicate_of", () => {
    const r = assembleLinkGuardResult({
      fromCaseId: A, toCaseId: B, type: "related",
      isDuplicate: false, targetIsAlreadyADuplicate: true, wouldCreateCycle: false,
    });
    expect(r.allowed).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("allows a clean link when every flag is false", () => {
    const r = assembleLinkGuardResult({
      fromCaseId: A, toCaseId: B, type: "parent_child",
      isDuplicate: false, targetIsAlreadyADuplicate: false, wouldCreateCycle: false,
    });
    expect(r).toEqual({ allowed: true, errors: [] });
  });
});

describe("PERF-021 (Site B) -- createLinkChecked no longer fetches every tenant link", () => {
  it("query count is the same for a small and a large pre-existing link volume, and no query is an unscoped full-tenant case_links fetch", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seedUnrelatedLinks(tenantSmall, SMALL_N);
    await seedUnrelatedLinks(tenantLarge, LARGE_N);
    const smallPair = await seedCases(tenantSmall, 2);
    const largePair = await seedCases(tenantLarge, 2);

    const captured: Array<{ query: string; params: unknown[] }> = [];
    const capture = (_c: number, query: string, params: unknown[]) => { captured.push({ query, params }); };

    try {
      addQueryDebugListener(capture);

      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => createLinkChecked({
          tenantId: tenantSmall, fromCaseId: smallPair[0]!, toCaseId: smallPair[1]!, linkType: "parent_child",
          actorId: ACTOR, correlationId: randomUUID(),
        })));

      const { result, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => createLinkChecked({
          tenantId: tenantLarge, fromCaseId: largePair[0]!, toCaseId: largePair[1]!, linkType: "parent_child",
          actorId: ACTOR, correlationId: randomUUID(),
        })));

      expect(result.ok).toBe(true);

      // (a) the requested property: flat query count whether the tenant has
      // SMALL_N or LARGE_N pre-existing (unrelated) links. The old code was
      // ALSO flat here (see file header) -- this is necessary but not
      // sufficient on its own.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(10);

      // (b) the actual fingerprint of the removed defect: zero plain
      // (non-EXISTS, non-recursive) SELECTs against case_links across BOTH
      // calls -- i.e. nothing shaped like the old "fetch every link row for
      // the tenant" query.
      const badFullFetch = captured.some((q) => {
        const s = q.query.toLowerCase();
        return s.trim().startsWith("select") && s.includes("case_links") && !s.includes("exists") && !s.includes("recursive");
      });
      expect(badFullFetch).toBe(false);
    } finally {
      removeQueryDebugListener(capture);
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });

  it("detects and rejects a genuine 2-hop transitive cycle (parent_child chain, exercises the recursive step)", async () => {
    const tenant = randomUUID();
    const [x, y, z] = await seedCases(tenant, 3);
    await insertLink(tenant, x!, y!, "parent_child"); // X -> Y
    await insertLink(tenant, y!, z!, "parent_child"); // Y -> Z
    try {
      const result = await runWithTenant(tenant, () => createLinkChecked({
        tenantId: tenant, fromCaseId: z!, toCaseId: x!, linkType: "parent_child", // would close Z -> X -> Y -> Z
        actorId: ACTOR, correlationId: randomUUID(),
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toEqual(["CYCLE_DETECTED"]);
      expect(await countLinks(tenant)).toBe(2); // rejected link was never inserted
    } finally {
      await wipe(tenant);
    }
  });

  it("detects a cycle through the REVERSED split_from containment edge", async () => {
    const tenant = randomUUID();
    const [parent, child] = await seedCases(tenant, 2);
    // "child was split from parent": containmentEdge reverses this stored
    // (from=child, to=parent) row to ancestor=parent, descendant=child.
    await insertLink(tenant, child!, parent!, "split_from");
    try {
      // parent_child(from=child, to=parent): ancestor=child, descendant=parent.
      // parent already reaches child via the reversed split_from edge, so
      // this closes a cycle -- only detectable if the CTE applies the SAME
      // reversal containmentEdge() uses for split_from.
      const result = await runWithTenant(tenant, () => createLinkChecked({
        tenantId: tenant, fromCaseId: child!, toCaseId: parent!, linkType: "parent_child",
        actorId: ACTOR, correlationId: randomUUID(),
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContain("CYCLE_DETECTED");
    } finally {
      await wipe(tenant);
    }
  });

  it("detects and rejects a genuine exact duplicate", async () => {
    const tenant = randomUUID();
    const [a, b] = await seedCases(tenant, 2);
    await insertLink(tenant, a!, b!, "related");
    try {
      const result = await runWithTenant(tenant, () => createLinkChecked({
        tenantId: tenant, fromCaseId: a!, toCaseId: b!, linkType: "related",
        actorId: ACTOR, correlationId: randomUUID(),
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toEqual(["DUPLICATE_LINK"]);
    } finally {
      await wipe(tenant);
    }
  });

  it("detects DUPLICATE_OF_A_DUPLICATE (the target is itself already a duplicate of something else)", async () => {
    const tenant = randomUUID();
    const [a, b, c] = await seedCases(tenant, 3);
    await insertLink(tenant, b!, c!, "duplicate_of"); // B is a duplicate of C
    try {
      const result = await runWithTenant(tenant, () => createLinkChecked({
        tenantId: tenant, fromCaseId: a!, toCaseId: b!, linkType: "duplicate_of", // claims A is a duplicate of B
        actorId: ACTOR, correlationId: randomUUID(),
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toEqual(["DUPLICATE_OF_A_DUPLICATE"]);
    } finally {
      await wipe(tenant);
    }
  });

  it("reports BOTH DUPLICATE_LINK and CYCLE_DETECTED when one attempt triggers both (collect-all, no short-circuit)", async () => {
    const tenant = randomUUID();
    const [a, b] = await seedCases(tenant, 2);
    // Seed a contradictory pair directly (bypassing the guard) so the SAME
    // attempted link both exactly duplicates an existing row AND would close
    // a cycle via a second existing row.
    await insertLink(tenant, a!, b!, "parent_child"); // A -> B
    await insertLink(tenant, b!, a!, "merged_from");  // B -> A (merged_from: ancestor=from=B, descendant=to=A)
    try {
      const result = await runWithTenant(tenant, () => createLinkChecked({
        tenantId: tenant, fromCaseId: a!, toCaseId: b!, linkType: "parent_child", // exact dup of row 1, and closes A->B->A
        actorId: ACTOR, correlationId: randomUUID(),
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("DUPLICATE_LINK");
        expect(result.errors).toContain("CYCLE_DETECTED");
        expect(result.errors).toHaveLength(2);
      }
    } finally {
      await wipe(tenant);
    }
  });

  it("FOR UPDATE race guard: two concurrent opposite-direction link creations on the same pair -- exactly one wins, no cycle is ever persisted", async () => {
    const tenant = randomUUID();
    const [a, b] = await seedCases(tenant, 2);
    try {
      const results = await Promise.all([
        runWithTenant(tenant, () => createLinkChecked({
          tenantId: tenant, fromCaseId: a!, toCaseId: b!, linkType: "parent_child",
          actorId: ACTOR, correlationId: randomUUID(),
        })),
        runWithTenant(tenant, () => createLinkChecked({
          tenantId: tenant, fromCaseId: b!, toCaseId: a!, linkType: "parent_child",
          actorId: ACTOR, correlationId: randomUUID(),
        })),
      ]);
      const oks = results.filter((r) => r.ok);
      const fails = results.filter((r) => !r.ok);
      expect(oks).toHaveLength(1);
      expect(fails).toHaveLength(1);
      if (!fails[0]!.ok) expect(fails[0]!.errors).toContain("CYCLE_DETECTED");
      // Exactly one row landed: the lock serialized the two transactions
      // instead of letting both commit and stored an actual A<->B cycle.
      expect(await countLinks(tenant)).toBe(1);
    } finally {
      await wipe(tenant);
    }
  });
});
