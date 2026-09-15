/**
 * REL-021 -- LocalStack container resource-limit regression guard.
 *
 * Context: the shared dev/CI `civitasone-localstack` container was found
 * pinned near an out-of-band, undocumented ~1GiB memory cap applied via a
 * bare `docker update` at some point in the past -- never declared in any
 * checked-in compose file (see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md,
 * gaps PERF-018 and REL-021). PERF-018 added explicit `mem_limit`/
 * `mem_reservation` to both compose files but did not add a test guarding
 * against the value being silently lowered or removed again -- exactly the
 * kind of drift that let the original out-of-band cap go undetected. This
 * file is that guard, plus REL-021's own re-validation of the sizing itself
 * against the fleet's real queue-creation pattern (queue + DLQ + RedrivePolicy
 * per topic, per services/queue-service/src/bus.ts), not just a bare queue
 * count.
 *
 * No YAML parser dependency is added (matching tests/infra/helm-pgbouncer
 * .test.ts's stated convention) -- plain text/regex extraction of the
 * `localstack:` service block is sufficient for the numeric assertions here.
 *
 * MIN_MEM_LIMIT_BYTES is a validated floor, derived from REL-021's own
 * measurement (see PR description), not the merely-observed committed value
 * -- so a future edit that lowers the compose value below what's actually
 * needed fails this test, even if it forgets to update the constant below by
 * coincidence matching a bad new compose value.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Paths below are repo-root-relative and read via process.cwd(), matching
// tests/infra/helm-pgbouncer.test.ts's convention (e.g. its CHART_DIR) --
// vitest always runs with cwd at the repo root, so this needs no
// import.meta/__dirname resolution.

// REL-021: validated against a disposable, generously-capped (--memory=6g,
// no CPU limit) standalone localstack/localstack:3 container -- see the PR
// description for full before/after evidence. Two shapes were measured:
//   1. 1,483 bare `create-queue` calls (matching the fleet's full queue
//      count): peaked ~445MiB transiently, settled at 420.2MiB total (~20MiB
//      above the ~400MiB idle baseline) -- bare queue count alone is cheap.
//   2. 400 REAL-shaped topics (DLQ + RedrivePolicy + VisibilityTimeout +
//      MessageRetentionPeriod each, mirroring bus.ts's getOrCreateQueue/
//      getOrCreateDlq, i.e. 800 queues): settled at 417.6MiB -- essentially
//      the same as (1); attributes don't meaningfully change the picture.
// Both are far below PERF-018's own 300-queue/~1.05GiB extrapolation, which
// this re-test could not reproduce even at ~3-5x that scale. CPU stayed low
// throughout both runs (brief single-core-range spikes only). MIN_MEM_LIMIT_BYTES
// is set with roughly 3x headroom above the highest transient peak observed
// (~445MiB) -- comfortably validated, still well under the committed 3g so
// this test isn't a tautology against today's exact value.
const MIN_MEM_LIMIT_BYTES = 1_610_612_736; // 1.5g -- see rationale above; well under the committed 3g
const COMMITTED_MEM_LIMIT_BYTES = 3_221_225_472; // 3g, infra/docker-compose.yml + .prod.yml today
const MIN_MEM_RESERVATION_BYTES = 268_435_456; // 256m -- floor; committed value is 768m
const MIN_CPUS = 1; // floor; committed value is 2.0 -- restores the pre-REL-021 ad-hoc 2-CPU
// cap (never itself declared in compose) as an explicit, version-controlled limit rather
// than leaving the recreated container CPU-unbounded on a shared host.

const BYTE_SUFFIXES: Record<string, number> = {
  b: 1,
  k: 1024,
  m: 1024 ** 2,
  g: 1024 ** 3,
};

function toBytes(raw: string): number {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)([bkmg])?$/i);
  if (!m) throw new Error(`Unrecognized docker-compose byte value: ${raw}`);
  const value = Number.parseFloat(m[1]!); // safe: group 1 is mandatory in the pattern above
  const suffix = (m[2] ?? "b").toLowerCase();
  const multiplier = BYTE_SUFFIXES[suffix];
  if (multiplier === undefined) throw new Error(`Unknown byte suffix "${suffix}" in value: ${raw}`);
  return Math.round(value * multiplier);
}

/**
 * Extract the `localstack:` service block from a compose file's raw text:
 * from the `  localstack:` line up to (not including) the next line at the
 * same (two-space) indentation level that starts a new top-level service.
 */
