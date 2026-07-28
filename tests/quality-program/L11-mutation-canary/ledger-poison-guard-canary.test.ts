/**
 * L11 — Canaries for scripts/ci/test-ledger-poison-guard.mjs
 *
 * THE DEFECT THE GUARD EXISTS FOR
 * inventory-service tests/batch-consumer.test.ts published two hardcoded message
 * ids and never cleared them from `_inbox.processed`. `markProcessed()` returns
 * false for a known id and the consumer then RETURNS — no insert, no throw, so no
 * retry and no dead letter. The first ever run passed, recorded both ids, and every
 * run after found 0 rows and 0 dead letters. It was carried in the scorecard as a
 * suspected concurrency defect in the consumer; the consumer was fine.
 *
 * WHY CANARIES, AND WHY PERMANENT ONES
 * Two guards in this programme shipped unable to fail — a regex matching `-h`
 * inside `--health-interval`, and a guard wired into no workflow. A gate is worth
 * exactly what its failure path is worth, and one proven only at authoring time is
 * unprotected against every later edit.
 *
 * METHOD
 * The guard accepts LEDGER_GUARD_SERVICES_DIR and LEDGER_GUARD_ALLOWLIST, so each
 * canary builds a small fixture tree plus its own allow-list in a temp directory
 * instead of copying 948 real test files. Exemption hygiene is therefore testable
 * rather than untestable-by-construction. Nothing under version control is touched.
 *
 * Every assertion checks the MESSAGE as well as the exit code: an
 * exit-1-for-the-wrong-reason is exactly how the earlier guard bug hid.
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(__dirname, "../../..");
const GUARD = join(REPO_ROOT, "scripts/ci/test-ledger-poison-guard.mjs");

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const d = created.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

interface Fixture {
  /** e.g. "widget-service/tests/thing.test.ts" */
  path: string;
  content: string;
}

interface Sandbox {
  servicesDir: string;
  allowlistPath: string;
}

function makeSandbox(files: Fixture[], entries: Record<string, string> = {}): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "ledger-guard-canary-"));
  created.push(root);
  const servicesDir = join(root, "services");
  for (const f of files) {
    const full = join(servicesDir, f.path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, f.content);
  }
  mkdirSync(servicesDir, { recursive: true });
  const allowlistPath = join(root, "allowlist.json");
  writeFileSync(allowlistPath, JSON.stringify({ generatedAt: "canary", entries }, null, 2));
  return { servicesDir, allowlistPath };
}

function runGuard(sb: Sandbox): { exitCode: number; output: string } {
  try {
    const out = execFileSync("node", [GUARD], {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        LEDGER_GUARD_SERVICES_DIR: sb.servicesDir,
        LEDGER_GUARD_ALLOWLIST: sb.allowlistPath,
      },
    });
    return { exitCode: 0, output: out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { exitCode: err.status ?? -1, output: `${err.stdout ?? ""}\n${err.stderr ?? ""}` };
  }
}

/** Publishes a fixed messageId against a real database, and never clears it. */
const POISONER = `
import { queue } from "../src/shared/infra.js";
it("does a thing", async () => {
  await queue.publish("x.y", { messageId: "aaaaaaaa-0000-4000-8000-000000000001", payload: {} });
});
`;

/** Same, but clears the ledger. */
const POISONER_FIXED = `
import { queue } from "../src/shared/infra.js";
import { processed } from "../src/shared/outbox.js";
async function cleanup() {
  await db.transaction(async (tx) => { await tx.delete(processed); });
}
it("does a thing", async () => {
  await cleanup();
  await queue.publish("x.y", { messageId: "aaaaaaaa-0000-4000-8000-000000000001", payload: {} });
});
`;

/** Same fixed id, but persistence is mocked so the ledger is unreachable. */
const POISONER_MOCKED = `
vi.mock("../src/shared/db.js", () => ({ db: {} }));
it("does a thing", async () => {
  await queue.publish("x.y", { messageId: "aaaaaaaa-0000-4000-8000-000000000001", payload: {} });
});
`;

