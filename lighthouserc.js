/**
 * Lighthouse CI performance baseline gate (Req 7.3, task 36).
 *
 * Asserts LCP < 2500ms and TBT < 300ms on /estab/files/list and
 * /inventory/list (the task's original exact thresholds), plus (as of
 * PERF-009 tranche 4) one representative "module home" page per
 * MAJOR_MODULE_SLUGS entry -- the same thresholds apply to all of them.
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
        // expanding coverage from 2/827 pages. Same assertMatrix applies
        // to all URLs below (matchingUrlPattern: ".*") -- a real module
        // home failing LCP/TBT here is a genuine finding, not suppressed
        // by a looser per-page threshold.
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
          matchingUrlPattern: ".*",
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
