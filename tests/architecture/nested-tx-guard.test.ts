/**
 * nested-tx-guard.mjs — fixture-based unit tests (TX-011).
 *
 * Exercises the exported `scanServiceForNestedTransactions()` (and
 * `cleanSource()`) directly against in-memory source strings, mirroring
 * tests/architecture/tenant-table-rls-guard.test.ts's shape.
 *
 * Covers, in order: (1) the two real fleet cases TX-011 cites — grant-
 * service's dashboard/queries.ts (scopedRead-as-outer + a 1-hop nested
 * open) and install-service's orchestrator (a 2-hop transitive chain
 * through a namespace-imported repo module) — both in their pre-fix
 * (must flag) and post-fix (must be clean) shapes; (2) one isolated,
 * minimal fixture per named blind spot (arrow-const repo functions,
 * tenantTransaction/scopedRead as the outer wrapper, transitive calls
 * >1 level deep — including a 3-level chain, proving there is no
 * hardcoded depth cutoff); (3) sabotage-check controls that must stay
 * clean (a non-nested top-level open, the `tx.transaction()` savepoint
 * form, comments/strings that merely mention the trigger words,
 * unresolvable calls, an unrelated same-named function in another file
 * that isn't imported); (4) template-literal safety, since this fleet's
 * drizzle `sql`...`` tags routinely contain parens inside a string that
 * must never desync brace/paren counting; (5) named (non-namespace)
 * cross-file import resolution, including a rename.
 *
 * Run: pnpm exec vitest run tests/architecture/nested-tx-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import { scanServiceForNestedTransactions, cleanSource } from "../../scripts/ci/nested-tx-guard.mjs";

describe("nested-tx-guard: real fleet cases", () => {
  it("flags grant-service's dashboard/queries.ts in its PRE-FIX shape (the TX-011 exemplar defect: scopedRead-as-outer, blind spot #2)", () => {
    const source = `
      import { eq } from "drizzle-orm";
      import { db, scopedRead } from "../../shared/db.js";
      import { grantApplications } from "../application/schema.js";

      export async function getOverdueApplicationIds(tenantId) {
        return scopedRead(async (tx) => {
          const rows = await tx.select().from(grantApplications).where(eq(grantApplications.tenantId, tenantId));
          return rows.map((r) => r.id);
        });
      }

      export async function getDashboard(tenantId) {
        return scopedRead(async (tx) => {
          const [grants] = await tx.select().from(grantApplications).where(eq(grantApplications.tenantId, tenantId));
          const overdueIds = await getOverdueApplicationIds(tenantId);
          return { totalGrants: grants, overdueIds };
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([{ path: "src/modules/dashboard/queries.ts", source }]);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("transitive");
    expect(violations[0].openerName).toBe("scopedRead");
    expect(violations[0].outerOpener).toBe("scopedRead");
    expect(violations[0].chain).toEqual(["getOverdueApplicationIds"]);
  });

  it("does NOT flag grant-service's dashboard/queries.ts in its actual POST-FIX shape (getDashboard routes through the Tx sibling)", () => {
    const source = `
      import { eq } from "drizzle-orm";
      import { db, scopedRead } from "../../shared/db.js";
      import { grantApplications } from "../application/schema.js";

      export async function getOverdueApplicationIds(tenantId) {
        return scopedRead(async (tx) => getOverdueApplicationIdsTx(tx, tenantId));
      }

      export async function getOverdueApplicationIdsTx(tx, tenantId) {
        const rows = await tx.select().from(grantApplications).where(eq(grantApplications.tenantId, tenantId));
        return rows.map((r) => r.id);
      }

      export async function getDashboard(tenantId) {
        return scopedRead(async (tx) => {
          const [grants] = await tx.select().from(grantApplications).where(eq(grantApplications.tenantId, tenantId));
          const overdueIds = await getOverdueApplicationIdsTx(tx, tenantId);
          return { totalGrants: grants, overdueIds };
        });
      }
    `;
    expect(scanServiceForNestedTransactions([{ path: "src/modules/dashboard/queries.ts", source }])).toEqual([]);
  });

  it("flags an install-service-style 2-hop transitive chain through a namespace-imported repo module (repo.foo(), blind spot #3)", () => {
    const repoSource = `
      import { db } from "../../shared/db.js";
      export async function getStepDefinitions(wizardId, tenantId) {
        return db.transaction(async (tx) => tx.select().from(x).where(eq(x.wizardId, wizardId)));
      }
    `;
    const consumerSource = `
      import { db } from "../../shared/db.js";
      import * as repo from "./repo.js";

      async function resolveDag(tx, tenantId, wizardId) {
        const defs = await repo.getStepDefinitions(wizardId, tenantId);
        return defs;
      }

      export function registerConsumers(queue) {
        queue.subscribe("x", async (msg) => {
          await db.transaction(async (tx) => {
            await resolveDag(tx, msg.tenantId, msg.wizardId);
          });
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([
      { path: "src/modules/orchestrator/repo.ts", source: repoSource },
      { path: "src/modules/orchestrator/consumer.ts", source: consumerSource },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("src/modules/orchestrator/consumer.ts");
    expect(violations[0].depth).toBe(1);
    expect(violations[0].chain).toEqual(["resolveDag", "getStepDefinitions"]);
    expect(violations[0].openerName).toBe("db.transaction");
  });

  it("does NOT flag the install-service-style fixed chain (repo.fooTx siblings all the way through)", () => {
    const repoSource = `
      import { db } from "../../shared/db.js";
      export async function getStepDefinitionsTx(tx, wizardId, tenantId) {
        return tx.select().from(x).where(eq(x.wizardId, wizardId));
      }
    `;
    const consumerSource = `
      import { db } from "../../shared/db.js";
      import * as repo from "./repo.js";

      async function resolveDag(tx, tenantId, wizardId) {
        return repo.getStepDefinitionsTx(tx, wizardId, tenantId);
      }

      export function registerConsumers(queue) {
        queue.subscribe("x", async (msg) => {
          await db.transaction(async (tx) => {
            await resolveDag(tx, msg.tenantId, msg.wizardId);
          });
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([
      { path: "src/modules/orchestrator/repo.ts", source: repoSource },
      { path: "src/modules/orchestrator/consumer.ts", source: consumerSource },
    ]);
    expect(violations).toEqual([]);
  });
});

describe("nested-tx-guard: blind spot #1 — export const foo = async (...) => {...} repo style", () => {
  it("flags an arrow-const repo function used directly as the nested opener", () => {
    const source = `
      import { db } from "../../shared/db.js";

      export const findWidgetById = async (id) => {
        return db.transaction(async (tx) => tx.select().from(widgets).where(eq(widgets.id, id)));
      };

      export const processWidget = async (id) => {
        return db.transaction(async (tx) => {
          const widget = await findWidgetById(id);
          return widget;
        });
      };
    `;
    const violations = scanServiceForNestedTransactions([{ path: "src/modules/widgets/repo.ts", source }]);
    expect(violations).toHaveLength(1);
    expect(violations[0].chain).toEqual(["findWidgetById"]);
    expect(violations[0].openerName).toBe("db.transaction");
  });

  it("flags an arrow-const repo function that is an INTERMEDIATE hop, not just the leaf opener", () => {
    const source = `
      import { db } from "../../shared/db.js";

      export const loadAndCheck = async (id) => {
        const w = await findWidgetByIdUnsafe(id);
        return w;
      };

      export const findWidgetByIdUnsafe = async (id) => {
        return db.transaction(async (tx) => tx.select().from(widgets).where(eq(widgets.id, id)));
      };

      export async function processWidget(id) {
        return db.transaction(async (tx) => {
          return loadAndCheck(id);
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([{ path: "src/modules/widgets/repo.ts", source }]);
    expect(violations).toHaveLength(1);
    expect(violations[0].depth).toBe(1);
    expect(violations[0].chain).toEqual(["loadAndCheck", "findWidgetByIdUnsafe"]);
  });
});

describe("nested-tx-guard: blind spot #2 — tenantTransaction/scopedRead as the OUTER wrapper", () => {
  it("flags a direct nested db.transaction() inside a tenantTransaction()-wrapped outer scope", () => {
    const source = `
      import { tenantTransaction } from "@civitasone/db";
      import { db } from "../../shared/db.js";

      export async function doWork(tenantId) {
        return tenantTransaction(db, tenantId, async (tx) => {
          await tx.insert(x).values({});
          await db.transaction(async (inner) => {
            await inner.insert(y).values({});
          });
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([{ path: "src/modules/work/commands.ts", source }]);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("direct");
    expect(violations[0].outerOpener).toBe("tenantTransaction");
    expect(violations[0].openerName).toBe("db.transaction");
  });

  it("flags a direct nested scopedRead() inside a scopedRead()-wrapped outer scope (the exact grant-service shape, isolated)", () => {
    const source = `
      import { scopedRead } from "../../shared/db.js";
      export async function outer(tenantId) {
        return scopedRead(async (tx) => {
          return scopedRead(async (tx2) => tx2.select().from(x));
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([{ path: "src/x.ts", source }]);
    expect(violations).toHaveLength(1);
    expect(violations[0].outerOpener).toBe("scopedRead");
    expect(violations[0].openerName).toBe("scopedRead");
  });
});

describe("nested-tx-guard: blind spot #3 — transitive calls more than 1 level deep", () => {
  it("flags a 3-level transitive chain (deeper than either real fleet example — proves there is no hardcoded depth cutoff)", () => {
    const source = `
      import { db } from "../../shared/db.js";

      function levelC(tx, tenantId) {
        return levelD(tenantId);
      }
      function levelD(tenantId) {
        return db.transaction(async (tx) => tx.select().from(x));
      }
      function levelB(tx, tenantId) {
        return levelC(tx, tenantId);
      }
      export async function outer(tenantId) {
        return db.transaction(async (tx) => {
          return levelB(tx, tenantId);
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([{ path: "src/modules/deep/chain.ts", source }]);
    expect(violations).toHaveLength(1);
    expect(violations[0].depth).toBe(2);
    expect(violations[0].chain).toEqual(["levelB", "levelC", "levelD"]);
  });

  it("resolves a named (non-namespace) cross-file import, including a rename (`import { foo as bar }`)", () => {
    const otherSource = `
      import { db } from "../../shared/db.js";
      export async function riskyRead(tenantId) {
        return db.transaction(async (tx) => tx.select().from(x));
      }
    `;
    const callerSource = `
      import { db } from "../../shared/db.js";
      import { riskyRead as loadStuff } from "./other.js";
      export async function outer(tenantId) {
        return db.transaction(async (tx) => {
          return loadStuff(tenantId);
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([
      { path: "src/modules/x/other.ts", source: otherSource },
      { path: "src/modules/x/caller.ts", source: callerSource },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].chain).toEqual(["riskyRead"]);
  });
});

describe("nested-tx-guard: sabotage-check controls (must stay clean)", () => {
  it("does not flag a top-level (non-nested) self-opening call", () => {
    const source = `
      import { db } from "../../shared/db.js";
      export async function getWizard(id) {
        return db.transaction(async (tx) => tx.select().from(w).where(eq(w.id, id)));
      }
      export async function useIt(id) {
        return getWizard(id);
      }
    `;
    expect(scanServiceForNestedTransactions([{ path: "src/x.ts", source }])).toEqual([]);
  });

  it("excludes tx.transaction() (a same-connection savepoint, not a new pool checkout — a different risk class)", () => {
    const source = `
      import { db } from "../../shared/db.js";
      export async function doWork() {
        return db.transaction(async (tx) => {
          await tx.transaction(async (savepointTx) => {
            await savepointTx.insert(x).values({});
          });
        });
      }
    `;
    expect(scanServiceForNestedTransactions([{ path: "src/x.ts", source }])).toEqual([]);
  });

  it("never counts scopedRead()/db.transaction() mentioned only in comments or string literals", () => {
    const source = `
      import { db } from "../../shared/db.js";
      // NOTE: do not call scopedRead() or db.transaction() from inside here!
      const warning = "never call scopedRead() inside db.transaction(x)";
      export async function outer(tenantId) {
        return db.transaction(async (tx) => {
          /* db.transaction(async ()=>{}) */
          return tx.select().from(y);
        });
      }
    `;
    expect(scanServiceForNestedTransactions([{ path: "src/x.ts", source }])).toEqual([]);
  });

  it("does not falsely traverse unresolvable / cross-package calls inside a transaction", () => {
    const source = `
      import { db } from "../../shared/db.js";
      import { enqueue } from "../../shared/outbox.js";
      export async function outer(tenantId) {
        return db.transaction(async (tx) => {
          await enqueue(tx, { topic: "x" });
          await cache.invalidate(tenantId);
          return tx.select().from(y);
        });
      }
    `;
    expect(scanServiceForNestedTransactions([{ path: "src/x.ts", source }])).toEqual([]);
  });

  it("does not resolve an unrelated same-named function in another file that is neither imported nor local (no name-only global fallback)", () => {
    const otherServiceFile = `
      import { db } from "../../shared/db.js";
      export async function emit(tx, msg) {
        return db.transaction(async (inner) => inner.insert(y).values({}));
      }
    `;
    const callerSource = `
      import { db } from "../../shared/db.js";
      async function emit(tx, msg) {
        return; // this file's OWN local emit() -- does not open anything
      }
      export async function outer(tenantId) {
        return db.transaction(async (tx) => {
          return emit(tx, {});
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([
      { path: "src/modules/unrelated/other.ts", source: otherServiceFile },
      { path: "src/modules/x/caller.ts", source: callerSource },
    ]);
    expect(violations).toEqual([]);
  });
});