/**
 * The id is fixed but bound to a const first. This is the shape the guard
 * originally MISSED — and it is the shape inventory-service's own test took after
 * its ids were lifted into a RACE_MESSAGE_IDS constant. A guard that only matches
 * `messageId: "literal"` stops working the moment someone tidies up.
 */
const POISONER_VIA_CONST = `
import { queue } from "../src/shared/infra.js";
const FIXED_ID = "aaaaaaaa-0000-4000-8000-000000000009";
it("does a thing", async () => {
  await queue.publish("x.y", { messageId: FIXED_ID, payload: {} });
});
`;

/** Same, via an array destructured into locals — the other common spelling. */
const POISONER_VIA_ARRAY = `
import { queue } from "../src/shared/infra.js";
const IDS = ["aaaaaaaa-0000-4000-8000-00000000000a", "aaaaaaaa-0000-4000-8000-00000000000b"];
const [first, second] = IDS;
it("does a thing", async () => {
  await queue.publish("x.y", { messageId: first, payload: {} });
  await queue.publish("x.y", { messageId: second, payload: {} });
});
`;

/**
 * A uuid literal that never reaches messageId. Must NOT be flagged: tenant and
 * actor ids are hardcoded in almost every test, and flagging on their presence
 * alone would swamp the signal and get the guard disabled.
 */
const UUID_BUT_NOT_A_MESSAGE_ID = `
import { queue } from "../src/shared/infra.js";
const TENANT = "aaaaaaaa-0000-4000-8000-00000000000c";
it("does a thing", async () => {
  await queue.publish("x.y", { messageId: crypto.randomUUID(), tenantId: TENANT, payload: {} });
});
`;

const POISON_PATH = "widget-service/tests/poison.test.ts";
const FIXED_PATH = "widget-service/tests/fixed.test.ts";

