/**
 * UX-005 tranche 9 — runs exactly once per overall `playwright test`
 * invocation, in the main process, before any worker starts. Unlike
 * `beforeAll`/`afterAll` inside a11y.spec.ts, this does NOT re-run when
 * Playwright recycles a worker mid-run (see that file's header comment for
 * why that distinction is the whole point of this file existing).
 *
 * Clears stale fragments from a PREVIOUS invocation so this run's aggregate
 * test only ever sees fragments this run itself produced — without this, a
 * curated run's leftover fragments could bleed into a later full-mode run
 * (or vice versa) and double-count or misattribute routes.
 */
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const FRAGMENTS_DIR = join(__dirname, ".a11y-fragments");

export default function globalSetup(): void {
  rmSync(FRAGMENTS_DIR, { recursive: true, force: true });
  mkdirSync(FRAGMENTS_DIR, { recursive: true });
}