describe("nested-tx-guard: dual-mode-helper refinement (found necessary against the real fleet)", () => {
  it("does not flag a dual-mode helper in braced if/else form (the real grant-service sumDisbursedForApplication shape)", () => {
    const repoSource = `
      import { db } from "../../shared/db.js";
      export async function sumDisbursedForApplication(tx, applicationId, tenantId) {
        const doQuery = async (q) => q.select().from(x);
        if (tx === db) {
          return scopedRead((stx) => doQuery(stx));
        }
        return doQuery(tx);
      }
    `;
    const callerSource = `
      import { db } from "../../shared/db.js";
      import * as repo from "./repo.js";
      export async function outer(tenantId) {
        return db.transaction(async (tx) => {
          return repo.sumDisbursedForApplication(tx, "app1", tenantId);
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([
      { path: "src/modules/disbursement/repo.ts", source: repoSource },
      { path: "src/modules/disbursement/consumer.ts", source: callerSource },
    ]);
    expect(violations).toEqual([]);
  });

  it("does not flag a dual-mode helper in unbraced early-return form (the real estab-service upsertBalance shape)", () => {
    const repoSource = `
      import { db } from "../../shared/db.js";
      export async function upsertBalance(tenantId, itemId, delta, tx) {
        const run = async (executor) => executor.select().from(x);
        if (tx) return run(tx);
        return db.transaction((t) => run(t));
      }
    `;
    const callerSource = `
      import * as repo from "./repo.js";
      export function register(queue) {
        queue.subscribe("x", async (msg) => {
          db.transaction(async (tx) => {
            repo.upsertBalance(msg.tenantId, msg.itemId, 1, tx);
          });
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([
      { path: "src/modules/consumables/repo.ts", source: repoSource },
      { path: "src/modules/consumables/consumer.ts", source: callerSource },
    ]);
    expect(violations).toEqual([]);
  });

  it("does not flag a dual-mode helper in BRACED early-return form (the real procurement insertBlacklist/insertBlacklistTx shape: the guard block itself ends in return, and the fallback is a later sibling statement, not an else)", () => {
    const repoSource = `
      import { db } from "../../shared/db.js";
      export async function insertBlacklist(row, writer) {
        if (writer) {
          const rows = await writer.insert(x).values(row).returning();
          return rows[0];
        }
        const rows = await db.transaction((tx) => tx.insert(x).values(row).returning());
        return rows[0];
      }
      export async function insertBlacklistTx(tx, row) {
        return insertBlacklist(row, tx);
      }
    `;
    const callerSource = `
      import * as repo from "./repo.js";
      export async function outer(tenantId) {
        return db.transaction(async (tx) => {
          return repo.insertBlacklistTx(tx, { tenantId });
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([
      { path: "src/modules/vendor-blacklist/repo.ts", source: repoSource },
      { path: "src/modules/vendor-blacklist/consumer.ts", source: callerSource },
    ]);
    expect(violations).toEqual([]);
  });

  it("control: a function that accepts a tx-shaped param but ignores it and ALWAYS opens anyway is still flagged (the refinement requires an actual guard, not just a similarly-named param)", () => {
    const repoSource = `
      import { db } from "../../shared/db.js";
      export async function buggyAlwaysOpens(tenantId, tx) {
        return db.transaction((t) => t.select().from(x));
      }
    `;
    const callerSource = `
      import * as repo from "./repo.js";
      export async function outer(tenantId) {
        return db.transaction(async (tx) => {
          return repo.buggyAlwaysOpens(tenantId, tx);
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([
      { path: "src/modules/x/repo.ts", source: repoSource },
      { path: "src/modules/x/consumer.ts", source: callerSource },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].chain).toEqual(["buggyAlwaysOpens"]);
  });

  it("control: an unrelated if-guard (not mentioning the function's own param) does not suppress a real unconditional open", () => {
    const repoSource = `
      import { db } from "../../shared/db.js";
      export async function risky(tenantId, flag) {
        if (flag === "special") {
          return db.transaction((t) => t.select().from(x));
        }
        return db.transaction((t) => t.select().from(y));
      }
    `;
    const callerSource = `
      import * as repo from "./repo.js";
      export async function outer(tenantId) {
        return db.transaction(async (tx) => {
          return repo.risky(tenantId, "special");
        });
      }
    `;
    const violations = scanServiceForNestedTransactions([
      { path: "src/modules/x/repo.ts", source: repoSource },
      { path: "src/modules/x/consumer.ts", source: callerSource },
    ]);
    expect(violations).toHaveLength(1);
  });
});

describe("nested-tx-guard: template-literal safety (drizzle sql`` tags)", () => {
  it("does not desync function-body extraction on a sql`` tag containing parens/braces inside string text", () => {
    const source = `
      import { db } from "../../shared/db.js";
      import { sql } from "drizzle-orm";

      export async function lockRows(tx, ids) {
        return tx.execute(sql\`SELECT * FROM t WHERE id = ANY(\${ids}::uuid[]) AND (status = 'a' OR status = 'b')\`);
      }

      export async function outer(tenantId) {
        return db.transaction(async (tx) => {
          const rows = await lockRows(tx, [1, 2]);
          return rows;
        });
      }
    `;
    expect(scanServiceForNestedTransactions([{ path: "src/x.ts", source }])).toEqual([]);
  });

  it("cleanSource() preserves real code inside a template's ${...} interpolation", () => {
    const source = "const x = `value is ${scopedRead(cb)}`;";
    const clean = cleanSource(source);
    expect(clean).toContain("scopedRead(cb)");
    expect(clean).toHaveLength(source.length);
  });

  it("cleanSource() blanks string/comment content but preserves length and line count", () => {
    const source = '// scopedRead(x)\nconst s = "scopedRead(y) db.transaction(z)";\nconst n = 1;';
    const clean = cleanSource(source);
    expect(clean).toHaveLength(source.length);
    expect(clean.split("\n")).toHaveLength(3);
    expect(clean).not.toContain("scopedRead");
    expect(clean).toContain("const n = 1;");
  });
});