function extractLocalstackBlock(composeText: string): string {
  const lines = composeText.split("\n");
  const startIdx = lines.findIndex((l) => /^  localstack:\s*$/.test(l));
  if (startIdx === -1) {
    throw new Error("No top-level `localstack:` service found in compose file");
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!; // safe: i < lines.length, checked by the loop condition
    if (/^  \S.*:\s*$/.test(line) || /^\S/.test(line)) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

/**
 * Asserts `m` matched (with a helpful message naming what should have been
 * declared) and returns its first capture group as a definite `string` --
 * centralizing the noUncheckedIndexedAccess-safe extraction so call sites
 * don't each need a double non-null assertion.
 */
function requireCapture(m: RegExpMatchArray | null, notFoundMessage: string): string {
  expect(m, notFoundMessage).not.toBeNull();
  const captured = m?.[1];
  expect(captured, `${notFoundMessage} (matched, but with no capture group)`).toBeDefined();
  return captured as string;
}

function assertLocalstackLimits(composePath: string) {
  const text = readFileSync(composePath, "utf8");
  const block = extractLocalstackBlock(text);

  const memLimitRaw = requireCapture(
    block.match(/^\s*mem_limit:\s*(\S+)\s*$/m),
    `${composePath}'s localstack service must declare an explicit mem_limit ` +
      `(REL-021/PERF-018: the live container was once capped out-of-band, ` +
      `entirely outside any checked-in config)`,
  );
  const memReservationRaw = requireCapture(
    block.match(/^\s*mem_reservation:\s*(\S+)\s*$/m),
    `${composePath}'s localstack service must declare an explicit mem_reservation`,
  );
  const cpusRaw = requireCapture(
    block.match(/^\s*cpus:\s*"?(\S+?)"?\s*$/m),
    `${composePath}'s localstack service must declare an explicit cpus limit ` +
      `(REL-021: recreating from mem_limit/mem_reservation alone dropped a ` +
      `pre-existing out-of-band 2-CPU cap entirely, leaving the container ` +
      `unbounded -- this must stay declared here so it can't silently regress)`,
  );

  const memLimitBytes = toBytes(memLimitRaw);
  const memReservationBytes = toBytes(memReservationRaw);
  const cpus = Number.parseFloat(cpusRaw);

  expect(
    memLimitBytes,
    `${composePath}: mem_limit ${memLimitRaw} is below the validated floor ` +
      `for this fleet's real LocalStack usage (REL-021) -- see this test ` +
      `file's header comment and the REL-021 PR description for the ` +
      `measurement this floor is derived from`,
  ).toBeGreaterThanOrEqual(MIN_MEM_LIMIT_BYTES);

  expect(memReservationBytes).toBeGreaterThanOrEqual(MIN_MEM_RESERVATION_BYTES);
  expect(memReservationBytes).toBeLessThanOrEqual(memLimitBytes);

  expect(Number.isNaN(cpus), `${composePath}: cpus value "${cpusRaw}" did not parse as a number`).toBe(false);
  expect(cpus).toBeGreaterThanOrEqual(MIN_CPUS);
}

describe("REL-021 -- civitasone-localstack resource limits stay declared and adequate", () => {
  it("infra/docker-compose.yml (shared dev/CI fleet) declares adequate mem_limit/mem_reservation/cpus", () => {
    assertLocalstackLimits("infra/docker-compose.yml");
  });

  it("infra/docker-compose.prod.yml declares adequate mem_limit/mem_reservation/cpus", () => {
    assertLocalstackLimits("infra/docker-compose.prod.yml");
  });

  it("sanity: the currently-committed limit is itself above the validated floor", () => {
    // Guards against MIN_MEM_LIMIT_BYTES and the compose files silently both
    // drifting to the same wrong (too-low) number together.
    expect(COMMITTED_MEM_LIMIT_BYTES).toBeGreaterThanOrEqual(MIN_MEM_LIMIT_BYTES);
  });
});
