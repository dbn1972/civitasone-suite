/**
 * Lighthouse CI performance baseline gate (Req 7.3, task 36).
 *
 * Asserts LCP < 2500ms and TBT < 300ms on /estab/files/list and
 * /inventory/list, per the task's original exact thresholds -- this
 * pair remains a hard ("error") gate.
 *
 * As of PERF-009 tranche 4, also collects the same metrics on one
 * representative "module home" page per MAJOR_MODULE_SLUGS entry
 * (apps/web/src/lib/helpContent.ts), expanding coverage from 2/827
 * pages. That first real run found 4 of the 9 genuinely fail TBT<300ms
 * (some severely: /citizen measured up to ~2000ms, /projects ~1968ms) --
 * real, substantive performance problems needing dedicated profiling,
 * not something to fix blindly alongside a coverage-expansion tranche
 * (filed as PERF-020 for that follow-up work). Rather than either
 * silently drop these 9 or immediately flip "Lighthouse Performance
 * Baseline" red for pre-existing issues the expansion merely revealed,
 * they're asserted at "warn" severity (matchingUrlPattern below) --
 * every run still measures and records real numbers (visible in CI
 * logs and the uploaded report), it just doesn't fail the job. The
 * original 2 pages' own gate is unchanged.
 * Runs against a
 * production build of apps/web (see the nightly.yml lighthouse job) with
 * auth handled by tests/lighthouse/puppeteer-script.js (mints the same
 * civitasone_at cookie the a11y gate already uses).
 *
 * `numberOfRuns: 3` and asserting on the median trims single-run noise —
 * Lighthouse's own timing measurements vary run to run even against a
 * static server, and a single bad sample should not flip the gate red.
 */
module.exports = {
  ci: {
    collect: {
      url: [
        "http://localhost:3000/estab/files/list",
        "http://localhost:3000/inventory/list",
        // PERF-009 tranche 4: one representative "module home" page per
        // MAJOR_MODULE_SLUGS entry (apps/web/src/lib/helpContent.ts),
        // expanding coverage from 2/827 pages. Asserted at "warn"
        // severity below (see the assert block) -- real numbers are
        // still measured and recorded every run, they just don't fail
        // the job on the pre-existing issues this expansion revealed
        // (PERF-020).
        "http://localhost:3000/finance",
        "http://localhost:3000/procurement",
        "http://localhost:3000/hr",
        "http://localhost:3000/hr/payroll",
        "http://localhost:3000/estab",
        "http://localhost:3000/grants",
        "http://localhost:3000/projects",
        "http://localhost:3000/citizen",
        "http://localhost:3000/tenant-admin",
      ],
      numberOfRuns: 3,
      puppeteerScript: "./apps/web/tests/lighthouse/puppeteer-script.js",
      settings: {
        // Server-rendered pages behind auth — skip storage-reset so the
        // puppeteerScript-set cookie survives from the warm-up navigation
        // into the audited run.
        disableStorageReset: true,
        chromeFlags: "--no-sandbox --disable-gpu",
      },
    },
    assert: {
      assertMatrix: [
        {
          // PERF-009 tranche 4's 9 new module-home pages: measure and
          // record real numbers, don't fail the job on pre-existing
          // issues the expansion revealed (see PERF-020). Anchored and
          // listed explicitly so this can never accidentally widen to
          // match the original hard-gated pair below.
          matchingUrlPattern:
            ".*/(finance|procurement|hr|hr/payroll|estab|grants|projects|citizen|tenant-admin)$",
          assertions: {
            "largest-contentful-paint": ["warn", { maxNumericValue: 2500 }],
            "total-blocking-time": ["warn", { maxNumericValue: 300 }],
          },
        },
        {
          // Original pair -- unchanged hard gate. Listed explicitly
          // (not a ".*" catch-all) so it can never also match the
          // warn-tier URLs above -- lhci applies every matching
          // assertMatrix entry cumulatively, not "first/most-specific
          // match wins", so an overlapping blanket pattern here would
          // silently re-apply the error tier to the warn-tier URLs too.
          matchingUrlPattern: ".*/(estab/files/list|inventory/list)$",
          assertions: {
            "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
            "total-blocking-time": ["error", { maxNumericValue: 300 }],
          },
        },
      ],
    },
    upload: {
      // filesystem, not temporary-public-storage: that target uploads the
      // full report (including page URLs and screen structure) to a public
      // Google-hosted server. Keeping reports local avoids sending anything
      // about this deployment to a third party.
      target: "filesystem",
      outputDir: "./.lighthouseci",
    },
  },
};