describe("L11 — Canary: test-ledger-poison-guard is not vacuous", () => {
  it("CANARY: a hardcoded messageId with no ledger cleanup is caught", () => {
    const r = runGuard(makeSandbox([{ path: POISON_PATH, content: POISONER }]));
    expect(r.exitCode, "a poisoning test was NOT caught").toBe(1);
    expect(r.output).toContain("can poison their own idempotency ledger");
    expect(r.output).toContain(POISON_PATH);
  });

  it("CANARY: clearing the ledger in the same file makes it pass", () => {
    // Proves the guard reacts to the FIX, not merely to the presence of a fixed id
    // — otherwise it would be unsatisfiable and therefore useless.
    const r = runGuard(makeSandbox([{ path: FIXED_PATH, content: POISONER_FIXED }]));
    expect(r.exitCode, `a compliant file was rejected:\n${r.output}`).toBe(0);
    expect(r.output).toContain("CLEAN");
  });

  it("CANARY: listing the offender in the allow-list suppresses it", () => {
    const r = runGuard(
      makeSandbox([{ path: POISON_PATH, content: POISONER }], {
        [POISON_PATH]: "canary: tracked with a reason",
      }),
    );
    expect(r.exitCode, `an allow-listed file still failed:\n${r.output}`).toBe(0);
    expect(r.output).toMatch(/exemptions matched\s*:\s*1\/1/);
  });

  it("CANARY: an allow-list entry with no written reason is rejected", () => {
    const r = runGuard(
      makeSandbox([{ path: POISON_PATH, content: POISONER }], { [POISON_PATH]: "   " }),
    );
    expect(r.exitCode, "a reasonless exemption was accepted").toBe(1);
    expect(r.output).toContain("no written reason");
  });

  it("CANARY: a stale allow-list entry is caught", () => {
    // The file now clears the ledger, so its exemption is obsolete. Leaving it
    // listed would let the defect be reintroduced for free.
    const r = runGuard(
      makeSandbox([{ path: FIXED_PATH, content: POISONER_FIXED }], {
        [FIXED_PATH]: "canary: obsolete, the file was fixed",
      }),
    );
    expect(r.exitCode, "a stale exemption was NOT caught").toBe(1);
    expect(r.output).toContain("stale exemption");
    expect(r.output).toContain(FIXED_PATH);
  });

  it("CANARY: a mocked persistence layer is exempt by construction, not by allow-list", () => {
    const r = runGuard(
      makeSandbox([
        { path: "widget-service/tests/mocked.test.ts", content: POISONER_MOCKED },
        // A real candidate is needed as well, or the run is legitimately UNMEASURED.
        { path: FIXED_PATH, content: POISONER_FIXED },
      ]),
    );
    expect(r.exitCode, `a mocked file was wrongly flagged:\n${r.output}`).toBe(0);
    expect(r.output).toMatch(/hardcoded messageId, mocked\s*:\s*1/);
  });

  it("CANARY: no candidates found reports UNMEASURED, not success", () => {
    // The failure mode this programme keeps finding: a check that inspects nothing
    // and reports a pass.
    const r = runGuard(
      makeSandbox([
        {
          path: "widget-service/tests/harmless.test.ts",
          content: 'it("no message ids here", () => { expect(1).toBe(1); });',
        },
      ]),
    );
    expect(r.exitCode, "an empty scan reported success").toBe(1);
    expect(r.output).toContain("UNMEASURED");
  });

  it("CANARY: an empty services directory reports UNMEASURED", () => {
    const r = runGuard(makeSandbox([]));
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("UNMEASURED");
  });

  it("CANARY: a hardcoded messageId via a CONST is caught (the detection gap that missed inventory)", () => {
    // The guard originally only matched `messageId: "literal"`. That would NOT
    // have flagged inventory-service's serial-race test after its ids were lifted
    // into RACE_MESSAGE_IDS. This canary pins the broader detection.
    const r = runGuard(makeSandbox([{ path: "widget-service/tests/via-const.test.ts", content: POISONER_VIA_CONST }]));
    expect(r.exitCode, "a const-bound fixed id was NOT caught").toBe(1);
    expect(r.output).toContain("can poison their own idempotency ledger");
    expect(r.output).toContain("via-const.test.ts");
  });

  it("CANARY: a hardcoded messageId via array destructuring is caught", () => {
    const r = runGuard(makeSandbox([{ path: "widget-service/tests/via-array.test.ts", content: POISONER_VIA_ARRAY }]));
    expect(r.exitCode, "an array-destructured fixed id was NOT caught").toBe(1);
    expect(r.output).toContain("via-array.test.ts");
  });

  it("CANARY: a uuid literal that does NOT reach messageId is NOT flagged", () => {
    // Tenant ids, actor ids, etc. are hardcoded everywhere. A guard that flagged
    // on their presence alone would swamp the signal and get disabled within a
    // month. This proves the false-positive path is absent.
    const r = runGuard(
      makeSandbox([
        { path: "widget-service/tests/not-a-msgid.test.ts", content: UUID_BUT_NOT_A_MESSAGE_ID },
        // A real candidate is needed too, or UNMEASURED fires.
        { path: "widget-service/tests/fixed.test.ts", content: POISONER_FIXED },
      ]),
    );
    expect(r.exitCode, `a non-messageId uuid was wrongly flagged:\n${r.output}`).toBe(0);
    expect(r.output).toContain("CLEAN");
  });

  it("CANARY: a malformed allow-list is rejected, not read as empty", () => {
    const sb = makeSandbox([{ path: POISON_PATH, content: POISONER }]);
    writeFileSync(sb.allowlistPath, '{"entries": "not-an-object"}');
    const r = runGuard(sb);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("malformed");
  });

  it("CANARY: a missing allow-list is rejected, not treated as no exemptions", () => {
    const sb = makeSandbox([{ path: POISON_PATH, content: POISONER }]);
    rmSync(sb.allowlistPath);
    const r = runGuard(sb);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("allow-list not found");
  });

  it("the real repository passes, and every exemption still matches a real file", () => {
    const r = runGuard({
      servicesDir: join(REPO_ROOT, "services"),
      allowlistPath: join(REPO_ROOT, "scripts/ci/test-ledger-poison-allowlist.json"),
    });
    expect(r.exitCode, `the real repo violates the guard:\n${r.output}`).toBe(0);
    expect(r.output).toContain("CLEAN");
    // n/n — a stale entry would make these differ and fail the run above anyway.
    expect(r.output).toMatch(/exemptions matched\s*:\s*(\d+)\/\1/);
  });
});
